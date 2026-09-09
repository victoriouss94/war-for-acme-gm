import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

const root=new URL('../supabase/functions/',import.meta.url);
const dataModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const serviceSource=await readFile(process.env.GM_AUDIT_EMBEDDING_SERVICE||new URL('_shared/ai-service.ts',root),'utf8');
const serviceUrl=dataModule(stripTypeScriptTypes(serviceSource
  .replace("import {createClient} from 'npm:@supabase/supabase-js@2.95.0';","const createClient=(...args)=>globalThis.__embeddingAuditClient(...args);")
  .replace("'./response-parser.js'",JSON.stringify(new URL('_shared/response-parser.js',root).href))));
const {createEmbeddings}=await import(serviceUrl);
const vector=value=>Array(1536).fill(value);
const row=(index,value=0.1)=>({index,embedding:vector(value)});
function environment(t){
  const previous=globalThis.Deno;
  globalThis.Deno={env:{get:name=>({OPENAI_API_KEY:'synthetic-key',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key'})[name]},serve:()=>{}};
  t.after(()=>{if(previous===undefined)delete globalThis.Deno;else globalThis.Deno=previous});
}
function mockEmbeddings(t,data,status=200){
  environment(t);let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/embeddings');assert.equal(options.headers.Authorization,'Bearer synthetic-key');calls++;
    return Response.json(status===200?{data,usage:{prompt_tokens:12,total_tokens:12}}:{error:{code:'insufficient_quota'}},{status});
  });return ()=>calls;
}
test('valid out-of-order embeddings retain exact input association and usage',async t=>{
  const calls=mockEmbeddings(t,[row(1,0.2),row(0,0.1)]),result=await createEmbeddings(['first','second']);
  assert.equal(result.vectors[0][0],0.1);assert.equal(result.vectors[1][0],0.2);
  assert.deepEqual(result.usage,{prompt_tokens:12,total_tokens:12});assert.equal(calls(),1);
});
for(const [name,data] of [
  ['duplicate indexes',[row(0),row(0)]],['missing index',[row(0),{embedding:vector(0.2)}]],
  ['negative index',[row(-1),row(0)]],['out-of-range index',[row(0),row(2)]],
  ['fractional index',[row(0),row(0.5)]],['extra vectors',[row(0),row(1),row(2)]],
])test('embedding response rejects '+name,async t=>{
  const calls=mockEmbeddings(t,data);await assert.rejects(createEmbeddings(['first','second']),{code:'INVALID_EMBEDDING_RESPONSE'});assert.equal(calls(),1);
});
for(const value of [null,'0',{}])test('embedding response rejects non-numeric vector member '+JSON.stringify(value),async t=>{
  const data=[row(0),row(1)];data[0].embedding[0]=value;
  mockEmbeddings(t,data);await assert.rejects(createEmbeddings(['first','second']),{code:'INVALID_EMBEDDING_RESPONSE'});
});
test('dimension mismatch is rejected',async t=>{
  mockEmbeddings(t,[{index:0,embedding:[0.1]}]);await assert.rejects(createEmbeddings(['first']),{code:'INVALID_EMBEDDING_RESPONSE'});
});
test('provider credit errors remain distinct from invalid embeddings',async t=>{
  mockEmbeddings(t,[],429);await assert.rejects(createEmbeddings(['first']),{code:'OPENAI_CREDITS_REQUIRED',status:402});
});

for(const valid of [false,true])test('actual ingestion handler '+(valid?'saves correctly associated passages':'does not activate corrupted embeddings'),async t=>{
  environment(t);let handler;globalThis.Deno.serve=callback=>{handler=callback};
  const calls=[],chunks=[{heading:'One',source_locator:'1',content:'First passage.'},{heading:'Two',source_locator:'2',content:'Second passage.'}];
  const client={auth:{getUser:async()=>({data:{user:{id:'synthetic-gm'}}})},from(table){const query={select(){return query},eq(){return query},single:async()=>({data:{id:'00000000-0000-4000-8000-000000000001',status:'PROCESSING',requested_status:'ACTIVE',source_file_name:'audit.txt',storage_path:'synthetic/audit.txt',content_type:'text/plain',official_documents:{game_id:'synthetic-game',title:'Audit',document_type:'RULES'}}}),maybeSingle:async()=>({data:{member_role:'owner'}})};return query},storage:{from:()=>({download:async()=>({data:new Blob(['Synthetic source'])})})},rpc:async(name,args)=>{calls.push({name,args});return {data:name==='claim_knowledge_ingestion_internal'?true:{},error:null}}};
  const previous=globalThis.__embeddingAuditClient;globalThis.__embeddingAuditClient=()=>client;t.after(()=>{if(previous===undefined)delete globalThis.__embeddingAuditClient;else globalThis.__embeddingAuditClient=previous});
  t.mock.method(globalThis,'fetch',async(url)=>{
    if(url==='https://api.openai.com/v1/responses')return Response.json({status:'completed',id:'synthetic-response',output_text:JSON.stringify({summary:'Audit',warnings:[],chunks})});
    assert.equal(url,'https://api.openai.com/v1/embeddings');return Response.json({data:valid?[row(1,0.2),row(0,0.1)]:[row(0),row(0)]});
  });
  const source=(await readFile(new URL('gm-knowledge-ingest/index.ts',root),'utf8')).replace("'../_shared/ai-service.ts'",JSON.stringify(serviceUrl));
  await import(dataModule(stripTypeScriptTypes(source)+'\n// test '+valid));
  const response=await handler(new Request('https://synthetic.invalid/ingest',{method:'POST',headers:{Authorization:'Bearer synthetic-user-token','Content-Type':'application/json'},body:JSON.stringify({documentVersionId:'00000000-0000-4000-8000-000000000001'})}));
  const body=await response.json();
  if(valid){assert.equal(response.status,200);assert.equal(body.status,'ACTIVE');const saved=calls.find(c=>c.name==='complete_claimed_knowledge_ingestion_internal');assert.equal(saved.args.target_chunks[0].embedding[0],0.1);assert.equal(saved.args.target_chunks[1].embedding[0],0.2);}
  else{assert.equal(response.status,502);assert.equal(body.code,'INVALID_EMBEDDING_RESPONSE');assert.ok(!calls.some(c=>c.name==='complete_claimed_knowledge_ingestion_internal'));assert.ok(calls.some(c=>c.name==='fail_claimed_knowledge_ingestion_internal'));}
});
