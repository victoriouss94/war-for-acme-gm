import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically as resolve} from '../js/night-engine.js';
import {globalAbilityDefinition} from '../js/global-abilities.js';
import {buildResolutionDraft,finalResolutionPayload} from '../js/resolution-editor.js';
import {normalizeMechanic} from '../js/mechanics.js';

function fixture(standard,source={}){
  return {gameId:'synthetic-passive-gates',round:1,phase:'Night',players:[{id:'actor',name:'Actor',alive:true},{id:'owner',name:'Owner',alive:true,roleId:'role'}],roles:[{id:'role',passiveAbilityId:'passive'}],abilities:[{id:'passive',name:globalAbilityDefinition(standard).name,standardAbilityId:standard,activePassive:'PASSIVE',customIdentity:false,...source}],actions:[{id:'attack',name:'Personal Instant Kill',sourcePlayerId:'actor',targetIds:['owner']}]};
}

for(const [name,standard,source] of [
  ['optional flag','death_immunity',{optional:true}],
  ['optional behavior','bulletproof',{passive_behavior:'OPTIONAL'}],
  ['automatic disabled','counterattack',{automatic:false}],
  ['parsed optional behavior','reflection',{understanding:{mechanics:[{type:'PASSIVE',passiveBehavior:'OPTIONAL'}]}}],
  ['parsed conditions','death_immunity',{understanding:{mechanics:[{type:'CONDITIONAL_IMMUNITY',conditions:['Only while a bound partner lives.']}]}}],
  ['parsed dependencies','counterattack',{mechanicalStatements:[{type:'COUNTERATTACK',dependencies:['A bound player must be alive.']}]}],
  ['parsed trigger limit','counterattack',{mechanical_statements:[{type:'PASSIVE',trigger_limit:1}]}],
  ['different parsed trigger','reflection',{understanding:{mechanics:[{type:'PASSIVE',triggers:['PLAYER_DIED']}]}}],
  ['direct conditions','death_immunity',{conditions:['Only while a bound partner lives.']}],
  ['zero trigger allowance','counterattack',{triggerLimit:0}],
  ['nested optional flag','bulletproof',{understanding:{optional:true}}],
  ['renamed passive with snake-case mechanic type','death_immunity',{name:'Conditional Shield',mechanical_statements:[{mechanic_type:'CONDITIONAL_IMMUNITY',conditions:['Only while bound.']}]}],
])test(name+' is not silently executed as an unconditional standard passive',()=>{
  const input=fixture(standard,source),before=structuredClone(input),result=resolve(input);
  assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');
  assert.ok(result.unresolved_questions.some(question=>question.includes('Owner')));
  assert.equal(result.passive_results.length,0);
  assert.equal(result.observability.generated_effect_count,0);
  assert.equal(result.observability.ai_fallback_call_count,0);
  assert.deepEqual(result.action_results[0].final_target_ids,['owner']);
  assert.deepEqual(input,before);
  assert.equal(finalResolutionPayload(buildResolutionDraft({proposal:result,actions:input.actions,players:input.players})).resolution_status,'GM_REVIEW_REQUIRED');
});

test('matching automatic standard trigger with empty constraints remains executable',()=>{
  const input=fixture('death_immunity',{understanding:{mechanics:[{type:'PASSIVE',passiveBehavior:'AUTOMATIC',automatic:true,optional:false,conditions:[],dependencies:[],triggerLimit:null,triggers:['PLAYER_ABOUT_TO_DIE']}]}});
  const result=resolve(input);assert.equal(result.resolution_status,'RESOLVED');assert.deepEqual(result.deaths,[]);assert.equal(result.passive_results.length,1);
});
test('unrelated active mechanic constraints do not disable an unconditional passive',()=>{
  const input=fixture('death_immunity',{understanding:{mechanics:[{type:'ACTIVE_ABILITY',conditions:['Only at night.']}]}});
  const result=resolve(input);assert.equal(result.resolution_status,'RESOLVED');assert.deepEqual(result.deaths,[]);
});

test('normalized default booleans do not invent an optional gate',()=>{
  for(const type of ['PASSIVE','IMMUNITY']){
    const mechanic=normalizeMechanic({type,triggers:['PLAYER_ABOUT_TO_DIE']});
    assert.equal(mechanic.automatic,false);
    const result=resolve(fixture('death_immunity',{understanding:{mechanics:[mechanic]}}));
    assert.equal(result.resolution_status,'RESOLVED');assert.deepEqual(result.deaths,[]);
  }
});

test('normalized optional mechanics retain their review gate',()=>{
  const mechanic=normalizeMechanic({type:'PASSIVE',passiveBehavior:'OPTIONAL',triggers:['PLAYER_ABOUT_TO_DIE']});
  const result=resolve(fixture('death_immunity',{understanding:{mechanics:[mechanic]}}));
  assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');assert.equal(result.passive_results.length,0);
});
