// Canonical existing response-model pricing and usage persistence policy.
function accountingError(message,code,status=503){return Object.assign(new Error(message),{code,status})}
export function embeddingPrice(model){
  // Standard (non-Batch) USD / million input tokens, checked 2026-09-12:
  // https://developers.openai.com/api/docs/models/text-embedding-3-small
  const rates={'text-embedding-3-small':.02,'text-embedding-3-large':.13,'text-embedding-ada-002':.10};
  if(!Object.hasOwn(rates,model))throw accountingError('The configured embedding model has no verified cost estimate. No embedding request was made.','EMBEDDING_PRICING_UNAVAILABLE');
  return {input:rates[model],cachedInput:0,output:0,currency:'USD',unit:'per_million_tokens',kind:'embedding',verifiedAt:'2026-09-12'};
}

// One provider operation, one separate model-priced row in the existing ledger.
// The callback observes usage before the existing vector validation can fail.
export async function withEmbeddingUsage(service,{gameId,userId,feature,model},perform){
  const price=embeddingPrice(model),requestId=crypto.randomUUID(),started=Date.now();
  let reservation;
  try{reservation=await service.rpc('reserve_ai_usage_internal',{target_game_id:gameId,actor_user_id:userId,target_feature:feature,target_model:model,target_request_id:requestId,target_pricing_snapshot:price})}
  catch{throw accountingError('Embedding usage reservation could not be confirmed. No embedding request was made.','AI_USAGE_RESERVATION_FAILED')}
  if(reservation?.error||reservation?.data!==requestId){
    const code=String(reservation?.error?.message||''),limited=['AI_MONTHLY_LIMIT_REACHED','AI_RATE_LIMIT_REACHED'].includes(code);
    throw accountingError(code==='AI_MONTHLY_LIMIT_REACHED'?'This game has reached its monthly AI limit.':code==='AI_RATE_LIMIT_REACHED'?'This game has reached its AI request rate limit.':'Embedding usage reservation could not be confirmed. No embedding request was made.',limited?code:'AI_USAGE_RESERVATION_FAILED',limited?429:503);
  }
  let input=null;
  const observe=(usage,observedModel)=>{const count=usage?.prompt_tokens;input=observedModel===model&&Number.isSafeInteger(count)&&count>=0&&count<=2147483647?count:null};
  const finish=async(status,code='')=>{
    const cost=(input??0)*price.input/1_000_000;
    const recorded=await completeUsageRecord(service,{target_request_id:requestId,target_provider_response_id:'',target_input_tokens:input??0,target_cached_input_tokens:0,target_output_tokens:0,target_estimated_cost_usd:cost,target_latency_ms:Date.now()-started,target_status:status,target_error_code:code||(input===null?'EMBEDDING_USAGE_UNAVAILABLE':'')});
    const unknown=input===null?'Embedding token usage was unavailable; the recorded cost total may be incomplete. Do not repeat the request just to repair accounting.':'';
    return {...recorded,model,input,cost,usageKnown:input!==null,warning:[recorded.warning,unknown].filter(Boolean).join(' ')};
  };
  let result;
  try{result=await perform(observe)}
  catch(error){const failure=error instanceof Error?error:accountingError('The embedding request failed.','EMBEDDING_REQUEST_FAILED',502);failure.embeddingAccounting=await finish('FAILED',failure.code||'EMBEDDING_REQUEST_FAILED');throw failure}
  return {...result,embeddingAccounting:await finish('COMPLETED')};
}
export function usagePrice(model){return model.includes('sol')?{input:5,cachedInput:.5,output:30,currency:'USD',unit:'per_million_tokens'}:{input:2.5,cachedInput:.25,output:15,currency:'USD',unit:'per_million_tokens'}}
export function usageValues(usage){const input=Math.max(0,Number(usage?.input_tokens)||0),cached=Math.min(input,Math.max(0,Number(usage?.input_tokens_details?.cached_tokens)||0)),output=Math.max(0,Number(usage?.output_tokens)||0);return {input,cached,output}}
export function combinedUsage(...items){const totals=items.map(usageValues).reduce((sum,item)=>({input:sum.input+item.input,cached:sum.cached+item.cached,output:sum.output+item.output}),{input:0,cached:0,output:0});return {input_tokens:totals.input,output_tokens:totals.output,input_tokens_details:{cached_tokens:totals.cached}}}
export function usageCost(usage,price){const value=usageValues(usage);return {...value,cost:((value.input-value.cached)*price.input+value.cached*price.cachedInput+value.output*price.output)/1_000_000}}
const ACCOUNTING_WARNING='AI usage could not be saved. The displayed cost is an estimate and the saved usage total may be incomplete. Do not repeat the AI request just to repair accounting.';
export async function completeUsageRecord(service,values){
  let attempts=0,lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    attempts=attempt;let status=0;
    try{
      const response=await service.rpc('complete_ai_usage_internal',values);
      if(response&&!response.error)return {recorded:true,attempts,requestId:values.target_request_id,code:'',warning:''};
      lastError=response?.error||new Error('Empty accounting response');status=Number(response?.status)||0;
    }catch(error){lastError=error}
    const code=String(lastError?.code||''),message=String(lastError?.message||'');
    const permanent=/^(22|23|28|42)/.test(code);
    const transient=!permanent&&(/^(08|53)/.test(code)||['57P01','57P02','57P03','PGRST000','PGRST001','PGRST002','PGRST003'].includes(code)||[408,429,500,502,503,504].includes(status)||/fetch|network|timeout|timed out|connection/i.test(message));
    if(attempt===3||!transient)break;
    await new Promise(resolve=>setTimeout(resolve,100*2**(attempt-1)));
  }
  // Never log prompts, keys, access tokens or provider output; these identifiers and
  // measured amounts permit reconciliation without reissuing a paid request.
  console.error('AI_USAGE_RECORD_FAILED',{requestId:values.target_request_id,providerResponseId:values.target_provider_response_id,inputTokens:values.target_input_tokens,cachedInputTokens:values.target_cached_input_tokens,outputTokens:values.target_output_tokens,estimatedCostUsd:values.target_estimated_cost_usd,usageStatus:values.target_status,attempts,errorCode:String(lastError?.code||'ACCOUNTING_UNAVAILABLE')});
  return {recorded:false,attempts,requestId:values.target_request_id,code:'AI_USAGE_RECORD_FAILED',warning:ACCOUNTING_WARNING};
}
