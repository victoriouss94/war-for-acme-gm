import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically as resolve} from '../js/night-engine.js';
import {globalAbilityDefinition} from '../js/global-abilities.js';

function fixture(name,patch={}){
  const standard=globalAbilityDefinition(name);
  return {gameId:'synthetic-passive-contract',round:1,phase:'Night',
    players:[{id:'actor',name:'Attacker',alive:true},{id:'target',name:'Defender',alive:true,roleId:'role'}],
    roles:[{id:'role',name:'Role',passiveAbilityId:'passive'}],
    abilities:[{id:'passive',name,standardAbilityId:standard.abilityId,activePassive:'PASSIVE',customIdentity:false,engineBehavior:{...standard.behavior,...patch}}],
    actions:[{id:'attack',name:'Personal Instant Kill',sourcePlayerId:'actor',targetIds:['target']}]};
}
function assertReview(input){
  const before=structuredClone(input),result=resolve(input);
  assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');
  assert.ok(result.unresolved_questions.some(question=>question.includes('Defender')));
  assert.deepEqual(result.passive_results,[]);assert.equal(result.observability.generated_effect_count,0);
  assert.deepEqual(result.action_results[0].final_target_ids,['target']);
  assert.equal(result.unresolved_interactions.length,0);assert.equal(result.observability.ai_fallback_call_count,0);
  assert.deepEqual(input,before);
}
for(const [name,patch] of [
  ['Death Immunity',{effect:'APPLY_PROTECTION'}],['Counterattack',{effect:'APPLY_STATUS'}],
  ['Counterattack',{generatedAbility:'omega_kill'}],['Death Immunity',{trigger:'PLAYER_DIED'}],
  ['Reflection',{transformation:'GUARD'}],['Bulletproof',{trigger:'PHASE_STARTED'}]
])test(`incompatible ${name} passive behavior ${Object.keys(patch)[0]} requires review`,()=>assertReview(fixture(name,patch)));

for(const name of ['Death Immunity','Counterattack','Reflection','Bulletproof'])test(`matching ${name} passive behavior remains executable`,()=>{
  const result=resolve(fixture(name));assert.equal(result.resolution_status,'RESOLVED');assert.ok(result.passive_results.length>0);
});

test('denormalized passive names cannot strip incompatible behavior metadata',()=>{
  const input=fixture('Death Immunity',{trigger:'PLAYER_DIED'});
  Object.assign(input.roles[0],{passiveAbilityName:'Death Immunity',passives:['Death Immunity'],immunities:['Death Immunity']});
  assertReview(input);
});

test('structured player immunity uses the same compatibility check',()=>{
  const input=fixture('Death Immunity',{effect:'APPLY_PROTECTION'});input.roles[0].passiveAbilityId='';
  input.players[1].immunities=[input.abilities[0]];assertReview(input);
});

test('nested snake-case behavior on a renamed linked passive cannot bypass review',()=>{
  const input=fixture('Counterattack',{generatedAbility:'omega_kill'});
  input.abilities[0].name='Retaliation Variant';input.abilities[0].understanding={engine_behavior:input.abilities[0].engineBehavior};
  delete input.abilities[0].engineBehavior;assertReview(input);
});
