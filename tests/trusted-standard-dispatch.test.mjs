import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically} from '../js/night-engine.js';
import {globalAbilityDefinition} from '../js/global-abilities.js';

function fixture(name='Basic Ask',replacement='Advanced Ask',placement='ability'){
  const behavior={...globalAbilityDefinition(name).behavior,standard:globalAbilityDefinition(replacement)};
  const input={gameId:'synthetic-standard-boundary',round:1,phase:'Night',
    players:[{id:'actor',name:'Actor',alive:true},{id:'target',name:'Target',alive:true,roleId:'target-role',factionId:'town'},{id:'visitor',name:'Visitor',alive:true}],
    roles:[{id:'target-role',name:'Secret Role'}],factions:[{id:'town',name:'Villagers'}],
    abilities:[{id:'ability',name}],actions:[{id:'attempt',abilityId:'ability',sourcePlayerId:'actor',targetIds:['target']}]};
  if(placement==='action')input.actions[0].engineBehavior=behavior;
  else if(placement==='understanding')input.abilities[0].understanding={engine_behavior:behavior};
  else if(placement==='snake')input.abilities[0].engine_behavior=behavior;
  else input.abilities[0].engineBehavior=behavior;
  return input;
}
const row=result=>result.action_results.find(item=>item.action_id==='attempt');

for(const placement of ['ability','action','understanding','snake'])test(`untrusted nested standard cannot change Basic Ask into role intel (${placement})`,()=>{
  const input=fixture('Basic Ask','Advanced Ask',placement),before=structuredClone(input),result=resolveNightDeterministically(input);
  assert.equal(row(result).result,'SUCCESS');assert.equal(row(result).reason,'Basic Ask result: Villagers.');
  assert.equal(row(result).standardized_ability_type,'Basic Ask');assert.deepEqual(input,before);
});

test('nested standard cannot change Protect into Poison',()=>{
  const result=resolveNightDeterministically(fixture('Protect','Poison'));
  assert.deepEqual(result.status_effects,[]);
  assert.equal(result.proposed_state.protections[0].player_id,'target');
  assert.equal(row(result).result,'SUCCESS');
});

test('nested standard cannot add Omega visitor collateral to a personal kill',()=>{
  const input=fixture('Personal Instant Kill','Omega Kill');
  input.actions.push({id:'visit',name:'Basic Ask',sourcePlayerId:'visitor',targetIds:['target']});
  const result=resolveNightDeterministically(input);
  assert.equal(result.player_outcomes.find(item=>item.player_id==='target').alive_after_resolution,false);
  assert.equal(result.player_outcomes.find(item=>item.player_id==='visitor').alive_after_resolution,true);
});

test('ordinary explicit standard behavior still executes normally',()=>{
  const input=fixture('Advanced Ask','Basic Ask');delete input.abilities[0].engineBehavior.standard;
  const result=resolveNightDeterministically(input);
  assert.equal(row(result).reason,'Advanced Ask result: Secret Role.');
});
