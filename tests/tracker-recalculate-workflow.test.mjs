import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {buildResolutionDraft,resolutionDifferences} from '../js/resolution-editor.js';

const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
function harness(edit=()=>{}){
  const snapshot={players:['attacker','retaliator','observer'].map(id=>({id,name:id,alive:true,roleId:id+'-role'})),roles:[{id:'retaliator-role',name:'Retaliator',passives:['Counterattack']}],abilities:[],factions:[],statuses:[],grants:[],modes:[],rules:[],precedents:[]};
  const actions=[{id:'attack',name:'Personal Instant Kill',sourcePlayerId:'attacker',targetIds:['retaliator']},{id:'watch',name:'Watch',sourcePlayerId:'observer',targetIds:['attacker']}],input={snapshot,gameId:'button-test',resolutionId:'session',round:1,phase:'Night',actions};
  const previous=resolveNightDeterministically(input),session={id:'session',lock_version:4,status:'DRAFT',cycle:1,phase:'Night',pre_resolution_state:snapshot,submitted_actions:actions,engine_proposal:previous};
  const draft=buildResolutionDraft({proposal:previous,actions,players:snapshot.players});edit(draft);
  const button={},saved=[],alerts=[],elements={recalculateResolutionBtn:{disabled:false},finalizeResolutionBtn:{disabled:false},manualResolutionForm:{}};
  const context={currentResolutionSession:()=>session,currentGame:()=>({id:input.gameId}),resolutionPending:false,resolveNightDeterministically,recalculateNight,buildResolutionDraft,resolutionDifferences,captureResolutionEditor:()=>draft,
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
