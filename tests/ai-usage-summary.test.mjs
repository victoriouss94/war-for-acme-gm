import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),cloud=readFileSync(new URL('../js/cloud.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function aiUsageTotalsHtml('),app.indexOf('\nfunction ',app.indexOf('function aiUsageTotalsHtml(')+1));
const summary=()=>({month_start:'2026-09-01T00:00:00+00:00',month_end:'2026-10-01T00:00:00+00:00',requests:501,input_tokens:5010,cached_input_tokens:10,output_tokens:1002,estimated_cost_usd:12.5,pending_requests:3,failed_requests:2});
function render(value,owner=true){assert.ok(source.startsWith('function aiUsageTotalsHtml('),'Missing aggregate renderer');return vm.runInNewContext(source+'\naiUsageTotalsHtml(value,owner)',{value,owner,esc:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;')});}
test('usage renderer uses complete server aggregate beyond the 250-row display cap',()=>{
  const html=render(summary());assert.match(html,/501 requests/);assert.match(html,/\$12\.5000/);assert.match(html,/2026-09.*UTC/);assert.match(html,/3.*awaiting final usage/);assert.match(html,/2 failed/);
});
test('missing or malformed aggregate never becomes a false zero monthly total',()=>{
  for(const value of [null,undefined,{}, {...summary(),estimated_cost_usd:null},{...summary(),input_tokens:-1},{...summary(),requests:Infinity},{...summary(),month_start:'<script>bad</script>'}]){
    const html=render(value);assert.match(html,/unavailable/i);assert.doesNotMatch(html,/\$0\.0000|<script>/);
  }
});
test('an explicit empty month remains valid',()=>{
  const value=summary();for(const key of Object.keys(value))if(!key.startsWith('month_'))value[key]=0;
  assert.match(render(value),/0 requests/);assert.match(render(value),/\$0\.0000/);
});

test('actual learning-panel usage block renders the aggregate, not capped history',()=>{
  const start=app.indexOf('  const usage=aiGmData.usage||[];'),end=app.indexOf('\n',start),nodes={};
  assert.ok(start>=0);const $=id=>nodes[id]??=( {} );
  const aiGmData={usageMonth:summary(),usage:Array.from({length:250},()=>({feature:'assistant',model:'test',created_at:'2026-09-02',status:'COMPLETED',estimated_cost_usd:0.01}))};
  vm.runInNewContext(source+'\n'+app.slice(start,end),{aiGmData,owner:true,$,esc:String,formatDateTime:String});
  assert.match(nodes.aiUsageTotals.innerHTML,/501 requests/);assert.match(nodes.aiUsageTotals.innerHTML,/\$12\.5000/);
  assert.equal((nodes.aiUsageList.innerHTML.match(/usage-row/g)||[]).length,30);
});
test('nonowners never receive totals from the usage renderer',()=>{
  const html=render(summary(),false);assert.match(html,/Only the game owner/);assert.doesNotMatch(html,/12\.5000|501 requests/);
});
async function loadSummary({error=false,throws=false}={}){
  const start=cloud.indexOf('  async function resolutionContext('),end=cloud.indexOf('  async function createRoleAssignmentPreview(',start),calls=[];
  const client={from(){const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:null}),then(resolve){return Promise.resolve({data:[]}).then(resolve)}};return q;},rpc:async(name)=>{calls.push(name);if(name==='get_ai_usage_month_summary'){if(throws)throw Error('network');return error?{error:{message:'unavailable'}}:{data:summary()};}return {data:[]};}};
  const context={required:()=>client};vm.createContext(context);vm.runInContext(cloud.slice(start,end)+'\nglobalThis.load=resolutionContext;',context);
  return {result:await context.load('synthetic-game'),calls};
}
test('actual cloud loader fetches monthly aggregate separately from recent usage rows',async()=>{
  const {result,calls}=await loadSummary();assert.ok(calls.includes('get_ai_usage_month_summary'));assert.equal(result.usageMonth.requests,501);assert.equal(result.usage.length,0);
});
test('usage summary errors do not masquerade as zero or break the resolution context',async()=>{
  for(const options of [{error:true},{throws:true}]){const {result}=await loadSummary(options);assert.equal(result.usageMonth,null);assert.ok(Array.isArray(result.sessions));}
});
