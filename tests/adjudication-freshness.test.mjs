import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolveNightDeterministically as resolve,recalculateNight} from '../js/night-engine.js';
import {globalAbilityDefinition} from '../js/global-abilities.js';

const fixture=()=>({gameId:'freshness',resolutionId:'session',round:1,phase:'Night',players:[{id:'actor',name:'Actor',alive:true},{id:'target',name:'Target',alive:true},{id:'other',name:'Other',alive:true}],abilities:[{id:'ability',name:'Temporal Strike',definition:'A custom conditional strike.'}],rules:[],actions:[{id:'attempt',name:'Temporal Strike',abilityId:'ability',sourcePlayerId:'actor',targetIds:['target']}]});
function answer(input){const interaction=resolve(input).unresolved_interactions[0];return {action_id:'attempt',interaction_id:interaction.interaction_id,source_context_signature:interaction.source_context_signature,status:'ADJUDICATED',confidence:'HIGH',standardized_type:'Personal Instant Kill',resolution_category:'KILLS',behavior:{...globalAbilityDefinition('Personal Instant Kill').behavior,requiresExplicitRule:false}};}
for(const [name,change] of [
  ['ability text',input=>{input.abilities[0].definition='Never kill the target; inspect only.'}],
  ['target',input=>{input.actions[0].targetIds=['other']}],
  ['game rule',input=>{input.rules.push({name:'No lethal custom effects'})}],
  ['actor mode',input=>{input.players[0].modeName='Dormant'}],
  ['other queued action',input=>{input.actions.push({id:'watch',name:'Watch',sourcePlayerId:'other',targetIds:['actor']})}],
  ['phase',input=>{input.round=2}],
  ['game',input=>{input.gameId='another-game'}],
])test('saved custom AI mapping is rejected after changing '+name,()=>{
  const input=fixture();input.aiAdjudications=[answer(input)];change(input);const before=structuredClone(input),result=resolve(input);
  assert.deepEqual(result.deaths,[]);assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');assert.equal(result.observability.ai_adjudication_count,0);assert.deepEqual(input,before);
  assert.ok(result.engine_trace.some(item=>item.summary.includes('context changed')));
});
test('legacy custom answer without freshness evidence stays reviewable',()=>{const input=fixture(),saved=answer(input);delete saved.source_context_signature;input.aiAdjudications=[saved];assert.deepEqual(resolve(input).deaths,[])});
test('exact unchanged context reuses mapping after JSON replay without mutating input',()=>{const input=fixture(),saved=answer(input);assert.match(saved.source_context_signature,/^v1:/);input.aiAdjudications=[saved];const replay=JSON.parse(JSON.stringify(input)),result=resolve(replay);assert.deepEqual(result.deaths,['Target']);assert.equal(result.observability.ai_adjudication_count,1);assert.deepEqual(replay,input)});
test('GM target correction invalidates a custom mapping without a new AI request',()=>{const input=fixture();input.aiAdjudications=[answer(input)];const previous=resolve(input),next=recalculateNight(previous,input,{actionId:'attempt',actionPatch:{targetIds:['other']}});assert.deepEqual(previous.deaths,['Target']);assert.deepEqual(next.deaths,[]);assert.equal(next.resolution_status,'GM_REVIEW_REQUIRED')});
test('actual Resolve Night binds fresh response to requested context and persists reusable result',async()=>{
  const input=fixture(),snapshot={...input,roles:[],factions:[],statuses:[],grants:[],modes:[],precedents:[]},session={id:'session',lock_version:3,cycle:1,phase:'Night',status:'DRAFT',pre_resolution_state:snapshot,submitted_actions:input.actions},saved=[],calls=[];
  const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),start=source.indexOf('function nightEngineInput('),end=source.indexOf('\nasync function recalculateSelectedNight(',start);
  const context={currentResolutionSession:()=>session,currentGame:()=>({id:input.gameId}),resolutionPending:false,resolveNightDeterministically:resolve,renderAll:()=>{},refreshAiGmData:async()=>{},showView:()=>{},alert:message=>assert.fail(message),selectedResolutionSessionId:null,loadedResolutionFormId:null,
    GMCloud:{saveDeterministicResolution:async(...args)=>saved.push(args),adjudicateInteraction:async(...args)=>{calls.push(args);const result=answer(input);delete result.source_context_signature;return result}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.resolve=resolveSelectedNight;',context);await context.resolve();
  assert.equal(calls.length,1);assert.deepEqual(saved[0][2].deaths,['Target']);assert.match(saved[0][2].ai_adjudications[0].source_context_signature,/^v1:/);
  session.ai_adjudications=saved[0][2].ai_adjudications;await context.resolve();assert.equal(calls.length,1);assert.deepEqual(saved[1][2].deaths,['Target']);
});
