import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveModeAwareIntel} from '../js/role-modes.js';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {modeIntelFixture} from './helpers/mode-intel-fixture.mjs';

const fixture=(appearance={})=>({gameId:'mode-intel-audit',resolutionId:'night',round:2,phase:'Night',
  players:[{id:'asker',name:'Scout',alive:true,roleId:'scout',factionId:'village'},{id:'target',name:'Masked Player',alive:true,roleId:'hidden',factionId:'den',currentModeId:'cover'},{id:'plain',name:'Ordinary Player',alive:true,roleId:'plain-role',factionId:'den'}],
  roles:[{id:'scout',name:'Scout'},{id:'hidden',name:'True Role',startingModeId:'cover',modes:[{id:'cover',name:'Cover',investigationAppearance:appearance},{id:'other',name:'Other',investigationAppearance:{basicAsk:'Unused appearance',invisible:true}}]},{id:'plain-role',name:'Ordinary Role'}],
  factions:[{id:'village',name:'Villagers'},{id:'den',name:'Den'}],abilities:[],actions:[]});
const action=(name,target='target')=>({id:'intel',name,sourcePlayerId:'asker',targetIds:[target]});
const run=(input,name)=>resolveNightDeterministically({...input,actions:[action(name)]});
const answer=result=>result.action_results.find(item=>item.action_id==='intel').reason;

for(const [name,field,label] of [['Basic Ask','basicAsk','Villager appearance'],['Advanced Ask','advancedAsk','Disguised Role'],['Alignment Ask','factionAppearance','Neutral appearance']]){
  test('canonical Intel applies current mode '+field+' without AI or mutation',()=>{
    const input=fixture({[field]:label}),before=structuredClone(input),result=run(input,name);
    assert.equal(answer(result),`${name} result: ${label}.`);assert.equal(result.resolution_status,'RESOLVED');
    assert.equal(result.observability.ai_fallback_call_count,0);assert.deepEqual(input,before);
    assert.equal(result.player_outcomes.find(p=>p.player_id==='target').faction_id,'den');
    assert.equal(result.player_outcomes.find(p=>p.player_id==='target').role_id,'hidden');
  });
}
test('canonical Intel uses generic role appearance for Advanced Ask only',()=>{
  const input=fixture({roleAppearance:'Harmless Role'});
  assert.equal(answer(run(input,'Advanced Ask')),'Advanced Ask result: Harmless Role.');
  assert.equal(answer(run(input,'Basic Ask')),'Basic Ask result: Den.');
});
test('existing helper does not leak role appearance into faction Intel',()=>{
  const input=fixture({roleAppearance:'Harmless Role'});
  assert.equal(resolveModeAwareIntel({targetPlayer:input.players[1],targetRole:input.roles[1],intelType:'basicAsk',fallbackResult:'Den'}).result,'Den');
});
test('existing helper does not leak faction appearance into role Intel',()=>{
  const input=fixture({factionAppearance:'Neutral'});
  assert.equal(resolveModeAwareIntel({targetPlayer:input.players[1],targetRole:input.roles[1],intelType:'advancedAsk',fallbackResult:'True Role'}).result,'True Role');
});
test('canonical Intel respects explicit invisible investigation appearance',()=>{
  for(const name of ['Basic Ask','Advanced Ask','Alignment Ask'])assert.equal(answer(run(fixture({invisible:true}),name)),`${name} result: No result.`);
});
test('canonical Intel reads snake-case imported appearance fields',()=>{
  const input=fixture();delete input.roles[1].modes[0].investigationAppearance;
  input.roles[1].modes[0].investigation_appearance={basic_ask:'Disguised alignment'};
  assert.equal(answer(run(input,'Basic Ask')),'Basic Ask result: Disguised alignment.');
});
test('inactive temporary mode access does not replace current investigation appearance',()=>{
  const input=fixture({basicAsk:'Current appearance'});input.temporaryModeAccess=[{playerId:'target',roleId:'hidden',modeId:'other'}];
  assert.equal(answer(run(input,'Basic Ask')),'Basic Ask result: Current appearance.');
});
test('stale runtime mode ownership does not leak a prior role appearance',()=>{
  const input=fixture({basicAsk:'Current role appearance'});
  input.modes=[{player_id:'target',role_id:'old-role',current_mode_id:'other'}];
  // Existing normalization uses the current player's valid mode, not stale row data.
  assert.equal(answer(run(input,'Basic Ask')),'Basic Ask result: Current role appearance.');
});
test('Place Swap destinations and GM recalculation recalculate mode-aware Intel',()=>{
  const input=fixture({basicAsk:'Covered alignment'});input.actions=[{id:'swap',name:'Place Swap',sourcePlayerId:'plain',targetIds:['target','plain']},action('Basic Ask','plain')];
  const result=resolveNightDeterministically(input);assert.equal(answer(result),'Basic Ask result: Covered alignment.');
  const corrected=recalculateNight(result,input,{actionCorrections:[{actionId:'swap',actionPatch:{forceResult:'CANCELLED',forceReason:'GM cancelled swap'}}]});
  assert.equal(answer(corrected),'Basic Ask result: Den.');
});
test('ordinary faction/role Intel and Gravedigger keep their previous defaults',()=>{
  assert.equal(answer(run(fixture(),'Basic Ask')),'Basic Ask result: Den.');
  assert.equal(answer(run(fixture(),'Advanced Ask')),'Advanced Ask result: True Role.');
  assert.equal(answer(run(fixture(),'Alignment Ask')),'Alignment Ask result: Den.');
  const input=fixture({invisible:true,roleAppearance:'Disguise'});input.players[1].alive=false;
  assert.equal(answer(run(input,'Gravedigger')),'Gravedigger result: True Role.');
});
test('blocked investigation does not disclose any mode appearance',()=>{
  const input=fixture({basicAsk:'Secret appearance'});input.actions=[{id:'block',name:'Roleblock',sourcePlayerId:'plain',targetIds:['asker']},action('Basic Ask')];
  const result=resolveNightDeterministically(input),intel=result.action_results.find(item=>item.action_id==='intel');
  assert.equal(intel.result,'BLOCKED');assert.ok(!intel.reason.includes('Secret appearance'));
});
test('cloud workflow fixtures preserve exact mode Intel through editor normalization',()=>{
  for(const invisible of [false,true]){
    const {ruling,proposal,expected}=modeIntelFixture({invisible});
    assert.equal(proposal.resolution_status,'RESOLVED');assert.equal(proposal.observability.ai_fallback_call_count,0);
    for(const item of expected)assert.equal(ruling.action_results.find(action=>action.action_id===item.actionId).reason,item.reason);
    assert.ok(proposal.player_outcomes.every(player=>player.alive_after_resolution));
  }
});
