import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const root=new URL('../supabase/functions/',import.meta.url),url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const helper=await readFile(process.env.GM_AUDIT_IMPORT_SERVICE||new URL('_shared/ai-service.ts',root),'utf8');
const service=url(stripTypeScriptTypes(helper.replace("import {createClient} from 'npm:@supabase/supabase-js@2.95.0';",'const createClient=(...args)=>globalThis.__importAccountingClient(...args);').replace("'./response-parser.js'",JSON.stringify(new URL('_shared/response-parser.js',root).href))));
const entry=await readFile(process.env.GM_AUDIT_IMPORT_ENTRY||new URL('gm-document-import/index.ts',root),'utf8');
const app=await readFile(new URL('../js/app.js',import.meta.url),'utf8');
const importer=app.slice(app.indexOf('async function analyzeParsedDocumentWithAi(){'),app.indexOf('async function startWordImport('));
const game='22222222-2222-4222-8222-222222222222',actor='11111111-1111-4111-8111-111111111111';
const draft={game:{name:'Synthetic'},roles:[],abilities:[],warnings:[]};
const completed={id:'synthetic-import-response',status:'completed',output_text:JSON.stringify(draft),usage:{input_tokens:100,input_tokens_details:{cached_tokens:20},output_tokens:50}};
let serial=0;
async function run(t,{mode='initial',memberRole='owner',signedIn=true,reservation='ok',accountingFailure=false,payload=completed}={}){
  t.mock.method(console,'error',()=>{});
  let handler;const calls=[],saved=[],oldDeno=globalThis.Deno,oldClient=globalThis.__importAccountingClient;
  const client={auth:{getUser:async()=>({data:{user:signedIn?{id:actor}:null}})},from(table){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='game_members'?{member_role:memberRole}:{owner_id:actor}}),then(resolve,reject){return Promise.resolve({data:[]}).then(resolve,reject)}};return q},rpc:async(name,args)=>{calls.push(name);saved.push({name,args});if(name==='reserve_ai_usage_internal'){if(reservation==='throw')throw Error('private transport details');if(reservation==='null')return null;if(reservation==='wrong-id')return {data:'unconfirmed'};return reservation==='ok'?{data:args.target_request_id}:{error:{message:reservation}}}if(name==='complete_ai_usage_internal'&&accountingFailure)return {error:{code:'42501',message:'private denied'}};return {data:null}}};
  globalThis.__importAccountingClient=()=>client;
  globalThis.Deno={serve:fn=>{handler=fn},env:{get:name=>({OPENAI_API_KEY:'synthetic-key',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'})[name]}};
  t.mock.method(globalThis,'fetch',async(endpoint)=>{assert.equal(endpoint,'https://api.openai.com/v1/responses');calls.push('provider');return Response.json(payload)});
  t.after(()=>{if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;if(oldClient===undefined)delete globalThis.__importAccountingClient;else globalThis.__importAccountingClient=oldClient});
  await import(url(stripTypeScriptTypes(entry.replace("'../_shared/ai-service.ts'",JSON.stringify(service)).replace("'../_shared/usage-accounting.js'",JSON.stringify(new URL('_shared/usage-accounting.js',root).href)))+'\n// isolated import '+serial++));
  const response=await handler(new Request('https://synthetic.invalid/import',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({mode,gameId:game,fileName:'synthetic.docx',blocks:[{text:'Synthetic role.'}]})}));
  return {status:response.status,body:await response.json(),calls,saved};
}
for(const mode of ['initial','reimport'])test(mode+' Word import reserves and records exactly one response',async t=>{
  const r=await run(t,{mode});assert.equal(r.status,200);assert.deepEqual(r.body.result,draft);
  const reserve=r.saved.find(c=>c.name==='reserve_ai_usage_internal'),records=r.saved.filter(c=>c.name==='complete_ai_usage_internal');
  assert.ok(reserve);assert.equal(reserve.args.target_feature,'document_import');assert.equal(reserve.args.actor_user_id,actor);assert.equal(reserve.args.target_game_id,mode==='initial'?null:game);
  assert.equal(records.length,1);const record=records[0].args;assert.equal(record.target_request_id,reserve.args.target_request_id);assert.equal(record.target_status,'COMPLETED');assert.equal(record.target_provider_response_id,completed.id);
  assert.equal(record.target_input_tokens,100);assert.equal(record.target_cached_input_tokens,20);assert.equal(record.target_output_tokens,50);assert.equal(record.target_estimated_cost_usd,.000955);
  assert.equal(r.body.accounting.recorded,true);assert.ok(r.calls.indexOf('reserve_ai_usage_internal')<r.calls.indexOf('provider'));assert.equal(r.calls.filter(c=>c==='provider').length,1);
});
for(const reservation of ['AI_MONTHLY_LIMIT_REACHED','AI_RATE_LIMIT_REACHED','private SQL details','throw','null','wrong-id'])test('Word import blocks unconfirmed reservation: '+reservation,async t=>{
  const r=await run(t,{mode:'reimport',reservation});assert.equal(r.status,reservation.startsWith('AI_')?429:503);assert.equal(r.body.code,reservation.startsWith('AI_')?reservation:'AI_USAGE_RESERVATION_FAILED');assert.ok(!r.calls.includes('provider'));assert.ok(!r.calls.includes('complete_ai_usage_internal'));assert.doesNotMatch(r.body.error,/private|TypeError|properties/i);
});
for(const [name,payload,code] of [
  ['invalid JSON',{...completed,output_text:'{'},'AI_RESPONSE_INVALID_JSON'],
  ['truncated JSON',{...completed,status:'incomplete',incomplete_details:{reason:'max_output_tokens'}},'AI_RESPONSE_TRUNCATED'],
  ['refusal',{...completed,output:[{content:[{type:'refusal',refusal:'No'}]}]},'AI_RESPONSE_REFUSED']
])test('Word import records paid usage after '+name,async t=>{
  const r=await run(t,{payload});assert.equal(r.status,502);assert.equal(r.body.code,code);const records=r.saved.filter(c=>c.name==='complete_ai_usage_internal');assert.equal(records.length,1);assert.equal(records[0].args.target_status,'FAILED');assert.equal(records[0].args.target_input_tokens,100);assert.equal(records[0].args.target_output_tokens,50);assert.equal(r.calls.filter(c=>c==='provider').length,1);assert.equal(r.body.result,undefined);
});
test('accounting failure keeps the Word draft and warns without provider retry',async t=>{const r=await run(t,{accountingFailure:true});assert.equal(r.status,200);assert.deepEqual(r.body.result,draft);assert.equal(r.body.accounting.recorded,false);assert.match(r.body.accounting_warning,/usage could not be saved/i);assert.equal(r.calls.filter(c=>c==='provider').length,1)});
for(const options of [{signedIn:false},{mode:'reimport',memberRole:'viewer'},{mode:'reimport',memberRole:null}])test('unauthorized import performs no accounting or paid work '+JSON.stringify(options),async t=>{const r=await run(t,options);assert.equal(r.status,options.signedIn===false?401:403);assert.deepEqual(r.calls,[])});
test('actual Word importer retains accounting warning in the review draft',async()=>{
  const elements={},context={importParsedDocument:{source:{fileName:'synthetic.docx'},blocks:[],messages:[]},importSourceFile:{},importAiPending:false,importAnalysisToken:0,importDraft:null,importLocalDraft:null,importMode:'initial',importCatalog:[],id:()=> 'synthetic-warning',$:key=>elements[key]??={},GMCloud:{analyzeWordDocument:async()=>({result:draft,model:'synthetic-model',accounting_warning:'AI usage could not be saved. Do not repeat the request.'})},prepareDocumentBlocksForAi:x=>x,normalizeAiDocumentImport:()=>({roles:[],warnings:[],source:{}}),matchImportAbilities:()=>{},renderDocumentImport:()=>{}};
  vm.createContext(context);vm.runInContext(importer+'\nglobalThis.run=analyzeParsedDocumentWithAi;',context);await context.run();assert.equal(context.importAiPending,false);assert.ok(context.importDraft.warnings.some(w=>w.code==='ai-accounting-warning'&&/usage could not be saved/.test(w.message)));
});
