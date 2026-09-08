import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {complexNightFixture} from './helpers/complex-night-fixture.mjs';
import {buildResolutionDraft} from '../js/resolution-editor.js';
import {buildTrackerResolutionReview} from '../js/resolution-review.js';
const get=(r,id)=>r.action_results.find(a=>a.action_id===id);
test('complex result through editor and tracker preserves all deaths and cleared conversion role',()=>{
  const input=complexNightFixture(),proposal=resolveNightDeterministically(input),draft=buildResolutionDraft({proposal,actions:input.actions,players:input.players});
  const review=buildTrackerResolutionReview({draft,roster:input.players,snapshotPlayers:input.players,roles:input.roles,factions:input.factions,submittedActions:input.actions});
  assert.equal(review.players.filter(p=>!p.proposedAlive).length,8);
  const converted=review.players.find(p=>p.id==='p20');assert.equal(converted.proposedFactionId,'den');assert.equal(converted.proposedRoleId,'');
  assert.equal(converted.proposedRoleName,'No role');
  assert.ok(!review.summary.survived.some(p=>p.id==='p38'),'a blocked kill is not an actual lethal attempt');
});
test('independently specified 40-player night has exact deaths and conversions',()=>{
  const input=complexNightFixture(),before=structuredClone(input),r=resolveNightDeterministically(input);
  assert.equal(r.resolution_status,'RESOLVED',r.why);assert.equal(r.observability.ai_fallback_call_count,0);
  const deaths=r.player_outcomes.filter(p=>!p.alive_after_resolution).map(p=>p.player_id).sort();
  // The encyclopedia specifies that Super Protect stops Omega on the target,
  // but its unprotected visitors (Super Protect and Super Kill actors) die.
  assert.deepEqual(deaths,['p8','p12','p15','p17','p20','p26','p39','p40'].sort());
  const converted=r.player_outcomes.find(p=>p.player_id==='p20');assert.equal(converted.faction_id,'den');assert.equal(converted.role_id,'');
  assert.deepEqual(input,before);
});
test('complex night preserves transformed targets, prevented kills, and causal action counts',()=>{
  const input=complexNightFixture(),r=resolveNightDeterministically(input);
  assert.equal(r.action_results.length,input.actions.length);assert.equal(new Set(r.action_results.map(a=>a.action_id)).size,input.actions.length);
  assert.deepEqual(get(r,'ask').final_target_ids,['p8']);assert.deepEqual(get(r,'swapped-kill').final_target_ids,['p8']);
  assert.deepEqual(get(r,'guarded-kill').transformation_history.map(t=>t.type),['REDIRECT','GUARD']);assert.deepEqual(get(r,'guarded-kill').final_target_ids,['p12']);
  assert.deepEqual(get(r,'reflected-mark').final_target_ids,['p13']);
  for(const id of ['protected-pik','super-kill','immune-kill','mode-kill','generated-protected-kill'])assert.equal(get(r,id).result,'FAILURE',id);
  assert.equal(get(r,'blocked-grant-kill').result,'BLOCKED');assert.notEqual(get(r,'blocked-grant-kill').use_disposition,'CONSUMED');
  assert.equal(get(r,'amplified-kill').standardized_ability_type,'Super Kill');assert.equal(get(r,'save').result,'SUCCESS');assert.equal(get(r,'heal').result,'SUCCESS');
});
test('complex night status and grant consequences stay player-specific',()=>{
  const input=complexNightFixture(),r=resolveNightDeterministically(input);
  assert.ok(r.status_effects.some(s=>(s.player_id??s.target_player_id)==='p13'&&(s.status_type??s.status_name)==='MARK'));
  assert.ok(!r.status_effects.some(s=>(s.player_id??s.target_player_id)==='p18'&&s.operation!=='REMOVE'));
  const stolen=r.grant_effects.find(g=>g.operation==='SET_USES');assert.equal(stolen.uses,2);
  assert.ok(r.grant_effects.some(g=>g.operation==='GRANT'&&g.player_id==='p31'&&g.uses===1));
  assert.ok(r.grant_effects.some(g=>g.operation==='GRANT'&&g.player_id==='p32'&&g.uses===2));
  assert.equal(input.grants[0].uses_remaining,3);
});
test('complex night reload and GM correction retain random outcomes and remove dependent counterattack',()=>{
  const input=complexNightFixture(),first=resolveNightDeterministically(input),saved=JSON.parse(JSON.stringify(first));
  const replay=resolveNightDeterministically({...input,randomOutcomes:saved.random_outcomes});
  assert.deepEqual(replay.player_outcomes,first.player_outcomes);assert.deepEqual(replay.random_outcomes,first.random_outcomes);
  const corrected=recalculateNight(saved,input,{earliestStage:'KILLS',actionId:'counter-kill',actionPatch:{forceResult:'FAILURE',forceReason:'Isolated audit correction: this attack is prevented.'}});
  assert.equal(corrected.player_outcomes.find(p=>p.player_id==='p26').alive_after_resolution,true);
  assert.ok(!corrected.passive_results.some(p=>p.ability_name==='Counterattack'&&p.triggered));
  assert.deepEqual(corrected.random_outcomes,first.random_outcomes);
});
