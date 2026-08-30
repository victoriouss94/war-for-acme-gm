import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractStructuredOutputText,parseStructuredResponsePayload} from '../supabase/functions/_shared/response-parser.js';

test('structured response parser accepts top-level JSON output text',()=>{
  const payload={status:'completed',output_text:'{"answer":"Readable ruling"}'};
  assert.equal(extractStructuredOutputText(payload),payload.output_text);
  assert.deepEqual(parseStructuredResponsePayload(payload),{ok:true,value:{answer:'Readable ruling'}});
});

test('structured response parser accepts Responses API content blocks',()=>{
  const parsed=parseStructuredResponsePayload({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"answer":"Block resolved"}'}]}]});
  assert.equal(parsed.ok,true);assert.equal(parsed.value.answer,'Block resolved');
});

test('structured response parser explains a response cut off by the token ceiling',()=>{
  const parsed=parseStructuredResponsePayload({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]});
  assert.equal(parsed.ok,false);assert.equal(parsed.code,'AI_RESPONSE_TRUNCATED');assert.match(parsed.message,/cut off/i);
});

test('structured response parser distinguishes refusal, empty output, and malformed JSON',()=>{
  assert.equal(parseStructuredResponsePayload({status:'completed',output:[{content:[{type:'refusal',refusal:'Unable'}]}]}).code,'AI_RESPONSE_REFUSED');
  assert.equal(parseStructuredResponsePayload({status:'completed',output:[]}).code,'AI_RESPONSE_EMPTY');
  assert.equal(parseStructuredResponsePayload({status:'completed',output_text:'{"answer":'}).code,'AI_RESPONSE_INVALID_JSON');
});

test('Master GM action rulings use the expanded low-verbosity response budget',async()=>{
  const source=await readFile(new URL('../supabase/functions/gm-copilot/index.ts',import.meta.url),'utf8');
  assert.match(source,/const RESOLUTION_MAX_OUTPUT_TOKENS=18_000/);
  assert.match(source,/maxOutputTokens:resolvingActions\?RESOLUTION_MAX_OUTPUT_TOKENS:6500/);
  assert.match(source,/schemaName:'master_gm_resolution_repair',maxOutputTokens:RESOLUTION_MAX_OUTPUT_TOKENS/);
  assert.match(source,/effort:resolvingActions\?'low'/);
  assert.match(source,/verbosity:resolvingActions\?'low':'medium'/);
  assert.match(source,/do not repeat the same rationale/i);
});
