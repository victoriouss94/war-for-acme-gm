import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

const entry=await readFile(process.env.GM_AUDIT_INGEST_ENTRY||new URL('../supabase/functions/gm-knowledge-ingest/index.ts',import.meta.url),'utf8');
const app=await readFile(new URL('../js/app.js',import.meta.url),'utf8');
const upload=app.slice(app.indexOf('async function uploadSelectedKnowledge('),app.indexOf('function renderOfficialAbilities('));
let serial=0;
async function ingest(t,{requestedStatus='ACTIVE',downloadFails=false,failRecording='',memberRole='owner'}={}){
  const calls=[],priorDeno=globalThis.Deno,priorApi=globalThis.__ingestionAudit;let handler;
  class ServiceError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code}}
  const client={auth:{},from(table){const query={select(){return query},eq(){return query},single:async()=>({data:{id:'00000000-0000-4000-8000-000000000001',status:'PROCESSING',requested_status:requestedStatus,source_file_name:'test.txt',storage_path:'synthetic/test.txt',content_type:'text/plain',official_documents:{game_id:'game',title:'Test',document_type:'CUSTOM'}}}),maybeSingle:async()=>({data:{member_role:memberRole}})};return query},storage:{from:()=>({download:async()=>{calls.push('download');return downloadFails?{error:{message:'unavailable'}}:{data:new Blob(['Synthetic reference'])}}})},rpc:async(name,args)=>{calls.push(name);if(name==='reserve_ai_usage_internal')return {data:args.target_request_id};if(name==='claim_knowledge_ingestion_internal')return {data:true};if(name==='fail_claimed_knowledge_ingestion_internal'){if(failRecording==='throw')throw Error('private transport detail');if(failRecording==='returned')return {error:{message:'private SQL detail'}}}return {data:null,error:null}}};
  globalThis.Deno={serve:callback=>{handler=callback}};
  globalThis.__ingestionAudit={allowedOrigins:new Set(),corsHeaders:()=>({}),createServiceClient:()=>client,createUserClient:()=>client,verifiedUser:async()=>({id:'synthetic-owner'}),json:(data,status)=>Response.json(data,{status}),list:(value,max)=>Array.isArray(value)?value.slice(0,max):[],modelForDepth:()=> 'synthetic-model',OpenAIServiceError:ServiceError,textValue:(value,max)=>String(value??'').slice(0,max),structuredResponse:async()=>{calls.push('provider');return {result:{summary:'Synthetic',warnings:[],chunks:[{heading:'Rule',source_locator:'1',content:'A synthetic rule.'}]}}},createEmbeddings:async()=>{calls.push('embeddings');return {model:'synthetic-embedding',vectors:[Array(1536).fill(0)]}}};
  t.after(()=>{if(priorDeno===undefined)delete globalThis.Deno;else globalThis.Deno=priorDeno;if(priorApi===undefined)delete globalThis.__ingestionAudit;else globalThis.__ingestionAudit=priorApi});
  const source=entry.replace(/^import \{([^}]+)\} from '..\/_shared\/ai-service.ts';/,'const {$1}=globalThis.__ingestionAudit;').replace("'../_shared/usage-accounting.js'",JSON.stringify(new URL('../supabase/functions/_shared/usage-accounting.js',import.meta.url).href));
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)+'\n// lifecycle '+serial++).toString('base64'));
  const response=await handler(new Request('https://synthetic.invalid/ingest',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({documentVersionId:'00000000-0000-4000-8000-000000000001'})}));
  return {status:response.status,body:await response.json(),calls};
}
for(const status of ['ACTIVE','APPROVED','DRAFT'])test('ingestion returns the saved requested status '+status,async t=>{
  const result=await ingest(t,{requestedStatus:status});assert.equal(result.status,200);assert.equal(result.body.status,status);
  assert.equal(result.calls.filter(call=>call==='complete_claimed_knowledge_ingestion_internal').length,1);
});
test('invalid requested status stops before paid indexing',async t=>{
  const result=await ingest(t,{requestedStatus:'BROKEN'});assert.equal(result.status,409);assert.equal(result.body.code,'INVALID_DOCUMENT_STATUS');assert.deepEqual(result.calls,[]);
});
for(const failure of ['returned','throw'])test('failure-recording '+failure+' error is not hidden',async t=>{
  const result=await ingest(t,{downloadFails:true,failRecording:failure});assert.equal(result.status,404);assert.equal(result.body.code,'DOCUMENT_DOWNLOAD_FAILED');
  assert.match(result.body.error,/failure status could not be saved/i);assert.ok(!result.body.error.includes('private'));
  assert.ok(!result.calls.includes('provider'));assert.equal(result.calls.filter(call=>call==='fail_claimed_knowledge_ingestion_internal').length,1);
});
test('successfully recorded ingestion failure retains the original error',async t=>{
  const result=await ingest(t,{downloadFails:true});assert.equal(result.body.code,'DOCUMENT_DOWNLOAD_FAILED');assert.doesNotMatch(result.body.error,/failure status could not be saved/i);
});
test('unauthorized member cannot index or record failure',async t=>{
  const result=await ingest(t,{memberRole:'viewer'});assert.equal(result.status,403);assert.deepEqual(result.calls,[]);
});

async function uploadThroughApp(status,accounting_warning=''){
  const notices=[],elements={knowledgeTitle:{value:'Reference'},knowledgeType:{value:'CUSTOM'},knowledgeStatus:{value:'ACTIVE'},knowledgeScope:{value:'GAME_SPECIFIC'},copilotDepth:{value:'standard'},knowledgeFile:{value:'test.txt'}};
  const context={knowledgePending:false,canEditGame:()=>true,selectedKnowledgeFile:{arrayBuffer:async()=>new ArrayBuffer(0)},validateKnowledgeFile:()=>[],$:id=>elements[id]??={},setNotice:(_element,text,kind)=>notices.push({text,kind}),renderKnowledgeLibrary:()=>{},renderAll:()=>{},crypto:globalThis.crypto,id:()=> 'synthetic-doc',knowledgeDocumentKey:()=> 'synthetic',currentGame:()=>({id:'game'}),refreshPhaseOne:async()=>{},GMCloud:{uploadKnowledgeDocument:async()=>({status,accounting_warning})}};
  vm.createContext(context);vm.runInContext(upload+'\nglobalThis.upload=uploadSelectedKnowledge;',context);await context.upload();return notices.at(-1);
}
for(const status of ['DRAFT','APPROVED'])test('actual uploader does not claim '+status+' is active',async()=>{
  const notice=await uploadThroughApp(status);assert.equal(notice.kind,'success');assert.match(notice.text,new RegExp(status,'i'));assert.match(notice.text,/not active/i);assert.doesNotMatch(notice.text,/can now retrieve/i);
});
test('actual uploader retains active retrieval notice',async()=>{assert.match((await uploadThroughApp('ACTIVE')).text,/can now retrieve/i)});
test('unknown response status does not claim an active reference',async()=>{assert.match((await uploadThroughApp(undefined)).text,/verify.*status/i)});
test('actual uploader shows a saved document accounting warning',async()=>{const notice=await uploadThroughApp('ACTIVE','AI usage could not be saved. Do not repeat the AI request.');assert.equal(notice.kind,'warning');assert.match(notice.text,/usage could not be saved/)});
