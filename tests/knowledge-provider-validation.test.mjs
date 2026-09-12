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
async function run(t,payload,{reservationError='',accountingFailure=false,embeddingFailure=false,saveFailure=false,embeddingReservationError='',invalidEmbedding=false}={}){
  t.mock.method(console,'error',()=>{});
  const calls=[],saved=[],previousDeno=globalThis.Deno,previousClient=globalThis.__knowledgeProviderClient;let handler;
  const client={auth:{getUser:async()=>({data:{user:{id:'synthetic-owner'}}})},from(){const q={select:()=>q,eq:()=>q,single:async()=>({data:{id:'00000000-0000-4000-8000-000000000001',status:'PROCESSING',requested_status:'ACTIVE',source_file_name:'synthetic.txt',storage_path:'synthetic.txt',content_type:'text/plain',official_documents:{game_id:'synthetic-game',title:'Synthetic',document_type:'CUSTOM'}}}),maybeSingle:async()=>({data:{member_role:'owner'}})};return q;},storage:{from:()=>({download:async()=>({data:new Blob(['Synthetic reference'])})})},rpc:async(name,args)=>{calls.push(name);saved.push({name,args});if(name==='reserve_ai_usage_internal'&&args.target_model==='text-embedding-3-small'&&embeddingReservationError)return {error:{message:embeddingReservationError}};if(name==='reserve_ai_usage_internal')return reservationError?{error:{message:reservationError}}:{data:args.target_request_id};if(name==='complete_ai_usage_internal'&&accountingFailure)return {error:{code:'42501',message:'Synthetic denied'}};if(name==='complete_claimed_knowledge_ingestion_internal'&&saveFailure)return {error:{message:'Synthetic save failure'}};return {data:name==='claim_knowledge_ingestion_internal'?true:null};}};
  globalThis.__knowledgeProviderClient=()=>client;
  globalThis.Deno={serve:callback=>{handler=callback},env:{get:name=>({OPENAI_API_KEY:'synthetic-key',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'})[name]}};
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer synthetic-key');calls.push(url);
    if(url==='https://api.openai.com/v1/responses')return Response.json(payload);
    assert.equal(url,'https://api.openai.com/v1/embeddings');if(invalidEmbedding)return Response.json({data:[],usage:{prompt_tokens:17,total_tokens:17}});if(embeddingFailure)throw Error('Synthetic embedding failure');return Response.json({data:[{index:0,embedding:Array(1536).fill(0)}],usage:{prompt_tokens:17,total_tokens:17}});
  });
  t.after(()=>{if(previousDeno===undefined)delete globalThis.Deno;else globalThis.Deno=previousDeno;if(previousClient===undefined)delete globalThis.__knowledgeProviderClient;else globalThis.__knowledgeProviderClient=previousClient;});
  await import(moduleUrl(stripTypeScriptTypes(entry.replace("'../_shared/ai-service.ts'",JSON.stringify(service)).replace("'../_shared/usage-accounting.js'",JSON.stringify(new URL('_shared/usage-accounting.js',root).href)))+'\n// provider validation '+serial++));
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

for(const code of ['AI_MONTHLY_LIMIT_REACHED','AI_RATE_LIMIT_REACHED','Synthetic private error'])test('ingestion reservation denial prevents paid work: '+code,async t=>{
  const r=await run(t,completed,{reservationError:code});
  assert.equal(r.status,code.startsWith('AI_')?429:503);
  assert.equal(r.body.code,code.startsWith('AI_')?code:'AI_USAGE_RESERVATION_FAILED');
  assert.ok(!r.calls.some(c=>c.startsWith('https://api.openai.com/')));
  assert.ok(!r.calls.includes('complete_ai_usage_internal'));
  assert.equal(r.calls.filter(c=>c==='fail_claimed_knowledge_ingestion_internal').length,1);
  assert.doesNotMatch(r.body.error,/Synthetic private/);
});

for(const [name,payload,options,status] of [
  ['success',completed,{},200],
  ['parse failure',{...completed,output_text:'{'},{},502],
  ['embedding failure',completed,{embeddingFailure:true},502],
  ['save failure',completed,{saveFailure:true},500]
])test('ingestion records extraction usage after '+name,async t=>{
  const r=await run(t,payload,options);assert.equal(r.status,status);
  const reserve=r.saved.find(x=>x.name==='reserve_ai_usage_internal'),records=r.saved.filter(x=>x.name==='complete_ai_usage_internal'&&x.args.target_request_id===reserve.args.target_request_id);
  assert.equal(reserve.args.target_feature,'knowledge_ingest');assert.equal(records.length,1);
  assert.equal(records[0].args.target_request_id,reserve.args.target_request_id);
  assert.equal(records[0].args.target_input_tokens,100);assert.equal(records[0].args.target_output_tokens,50);
  assert.equal(records[0].args.target_estimated_cost_usd,.001);
  assert.equal(records[0].args.target_provider_response_id,'synthetic-response');
  assert.equal(records[0].args.target_status,status===200?'COMPLETED':'FAILED');
  assert.ok(r.calls.indexOf('reserve_ai_usage_internal')<r.calls.indexOf('https://api.openai.com/v1/responses'));
  assert.equal(r.calls.filter(c=>c==='https://api.openai.com/v1/responses').length,1);
});

test('ingestion embedding budget denial retains extraction charge without embedding call',async t=>{
  const r=await run(t,completed,{embeddingReservationError:'AI_MONTHLY_LIMIT_REACHED'});assert.equal(r.status,429);
  assert.equal(r.calls.filter(c=>c==='https://api.openai.com/v1/responses').length,1);assert.ok(!r.calls.includes('https://api.openai.com/v1/embeddings'));
  const records=r.saved.filter(x=>x.name==='complete_ai_usage_internal');assert.equal(records.length,1);assert.equal(records[0].args.target_input_tokens,100);assert.equal(records[0].args.target_status,'FAILED');assert.ok(!r.calls.includes('complete_claimed_knowledge_ingestion_internal'));
});
for(const options of [{saveFailure:true},{invalidEmbedding:true}])test('ingestion preserves separate embedding charge on downstream failure '+JSON.stringify(options),async t=>{
  const r=await run(t,completed,options);assert.equal(r.status,options.saveFailure?500:502);
  const reserve=r.saved.find(x=>x.name==='reserve_ai_usage_internal'&&x.args.target_model==='text-embedding-3-small'),record=r.saved.find(x=>x.name==='complete_ai_usage_internal'&&x.args.target_request_id===reserve.args.target_request_id);
  assert.equal(record.args.target_input_tokens,17);assert.equal(record.args.target_status,options.saveFailure?'COMPLETED':'FAILED');assert.equal(r.calls.filter(c=>c==='https://api.openai.com/v1/embeddings').length,1);
});

test('knowledge indexing records embeddings separately from response-model usage',async t=>{
  const r=await run(t,completed);assert.equal(r.status,200);
  const reserve=r.saved.find(x=>x.name==='reserve_ai_usage_internal'&&x.args.target_model==='text-embedding-3-small');
  assert.ok(reserve,'Embedding request must have its own priced ledger row');
  const record=r.saved.find(x=>x.name==='complete_ai_usage_internal'&&x.args.target_request_id===reserve.args.target_request_id);
  assert.ok(record);assert.equal(record.args.target_input_tokens,17);assert.equal(record.args.target_output_tokens,0);assert.equal(record.args.target_estimated_cost_usd,17*.02/1_000_000);
});

test('ingestion accounting failure keeps saved document and warns without paid retry',async t=>{
  const r=await run(t,completed,{accountingFailure:true});
  assert.equal(r.status,200);assert.equal(r.body.status,'ACTIVE');assert.equal(r.body.accounting.recorded,false);
  assert.match(r.body.accounting_warning,/usage could not be saved/i);
  assert.equal(r.calls.filter(c=>c==='complete_claimed_knowledge_ingestion_internal').length,1);
  assert.equal(r.saved.filter(c=>c.name==='complete_ai_usage_internal'&&c.args.target_request_id===r.saved.find(x=>x.name==='reserve_ai_usage_internal').args.target_request_id).length,1);
  assert.equal(r.calls.filter(c=>c==='https://api.openai.com/v1/responses').length,1);
});
