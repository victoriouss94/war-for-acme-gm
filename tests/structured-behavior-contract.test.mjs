import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically as resolve} from '../js/night-engine.js';
import {globalAbilityDefinition} from '../js/global-abilities.js';

function fixture(name,patch={}){
  const behavior=globalAbilityDefinition(name)?.behavior||{effect:'APPLY_STATUS',statusType:'ABILITIES_DISABLED',captureWindow:'CURRENT_NIGHT',tags:['ACTIVE_ACTION','BLOCKABLE','REDIRECTABLE','REFLECTABLE']};
  return {gameId:'synthetic-structured-contract',round:1,phase:'Night',
    players:[{id:'actor',name:'Actor',alive:true},{id:'target',name:'Target',alive:true},{id:'helper',name:'Helper',alive:true}],
    abilities:[{id:'ability',name,engineBehavior:{...behavior,...patch}}],
    actions:[{id:'attempt',abilityId:'ability',name,sourcePlayerId:'actor',targetIds:['target'],playerAbilityGrantId:'grant'}]};
}
const row=result=>result.action_results.find(item=>item.action_id==='attempt');
const markStatus={id:'mark',player_id:'target',status_type:'MARK',state:'ACTIVE',applied_at_cycle:1,applied_at_phase:'Night'};

for(const value of [['POISON'],[],null,'POISON'])test(`Heal refuses incompatible statusTypes ${JSON.stringify(value)}`,()=>{
  const input=fixture('Heal',{statusTypes:value});input.statuses=[markStatus];
  const result=resolve(input);assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');assert.equal(row(result).use_disposition,'NOT_CONSUMED');
  assert.ok(!result.status_effects.some(item=>item.operation==='REMOVE'));
});

test('Heal accepts an equivalent reordered status set',()=>{
  const input=fixture('Heal',{statusTypes:['MARK','SOBER','DRUNK','POISON']});input.statuses=[markStatus];
  const result=resolve(input);assert.equal(row(result).result,'SUCCESS');assert.ok(result.status_effects.some(item=>item.operation==='REMOVE'));
});

for(const value of [{personal_instant_kill:'omega_kill'},{},null,[]])test(`Ability Amplify refuses incompatible upgrades ${JSON.stringify(value)}`,()=>{
  const input=fixture('Ability Amplify',{upgrades:value});
  const result=resolve(input);assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');assert.deepEqual(result.status_effects,[]);
});

test('matching structured amplification behavior remains executable',()=>{
  assert.equal(row(resolve(fixture('Ability Amplify',{upgrades:{personal_instant_kill:'super_kill'}}))).result,'SUCCESS');
});

for(const patch of [{effect:'INVESTIGATE'},{statusType:'DRUNK'},{captureWindow:'NEXT_NIGHT'}])test(`Capture does not ignore explicit ${Object.keys(patch)[0]}`,()=>{
  const input=fixture('Capture',patch),before=structuredClone(input),result=resolve(input);
  assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');assert.equal(row(result).result,'INELIGIBLE_EFFECT');
  assert.deepEqual(result.status_effects,[]);assert.deepEqual(input,before);
  assert.ok(!result.unresolved_interactions[0].question.includes('undefined'));
});

test('default Capture continues to disable later actions in the current night',()=>{
  const input=fixture('Capture');input.actions.push({id:'intel',name:'Basic Ask',sourcePlayerId:'target',targetIds:['helper']});
  const result=resolve(input);assert.equal(row(result).result,'SUCCESS');
  assert.equal(result.action_results.find(item=>item.action_id==='intel').result,'BLOCKED');
});

test('isolated Capture adjudication cannot bypass behavior compatibility',()=>{
  const input=fixture('Capture',{effect:'CUSTOM'});input.aiAdjudications=[{action_id:'attempt',status:'ADJUDICATED',confidence:'HIGH',standardized_type:'Capture',resolution_category:'STATUS_EFFECTS',behavior:{effect:'APPLY_STATUS',statusType:'DRUNK',requiresExplicitRule:false}}];
  const context=resolve({...input,aiAdjudications:[]}).unresolved_interactions[0];Object.assign(input.aiAdjudications[0],{interaction_id:context.interaction_id,source_context_signature:context.source_context_signature});
  const result=resolve(input);assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');assert.deepEqual(result.status_effects,[]);
});
