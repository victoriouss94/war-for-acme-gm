import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically} from '../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../js/resolution-editor.js';
import {passiveIdentityFixture} from './helpers/passive-identity-fixture.mjs';

const action=(id,name,actor,target,extra={})=>({id,name,sourcePlayerId:actor,targetIds:[target],...extra});
function fixture(){
  return {
    gameId:'audit-game',resolutionId:'audit-session',round:0,phase:'Night',
    players:[{id:'actor',name:'Actor',roleId:'actor-role',alive:true,factionId:'town'},{id:'target',name:'Target',roleId:'target-role',alive:true,factionId:'town'},{id:'helper',name:'Helper',roleId:'helper-role',alive:true,factionId:'den'}],
    factions:[{id:'town',name:'Town'},{id:'den',name:'Den'}],
    roles:[{id:'actor-role',name:'Actor role'},{id:'target-role',name:'Target role',version:3},{id:'helper-role',name:'Helper role',version:8}],
    abilities:[],actions:[]
  };
}
function addPassive(input,name,owner=input.roles[1],field='roleWidePassiveAbilityIds'){
  input.abilities.push({id:'unrelated-passive',name:'Archive '+name,activePassive:'PASSIVE'},{id:'owned-passive',name,activePassive:'PASSIVE'});
  owner[field]=['owned-passive'];
}

test('a triggered linked passive is attributed to its owned ability, not an earlier catalog match',()=>{
  const input=fixture();addPassive(input,'Counterattack');input.actions=[action('attack','Personal Instant Kill','actor','target')];
  const before=structuredClone(input),result=resolveNightDeterministically(input);
  assert.equal(result.passive_results.length,1);assert.equal(result.passive_results[0].ability_id,'owned-passive');
  assert.equal(result.passive_results[0].role_id,'target-role');assert.equal(result.passive_results[0].role_version,3);
  assert.equal(result.action_results.length,1);assert.equal(result.observability.generated_effect_count,1);
  assert.deepEqual(input,before);
  const ruling=finalResolutionPayload(buildResolutionDraft({proposal:result,actions:input.actions,players:input.players}));
  assert.equal(ruling.passive_results[0].ability_id,'owned-passive');
});

test('mode-linked immunity retains its exact source ability',()=>{
  const input=fixture(),mode={id:'shield',name:'Shield'};input.roles[1].modes=[mode];input.players[1].currentModeId='shield';
  addPassive(input,'Death Immunity',mode,'passiveAbilityIds');input.actions=[action('attack','Super Kill','actor','target')];
  const result=resolveNightDeterministically(input);
  assert.equal(result.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,true);
  assert.equal(result.passive_results[0].ability_id,'owned-passive');
});

test('reflection records its source before a later conversion removes the role',()=>{
  const input=fixture();addPassive(input,'Reflection');
  input.actions=[action('mark','Mark','actor','target'),action('convert','Convert','helper','target',{reflectable:false})];
  const result=resolveNightDeterministically(input);
  assert.equal(result.player_outcomes.find(p=>p.player_id==='target').role_id,'');
  assert.equal(result.passive_results[0].ability_id,'owned-passive');assert.equal(result.passive_results[0].role_id,'target-role');
  assert.deepEqual(result.action_results.find(a=>a.action_id==='mark').final_target_ids,['actor']);
});

test('temporary Role Swap attributes a triggered passive to the effective role',()=>{
  const input=fixture();addPassive(input,'Death Immunity',input.roles[2]);
  input.actions=[action('swap','Role Swap','actor','target',{targetIds:['target','helper']}),action('attack','Personal Instant Kill','actor','target')];
  const result=resolveNightDeterministically(input),passive=result.passive_results[0];
  assert.equal(result.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,true);
  assert.equal(passive.ability_id,'owned-passive');assert.equal(passive.role_id,'helper-role');assert.equal(passive.role_version,8);
  assert.equal(result.player_outcomes.find(p=>p.player_id==='target').role_id,'target-role','temporary context does not rewrite the player role');
});

test('cloud approval fixtures retain exact expected passive sources and life outcomes',()=>{
  for(const swapRoles of [false,true])for(const passiveAliases of [false,true]){
    const fixture=passiveIdentityFixture({swapRoles,passiveAliases});assert.equal(fixture.proposal.engine_status,'RESOLVED');
    assert.deepEqual(fixture.ruling.passive_results.map(p=>({playerId:p.player_id,abilityId:p.ability_id,roleId:p.role_id,roleVersion:p.role_version,targetIds:p.target_ids})).sort((a,b)=>a.playerId.localeCompare(b.playerId)),fixture.expectedPassives);
    assert.deepEqual(fixture.proposal.player_outcomes.filter(p=>p.alive_after_resolution).map(p=>p.player_id),fixture.expectedAlive);
  }
});
