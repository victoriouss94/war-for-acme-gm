import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {globalAbilityDefinition} from '../js/global-abilities.js';

function fixture(name,patch={}){
  return {gameId:'synthetic-field-contract',round:1,phase:'Night',
    players:[{id:'actor',name:'Actor',alive:true,factionId:'den'},{id:'target',name:'Target',alive:true,factionId:'town',roleId:'target-role'},{id:'helper',name:'Helper',alive:true,factionId:'town'}],
    roles:[{id:'target-role',name:'Target Role'}],factions:[{id:'den',name:'Den'},{id:'town',name:'Villagers'}],
    abilities:[{id:'custom',name,engineBehavior:{...globalAbilityDefinition(name).behavior,...patch}}],
    actions:[{id:'attempt',abilityId:'custom',sourcePlayerId:'actor',targetIds:['target'],playerAbilityGrantId:'grant'}]};
}
const row=result=>result.action_results.find(item=>item.action_id==='attempt');
const conflicts=[
  ['Roleblock','scope','FACTION'],['Den Block','factionKind','VILLAGER'],
  ['Guard','transformation','REDIRECT'],['Poison','statusType','DRUNK'],
  ['Basic Ask','intelType','EXACT_ROLE'],['Protect','protectionTier',2],
  ['Super Protect','stopsKillTier',1],['Convert','dropsOldRole',false],
  ['Poison','duration',1],['Drunk','activates','IMMEDIATE'],
  ['Sober','expires','NEVER'],['Omega Kill','visitorCollateral',false],
  ['Super Kill','bypassesProtectionTier',2],['Poison','healRemoves',false],
  ['Mark','mayGenerate','omega_kill']
];
for(const [name,field,value] of conflicts)test(`${name} cannot silently ignore explicit ${field}`,()=>{
  const input=fixture(name,{[field]:value}),before=structuredClone(input),result=resolveNightDeterministically(input);
  assert.equal(row(result).result,'INELIGIBLE_EFFECT');
  assert.equal(row(result).use_disposition,'NOT_CONSUMED');
  assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');
  assert.equal(result.unresolved_interactions.length,1);
  assert.match(result.unresolved_interactions[0].question,new RegExp(field));
  assert.deepEqual(result.deaths,[]);assert.deepEqual(result.status_effects,[]);
  assert.equal(result.player_outcomes.find(item=>item.player_id==='target').role_id,'target-role');
  assert.deepEqual(input,before);
});

test('field conflicts in isolated adjudication cannot reinstate the wrong status',()=>{
  const input=fixture('Poison',{effect:'CUSTOM'});input.aiAdjudications=[{action_id:'attempt',status:'ADJUDICATED',confidence:'HIGH',standardized_type:'Poison',resolution_category:'STATUS_EFFECTS',behavior:{statusType:'DRUNK',requiresExplicitRule:false}}];
  const context=resolveNightDeterministically({...input,aiAdjudications:[]}).unresolved_interactions[0];Object.assign(input.aiAdjudications[0],{interaction_id:context.interaction_id,source_context_signature:context.source_context_signature});
  const result=resolveNightDeterministically(input);
  assert.equal(row(result).result,'INELIGIBLE_EFFECT');assert.deepEqual(result.status_effects,[]);
});

test('conflicting status cannot trigger Reflection or be counted as a Watch visit',()=>{
  const input=fixture('Poison',{statusType:'DRUNK'});input.roles[0].passives=['Reflection'];
  input.actions.push({id:'watch',name:'Watch',sourcePlayerId:'helper',targetIds:['target'],reflectable:false});
  const result=resolveNightDeterministically(input);
  assert.deepEqual(row(result).transformation_history,[]);
  assert.equal(result.action_results.find(item=>item.action_id==='watch').reason,'Watch result: No visitors.');
});

test('blocked field conflict retains its use without requiring effect adjudication',()=>{
  const input=fixture('Poison',{duration:1});input.actions.unshift({id:'block',name:'Roleblock',sourcePlayerId:'helper',targetIds:['actor']});
  const result=resolveNightDeterministically(input);
  assert.equal(row(result).result,'BLOCKED');assert.equal(row(result).use_disposition,'NOT_CONSUMED');assert.equal(result.unresolved_interactions.length,0);
});

test('matching standard behavior remains executable',()=>{
  const result=resolveNightDeterministically(fixture('Poison'));
  assert.equal(row(result).result,'SUCCESS');assert.equal(result.status_effects[0].status_type,'POISON');
});

test('runtime-supported kill strength remains customizable',()=>{
  const input=fixture('Personal Instant Kill',{killTier:2});input.actions.push({id:'protect',name:'Protect',sourcePlayerId:'helper',targetIds:['target']});
  const result=resolveNightDeterministically(input);
  assert.equal(row(result).result,'SUCCESS');assert.equal(result.player_outcomes.find(item=>item.player_id==='target').alive_after_resolution,false);
});

test('GM classification explicitly replaces conflicting field dispatch',()=>{
  const input=fixture('Poison',{statusType:'DRUNK'});
  const result=recalculateNight(resolveNightDeterministically(input),input,{actionId:'attempt',actionPatch:{standardizedAbilityType:'Drunk',resolutionCategory:'STATUS_EFFECTS'}});
  assert.equal(row(result).result,'SUCCESS');assert.equal(result.status_effects[0].status_type,'DRUNK');
  assert.equal(input.abilities[0].engineBehavior.statusType,'DRUNK');assert.equal(input.abilities[0].name,'Poison');
});
