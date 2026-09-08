import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

// Execute the actual TypeScript implementation with provider/network/client
// boundaries stubbed. No keys, accounts, network requests or paid calls.
const root=new URL('../supabase/functions/',import.meta.url);
const dataModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const serviceSource=await readFile(new URL('_shared/ai-service.ts',root),'utf8');
const serviceUrl=dataModule(stripTypeScriptTypes(serviceSource
  .replace("import {createClient} from 'npm:@supabase/supabase-js@2.95.0';","const createClient=(...args)=>globalThis.__auditCreateClient(...args);")
  .replace("'./response-parser.js'",JSON.stringify(new URL('_shared/response-parser.js',root).href))));
const {structuredResponse,responseUsageTracker}=await import(serviceUrl);
const base={model:'audit-model',userId:'synthetic-user',instructions:'Test',input:'Synthetic input',schema:{type:'object'},schemaName:'audit'};
const usage=(input,output,cached=0)=>({input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:cached}});
const payload=(output_text='{"answer":"ok"}',id='response-1',tokens=usage(100,20,30))=>({status:'completed',id,usage:tokens,output_text});

function mocks(t,responses,environment={}){
  const calls=[];
  calls.attemptedUrls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.attemptedUrls.push(url);
    if(url==='https://api.openai.com/v1/embeddings'){
      assert.equal(options.headers.Authorization,'Bearer synthetic-test-key');
      return Response.json({data:[{index:0,embedding:Array(1536).fill(0)}],usage:{prompt_tokens:10,total_tokens:10}});
    }
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization,'Bearer synthetic-test-key');
    calls.push(JSON.parse(options.body));
    const next=responses.shift();
    assert.notEqual(next,undefined,'Unexpected provider request');
    if(next instanceof Error)throw next;
    return Response.json(next.body??next,{status:next.httpStatus??200});
  });
  const previous=globalThis.Deno;
  globalThis.Deno={env:{get:name=>({OPENAI_API_KEY:'synthetic-test-key',...environment})[name]},serve:()=>{}};
  t.after(()=>{if(previous===undefined)delete globalThis.Deno;else globalThis.Deno=previous});
  return calls;
}
test('request-local usage tracker retains known totals and clamps cached tokens',()=>{
  const tracker=responseUsageTracker();
  tracker.observe(usage(10,5,30),'first');tracker.observe(null,'');tracker.observe(usage(20,8,4),'second');
  assert.deepEqual(tracker.usage,usage(30,13,14));assert.equal(tracker.responseId,'second');
  assert.deepEqual(responseUsageTracker().usage,usage(0,0,0));
});
test('successful response observes usage exactly once and preserves returned result',async t=>{
  const calls=mocks(t,[payload()]),tracker=responseUsageTracker();
  const result=await structuredResponse({...base,onUsage:tracker.observe});
  assert.deepEqual(result.result,{answer:'ok'});assert.deepEqual(tracker.usage,result.usage);assert.equal(calls.length,1);
});
for(const [name,body,code] of [
  ['malformed',payload('{'),'AI_RESPONSE_INVALID_JSON'],
  ['truncated',{...payload(),status:'incomplete',incomplete_details:{reason:'max_output_tokens'}},'AI_RESPONSE_TRUNCATED'],
  ['refused',{...payload(),output_text:'',output:[{content:[{type:'refusal',refusal:'Unable'}]}]},'AI_RESPONSE_REFUSED'],
]){
  test(name+' structured response retains usage before rejecting',async t=>{
    mocks(t,[body]);const tracker=responseUsageTracker();
    await assert.rejects(structuredResponse({...base,onUsage:tracker.observe}),error=>error.code===code);
    assert.deepEqual(tracker.usage,usage(100,20,30));assert.equal(tracker.responseId,'response-1');
  });
}
for(const [name,second,code,expected,expectedId] of [
  ['invalid',payload('{','response-2',usage(40,10,4)),'AI_RESPONSE_INVALID_JSON',usage(140,30,34),'response-2'],
  ['unreachable',new Error('Mock network failure'),null,usage(100,20,30),'response-1'],
  ['quota denied',{httpStatus:429,body:{error:{code:'insufficient_quota'}}},'OPENAI_CREDITS_REQUIRED',usage(100,20,30),'response-1'],
]){
  test('failed JSON repair '+name+' retains all available response usage',async t=>{
    const calls=mocks(t,[payload('{'),second]),tracker=responseUsageTracker();
    await assert.rejects(structuredResponse({...base,repairInvalidJson:true,onUsage:tracker.observe}),error=>!code||error.code===code);
    assert.deepEqual(tracker.usage,expected);assert.equal(tracker.responseId,expectedId);assert.equal(calls.length,2);
  });
}
test('successful JSON repair counts both provider calls without double counting',async t=>{
  const calls=mocks(t,[payload('{'),payload('{"answer":"repaired"}','response-2',usage(40,10,4))]),tracker=responseUsageTracker();
  const result=await structuredResponse({...base,repairInvalidJson:true,onUsage:tracker.observe});
  assert.equal(result.repairAttempts,1);assert.deepEqual(result.result,{answer:'repaired'});
  assert.deepEqual(tracker.usage,usage(140,30,34));assert.deepEqual(result.usage,tracker.usage);assert.equal(calls.length,2);
});
test('initial transport failure does not invent unreported provider usage',async t=>{
  mocks(t,[new Error('Mock network failure')]);const tracker=responseUsageTracker();
  await assert.rejects(structuredResponse({...base,onUsage:tracker.observe}),error=>error.code==='OPENAI_UNAVAILABLE');
  assert.deepEqual(tracker.usage,usage(0,0));assert.equal(tracker.responseId,'');
});

