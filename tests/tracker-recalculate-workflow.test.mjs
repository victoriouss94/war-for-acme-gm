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
    renderAll:()=>{},refreshAiGmData:async()=>{},showView:()=>{},alert:value=>alerts.push(value),selectedResolutionSessionId:null,loadedResolutionFormId:'original',loadedResolutionFormVersion:4,
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
for(const [label,patch,deaths,generated] of [
  ['cancelled root',{forceResult:'CANCELLED'},[],0],
  ['retargeted root',{targetIds:['observer'],effectiveTargetIds:['observer'],originalTargetIds:['retaliator']},['observer'],0]
])test('Resolve again preserves saved GM recalculation: '+label,async()=>{
  const h=harness(),input={gameId:'button-test',resolutionId:'session',round:1,phase:'Night',snapshot:h.session.pre_resolution_state,actions:h.session.submitted_actions};
  const corrected=recalculateNight(h.previous,input,{actionId:'attack',actionPatch:patch});
  const {starting_snapshot,...savedProposal}=corrected;h.session.engine_proposal=JSON.parse(JSON.stringify(savedProposal));
  const before=structuredClone(h.session);
  await vm.runInContext('resolveSelectedNight()',h.context);
  assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,1);
  assert.deepEqual(h.saved[0][2].deaths,deaths);assert.equal(h.saved[0][2].observability.generated_effect_count,generated);
  assert.deepEqual(h.saved[0][2].recalculation.action_overrides,corrected.recalculation.action_overrides);
  assert.deepEqual(h.session,before);
});

test('Resolve again retains saved GM rule additions without duplicating them',async()=>{
  const h=harness(),input={gameId:'button-test',resolutionId:'session',round:1,phase:'Night',snapshot:h.session.pre_resolution_state,actions:h.session.submitted_actions};
  h.session.engine_proposal=recalculateNight(h.previous,input,{rules:[{id:'gm-rule',description:'Synthetic GM ruling context.'}]});
  await vm.runInContext('resolveSelectedNight()',h.context);
  assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,1);
  assert.deepEqual(h.saved[0][2].recalculation?.rule_additions,[{id:'gm-rule',description:'Synthetic GM ruling context.'}]);
});

test('unknown-interaction second pass cannot discard a saved GM cancellation',async()=>{
  const h=harness(()=>{},input=>{
    input.snapshot.abilities.push({id:'unknown',name:'Unknown custom action',engineBehavior:{effect:'CUSTOM',requiresExplicitRule:true,tags:['ACTIVE_ACTION']}});
    input.actions.push({id:'unknown-action',abilityId:'unknown',name:'Unknown custom action',sourcePlayerId:'observer',targetIds:['attacker']});
  });
  const input={gameId:'button-test',resolutionId:'session',round:1,phase:'Night',snapshot:h.session.pre_resolution_state,actions:h.session.submitted_actions};
  h.session.engine_proposal=recalculateNight(h.previous,input,{actionId:'attack',actionPatch:{forceResult:'CANCELLED'}});
  let requests=0;h.context.GMCloud.adjudicateInteraction=async()=>{requests++;return {status:'REJECTED',accounting_warning:'Synthetic accounting warning.'}};
  await vm.runInContext('resolveSelectedNight()',h.context);
  assert.equal(requests,1);assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,1);
  assert.deepEqual(h.saved[0][2].deaths,[]);assert.equal(h.saved[0][2].observability.generated_effect_count,0);
  assert.equal(h.saved[0][2].action_results.find(row=>row.action_id==='attack').result,'CANCELLED');
  assert.equal(h.saved[0][2].resolution_status,'GM_REVIEW_REQUIRED');
});

test('repeated saved Resolve replay keeps cumulative rule additions exactly once',async()=>{
  const h=harness(),input={gameId:'button-test',resolutionId:'session',round:1,phase:'Night',snapshot:h.session.pre_resolution_state,actions:h.session.submitted_actions};
  h.session.engine_proposal=recalculateNight(h.previous,input,{rules:[{id:'first'}]});
  h.session.engine_proposal=recalculateNight(h.session.engine_proposal,input,{rules:[{id:'second'}]});
  for(let n=0;n<2;n++){
    await vm.runInContext('resolveSelectedNight()',h.context);
    h.session.engine_proposal=JSON.parse(JSON.stringify(h.saved.at(-1)[2]));
  }
  assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,2);
  assert.deepEqual(h.session.engine_proposal.recalculation.rule_additions,[{id:'first'},{id:'second'}]);
});

for(const [label,edit] of [
  ['action cancellation',draft=>{draft.action_results[0].result='CANCELLED'}],
  ['player survival',draft=>{draft.player_outcomes.find(p=>p.player_id==='retaliator').life_state='UNCHANGED'}],
  ['manual ruling',draft=>{draft.final_ruling='My source-grounded manual ruling.'}],
  ['review questions',draft=>{draft.unresolved_questions=['Resolve this condition first.']}]
])test('Resolve does not overwrite current editor changes: '+label,async()=>{
  const h=harness(edit),before=structuredClone(h.draft);h.context.loadedResolutionFormId=h.session.id;
  await vm.runInContext('resolveSelectedNight()',h.context);
  assert.equal(h.saved.length,0);assert.match(h.alerts.join(' '),/manual edits.*Recalculate/i);
  assert.deepEqual(h.draft,before);assert.equal(h.context.loadedResolutionFormId,h.session.id);
  assert.equal(h.context.resolutionPending,false);
});

test('Resolve with an unchanged editor still runs normally',async()=>{
  const h=harness();h.context.loadedResolutionFormId=h.session.id;
  await vm.runInContext('resolveSelectedNight()',h.context);
  assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,1);
});

test('Resolve does not inspect a draft belonging to another session',async()=>{
  const h=harness(draft=>{draft.final_ruling='Different session edit'});
  h.context.loadedResolutionFormId='different-session';
  h.context.captureResolutionEditor=()=>assert.fail('Do not capture another session editor');
  await vm.runInContext('resolveSelectedNight()',h.context);
  assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,1);
});

for(const handler of ['resolveSelectedNight','recalculateSelectedNight'])test('stale editor cannot rewrite a newer proposal through '+handler,async()=>{
  const h=harness(),before=structuredClone(h.draft);h.context.loadedResolutionFormId=h.session.id;h.session.lock_version=5;
  await vm.runInContext(handler+'()',h.context);
  assert.equal(h.saved.length,0);assert.match(h.alerts.join(' '),/changed this session/);assert.deepEqual(h.draft,before);
});

test('fresh Resolve still executes the existing engine without creating correction metadata',async()=>{
  const h=harness();await vm.runInContext('resolveSelectedNight()',h.context);
  assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,1);
  assert.deepEqual(new Set(h.saved[0][2].deaths),new Set(['attacker','retaliator']));
  assert.equal(h.saved[0][2].recalculation,undefined);
});
