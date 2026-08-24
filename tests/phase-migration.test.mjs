import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const sql=await readFile('supabase/migrations/20260824130000_integrated_phase_action_queue.sql','utf8');

test('phase migration enforces one current phase and phase-scoped concurrency',()=>{
  for(const pattern of [/create table public\.game_phases/,/game_phases_one_current_per_game_idx/,/unique\(game_id,cycle,phase\)/,/queue_version integer not null/,/PHASE_VERSION_CONFLICT/,/PHASE_CHANGED/,/for update/])assert.match(sql,pattern);
});

test('phase tables are explicitly exposed read-only with RLS and Realtime',()=>{
  for(const pattern of [/alter table public\.game_phases enable row level security/,/game_phases_gm_read/,/revoke all on table public\.game_phases/,/grant select on table public\.game_phases/,/supabase_realtime add table public\.game_phases/,/supabase_realtime add table public\.game_phase_events/])assert.match(sql,pattern);
});

test('advance is previewed, approved, audited, and applies deterministic consequences',()=>{
  for(const pattern of [/preview_game_phase_advance/,/advance_game_phase/,/resolved_count/,/unresolved_action_ids/,/UNRESOLVED_ACTIONS_REQUIRE_APPROVAL/,/player_status_effects effect set state='EXPIRED'/,/player_ability_grants grant_target set status='EXPIRED'/,/STATUS_TIMER_UPDATED/,/TEMPORARY_ABILITY_EXPIRED/,/ABILITY_USES_REFRESHED/,/COOLDOWN_UPDATED/,/PENDING_EFFECTS_REVIEWED/,/PHASE_ADVANCED/,/PHASE_OPENED/,/public\.save_game_document/])assert.match(sql,pattern);
});

test('old phases reject normal queue writes and owner correction requires an audit reason',()=>{
  for(const pattern of [/current_row\.id<>requested_phase_id/,/status='CURRENT'/,/admin_correct_phase_action/,/public\.is_game_owner/,/CORRECTION_REASON_REQUIRED/,/ADMIN_CORRECTION/])assert.match(sql,pattern);
});

test('resolution sessions and final results remain bound to one phase identifier',()=>{
  for(const pattern of [/resolution_sessions add column phase_id/,/source_phase_version/,/RESOLUTION_SESSION_OPENED/,/RESOLUTION_FINALIZED/,/resolution_summary/])assert.match(sql,pattern);
});