const copilotSource=await readFile(new URL('gm-copilot/index.ts',root),'utf8');
const globalResolution=dataModule(stripTypeScriptTypes(await readFile(new URL('_shared/global-resolution.ts',root),'utf8')));
const copilotJs=stripTypeScriptTypes(copilotSource
  .replace("'../_shared/ai-service.ts'",JSON.stringify(serviceUrl))
  .replace("'../_shared/global-resolution.ts'",JSON.stringify(globalResolution))
  .replace(/'(\.\.\/_shared\/[^']+\.js)'/g,(_,path)=>JSON.stringify(new URL(path,new URL('gm-copilot/',root)).href)));
async function handlerFixture(t,body,options={}){
  const calls=mocks(t,[body],{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'});
  const gameId='11111111-1111-4111-8111-111111111111',sessionId='22222222-2222-4222-8222-222222222222';
  const rpcCalls=[],rows={
    game_members:{member_role:options.memberRole??'gm'},
    game_documents:{document:{},version:1},
    resolution_sessions:{id:sessionId,status:'GM_REVIEW',submitted_actions:[{id:'action-1'}],pre_resolution_state:{}}
  };
  const userClient={auth:{getUser:async()=>({data:{user:options.invalidUser?null:{id:'synthetic-user'}}})},
    rpc:async(name)=>{if(options.failContext&&name==='get_mechanics_review_queue')throw new Error('Synthetic context lookup failed');return {data:null}},
    from:table=>{
      const query={maybeSingle:async()=>({data:rows[table]??null}),single:async()=>({data:rows[table]??null}),then:resolve=>resolve({data:rows[table]??[]})};
      for(const method of ['select','eq','order','limit','in','not'])query[method]=()=>query;
      return query;
    }};
  const accountingErrors=[...(options.accountingErrors||[])],logs=[];
  t.mock.method(console,'error',(...args)=>logs.push(args));
  const serviceClient={rpc:async(name,args)=>{rpcCalls.push({name,args});if(name==='complete_ai_usage_internal'&&accountingErrors.length){const error=accountingErrors.shift();if(error instanceof Error)throw error;return {data:null,error,status:503}}return {data:{},error:options.denyBudget&&name==='reserve_ai_usage_internal'?{message:options.budgetError||'AI_MONTHLY_LIMIT_REACHED'}:options.failDraftSave&&name==='create_ai_draft_internal'?{message:'Synthetic persistence failure'}:null}}};
  const previous=globalThis.__auditCreateClient;
  globalThis.__auditCreateClient=(_url,key)=>key==='synthetic-service'?serviceClient:userClient;
  t.after(()=>{if(previous===undefined)delete globalThis.__auditCreateClient;else globalThis.__auditCreateClient=previous});
  let handler;globalThis.Deno.serve=callback=>{handler=callback};
  await import(dataModule(copilotJs+'\n// fixture '+crypto.randomUUID()));
  const response=await handler(new Request('https://synthetic.invalid/gm-copilot',{method:'POST',headers:{Authorization:'Bearer synthetic-session','Content-Type':'application/json',Origin:'https://victoriouss94.github.io'},body:JSON.stringify({gameId,resolutionSessionId:sessionId,task:options.task??'adjudicate_interaction',message:options.message,interaction:{question:'Synthetic?',interaction_id:'interaction-1',action_id:'action-1'}})}));
  return {response,rpcCalls,calls,logs};
}
test('actual adjudication handler records reported usage when parsing fails',async t=>{
  const {response,rpcCalls}=await handlerFixture(t,payload('{'));
  assert.equal(response.status,502);
  const completed=rpcCalls.find(call=>call.name==='complete_ai_usage_internal').args;
  assert.equal(completed.target_status,'FAILED');assert.equal(completed.target_input_tokens,100);
  assert.equal(completed.target_cached_input_tokens,30);assert.equal(completed.target_output_tokens,20);
  assert.equal(completed.target_provider_response_id,'response-1');assert.ok(completed.target_estimated_cost_usd>0);
});
test('actual adjudication handler preserves success accounting',async t=>{
  const {response,rpcCalls}=await handlerFixture(t,payload('{"action_id":"action-1","interaction_id":"interaction-1"}'));
  assert.equal(response.status,200);
  const completed=rpcCalls.find(call=>call.name==='complete_ai_usage_internal').args;
  assert.equal(completed.target_status,'COMPLETED');assert.equal(completed.target_input_tokens,100);
  assert.equal(completed.target_output_tokens,20);
});
for(const [name,options,status] of [['invalid session',{invalidUser:true},401],['viewer',{memberRole:'viewer'},403],['exhausted budget',{denyBudget:true},402]]){
  test('actual adjudication handler denies '+name+' before any provider call',async t=>{
    const {response,calls,rpcCalls}=await handlerFixture(t,payload(),options);
    assert.equal(response.status,status);assert.equal(calls.length,0);
    assert.equal(rpcCalls.filter(call=>call.name==='complete_ai_usage_internal').length,0);
  });
}
test('actual main handler retains usage when a valid draft cannot be persisted',async t=>{
  const result={answer:'Synthetic draft',sources:[],proposed_changes:[],draft:{draft_type:'FACTION',title:'Synthetic Faction',payload:{name:'Synthetic Faction'}}};
  const {response,rpcCalls,calls}=await handlerFixture(t,payload(JSON.stringify(result)),{task:'create_faction',message:'Create a faction',failDraftSave:true});
  assert.equal(response.status,503);assert.equal((await response.json()).code,'AI_DRAFT_SAVE_FAILED');
  assert.equal(calls.length,1);
  assert.ok(rpcCalls.some(call=>call.name==='create_ai_draft_internal'));
  const completed=rpcCalls.find(call=>call.name==='complete_ai_usage_internal').args;
  assert.equal(completed.target_status,'FAILED');assert.equal(completed.target_input_tokens,100);
  assert.equal(completed.target_output_tokens,20);assert.equal(completed.target_provider_response_id,'response-1');
  assert.ok(completed.target_estimated_cost_usd>0);
});
test('actual main handler retains usage when semantic draft validation fails',async t=>{
  const {response,rpcCalls}=await handlerFixture(t,payload('{"answer":"Missing draft","sources":[]}'),{task:'create_faction',message:'Create a faction'});
  assert.equal(response.status,502);assert.equal((await response.json()).code,'INVALID_AI_RESPONSE');
  const completed=rpcCalls.find(call=>call.name==='complete_ai_usage_internal').args;
  assert.equal(completed.target_status,'FAILED');assert.equal(completed.target_input_tokens,100);
  assert.equal(completed.target_output_tokens,20);
  assert.equal(rpcCalls.filter(call=>call.name==='create_ai_draft_internal').length,0);
});
test('every copilot generation and repair call uses the request-local observer',()=>{
  const calls=copilotSource.match(/await structuredResponse\(\{[^]*?\}\);/g);
  assert.equal(calls.length,3);for(const call of calls)assert.match(call,/onUsage:providerUsage.observe/);
  assert.equal((copilotSource.match(/measured=usageCost\(providerUsage.usage,price\)/g)||[]).length,2);
  assert.doesNotMatch(copilotSource,/target_status:'FAILED'[^]*target_input_tokens:0/);
});

for(const [code,status] of [['AI_MONTHLY_LIMIT_REACHED',402],['AI_RATE_LIMIT_REACHED',429],['Synthetic accounting outage',503]]){
  test('document search performs no paid request when reservation denies '+code,async t=>{
    const {response,calls,rpcCalls}=await handlerFixture(t,payload(),{task:'explain_content',message:'Explain the official document rules',denyBudget:true,budgetError:code});
    assert.equal(response.status,status);assert.deepEqual(calls.attemptedUrls,[]);
    assert.equal(rpcCalls.filter(call=>call.name==='reserve_ai_usage_internal').length,1);
    assert.equal(rpcCalls.filter(call=>call.name==='complete_ai_usage_internal').length,0);
  });
}
test('reserved document search still retrieves and answers when budget is available',async t=>{
  const {response,calls,rpcCalls}=await handlerFixture(t,payload('{"answer":"Synthetic answer","sources":[]}'),{task:'explain_content',message:'Explain the official document rules'});
  assert.equal(response.status,200);assert.deepEqual(calls.attemptedUrls,['https://api.openai.com/v1/embeddings','https://api.openai.com/v1/responses']);
  assert.equal(rpcCalls.filter(call=>call.name==='reserve_ai_usage_internal').length,1);
  assert.equal(rpcCalls.find(call=>call.name==='complete_ai_usage_internal').args.target_status,'COMPLETED');
});
test('context preparation failure closes its reservation with a visible error',async t=>{
  const {response,calls,rpcCalls}=await handlerFixture(t,payload(),{task:'explain_content',message:'Explain the official document rules',failContext:true});
  assert.equal(response.status,502);assert.match((await response.json()).error,/context lookup failed/);
  assert.equal(calls.length,0);assert.equal(rpcCalls.filter(call=>call.name==='reserve_ai_usage_internal').length,1);
  assert.equal(rpcCalls.find(call=>call.name==='complete_ai_usage_internal').args.target_status,'FAILED');
});

for(const task of ['adjudicate_interaction','explain_content']){
  test(task+' retries only a transient accounting write with identical usage and request ID',async t=>{
    const result=task==='adjudicate_interaction'?{action_id:'action-1',interaction_id:'interaction-1'}:{answer:'Synthetic answer',sources:[]};
    const {response,rpcCalls,calls}=await handlerFixture(t,payload(JSON.stringify(result)),{task,message:'Explain this rule',accountingErrors:[{code:'08006',message:'Synthetic connection failure'},new TypeError('Synthetic fetch failed')]});
    assert.equal(response.status,200);
    const completion=rpcCalls.filter(call=>call.name==='complete_ai_usage_internal');
    assert.equal(completion.length,3);assert.deepEqual(completion[1].args,completion[0].args);assert.deepEqual(completion[2].args,completion[0].args);
    assert.equal(calls.length,1,'accounting retries must not repeat the paid request');
    assert.equal(rpcCalls.filter(call=>call.name==='reserve_ai_usage_internal').length,1);
    const body=await response.json();assert.equal(body.accounting.recorded,true);assert.equal(body.accounting.attempts,3);
  });
}

test('exhausted accounting retries preserve the useful result and expose incomplete recording',async t=>{
  const {response,rpcCalls,calls,logs}=await handlerFixture(t,payload('{"answer":"Keep this answer","sources":[]}'),{task:'explain_content',message:'Explain this rule',accountingErrors:Array(3).fill({code:'08006',message:'Synthetic outage'})});
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.result.answer,'Keep this answer');
  assert.equal(body.accounting.recorded,false);assert.equal(body.accounting.attempts,3);assert.equal(body.accounting.code,'AI_USAGE_RECORD_FAILED');
  assert.ok(body.result.warnings.some(item=>/usage could not be saved/i.test(item)));
  assert.equal(calls.length,1);assert.equal(rpcCalls.filter(call=>call.name==='complete_ai_usage_internal').length,3);
  assert.equal(logs.length,1);assert.equal(logs[0][1].requestId,body.accounting.requestId);assert.equal(logs[0][1].inputTokens,100);
  assert.doesNotMatch(JSON.stringify(logs),/synthetic-test-key|Keep this answer/);
});

test('a failed provider response keeps its original error if usage persistence also fails',async t=>{
  const {response,rpcCalls,calls}=await handlerFixture(t,payload('{'),{accountingErrors:Array(3).fill(new TypeError('Synthetic fetch failed'))});
  assert.equal(response.status,502);const body=await response.json();assert.equal(body.code,'AI_RESPONSE_INVALID_JSON');
  assert.equal(body.accounting.recorded,false);assert.match(body.error,/usage could not be saved/i);
  assert.equal(calls.length,1);assert.equal(rpcCalls.filter(call=>call.name==='complete_ai_usage_internal').length,3);
  assert.ok(rpcCalls.filter(call=>call.name==='complete_ai_usage_internal').every(call=>call.args.target_status==='FAILED'&&call.args.target_input_tokens===100));
});

test('nontransient accounting rejection is visible without repeated writes',async t=>{
  const {response,rpcCalls,calls}=await handlerFixture(t,payload('{"action_id":"action-1","interaction_id":"interaction-1"}'),{accountingErrors:[{code:'42501',message:'Synthetic permission denial'}]});
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.accounting.recorded,false);assert.equal(body.accounting.attempts,1);
  assert.match(body.adjudication.accounting_warning,/usage could not be saved/i);
  assert.equal(rpcCalls.filter(call=>call.name==='complete_ai_usage_internal').length,1);assert.equal(calls.length,1);
});

test('main-handler validation failure retries its usage record without changing the original failure',async t=>{
  const {response,rpcCalls,calls}=await handlerFixture(t,payload('{"answer":"Missing draft","sources":[]}'),{task:'create_faction',message:'Create a faction',accountingErrors:[{code:'PGRST003',message:'Synthetic pool timeout'}]});
  assert.equal(response.status,502);const body=await response.json();assert.equal(body.code,'INVALID_AI_RESPONSE');assert.equal(body.accounting.recorded,true);
  const writes=rpcCalls.filter(call=>call.name==='complete_ai_usage_internal');assert.equal(writes.length,2);assert.deepEqual(writes[1].args,writes[0].args);assert.equal(writes[0].args.target_status,'FAILED');
  assert.equal(calls.length,1);assert.equal(rpcCalls.filter(call=>call.name==='create_ai_draft_internal').length,0);
});
