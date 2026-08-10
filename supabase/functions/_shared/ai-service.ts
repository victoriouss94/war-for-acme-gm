import {createClient} from 'npm:@supabase/supabase-js@2.95.0';

export const allowedOrigins=new Set([
  'https://victoriouss94.github.io','http://localhost:4173','http://127.0.0.1:4173','http://localhost:8080','http://127.0.0.1:8080'
]);

export const textValue=(value:unknown,limit=4000)=>String(value??'').trim().slice(0,limit);
export const list=(value:unknown,limit=1000)=>Array.isArray(value)?value.slice(0,limit):[];
export function corsHeaders(origin:string|null){const allowed=origin&&allowedOrigins.has(origin)?origin:'https://victoriouss94.github.io';return {'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'}}
export function json(body:unknown,status:number,origin:string|null){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders(origin),'Content-Type':'application/json','Cache-Control':'no-store'}})}
export function publishableKey(){try{const keys=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}');if(keys.default)return String(keys.default)}catch{}return Deno.env.get('SUPABASE_ANON_KEY')||''}
export function modelForDepth(depth:string){return depth==='deep'?(Deno.env.get('OPENAI_ADVANCED_MODEL')||'gpt-5.6-sol'):(Deno.env.get('OPENAI_PRIMARY_MODEL')||'gpt-5.6-terra')}
export function embeddingModel(){return Deno.env.get('OPENAI_EMBEDDING_MODEL')||'text-embedding-3-small'}
export function createUserClient(authHeader:string){return createClient(Deno.env.get('SUPABASE_URL')||'',publishableKey(),{global:{headers:{Authorization:authHeader}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
export function createServiceClient(){const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';if(!url||!key)throw new OpenAIServiceError('The secure AI persistence service is not configured.',503,'CONFIGURATION_ERROR');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
export async function verifiedUser(client:any,authHeader:string){const token=authHeader.slice(7),{data,error}=await client.auth.getUser(token);if(error||!data?.user)return null;return data.user}
export async function safetyIdentifier(userId:string){const encoded=new TextEncoder().encode(userId),digest=await crypto.subtle.digest('SHA-256',encoded);return 'gmcc_'+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('').slice(0,32)}
export function extractOutputText(payload:any){if(typeof payload?.output_text==='string')return payload.output_text;for(const item of list(payload?.output,100))for(const content of list(item?.content,100))if(content?.type==='output_text'&&typeof content.text==='string')return content.text;return ''}

export class OpenAIServiceError extends Error{
  status:number;code:string;
  constructor(message:string,status=502,code='OPENAI_ERROR'){super(message);this.status=status;this.code=code}
}

function apiError(payload:any,status:number){
  const apiCode=textValue(payload?.error?.code,100),apiType=textValue(payload?.error?.type,100),apiMessage=String(payload?.error?.message||'').toLowerCase();
  const quota=[apiCode,apiType].some(value=>['insufficient_quota','billing_hard_limit_reached'].includes(value))||/(quota|billing|credits|credit balance)/.test(apiMessage);
  if(quota)return new OpenAIServiceError('Add OpenAI API credits before using AI features.',402,'OPENAI_CREDITS_REQUIRED');
  if(status===429)return new OpenAIServiceError('The AI service is busy. Wait a moment and try again.',429,'OPENAI_RATE_LIMIT');
  return new OpenAIServiceError('The AI service could not complete this request.',502,'OPENAI_ERROR');
}

export async function structuredResponse(options:{model:string;userId:string;instructions:string;input:unknown;schema:unknown;schemaName:string;maxOutputTokens?:number;effort?:string;verbosity?:string}){
  const key=Deno.env.get('OPENAI_API_KEY')||'';if(!key)throw new OpenAIServiceError('The AI service is not configured.',503,'CONFIGURATION_ERROR');
  let response:Response;
  try{response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({
    model:options.model,store:false,safety_identifier:await safetyIdentifier(options.userId),reasoning:{effort:options.effort||'medium'},max_output_tokens:options.maxOutputTokens||5000,
    instructions:options.instructions,input:options.input,text:{verbosity:options.verbosity||'medium',format:{type:'json_schema',name:options.schemaName,strict:true,schema:options.schema}}
  })})}catch{throw new OpenAIServiceError('The AI service could not be reached.',502,'OPENAI_UNAVAILABLE')}
  const payload=await response.json().catch(()=>({}));if(!response.ok)throw apiError(payload,response.status);
  try{return {result:JSON.parse(extractOutputText(payload)),responseId:textValue(payload?.id,200),usage:payload?.usage||null}}catch{throw new OpenAIServiceError('The AI returned an unreadable result.',502,'INVALID_AI_RESPONSE')}
}

export async function createEmbeddings(inputs:string[]){
  const key=Deno.env.get('OPENAI_API_KEY')||'';if(!key)throw new OpenAIServiceError('The AI service is not configured.',503,'CONFIGURATION_ERROR');
  let response:Response;
  try{response=await fetch('https://api.openai.com/v1/embeddings',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:embeddingModel(),input:inputs,encoding_format:'float'})})}
  catch{throw new OpenAIServiceError('The AI embedding service could not be reached.',502,'OPENAI_UNAVAILABLE')}
  const payload=await response.json().catch(()=>({}));if(!response.ok)throw apiError(payload,response.status);
  const vectors=list(payload?.data,inputs.length).sort((a:any,b:any)=>a.index-b.index).map((item:any)=>item.embedding);
  if(vectors.length!==inputs.length||vectors.some((vector:any)=>!Array.isArray(vector)||vector.length!==1536))throw new OpenAIServiceError('The AI returned invalid document embeddings.',502,'INVALID_EMBEDDING_RESPONSE');
  return {vectors,model:embeddingModel(),usage:payload?.usage||null};
}
