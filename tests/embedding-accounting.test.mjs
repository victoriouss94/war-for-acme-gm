import test from 'node:test';
import assert from 'node:assert/strict';
import {embeddingPrice,withEmbeddingUsage} from '../supabase/functions/_shared/usage-accounting.js';
const context={gameId:'synthetic-game',userId:'synthetic-user',feature:'knowledge_ingest',model:'text-embedding-3-small'};
for(const [model,input] of [['text-embedding-3-small',.02],['text-embedding-3-large',.13],['text-embedding-ada-002',.10]])test('embedding estimate uses its own price: '+model,()=>{assert.equal(embeddingPrice(model).input,input);assert.equal(embeddingPrice(model).kind,'embedding')});
test('unknown embedding model is not priced as a response model',()=>{assert.throws(()=>embeddingPrice('unknown-model'),{code:'EMBEDDING_PRICING_UNAVAILABLE'})});
for(const denial of ['AI_MONTHLY_LIMIT_REACHED','AI_RATE_LIMIT_REACHED','private error','null','wrong-id','throw'])test('embedding reservation stops work: '+denial,async()=>{
  let paid=0;const service={rpc:async()=>{if(denial==='throw')throw Error('private error');return denial==='null'?null:denial==='wrong-id'?{data:'other'}:{error:{message:denial}}}};
  await assert.rejects(()=>withEmbeddingUsage(service,context,async()=>{paid++}),error=>{assert.equal(error.code,denial.startsWith('AI_')?denial:'AI_USAGE_RESERVATION_FAILED');assert.doesNotMatch(error.message,/private/);return true});assert.equal(paid,0);
});
for(const input of [20,0,null,-1,'20',Infinity,2147483648])test('embedding usage remains explicit: '+input,async()=>{
  const records=[];const service={rpc:async(name,args)=>{records.push({name,args});return {data:name==='reserve_ai_usage_internal'?args.target_request_id:null}}};let calls=0;
  const result=await withEmbeddingUsage(service,context,async observe=>{calls++;observe({prompt_tokens:input},context.model);return {vectors:[[1]]}}),known=Number.isSafeInteger(input)&&input>=0&&input<=2147483647;
  assert.equal(calls,1);assert.equal(records.length,2);assert.equal(records[1].args.target_request_id,records[0].args.target_request_id);assert.equal(records[1].args.target_output_tokens,0);assert.equal(result.embeddingAccounting.usageKnown,known);assert.equal(result.embeddingAccounting.input,known?input:null);assert.equal(result.embeddingAccounting.cost,(known?input:0)*.02/1_000_000);assert.equal(Boolean(result.embeddingAccounting.warning),!known);if(!known)assert.equal(records[1].args.target_error_code,'EMBEDDING_USAGE_UNAVAILABLE');
});
test('invalid vectors keep observed embedding usage without repeating provider work',async()=>{
  const records=[];const service={rpc:async(name,args)=>{records.push({name,args});return {data:name==='reserve_ai_usage_internal'?args.target_request_id:null}}};let calls=0;
  await assert.rejects(()=>withEmbeddingUsage(service,context,async observe=>{calls++;observe({prompt_tokens:19},context.model);throw Object.assign(Error('Invalid vectors'),{code:'INVALID_EMBEDDING_RESPONSE'})}),error=>{assert.equal(error.embeddingAccounting.input,19);assert.equal(error.code,'INVALID_EMBEDDING_RESPONSE');return true});assert.equal(calls,1);assert.equal(records[1].args.target_status,'FAILED');assert.equal(records[1].args.target_input_tokens,19);
});
test('embedding completion retries only accounting and preserves vectors',async t=>{
  t.mock.method(console,'error',()=>{});let writes=0,paid=0;const service={rpc:async(name,args)=>name==='reserve_ai_usage_internal'?{data:args.target_request_id}:(writes++,{error:{code:'08006',message:'Synthetic network failure'}})};
  const result=await withEmbeddingUsage(service,context,async observe=>{paid++;observe({prompt_tokens:10},context.model);return {vectors:[[1]]}});assert.equal(paid,1);assert.equal(writes,3);assert.deepEqual(result.vectors,[[1]]);assert.equal(result.embeddingAccounting.recorded,false);assert.match(result.embeddingAccounting.warning,/could not be saved/);
});
