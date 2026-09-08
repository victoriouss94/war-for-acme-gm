import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizePlayerModeState,roleModeContext,canTransitionMode} from '../js/role-modes.js';
import {resolveNightDeterministically} from '../js/night-engine.js';
import {modeRoleReassignmentFixture} from './helpers/mode-role-reassignment-fixture.mjs';

const fixture=()=>{const {document,action}=modeRoleReassignmentFixture();document.data.players[0].roleId='audit-new';return {...document.data,action,role:document.data.roles[1]};};
for(const roleField of ['role_id','roleId'])test(`role reassignment ignores old ${roleField} locks, cooldowns and temporary access`,()=>{
  const f=fixture(),player={...f.players[0],modeState:{[roleField]:'audit-old',current_mode_id:'shared-mode',mode_locked:true,locked_mode_id:'shared-mode',temporary_mode_access:[{modeId:'shared-mode'}],mode_cooldowns:{'shared-mode':{untilCycle:100}},previous_mode_id:'old-calm'}};
  const state=normalizePlayerModeState(player,f.role,f.abilities),ctx=roleModeContext({player,role:f.role,abilities:f.abilities});
  assert.equal(state.currentModeId,'new-calm');assert.equal(state.modeLocked,false);assert.deepEqual(state.modeCooldowns,{});assert.equal(state.previousModeId,'');assert.deepEqual(ctx.temporaryModeIds,[]);
  assert.equal(canTransitionMode({player,role:f.role,abilities:f.abilities,toModeId:'shared-mode'}).allowed,true);
});
test('same-role runtime and legacy unscoped runtime retain their legitimate configuration',()=>{
  const f=fixture();for(const role_id of ['audit-new',undefined]){const state=normalizePlayerModeState({...f.players[0],modeState:{role_id,current_mode_id:'shared-mode',mode_locked:true,temporary_mode_access:[{modeId:'new-calm'}]}},f.role,f.abilities);assert.equal(state.currentModeId,'shared-mode');assert.equal(state.modeLocked,true);assert.equal(state.temporaryModeAccess.length,1);}
});
test('old immutable snapshot temporary access cannot activate a new role mode with the same ID',()=>{
  const f=fixture(),input={...f,phase:'Night',round:0,modes:[{player_id:'audit-actor',role_id:'audit-old',current_mode_id:'old-calm'}],temporary_mode_access:[{player_id:'audit-actor',modeId:'shared-mode'}],actions:[f.action]};
  const result=resolveNightDeterministically(input);assert.equal(result.action_results[0].result,'INELIGIBLE_EFFECT');assert.equal(result.observability.ai_fallback_call_count,0);
});
test('role-tagged stale temporary access is ignored even when no runtime row exists',()=>{
  const f=fixture(),result=resolveNightDeterministically({...f,phase:'Night',temporary_mode_access:[{player_id:'audit-actor',role_id:'audit-old',modeId:'shared-mode'}],actions:[f.action]});assert.equal(result.action_results[0].result,'INELIGIBLE_EFFECT');
});
test('new-role default mode is executable when no runtime row has been initialized',()=>{
  const f=fixture();f.role.modes[0].abilityIds=['audit-ask'];const result=resolveNightDeterministically({...f,phase:'Night',actions:[{...f.action,modeId:'new-calm'}]});assert.equal(result.action_results[0].result,'SUCCESS');
});
test('current role temporary access remains executable',()=>{
  const f=fixture(),result=resolveNightDeterministically({...f,phase:'Night',modes:[{player_id:'audit-actor',role_id:'audit-new',current_mode_id:'new-calm'}],temporary_mode_access:[{player_id:'audit-actor',role_id:'audit-new',modeId:'shared-mode'}],actions:[f.action]});assert.equal(result.action_results[0].result,'SUCCESS');
});
test('stale temporary mode defenses cannot protect a reassigned player',()=>{
  for(const runtimeRole of ['audit-old','audit-new']){
    const f=fixture();f.role.modes[1].immunities=['Death Immunity'];f.abilities.push({id:'kill',name:'Personal Instant Kill',phase:'Night'});
    const result=resolveNightDeterministically({...f,phase:'Night',modes:[{player_id:'audit-actor',role_id:runtimeRole,current_mode_id:runtimeRole==='audit-old'?'old-calm':'new-calm'}],temporary_mode_access:[{player_id:'audit-actor',modeId:'shared-mode'}],actions:[{id:'kill-action',sourcePlayerId:'audit-target',abilityId:'kill',targetIds:['audit-actor']}]});
    assert.equal(result.player_outcomes.find(p=>p.player_id==='audit-actor').alive_after_resolution,runtimeRole==='audit-new');
  }
});
test('the starting configuration defense applies without a database runtime row',()=>{
  const f=fixture();f.role.modes[0].immunities=['Death Immunity'];f.abilities.push({id:'kill',name:'Personal Instant Kill',phase:'Night'});
  const result=resolveNightDeterministically({...f,phase:'Night',actions:[{id:'kill-action',sourcePlayerId:'audit-target',abilityId:'kill',targetIds:['audit-actor']}]});assert.equal(result.player_outcomes.find(p=>p.player_id==='audit-actor').alive_after_resolution,true);
});
