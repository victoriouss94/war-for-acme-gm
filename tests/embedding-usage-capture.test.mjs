import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

const root=new URL('../supabase/functions/',import.meta.url);
const source=await readFile(new URL('_shared/ai-service.ts',root),'utf8');
const moduleSource=stripTypeScriptTypes(source.replace("import {createClient} from 'npm:@supabase/supabase-js@2.95.0';","const createClient=()=>{};").replace("'./response-parser.js'",JSON.stringify(new URL('_shared/response-parser.js',root).href)));
const {createEmbeddings}=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
const usage={prompt_tokens:12,total_tokens:12};
const valid={data:[{index:0,embedding:Array(1536).fill(0.1)}],usage};
function setup(t,payload,status=200){
  const old=globalThis.Deno;globalThis.Deno={env:{get:name=>name==='OPENAI_API_KEY'?'synthetic-key':undefined}};
  t.after(()=>{if(old===undefined)delete globalThis.Deno;else globalThis.Deno=old;});
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;if(payload instanceof Error)throw payload;return Response.json(payload,{status});});
  return ()=>calls;
}

test('embedding observer retains raw usage and model on success',async t=>{
  const calls=setup(t,valid),observed=[];
  const result=await createEmbeddings(['synthetic'],{onUsage:(...args)=>observed.push(args)});
  assert.deepEqual(observed,[[usage,result.model]]);assert.deepEqual(result.usage,usage);assert.equal(calls(),1);
});

test('embedding observer captures usage before malformed vectors throw',async t=>{
  const calls=setup(t,{data:[],usage}),observed=[];
  await assert.rejects(createEmbeddings(['synthetic'],{onUsage:(...args)=>observed.push(args)}),{code:'INVALID_EMBEDDING_RESPONSE'});
  assert.equal(observed.length,1);assert.deepEqual(observed[0][0],usage);assert.equal(calls(),1);
});

test('HTTP error usage is observed without changing the existing error mapping',async t=>{
  setup(t,{error:{code:'insufficient_quota'},usage},429);const observed=[];
  await assert.rejects(createEmbeddings(['synthetic'],{onUsage:value=>observed.push(value)}),{code:'OPENAI_CREDITS_REQUIRED'});
  assert.deepEqual(observed,[usage]);
});

test('missing usage is unknown rather than an invented zero-token record',async t=>{
  setup(t,{data:valid.data});const observed=[];
  await createEmbeddings(['synthetic'],{onUsage:value=>observed.push(value)});assert.deepEqual(observed,[null]);
});

test('network failure creates no fabricated usage observation or retry',async t=>{
  const calls=setup(t,new Error('synthetic outage')),observed=[];
  await assert.rejects(createEmbeddings(['synthetic'],{onUsage:value=>observed.push(value)}),{code:'OPENAI_UNAVAILABLE'});
  assert.deepEqual(observed,[]);assert.equal(calls(),1);
});

test('the existing one-argument embedding call remains compatible',async t=>{
  setup(t,valid);assert.deepEqual((await createEmbeddings(['synthetic'])).usage,usage);
});
