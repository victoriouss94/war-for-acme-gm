import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../js/resolution-editor.js';
import {buildTrackerResolutionReview} from '../js/resolution-review.js';

const action=(id,name,actor='actor',target='target',extra={})=>({id,name,sourcePlayerId:actor,targetIds:[target],...extra});
function fixture(name='Reflection'){
  return {gameId:'passive-submission-audit',round:1,phase:'Night',
    players:[{id:'actor',name:'Actor',alive:true},{id:'target',name:'Target',roleId:'target-role',alive:true}],
    roles:[],abilities:[],actions:[action('invalid-passive',name,'actor','target',{playerAbilityGrantId:'synthetic-grant'})]};
}
const row=r=>r.action_results.find(a=>a.action_id==='invalid-passive');

for(const name of ['Reflection','Counterattack','Death Immunity','Bulletproof'])test('submitted '+name+' is reported, not silently dropped or executed',()=>{
  const input=fixture(name),before=structuredClone(input),r=resolveNightDeterministically(input);
  assert.equal(r.action_results.length,1);assert.equal(r.observability.submitted_action_count,1);
  assert.deepEqual(r.actions_analyzed,['invalid-passive']);assert.equal(row(r).result,'INELIGIBLE_EFFECT');
  assert.match(row(r).reason,/passive/i);assert.equal(row(r).use_disposition,'NOT_CONSUMED');
  assert.equal(r.resolution_status,'GM_REVIEW_REQUIRED');assert.ok(r.unresolved_questions.some(q=>/passive/i.test(q)));
  assert.equal(r.unresolved_interactions.length,0,'Known invalid submissions must not be sent to AI');
  assert.equal(r.observability.ai_fallback_call_count,0);assert.equal(r.passive_results.length,0);
  assert.deepEqual(r.deaths,[]);assert.deepEqual(input,before);
});

test('passive metadata on a local ability still preserves its queued ID',()=>{
  const input=fixture('Local Ward');input.actions[0].abilityId='ward';input.abilities=[{id:'ward',name:'Local Ward',activePassive:'PASSIVE',resolutionCategory:'PASSIVES'}];
  const r=resolveNightDeterministically(input);
  assert.equal(row(r)?.ability_id,'ward');assert.equal(row(r)?.result,'INELIGIBLE_EFFECT');
});

test('mixed valid action executes while invalid passive stays visible through approval normalization',()=>{
  const input=fixture();input.actions.push(action('attack','Personal Instant Kill'));
  const r=resolveNightDeterministically(input),payload=finalResolutionPayload(buildResolutionDraft({proposal:r,actions:input.actions,players:input.players}));
  assert.equal(r.action_results.length,2);assert.equal(payload.action_results.length,2);
  assert.equal(row(payload)?.result,'INELIGIBLE_EFFECT');assert.equal(r.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,false);
  assert.equal(r.resolution_status,'GM_REVIEW_REQUIRED');
});

test('GM cancellation clears the invalid passive review without losing action history',()=>{
  const input=fixture(),first=resolveNightDeterministically(input);
  const r=recalculateNight(first,input,{actionId:'invalid-passive',actionPatch:{forceResult:'CANCELLED',forceReason:'Remove erroneous queued passive'}});
  assert.equal(row(r)?.result,'CANCELLED');assert.equal(r.action_results.length,1);
  assert.equal(r.resolution_status,'RESOLVED');assert.deepEqual(r.unresolved_questions,[]);
});

test('invalid passive submission does not duplicate a real automatic passive trigger',()=>{
  const input=fixture('Counterattack');input.actions[0].sourcePlayerId='target';input.roles=[{id:'target-role',name:'Defender',passives:['Counterattack']}];input.actions.push(action('attack','Personal Instant Kill'));
  const r=resolveNightDeterministically(input);
  assert.equal(r.action_results.length,2);assert.equal(r.passive_results.length,1);
  assert.equal(r.observability.generated_effect_count,1);assert.equal(row(r)?.use_disposition,'NOT_CONSUMED');
});

test('an invalid mode does not overwrite or duplicate the passive submission result',()=>{
  const input=fixture();input.actions[0].modeId='inaccessible';
  const r=resolveNightDeterministically(input);
  assert.match(row(r).reason,/passive/);assert.equal(r.events.filter(e=>e.action_id==='invalid-passive'&&e.result==='INELIGIBLE_EFFECT').length,1);
  const cancelled=recalculateNight(r,input,{actionId:'invalid-passive',actionPatch:{forceResult:'CANCELLED'}});
  assert.equal(row(cancelled).result,'CANCELLED');assert.deepEqual(cancelled.unresolved_questions,[]);
});

test('an explicit GM reclassification can correct an imported passive-labelled active ability',()=>{
  const input=fixture(),first=resolveNightDeterministically(input);
  const r=recalculateNight(first,input,{actionId:'invalid-passive',actionPatch:{standardizedAbilityType:'Personal Instant Kill',resolutionCategory:'KILLS'}});
  assert.equal(row(r).result,'SUCCESS');assert.equal(row(r).standardized_ability_type,'Personal Instant Kill');
  assert.equal(r.resolution_status,'RESOLVED');assert.equal(r.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,false);
});

test('AI adjudication does not silently convert a queued passive into an active kill',()=>{
  const input=fixture();input.aiAdjudications=[{action_id:'invalid-passive',status:'ADJUDICATED',confidence:'HIGH',standardized_type:'Personal Instant Kill',resolution_category:'KILLS',behavior:{requiresExplicitRule:false}}];
  const r=resolveNightDeterministically(input);
  assert.equal(row(r).result,'INELIGIBLE_EFFECT');assert.deepEqual(r.deaths,[]);assert.equal(r.observability.ai_adjudication_count,0);
});

test('tracker review prevents approval of a dropped-passive replacement result until corrected',()=>{
  const input=fixture(),r=resolveNightDeterministically(input),review=buildTrackerResolutionReview({draft:r,roster:input.players,submittedActions:input.actions});
  assert.equal(review.isComplete,false);assert.ok(review.reviewQuestions.some(q=>/passive/i.test(q)));
});

test('actual Resolve Night handler saves the visible invalid submission without calling AI',async()=>{
  const input=fixture(),snapshot={...input,factions:[],statuses:[],grants:[],modes:[],rules:[],precedents:[]},
    session={id:'passive-session',lock_version:2,cycle:1,phase:'Night',status:'DRAFT',pre_resolution_state:snapshot,submitted_actions:input.actions};
  const saved=[],alerts=[],source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),start=source.indexOf('function nightEngineInput('),end=source.indexOf('\nasync function recalculateSelectedNight(',start);
  const context={currentResolutionSession:()=>session,currentGame:()=>({id:input.gameId}),resolutionPending:false,resolveNightDeterministically,
    renderAll:()=>{},refreshAiGmData:async()=>{},showView:()=>{},alert:m=>alerts.push(m),selectedResolutionSessionId:null,loadedResolutionFormId:null,
    GMCloud:{saveDeterministicResolution:async(...args)=>saved.push(args),adjudicateInteraction:()=>assert.fail('Invalid queued passive must not incur AI work')}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.resolve=resolveSelectedNight;',context);
  await context.resolve();assert.deepEqual(alerts,[]);assert.equal(saved.length,1);
  assert.equal(row(saved[0][2]).result,'INELIGIBLE_EFFECT');assert.equal(saved[0][2].resolution_status,'GM_REVIEW_REQUIRED');
});
