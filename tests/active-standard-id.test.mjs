import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyAbility,globalAbilityDefinition} from '../js/global-abilities.js';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';

for(const field of ['standardAbilityId','standard_ability_id'])test(`active classification retains exact ${field} after renaming`,()=>{
  const ability={id:'local-beam',name:'Ion Lance',definition:'A focused energy discharge.',[field]:'personal_instant_kill'};
  assert.equal(globalAbilityDefinition(ability)?.abilityId,'personal_instant_kill');
  const classification=classifyAbility(ability);
  assert.equal(classification.resolutionCategory,'KILLS');assert.equal(classification.standardizedAbilityType,'Personal Instant Kill');
  assert.equal(classification.requiresGmClassification,false);
});
test('explicit recognized standard identity is not replaced by another mechanic in its display name',()=>{
  assert.equal(globalAbilityDefinition({name:'Protect',standardAbilityId:'super_kill'})?.abilityId,'super_kill');
});
test('unknown, partial and local IDs do not create a standard mapping',()=>{
  for(const standardAbilityId of ['local-beam','conditional_personal_instant_kill','unknown']){
    assert.equal(globalAbilityDefinition({name:'Ion Lance',standardAbilityId}),null);
  }
  assert.equal(globalAbilityDefinition({name:'Protect'})?.abilityId,'protect');
});
function fixture(){return {gameId:'active-standard-audit',round:1,phase:'Night',players:[{id:'actor',name:'Actor',alive:true},{id:'target',name:'Target',alive:true},{id:'helper',name:'Helper',alive:true}],abilities:[{id:'beam',name:'Ion Lance',standardAbilityId:'personal_instant_kill'},{id:'shield',name:'Aegis Field',standard_ability_id:'protect'}],actions:[{id:'shot',abilityId:'beam',sourcePlayerId:'actor',targetIds:['target']}]};}
test('renamed active executes the mapped mechanic with local identity and no AI',()=>{
  const input=fixture(),before=structuredClone(input),r=resolveNightDeterministically(input);
  assert.equal(r.engine_status,'RESOLVED');assert.equal(r.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,false);
  assert.equal(r.action_results[0].ability_id,'beam');assert.equal(r.action_results[0].ability_name,'Ion Lance');
  assert.equal(r.observability.ai_fallback_call_count,0);assert.deepEqual(input,before);
});
test('mapped active protection and GM recalculation retain existing interaction behavior',()=>{
  const input=fixture();input.actions.unshift({id:'protect',abilityId:'shield',sourcePlayerId:'helper',targetIds:['target']});
  const before=resolveNightDeterministically(input);
  assert.equal(before.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,true);
  assert.equal(before.action_results.find(a=>a.action_id==='shot').result,'FAILURE');
  const after=recalculateNight(before,input,{actionCorrections:[{actionId:'protect',actionPatch:{forceResult:'CANCELLED'}}]});
  assert.equal(after.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,false);
  assert.equal(after.observability.ai_fallback_call_count,0);
});
test('explicit role category remains authoritative over the standard category default',()=>{
  const ability={name:'Ion Lance',standardAbilityId:'personal_instant_kill',resolutionCategory:'DOC'};
  assert.equal(classifyAbility(ability).resolutionCategory,'DOC');
});
