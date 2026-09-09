import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../js/resolution-editor.js';

const action=(id,name,actor,target,extra={})=>({id,name,sourcePlayerId:actor,targetIds:[target],...extra});
function fixture(){
  return {gameId:'late-intel-audit',resolutionId:'local-session',round:1,phase:'Night',
    players:['attacker','retaliator','observer','helper'].map(id=>({id,name:id,alive:true,roleId:id+'-role',factionId:'town'})),
    roles:[{id:'retaliator-role',name:'Retaliator',passives:['Counterattack']},{id:'attacker-role',name:'Attacker'}],
    factions:[{id:'town',name:'Town'},{id:'den',name:'Den'}],
    actions:[action('attack','Personal Instant Kill','attacker','retaliator')]};
}
const result=(r,id)=>r.action_results.find(item=>item.action_id===id);

for(const [name,target,expected] of [['Watch','attacker','retaliator'],['Track','retaliator','attacker'],['Action Check','attacker','Personal Instant Kill']]){
  test(name+' includes a Counterattack generated after the Intel stage',()=>{
    const input=fixture();input.actions.push(action('intel',name,'observer',target));
    const before=structuredClone(input),r=resolveNightDeterministically(input);
    assert.ok(result(r,'intel').reason.includes(expected),result(r,'intel').reason);
    assert.equal(r.observability.generated_effect_count,1);assert.equal(r.observability.ai_fallback_call_count,0);
    assert.equal(r.action_results.length,2);assert.deepEqual(input,before);
  });
}

test('Watch no longer reports a Duel destination replaced during KILLS',()=>{
  const input=fixture();input.roles=[];input.actions=[action('duel','Duel / Fight','attacker','retaliator',{parameters:{winnerId:'retaliator'}}),action('intel','Watch','observer','retaliator')];
  const r=resolveNightDeterministically(input);
  assert.deepEqual(result(r,'duel').final_target_ids,['attacker']);
  assert.equal(result(r,'intel').reason,'Watch result: No visitors.');
});

test('Track follows the final Duel destination selected during KILLS',()=>{
  const input=fixture();input.roles=[];input.actions=[action('duel','Duel / Fight','attacker','retaliator',{parameters:{winnerId:'retaliator'}}),action('intel','Track','observer','attacker')];
  assert.equal(result(resolveNightDeterministically(input),'intel').reason,'Track result: attacker.');
});

test('GM cancellation removes retaliation and updates dependent Intel without spending a second use',()=>{
  const input=fixture();input.actions.push(action('intel','Watch','observer','attacker',{playerAbilityGrantId:'synthetic-grant'}));
  const first=resolveNightDeterministically(input);assert.equal(result(first,'intel').reason,'Watch result: retaliator.');
  const corrected=recalculateNight(first,input,{earliestStage:'KILLS',actionId:'attack',actionPatch:{forceResult:'CANCELLED',forceReason:'GM cancelled attack'}});
  assert.equal(result(corrected,'intel').reason,'Watch result: No visitors.');assert.equal(corrected.observability.generated_effect_count,0);
  assert.equal(corrected.events.filter(e=>e.action_id==='intel'&&e.event_type==='SUCCESS').length,1);
  assert.equal(result(corrected,'intel').use_disposition,'CONSUMED');assert.deepEqual(corrected.deaths,[]);
});

test('finalized Intel and its existing event survive the editor/approval payload without duplicate attempts',()=>{
  const input=fixture();input.actions.push(action('intel','Watch','observer','attacker'));
  const r=resolveNightDeterministically(input),reason='Watch result: retaliator.';
  assert.equal(result(r,'intel').reason,reason);assert.equal(r.morning_summary.intel[0].reason,reason);
  const events=r.events.filter(e=>e.action_id==='intel'&&e.event_type==='SUCCESS');
  assert.equal(events.length,1);assert.equal(events[0].summary,reason);
  const payload=finalResolutionPayload(buildResolutionDraft({proposal:r,actions:input.actions,players:input.players}));
  assert.equal(result(payload,'intel').reason,reason);assert.equal(payload.action_results.length,2);
});

test('final visit calculation does not recompute faction Intel after conversion',()=>{
  const input=fixture();input.roles=[];input.actions=[action('intel','Basic Ask','observer','retaliator'),action('convert','Convert','helper','retaliator',{parameters:{targetFactionId:'den'}})];
  const r=resolveNightDeterministically(input);
  assert.equal(result(r,'intel').reason,'Basic Ask result: Town.');
  assert.equal(r.player_outcomes.find(p=>p.player_id==='retaliator').faction_id,'den');
});

