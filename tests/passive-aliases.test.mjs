import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';

function fixture(name,{linked=false,mode=false}={}){
  const owner={id:'defender-role',name:'Defender role',version:3};
  if(mode)owner.modes=[{id:'shield',name:'Shield',passiveAbilityIds:['owned-passive']}];
  else if(linked)owner.roleWidePassiveAbilityIds=['owned-passive'];
  else owner.passives=[name];
  return {gameId:'passive-alias-audit',resolutionId:'alias-session',round:1,phase:'Night',
    players:[{id:'attacker',name:'Attacker',alive:true},{id:'defender',name:'Defender',alive:true,roleId:owner.id,...(mode?{currentModeId:'shield'}:{})}],
    roles:[owner],abilities:[{id:'owned-passive',name,activePassive:'PASSIVE'}],
    actions:[{id:'attack',name:'Personal Instant Kill',sourcePlayerId:'attacker',targetIds:['defender']}]
  };
}
const alive=(result,id)=>result.player_outcomes.find(p=>p.player_id===id).alive_after_resolution;

for(const name of ['reflect','mirror'])test(`exact encyclopedia alias ${name} reflects without an active submission`,()=>{
  const input=fixture(name,{linked:true}),original=structuredClone(input),result=resolveNightDeterministically(input);
  assert.equal(alive(result,'defender'),true);assert.equal(alive(result,'attacker'),false);
  assert.equal(result.action_results.length,1);assert.equal(result.passive_results.length,1);
  assert.equal(result.passive_results[0].ability_id,'owned-passive');assert.equal(result.passive_results[0].ability_name,name);
  assert.deepEqual(input,original);assert.equal(result.observability.ai_fallback_call_count,0);
});
for(const name of ['death immune','passive immunity'])test(`exact encyclopedia alias ${name} retains immunity`,()=>{
  const result=resolveNightDeterministically(fixture(name,{mode:true}));
  assert.equal(alive(result,'defender'),true);assert.equal(result.passive_results[0].ability_id,'owned-passive');
});
for(const name of ['counter attack','retaliate'])test(`exact encyclopedia alias ${name} generates one retaliation`,()=>{
  const input=fixture(name),result=resolveNightDeterministically(input);
  assert.equal(alive(result,'attacker'),false);assert.equal(alive(result,'defender'),false);
  assert.equal(result.action_results.length,1);assert.equal(result.observability.generated_effect_count,1);
  assert.equal(result.passive_results[0].ability_id,'owned-passive');
  const corrected=recalculateNight(result,input,{actionCorrections:[{actionId:'attack',actionPatch:{forceResult:'CANCELLED'}}]});
  assert.equal(corrected.passive_results.length,0);assert.equal(corrected.observability.generated_effect_count,0);
  assert.ok(corrected.player_outcomes.every(p=>p.alive_after_resolution));
});
test('alias normalization does not infer a passive from partial or negative prose',()=>{
  for(const name of ['No Reflection','conditional death immune after a vote','retaliate only if a special condition holds']){
    const result=resolveNightDeterministically(fixture(name,{linked:true}));
    assert.equal(result.passive_results.length,0);assert.equal(alive(result,'defender'),false);assert.equal(alive(result,'attacker'),true);
  }
});
