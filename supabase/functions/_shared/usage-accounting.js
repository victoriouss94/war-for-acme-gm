// Canonical existing response-model pricing and usage persistence policy.
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
