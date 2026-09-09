import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

// Actual handler and provider adapter, with synthetic HTTP/Auth/Storage/RPC boundaries.
// The override permits checking the exact deployed helper before and after repair.
const root=new URL('../supabase/functions/',import.meta.url),moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const helper=await readFile(process.env.GM_AUDIT_AI_SERVICE||new URL('_shared/ai-service.ts',root),'utf8');
const service=moduleUrl(stripTypeScriptTypes(helper.replace("import {createClient} from 'npm:@supabase/supabase-js@2.95.0';",'const createClient=(...args)=>globalThis.__knowledgeProviderClient(...args);').replace("'./response-parser.js'",JSON.stringify(new URL('_shared/response-parser.js',root).href))));
const entry=await readFile(process.env.GM_AUDIT_INGEST_ENTRY||new URL('gm-knowledge-ingest/index.ts',root),'utf8');
let serial=0;
const valid={summary:'Synthetic reference',warnings:[],chunks:[{heading:'Rule',source_locator:'Section 1',content:'Synthetic complete source rule.'}]};
const completed={id:'synthetic-response',status:'completed',output_text:JSON.stringify(valid),usage:{input_tokens:100,output_tokens:50}};
async function run(t,payload){
  const calls=[],saved=[],previousDeno=globalThis.Deno,previousClient=globalThis.__knowledgeProviderClient;let handler;
  const client={auth:{getUser:async()=>({data:{user:{id:'synthetic-owner'}}})},from(){const q={select:()=>q,eq:()=>q,single:async()=>({data:{id:'00000000-0000-4000-8000-000000000001',status:'PROCESSING',requested_status:'ACTIVE',source_file_name:'synthetic.txt',storage_path:'synthetic.txt',content_type:'text/plain',official_documents:{game_id:'synthetic-game',title:'Synthetic',document_type:'CUSTOM'}}}),maybeSingle:async()=>({data:{member_role:'owner'}})};return q;},storage:{from:()=>({download:async()=>({data:new Blob(['Synthetic reference'])})})},rpc:async(name,args)=>{calls.push(name);saved.push({name,args});return {data:name==='claim_knowledge_ingestion_internal'?true:null};}};
  globalThis.__knowledgeProviderClient=()=>client;
  globalThis.Deno={serve:callback=>{handler=callback},env:{get:name=>({OPENAI_API_KEY:'synthetic-key',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'})[name]}};
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer synthetic-key');calls.push(url);
    if(url==='https://api.openai.com/v1/responses')return Response.json(payload);
    assert.equal(url,'https://api.openai.com/v1/embeddings');return Response.json({data:[{index:0,embedding:Array(1536).fill(0)}]});
  });
  t.after(()=>{if(previousDeno===undefined)delete globalThis.Deno;else globalThis.Deno=previousDeno;if(previousClient===undefined)delete globalThis.__knowledgeProviderClient;else globalThis.__knowledgeProviderClient=previousClient;});
  await import(moduleUrl(stripTypeScriptTypes(entry.replace("'../_shared/ai-service.ts'",JSON.stringify(service)))+'\n// provider validation '+serial++));
  const response=await handler(new Request('https://synthetic.invalid/index',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({documentVersionId:'00000000-0000-4000-8000-000000000001'})}));
  return {status:response.status,body:await response.json(),calls,saved};
}
for(const [name,payload,code] of [
  ['truncated valid JSON',{...completed,status:'incomplete',incomplete_details:{reason:'max_output_tokens'}},'AI_RESPONSE_TRUNCATED'],
  ['filtered valid JSON',{...completed,status:'incomplete',incomplete_details:{reason:'content_filter'}},'AI_RESPONSE_FILTERED'],
  ['unspecified incomplete valid JSON',{...completed,status:'incomplete'},'AI_RESPONSE_INCOMPLETE'],
  ['failed valid JSON',{...completed,status:'failed'},'AI_RESPONSE_FAILED'],
  ['refusal alongside valid JSON',{...completed,output:[{content:[{type:'refusal',refusal:'Synthetic refusal'}]}]},'AI_RESPONSE_REFUSED'],
  ['malformed JSON',{...completed,output_text:'{'},'AI_RESPONSE_INVALID_JSON'],
  ['empty response',{...completed,output_text:''},'AI_RESPONSE_EMPTY'],
])test('knowledge indexing rejects '+name+' before embeddings or activation',async t=>{
  const r=await run(t,payload);assert.equal(r.status,502);assert.equal(r.body.code,code);
  assert.equal(r.calls.filter(c=>c==='https://api.openai.com/v1/responses').length,1);
  assert.ok(!r.calls.includes('https://api.openai.com/v1/embeddings'));
  assert.ok(!r.calls.includes('complete_claimed_knowledge_ingestion_internal'));
  assert.equal(r.calls.filter(c=>c==='fail_claimed_knowledge_ingestion_internal').length,1);
  assert.equal(r.saved.find(c=>c.name==='fail_claimed_knowledge_ingestion_internal').args.target_claim_id,r.saved[0].args.target_claim_id);
});
test('complete reference indexes once and preserves the exact extracted passage',async t=>{
  const r=await run(t,completed);assert.equal(r.status,200);assert.equal(r.body.status,'ACTIVE');
  assert.equal(r.calls.filter(c=>c==='complete_claimed_knowledge_ingestion_internal').length,1);
  assert.equal(r.saved.find(c=>c.name==='complete_claimed_knowledge_ingestion_internal').args.target_chunks[0].content,valid.chunks[0].content);
  assert.ok(!r.calls.includes('fail_claimed_knowledge_ingestion_internal'));
});
test('complete response output content works without an output_text convenience field',async t=>{
  const payload={...completed};delete payload.output_text;payload.output=[{content:[{type:'output_text',text:JSON.stringify(valid)}]}];
  const r=await run(t,payload);assert.equal(r.status,200);assert.equal(r.body.chunks,1);
});