test('a blocked observer receives no late Intel even when retaliation occurs',()=>{
  const input=fixture();input.actions.push(action('intel','Watch','observer','attacker'),action('block','Roleblock','helper','observer'));
  const r=resolveNightDeterministically(input);
  assert.equal(result(r,'intel').result,'BLOCKED');assert.doesNotMatch(result(r,'intel').reason,/retaliator/);
});

test('a defender who survives protection still retaliates and remains visible to cycle Intel',()=>{
  const input=fixture();input.actions.push(action('protect','Protect','helper','retaliator'),action('intel','Watch','observer','attacker'));
  const r=resolveNightDeterministically(input);
  assert.equal(r.player_outcomes.find(p=>p.player_id==='retaliator').alive_after_resolution,true);
  assert.equal(result(r,'intel').reason,'Watch result: retaliator.');
});

test('Watch deduplicates the same retaliator across generated effects',()=>{
  const input=fixture();input.actions.push(action('attack2','Personal Instant Kill','attacker','retaliator'),action('intel','Watch','observer','attacker'));
  const r=resolveNightDeterministically(input);
  assert.equal(r.observability.generated_effect_count,2);assert.equal(result(r,'intel').reason,'Watch result: retaliator.');
  assert.equal(r.events.filter(e=>e.action_id==='intel'&&e.event_type==='SUCCESS').length,1);
});

test('random Duel winner is reused while late Intel recalculates',()=>{
  const input=fixture();input.roles=[];input.actions=[action('duel','Duel / Fight','attacker','retaliator',{parameters:{randomWinner:true}}),action('intel','Track','observer','attacker')];
  const first=resolveNightDeterministically(input),again=recalculateNight(first,input,{earliestStage:'KILLS'});
  assert.deepEqual(again.random_outcomes,first.random_outcomes);
  for(const r of [first,again])assert.equal(result(r,'intel').reason,'Track result: '+result(r,'duel').effective_target_names.join(', ')+'.');
});

test('reflected Watch finalizes its effective observation target, not its original target',()=>{
  const input=fixture();input.roles.push({id:'helper-role',name:'Mirror',passives:['Reflection']});
  input.actions[0].sourcePlayerId='observer';input.actions.push(action('intel','Watch','observer','helper'));
  const r=resolveNightDeterministically(input);
  assert.deepEqual(result(r,'intel').final_target_ids,['observer']);
  assert.equal(result(r,'intel').reason,'Reflected away from helper. Watch result: retaliator.');
});

test('actual Resolve Night handler persists final cycle Intel with zero AI calls',async()=>{
  const input=fixture();input.actions.push(action('intel','Watch','observer','attacker'));
  const snapshot={...input,abilities:[],statuses:[],grants:[],modes:[],rules:[],precedents:[]},
    session={id:'local-session',lock_version:4,cycle:1,phase:'Night',status:'DRAFT',pre_resolution_state:snapshot,submitted_actions:input.actions};
  const before=structuredClone(session),saved=[],alerts=[],views=[];
  const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),start=source.indexOf('function nightEngineInput('),end=source.indexOf('\nasync function recalculateSelectedNight(',start);
  const context={currentResolutionSession:()=>session,currentGame:()=>({id:input.gameId}),resolutionPending:false,
    resolveNightDeterministically,renderAll:()=>{},refreshAiGmData:async()=>{},showView:v=>views.push(v),alert:m=>alerts.push(m),
    selectedResolutionSessionId:null,loadedResolutionFormId:'old',GMCloud:{saveDeterministicResolution:async(...args)=>saved.push(args),
    adjudicateInteraction:()=>{assert.fail('Known cycle must not call AI')}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.resolve=resolveSelectedNight;',context);
  await context.resolve();assert.deepEqual(alerts,[]);assert.equal(saved.length,1);assert.deepEqual(saved[0].slice(0,2),['local-session',4]);
  const proposal=saved[0][2];assert.equal(result(proposal,'intel').reason,'Watch result: retaliator.');
  assert.equal(proposal.starting_snapshot,undefined);assert.equal(proposal.observability.ai_fallback_call_count,0);
  assert.equal(context.resolutionPending,false);assert.deepEqual(views,['resolutionsView']);assert.deepEqual(session,before);
});
