import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {globalAbilityDefinition} from '../js/global-abilities.js';

const fixture=()=>({gameId:'gift-test',round:1,phase:'Night',players:[{id:'kat',name:'Kat',alive:true},{id:'anne',name:'Anne',alive:true},{id:'blocker',name:'Blocker',alive:true}],actions:[{id:'gift',name:'Gift',sourcePlayerId:'kat',targetIds:['anne'],playerAbilityGrantId:'gift-use'}]});
const row=result=>result.action_results.find(a=>a.action_id==='gift');
test('Gift resolves under CONTROL without generating an inventory or ability effect',()=>{
 const input=fixture(),before=structuredClone(input),result=resolveNightDeterministically(input);
 assert.equal(globalAbilityDefinition('Gift').resolutionCategory,'CONTROL');
 assert.equal(row(result).result,'SUCCESS');assert.match(row(result).reason,/GMs handle delivery/);
 assert.equal(result.resolution_status,'RESOLVED');assert.equal(result.unresolved_interactions.length,0);
 assert.deepEqual(result.status_effects,[]);assert.deepEqual(result.grant_effects,[]);assert.equal(result.observability.generated_effect_count,0);assert.deepEqual(result.deaths,[]);assert.deepEqual(input,before);
});
test('a blocked Gift reports prevention and does not spend its use',()=>{
 const input=fixture();input.actions.unshift({id:'block',name:'Roleblock',sourcePlayerId:'blocker',targetIds:['kat']});
 const result=resolveNightDeterministically(input);assert.equal(row(result).result,'BLOCKED');assert.equal(row(result).use_disposition,'NOT_CONSUMED');assert.match(row(result).reason,/block/i);
});
test('Gift rejects a dead recipient',()=>{const input=fixture();input.players[1].alive=false;assert.notEqual(row(resolveNightDeterministically(input)).result,'SUCCESS');});
test('GM can reclassify the saved custom Cade action as Gift without inventing a gift payload',()=>{
 const input=fixture();input.actions[0].name='Cade – Inventor — Ability';input.actions[0].abilityId='cade';input.abilities=[{id:'cade',name:'Cade – Inventor — Ability',engineBehavior:{effect:'CUSTOM',requiresExplicitRule:true,tags:['ACTIVE_ACTION','BLOCKABLE']}}];
 const previous=resolveNightDeterministically(input);assert.equal(previous.resolution_status,'GM_REVIEW_REQUIRED');
 const result=recalculateNight(previous,input,{actionId:'gift',actionPatch:{standardizedAbilityType:'Gift',resolutionCategory:'CONTROL'}});
 assert.equal(row(result).result,'SUCCESS');assert.equal(result.unresolved_interactions.length,0);assert.equal(result.resolution_status,'RESOLVED');
});
