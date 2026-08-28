import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migrationUrl=new URL('../supabase/migrations/20260828030000_fix_universal_action_queue_ambiguity.sql',import.meta.url);

test('universal Action Queue validator uses collision-safe player and ability locals',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  assert.match(sql,/create or replace function private\.queue_player_action_document_v11_2/);
  assert.match(sql,/action_player_id text;action_ability_id text;/);
  assert.doesNotMatch(sql,/source_type text;player_id text;ability_id text;/);
  assert.match(sql,/grant_record\.player_id<>action_player_id/);
  assert.match(sql,/event\.actor_player_id=action_player_id and event\.ability_id=action_ability_id/);
  assert.match(sql,/effect\.player_id=action_player_id/);
  assert.match(sql,/security definer set search_path=''/);
  assert.match(sql,/revoke all on function private\.queue_player_action_document_v11_2[^;]+from public,anon,authenticated,service_role/);
});

test('phase-aware queue wrapper still delegates to the corrected validator',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260824130000_integrated_phase_action_queue.sql',import.meta.url),'utf8');
  assert.match(sql,/result:=private\.queue_player_action_document_v11_2\(target_game_id,expected_game_version,target_action,target_replace_action_id\)/);
  assert.match(sql,/phase_row\.game_id=target_game_id and phase_row\.status='CURRENT'/);
});
