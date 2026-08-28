const list=(value,limit=100)=>Array.isArray(value)?value.slice(0,limit):[];

export function extractStructuredOutputText(payload){
  if(typeof payload?.output_text==='string'&&payload.output_text.trim())return payload.output_text;
  for(const item of list(payload?.output))for(const content of list(item?.content))if(content?.type==='output_text'&&typeof content.text==='string'&&content.text.trim())return content.text;
  return '';
}

function refusalText(payload){
  for(const item of list(payload?.output))for(const content of list(item?.content))if(content?.type==='refusal')return String(content.refusal||content.text||'').trim();
  return '';
}

export function parseStructuredResponsePayload(payload){
  const reason=String(payload?.incomplete_details?.reason||'').trim(),status=String(payload?.status||'').trim().toLowerCase();
  if(status==='incomplete'||reason){
    if(reason==='max_output_tokens')return {ok:false,code:'AI_RESPONSE_TRUNCATED',message:'The AI ruling was cut off before it finished. Retry it; no game state was changed.'};
    if(reason==='content_filter')return {ok:false,code:'AI_RESPONSE_FILTERED',message:'The AI could not finish this ruling because its response was filtered. Rephrase the request or resolve it manually.'};
    return {ok:false,code:'AI_RESPONSE_INCOMPLETE',message:'The AI could not finish this ruling. Retry it; no game state was changed.'};
  }
  if(status==='failed')return {ok:false,code:'AI_RESPONSE_FAILED',message:'The AI could not complete this ruling. Retry it; no game state was changed.'};
  if(refusalText(payload))return {ok:false,code:'AI_RESPONSE_REFUSED',message:'The AI could not produce this ruling. Rephrase the request or resolve it manually.'};
  const text=extractStructuredOutputText(payload);
  if(!text)return {ok:false,code:'AI_RESPONSE_EMPTY',message:'The AI returned no ruling. Retry it; no game state was changed.'};
  try{return {ok:true,value:JSON.parse(text)}}catch{return {ok:false,code:'AI_RESPONSE_INVALID_JSON',message:'The AI returned an incomplete ruling format. Retry it; no game state was changed.'}}
}
