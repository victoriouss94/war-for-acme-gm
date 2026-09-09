import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

const entry=await readFile(process.env.GM_AUDIT_INGEST_ENTRY||new URL('../supabase/functions/gm-knowledge-ingest/index.ts',import.meta.url),'utf8');
let serial=0;
async function setup(t,{claimFailure='',alreadyClaimed=false,providerFails=false}={}){
  const calls=[],previousDeno=globalThis.Deno,previousApi=globalThis.__claimAudit;let claim=alreadyClaimed?'interrupted-attempt':null,status='PROCESSING';
  class ServiceError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code}}
  const client={from(){const query={select(){return query},eq(){return query},single:async()=>({data:{id:'00000000-0000-4000-8000-000000000001',status,requested_status:'ACTIVE',source_file_name:'audit.txt',storage_path:'synthetic.txt',content_type:'text/plain',official_documents:{game_id:'synthetic',title:'Synthetic',document_type:'CUSTOM'}}}),maybeSingle:async()=>({data:{member_role:'owner'}})};return query;},storage:{from:()=>({download:async()=>{calls.push({name:'download'});return {data:new Blob(['Synthetic'])};}})},rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='claim_knowledge_ingestion_internal'){
      if(claimFailure==='returned')return {error:{message:'private SQL detail'}};
      if(claimFailure==='malformed')return {data:{claimed:true}};
      if(claimFailure==='throw'){claim=args.target_claim_id;throw Error('private transport detail');}
      if(claim)return {data:false};claim=args.target_claim_id;return {data:true};
    }
    if(name==='complete_claimed_knowledge_ingestion_internal'||name==='fail_claimed_knowledge_ingestion_internal'){
      assert.equal(args.target_claim_id,claim);assert.equal(args.actor_user_id,'synthetic-owner');
      status=name.startsWith('complete')?'ACTIVE':'FAILED';return {data:null};
    }
    throw Error('Unexpected RPC '+name);
  }};
  globalThis.__claimAudit={allowedOrigins:new Set(),corsHeaders:()=>({}),createServiceClient:()=>client,createUserClient:()=>client,verifiedUser:async()=>({id:'synthetic-owner'}),json:(data,status)=>Response.json(data,{status}),list:(value,max)=>Array.isArray(value)?value.slice(0,max):[],textValue:(value,max)=>String(value??'').slice(0,max),modelForDepth:()=> 'synthetic-model',OpenAIServiceError:ServiceError,
    structuredResponse:async()=>{calls.push({name:'provider'});await new Promise(resolve=>setTimeout(resolve,10));if(providerFails)throw new ServiceError('Synthetic provider failure',502,'SYNTHETIC_FAILURE');return {result:{summary:'Synthetic',warnings:[],chunks:[{heading:'Rule',source_locator:'1',content:'Synthetic rule'}]}};},
    createEmbeddings:async()=>{calls.push({name:'embeddings'});return {model:'synthetic-embedding',vectors:[Array(1536).fill(0)]};}
  };
  t.after(()=>{if(previousDeno===undefined)delete globalThis.Deno;else globalThis.Deno=previousDeno;if(previousApi===undefined)delete globalThis.__claimAudit;else globalThis.__claimAudit=previousApi;});
  async function load(){let handler;globalThis.Deno={serve:callback=>{handler=callback}};const source=entry.replace(/^import \{([^}]+)\} from '..\/_shared\/ai-service.ts';/,'const {$1}=globalThis.__claimAudit;');await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)+'\n// claim test '+serial++).toString('base64'));return handler;}
  const request=()=>new Request('https://synthetic.invalid/ingest',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({documentVersionId:'00000000-0000-4000-8000-000000000001'})});
  return {load,calls,request,getStatus:()=>status};
}
for(const independent of [false,true])test(`one indexing worker across ${independent?'independent handlers':'concurrent calls'}`,async t=>{
  const f=await setup(t),first=await f.load(),second=independent?await f.load():first;
  const responses=await Promise.all([first(f.request()),second(f.request())]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  for(const name of ['download','provider','embeddings','complete_claimed_knowledge_ingestion_internal'])assert.equal(f.calls.filter(c=>c.name===name).length,1,name);
  assert.equal(f.calls.filter(c=>c.name.startsWith('fail_')).length,0);assert.equal(f.getStatus(),'ACTIVE');
  assert.equal(f.calls[0].name,'claim_knowledge_ingestion_internal');
});
for(const failure of ['returned','throw','malformed'])test(`unconfirmed ${failure} claim stops before paid work without failing another attempt`,async t=>{
  const f=await setup(t,{claimFailure:failure}),handler=await f.load(),response=await handler(f.request()),body=await response.json();
  assert.equal(response.status,503);assert.equal(body.code,'INGESTION_CLAIM_UNAVAILABLE');assert.doesNotMatch(body.error,/private/);
  assert.deepEqual(f.calls.map(c=>c.name),['claim_knowledge_ingestion_internal']);assert.equal(f.getStatus(),'PROCESSING');
});
test('interrupted claimed version is not automatically replayed or failed',async t=>{
  const f=await setup(t,{alreadyClaimed:true}),handler=await f.load(),response=await handler(f.request());
  assert.equal(response.status,409);assert.match((await response.json()).error,/interrupted.*new version/i);assert.equal(f.calls.length,1);assert.equal(f.getStatus(),'PROCESSING');
});
test('provider failure is recorded only for the claimed attempt',async t=>{
  const f=await setup(t,{providerFails:true}),handler=await f.load(),response=await handler(f.request());
  assert.equal(response.status,502);assert.equal(f.getStatus(),'FAILED');assert.equal(f.calls.filter(c=>c.name==='fail_claimed_knowledge_ingestion_internal').length,1);assert.ok(!f.calls.some(c=>c.name==='embeddings'));
});
