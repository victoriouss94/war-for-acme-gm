import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migrationPath=new URL('../supabase/migrations/20260824193118_universal_role_understanding.sql',import.meta.url);

test('v11.4 migration is additive and exposes protected review and usage RPCs',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/create or replace function public\.get_mechanics_review_queue/i);
  assert.match(sql,/create or replace function public\.get_ability_usage_statistics/i);
  assert.match(sql,/create or replace function public\.get_cross_game_ability_usage_statistics\(\)/i);
  assert.match(sql,/public\.can_edit_game\(target_game_id\)/i);
  assert.match(sql,/revoke all on function public\.get_mechanics_review_queue\(uuid\),public\.get_ability_usage_statistics\(uuid\) from public,anon/i);
  assert.doesNotMatch(sql,/drop table/i);
  assert.doesNotMatch(sql,/delete from public\.game_documents/i);
});

test('v11.4 queue validation distinguishes faction/global actions and soft eligibility',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/FACTION_ACTION_NOT_SOURCE_DEFINED/);
  assert.match(sql,/NO_ELIGIBLE_FACTION_PERFORMER/);
  assert.match(sql,/DEN_BLOCKED/);
  assert.match(sql,/target_type not in \('ONE_PLAYER','MULTIPLE_PLAYERS','SELF','NO_TARGET','DEAD_PLAYER','ABILITY','FACTION','GLOBAL'/);
  assert.match(sql,/selection_rule_type<>'SOFT_EFFECT_ELIGIBILITY'/);
  assert.match(sql,/effective_ability_record#>>'\{understanding,targeting,type\}'/);
  assert.match(sql,/TARGET_FACTION_RESTRICTED/);
  assert.match(sql,/TARGET_ROLE_RESTRICTED/);
  assert.match(sql,/'status','ATTEMPTED'/);
});

test('v11.4 event projection and statistics use exact action ids',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  for(const type of ['INELIGIBLE_EFFECT','CANCELLED','PASSIVE_PREVENTED','USE_REFUNDED'])assert.match(sql,new RegExp(type));
  assert.match(sql,/count\(distinct action\.action_id\).* as attempts/is);
  assert.match(sql,/event\.action_id/);
  assert.match(sql,/affected_player_ids/);
  assert.match(sql,/remaining_uses/);
  assert.match(sql,/last_attempt_phase/);
  assert.match(sql,/select queued\.value from jsonb_array_elements\(result\.submitted_actions\)/i);
});

test('v11.4 cross-game analytics preserve game identity and use least privilege',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/public\.can_edit_game\(game\.id\)/i);
  assert.match(sql,/jsonb_build_object\('game_id',game_id,'game_name',game_name\)/i);
  assert.match(sql,/security invoker/i);
  assert.match(sql,/revoke all on function public\.get_cross_game_ability_usage_statistics\(\) from public,anon/i);
  assert.match(sql,/resolution_session_events_game_ability_actor_type_idx/i);
});
