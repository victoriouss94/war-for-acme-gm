import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {globalAbilityDefinition} from '../js/global-abilities.js';

function fixture(name='Personal Instant Kill',effect='APPLY_PROTECTION'){
  return {gameId:'synthetic-conflicting-effect',round:1,phase:'Night',
    players:[{id:'actor',name:'Actor',alive:true,factionId:'den'},{id:'target',name:'Target',alive:true,factionId:'town'},{id:'helper',name:'Helper',alive:true,factionId:'town'}],
    factions:[{id:'den',name:'Den'},{id:'town',name:'Town'}],
    abilities:[{id:'ability',name,definition:'Explicit source behavior differs from the standard mapping.',engineBehavior:{...globalAbilityDefinition(name).behavior,effect,requiresExplicitRule:false}}],
    actions:[{id:'attempt',abilityId:'ability',sourcePlayerId:'actor',targetIds:['target'],playerAbilityGrantId:'grant'}]};
}
const row=result=>result.action_results.find(item=>item.action_id==='attempt');

for(const [name,effect] of [['Personal Instant Kill','APPLY_PROTECTION'],['Protect','ATTEMPT_KILL'],['Convert','INVESTIGATE'],['Basic Ask','CHANGE_FACTION'],['Roleblock','ATTEMPT_KILL']]){
  test(`${name} cannot override a conflicting explicit ${effect} primitive`,()=>{
    const input=fixture(name,effect),before=structuredClone(input),result=resolveNightDeterministically(input);
    assert.equal(row(result).result,'INELIGIBLE_EFFECT');
    assert.equal(row(result).use_disposition,'NOT_CONSUMED');
    assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');
    assert.equal(result.unresolved_interactions.length,1);
    assert.deepEqual(result.deaths,[]);assert.deepEqual(result.status_effects,[]);
    assert.equal(result.player_outcomes.find(item=>item.player_id==='target').faction_id,'town');
    assert.deepEqual(input,before);
  });
}

test('conflicting primitive cannot trigger Reflection before review',()=>{
  const input=fixture();input.players[1].roleId='mirror';input.roles=[{id:'mirror',name:'Mirror',passives:['Reflection']}];
  const result=resolveNightDeterministically(input);
  assert.deepEqual(row(result).transformation_history,[]);assert.deepEqual(result.passive_results,[]);assert.deepEqual(result.deaths,[]);
});

test('conflicting primitive is not counted as a Watch visit',()=>{
  const input=fixture();input.actions.push({id:'watch',name:'Watch',sourcePlayerId:'helper',targetIds:['target']});
  const result=resolveNightDeterministically(input);
  assert.equal(result.action_results.find(item=>item.action_id==='watch').reason,'Watch result: No visitors.');
});

test('conflicting isolated adjudication stays review-only',()=>{
  const input=fixture();input.aiAdjudications=[{action_id:'attempt',status:'ADJUDICATED',confidence:'HIGH',standardized_type:'Personal Instant Kill',resolution_category:'KILLS',behavior:{effect:'APPLY_PROTECTION',requiresExplicitRule:false}}];
  const result=resolveNightDeterministically(input);
  assert.equal(row(result).result,'INELIGIBLE_EFFECT');assert.deepEqual(result.deaths,[]);assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');
});

test('GM reclassification replaces conflicting source dispatch without rewriting source',()=>{
  const input=fixture(),first=resolveNightDeterministically(input);
  const result=recalculateNight(first,input,{actionId:'attempt',actionPatch:{standardizedAbilityType:'Personal Instant Kill',resolutionCategory:'KILLS'}});
  assert.equal(row(result).result,'SUCCESS');assert.equal(result.unresolved_interactions.length,0);
  assert.equal(input.abilities[0].engineBehavior.effect,'APPLY_PROTECTION');
});

test('matching explicit kill primitive remains supported',()=>{
  const result=resolveNightDeterministically(fixture('Personal Instant Kill','ATTEMPT_KILL'));
  assert.equal(row(result).result,'SUCCESS');assert.equal(result.unresolved_interactions.length,0);
});
