import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically} from '../js/night-engine.js';

function fixture(standard,field='standardAbilityId',mode=false){
  const ability={id:'owned-custom',name:'Aegis Plating',activePassive:'PASSIVE',[field]:standard};
  const role={id:'defender-role',name:'Defender Role',version:9,...(mode?{modes:[{id:'shield',name:'Shield',passiveAbilityIds:[ability.id]},{id:'open',name:'Open',passiveAbilityIds:[]}]}:{roleWidePassiveAbilityIds:[ability.id]})};
  return {gameId:'standard-id-audit',round:1,phase:'Night',players:[{id:'actor',name:'Actor',alive:true},{id:'target',name:'Target',roleId:role.id,alive:true,...(mode?{currentModeId:'shield'}:{})}],roles:[role],abilities:[{id:'unrelated',name:'Bulletproof',activePassive:'PASSIVE'},ability],actions:[{id:'attack',name:'Personal Instant Kill',sourcePlayerId:'actor',targetIds:['target']}]};
}
const alive=(r,id)=>r.player_outcomes.find(p=>p.player_id===id).alive_after_resolution;
for(const field of ['standardAbilityId','standard_ability_id'])test(`renamed linked immunity executes its exact ${field} and retains local identity`,()=>{
  const input=fixture('bulletproof',field),before=structuredClone(input),r=resolveNightDeterministically(input);
  assert.equal(alive(r,'target'),true);assert.equal(r.passive_results.length,1);
  assert.equal(r.passive_results[0].ability_id,'owned-custom');assert.equal(r.passive_results[0].ability_name,'Aegis Plating');
  assert.equal(r.passive_results[0].role_id,'defender-role');assert.equal(r.passive_results[0].role_version,9);
  assert.deepEqual(input,before);assert.equal(r.observability.ai_fallback_call_count,0);
});
test('renamed mapped Reflection reuses the existing target transformation',()=>{
  const r=resolveNightDeterministically(fixture('reflection'));
  assert.equal(alive(r,'target'),true);assert.equal(alive(r,'actor'),false);
  assert.deepEqual(r.action_results[0].final_target_ids,['actor']);assert.equal(r.passive_results[0].ability_id,'owned-custom');
});
test('renamed mapped Counterattack generates a child without another submission',()=>{
  const r=resolveNightDeterministically(fixture('counterattack'));
  assert.equal(alive(r,'actor'),false);assert.equal(alive(r,'target'),false);
  assert.equal(r.action_results.length,1);assert.equal(r.observability.generated_effect_count,1);
  assert.equal(r.passive_results[0].ability_id,'owned-custom');
});
test('mode-owned mapped immunity applies only while that mode is accessible',()=>{
  const input=fixture('death_immunity','standardAbilityId',true);
  assert.equal(alive(resolveNightDeterministically(input),'target'),true);
  input.players[1].currentModeId='open';assert.equal(alive(resolveNightDeterministically(input),'target'),false);
});
test('unknown, conditional and local IDs do not become executable standard mappings',()=>{
  for(const id of ['unknown','conditional_bulletproof','owned-custom','reflection_if_attacked']){
    const r=resolveNightDeterministically(fixture(id));assert.equal(r.passive_results.length,0);assert.equal(alive(r,'target'),false);
  }
});
