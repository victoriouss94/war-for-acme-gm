import test from 'node:test';
import assert from 'node:assert/strict';
import {scanRpcCalls,compareRpcCalls} from '../scripts/audit-rpc-contracts.mjs';

const catalog=[{name:'sample',signature:'target_game_id uuid, payload jsonb, optional_value text',argument_names:['target_game_id','payload','optional_value','output_column'],input_count:3,default_count:1}];
test('RPC scanner retains nested arguments, strings and source line',()=>{
  const [call]=scanRpcCalls("\nclient.rpc('sample',{target_game_id:id,payload:{text:'commas, } )',items:[1,2]}})",'fixture');
  assert.equal(call.line,2);assert.deepEqual(call.keys,['target_game_id','payload']);assert.equal(compareRpcCalls([call],catalog)[0].status,'MATCH');
});
test('RPC scanner ignores comments, strings and literal template examples',()=>{
  const calls=scanRpcCalls("// x.rpc('fake')\nconst example=\"x.rpc('fake')\";/* y.rpc('fake') */const tpl=`z.rpc('fake')`;client.rpc('sample',{target_game_id:1,payload:{}})");
  assert.equal(calls.length,1);assert.equal(calls[0].name,'sample');
});
test('RPC scanner preserves UTF-16 offsets and escaped quotes',()=>{
  const calls=scanRpcCalls("const s='😀 can\\'t';\nclient.rpc('sample',{target_game_id:'😀',payload:{}})");
  assert.equal(calls[0].name,'sample');assert.equal(calls[0].line,2);assert.equal(compareRpcCalls(calls,catalog)[0].status,'MATCH');
});
test('optional arguments may be omitted and output columns are not input keys',()=>{
  const good=scanRpcCalls("x.rpc('sample',{target_game_id,payload,optional_value:null})");
  assert.equal(compareRpcCalls(good,catalog)[0].status,'MATCH');
  assert.equal(compareRpcCalls(scanRpcCalls("x.rpc('sample',{target_game_id,payload,output_column:1})"),catalog)[0].status,'ARGUMENT_MISMATCH');
});
test('missing function, missing required key and extra key remain distinct failures',()=>{
  assert.equal(compareRpcCalls(scanRpcCalls("x.rpc('gone',{})"),catalog)[0].status,'MISSING_FUNCTION');
  for(const source of ["x.rpc('sample',{payload:{}})","x.rpc('sample',{target_game_id,payload,unknown:1})"])
    assert.equal(compareRpcCalls(scanRpcCalls(source),catalog)[0].status,'ARGUMENT_MISMATCH');
});
test('dynamic targets, expressions and spreads are explicit manual review',()=>{
  for(const source of ["x.rpc(selected,{target_game_id,payload})","x.rpc('sample',values)","x.rpc('sample',{...values})","x.rpc('sample',{[key]:1})"])
    assert.equal(compareRpcCalls(scanRpcCalls(source),catalog)[0].status,'MANUAL_REVIEW');
});
test('multiple matching overloads are not silently accepted',()=>{
  const calls=scanRpcCalls("x.rpc('sample',{target_game_id,payload})");assert.equal(compareRpcCalls(calls,[...catalog,...catalog])[0].status,'AMBIGUOUS_SIGNATURE');
});
test('argument-free RPCs match a zero-input catalog contract',()=>{
  const calls=scanRpcCalls("x.rpc('sample')");assert.equal(compareRpcCalls(calls,[{name:'sample',argument_names:null,input_count:0,default_count:0,signature:''}])[0].status,'MATCH');
});
