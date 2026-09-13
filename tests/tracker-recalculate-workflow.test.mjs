import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {buildResolutionDraft,resolutionDifferences} from '../js/resolution-editor.js';
import {classifyAbility} from '../js/global-abilities.js';

const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
function harness(edit=()=>{},setup=()=>{}){
  const snapshot={players:['attacker','retaliator','observer'].map(id=>({id,name:id,alive:true,roleId:id+'-role'})),roles:[{id:'retaliator-role',name:'Retaliator',passives:['Counterattack']}],abilities:[],factions:[],statuses:[],grants:[],modes:[],rules:[],precedents:[]};
  const actions=[{id:'attack',name:'Personal Instant Kill',sourcePlayerId:'attacker',targetIds:['retaliator']},{id:'watch',name:'Watch',sourcePlayerId:'observer',targetIds:['attacker']}],input={snapshot,gameId:'button-test',resolutionId:'session',round:1,phase:'Night',actions};
  setup(input);
  const previous=resolveNightDeterministically(input),session={id:'session',lock_version:4,status:'DRAFT',cycle:1,phase:'Night',pre_resolution_state:snapshot,submitted_actions:actions,engine_proposal:previous};
  const draft=buildResolutionDraft({proposal:previous,actions,players:snapshot.players});edit(draft);
  const button={},saved=[],alerts=[],elements={recalculateResolutionBtn:{disabled:false},finalizeResolutionBtn:{disabled:false},manualResolutionForm:{}};
  const context={currentResolutionSession:()=>session,currentGame:()=>({id:input.gameId}),resolutionPending:false,resolveNightDeterministically,recalculateNight,buildResolutionDraft,resolutionDifferences,classifyAbility,captureResolutionEditor:()=>draft,
    renderAll:()=>{},refreshAiGmData:async()=>{},showView:()=>{},alert:value=>alerts.push(value),selectedResolutionSessionId:null,loadedResolutionFormId:'original',
    $:id=>elements[id],document:{querySelectorAll:selector=>selector==='[data-resolution-workflow="recalculate"]'?[button]:[]},
    GMCloud:{saveDeterministicResolution:async(...args)=>saved.push(args),adjudicateInteraction:()=>assert.fail('Recalculation must not call AI')}};
  const start=source.indexOf('function nightEngineInput('),end=source.indexOf('\nfunction resolutionListCard(',start),bind=source.indexOf('function bindTrackerResolutionReview('),bindEnd=source.indexOf('\nfunction syncResolutionLearningControls(',bind);
  assert.ok(start>=0&&end>start&&bind>=0&&bindEnd>bind);vm.createContext(context);vm.runInContext(source.slice(start,end)+'\n'+source.slice(bind,bindEnd)+'\nglobalThis.bind=bindTrackerResolutionReview;globalThis.recalculate=recalculateSelectedNight;',context);context.bind();
  return {button,saved,alerts,session,draft,previous,context,elements};
}
test('tracker Recalculate button runs canonical correction and saves dependent outcomes',async()=>{
  const h=harness(draft=>{const attack=draft.action_results.find(a=>a.action_id==='attack');attack.result='CANCELLED';attack.reason='GM cancelled the attack.'}),before=structuredClone(h.session);
  assert.equal(h.button.disabled,false);await h.button.onclick();assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,1);assert.deepEqual(h.saved[0].slice(0,2),['session',4]);
  const proposal=h.saved[0][2];assert.deepEqual(proposal.deaths,[]);assert.equal(proposal.observability.generated_effect_count,0);assert.equal(proposal.action_results.find(a=>a.action_id==='watch').reason,'Watch result: No visitors.');assert.equal(proposal.starting_snapshot,undefined);assert.deepEqual(h.session,before);
});
test('changing only standardized ability type is detected and recalculated',async()=>{
  const h=harness(draft=>{draft.action_results.find(a=>a.action_id==='attack').standardized_ability_type='Super Kill'});await h.context.recalculate();
  assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,1);assert.equal(h.saved[0][2].action_results.find(a=>a.action_id==='attack').standardized_ability_type,'Super Kill');
});
for(const status of ['FINALIZED','REJECTED'])test('tracker mirrors disabled recalculation and finalized session remains unchanged: '+status,async()=>{const h=harness();h.session.status=status;h.elements.recalculateResolutionBtn.disabled=true;h.context.bind();assert.equal(h.button.disabled,true);await h.button.onclick();assert.deepEqual(h.saved,[])});
test('unsupported player outcome edit is not silently overwritten during recalculation',async()=>{
  const h=harness(draft=>{draft.player_outcomes.find(p=>p.player_id==='retaliator').life_state='UNCHANGED'}),before=structuredClone(h.draft);await h.context.recalculate();
  assert.deepEqual(h.saved,[]);assert.match(h.alerts.join(' '),/player.*outcome/i);assert.deepEqual(h.draft,before);assert.equal(h.context.loadedResolutionFormId,'original');
});

for(const [field,value] of [['use_disposition','REFUNDED'],['immune',true],['protected',true],['reflected',true],['redirected',true],['affected_player_ids',['observer']],['order',50],['resolution_timing','ANY_TIME'],['cooldown','Two nights'],['source_game_rule','Synthetic authority'],['global_rule_used','Synthetic standard'],['reason','A manual explanation without a result change']])test('unapplied action edit remains in editor: '+field,async()=>{
  const h=harness(draft=>{draft.action_results.find(a=>a.action_id==='attack')[field]=value}),before=structuredClone(h.draft);await h.context.recalculate();
  assert.equal(h.saved.length,0);assert.match(h.alerts.join(' '),/cannot|not.*appl/i);assert.deepEqual(h.draft,before);assert.equal(h.context.loadedResolutionFormId,'original');
});
test('a same-name original/effective target alias cannot override the GM target correction',async()=>{
  const h=harness(draft=>{draft.action_results.find(a=>a.action_id==='attack').final_target_ids=['observer']});Object.assign(h.session.submitted_actions[0],{originalTargetIds:['retaliator'],effectiveTargetIds:['retaliator']});
  const before=structuredClone(h.session);await h.context.recalculate();assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,1);const action=h.saved[0][2].action_results.find(a=>a.action_id==='attack');assert.deepEqual(action.final_target_ids,['observer']);assert.deepEqual(action.original_target_ids,['retaliator']);assert.deepEqual(h.saved[0][2].deaths,['observer']);assert.deepEqual(h.session,before);
});
test('reclassification does not turn an unchanged reflected target into a new submitted destination',async()=>{
  const h=harness(draft=>{draft.action_results.find(a=>a.action_id==='attack').standardized_ability_type='Poison'},input=>{input.actions[0].name='Mark';input.snapshot.roles[0].passives=['Reflection']});await h.context.recalculate();assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,1);const row=h.saved[0][2].action_results.find(a=>a.action_id==='attack');assert.equal(row.reflected,true);assert.deepEqual(row.original_target_ids,['retaliator']);assert.deepEqual(row.final_target_ids,['attacker']);assert.equal(h.saved[0][2].passive_results.length,1);
});
test('GM reclassification across categories uses the chosen standard stage',async()=>{
  const h=harness(draft=>{draft.action_results.find(a=>a.action_id==='attack').standardized_ability_type='Protect'});await h.context.recalculate();assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,1);assert.deepEqual(h.saved[0][2].deaths,[]);assert.equal(h.saved[0][2].action_results.find(a=>a.action_id==='attack').resolution_category,'STATUS_EFFECTS');
});
