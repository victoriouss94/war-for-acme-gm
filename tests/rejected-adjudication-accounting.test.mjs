import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolveNightDeterministically} from '../js/night-engine.js';

const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
async function run(response){
  const snapshot={players:[{id:'actor',name:'Actor',alive:true},{id:'target',name:'Target',alive:true}],roles:[],factions:[],abilities:[],statuses:[],grants:[],modes:[],rules:[],precedents:[]};
  const session={id:'synthetic-warning',lock_version:1,cycle:1,phase:'Night',status:'DRAFT',pre_resolution_state:snapshot,
    submitted_actions:[{id:'attempt',name:'Unknown effect',sourcePlayerId:'actor',targetIds:['target'],resolutionCategory:'STATUS_EFFECTS'}]};
  const saved=[],alerts=[],calls=[];
  const context={currentResolutionSession:()=>session,currentGame:()=>({id:'synthetic-game'}),resolutionPending:false,resolveNightDeterministically,
    renderAll:()=>{},refreshAiGmData:async()=>{},showView:()=>{},alert:value=>alerts.push(value),selectedResolutionSessionId:null,loadedResolutionFormId:null,
    GMCloud:{saveDeterministicResolution:async(...args)=>saved.push(args),adjudicateInteraction:async(...args)=>{calls.push(args);return response;}}};
  const start=source.indexOf('function nightEngineInput('),end=source.indexOf('\nasync function recalculateSelectedNight(',start);
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.run=resolveSelectedNight;',context);await context.run();
  assert.deepEqual(alerts,[]);assert.equal(calls.length,1);assert.equal(saved.length,1);return saved[0][2];
}

for(const status of ['GM_REVIEW_REQUIRED','UNRESOLVED','ADJUDICATED'])test(`actual Resolve Night retains accounting failure for ${status} rejected response`,async()=>{
  const response={action_id:'attempt',status,confidence:'LOW',behavior:{requiresExplicitRule:true},accounting_warning:'AI usage could not be saved.'};
  const result=await run(response);
  assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');assert.deepEqual(result.deaths,[]);
  assert.equal(result.ai_adjudications.length,1);assert.equal(result.ai_adjudications[0].accounting_warning,response.accounting_warning);
  const start=source.indexOf('function resolutionAccountingWarningHtml('),end=source.indexOf('\nfunction ',start+1);
  const html=vm.runInNewContext(source.slice(start,end)+'\nresolutionAccountingWarningHtml(result,{})',{result});
  assert.match(html,/AI usage recording incomplete/);
});

test('an ordinary rejected response without an accounting warning retains current review behavior',async()=>{
  const result=await run({action_id:'attempt',status:'GM_REVIEW_REQUIRED'});
  assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');assert.equal(result.ai_adjudications.length,0);
});
