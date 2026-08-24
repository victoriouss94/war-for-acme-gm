import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migrationPath=new URL('../supabase/migrations/20260824214102_master_gm_ruling_usage_tracking.sql',import.meta.url);

test('v11.5 approval path is permission checked, locked, idempotent, and atomic',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  for(const pattern of [/create or replace function private\.approve_and_apply_resolution/i,/public\.can_edit_game\(session_row\.game_id\)/i,/for update/i,/approval_idempotency_key/i,/RESOLUTION_VERSION_CONFLICT/i,/SOURCE_GAME_VERSION_CONFLICT/i,/private\.finalize_resolution_with_grants/i,/public\.save_game_document/i,/public\.mutate_player_status/i,/private\.grant_player_ability/i,/private\.mutate_player_ability_grant/i])assert.match(sql,pattern);
  assert.doesNotMatch(sql,/commit\s*;/i);assert.doesNotMatch(sql,/drop table/i);
});

test('v11.5 server rebuilds official events from the final GM ruling',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  for(const pattern of [/normalized_action_results/i,/canonical_events/i,/jsonb_set\(final_value,'\{events\}'/i,/delete from public\.resolution_session_events where session_id=result\.id/i,/DUPLICATE_OR_UNKNOWN_ACTION_ID/i,/GRANT_CONSUMPTION_MISMATCH/i,/RULING_WARNINGS_REQUIRE_GM_OVERRIDE/i])assert.match(sql,pattern);
  for(const pattern of [/'faction_action',upper\(coalesce\(action\.value->>'sourceType'/i,/PASSIVE_REFERENCE_NOT_FOUND/i,/STATUS_PLAYER_NOT_FOUND/i,/PLAYER_OUTCOME_REFERENCE_NOT_FOUND/i])assert.match(sql,pattern);
  assert.match(sql,/one approval\/apply\s+-- transaction/i);
});

test('v11.5 preserves historical role/source attribution and deduplicates attempts',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  for(const pattern of [/roleVersion/i,/roleNameSnapshot/i,/abilityNameSnapshot/i,/role_version integer/i,/ability_source text/i,/source_faction_id text/i,/update public\.resolution_session_events event_row set/i,/session_row\.submitted_actions/i,/distinct on \(action->>'id'\)/i,/count\(distinct attempt\.action_id\)/i])assert.match(sql,pattern);
});

test('v11.5 usage analytics are authorized, filterable, and separate attempts from official results',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  for(const pattern of [/create or replace function public\.get_resolution_usage_analytics/i,/security invoker/i,/public\.can_edit_game\(\$1\)/i,/target_filters jsonb/i,/PASSIVE_TRIGGER/i,/ABILITY_CONSUMED/i,/USE_REFUNDED/i,/faction_action_attempts/i,/source_type='FACTION'/i,/passive:'\|\|event\.id::text/i])assert.match(sql,pattern);
  assert.match(sql,/session\.status<>'REJECTED'/i);assert.match(sql,/session\.status='FINALIZED'/i);
});

test('v11.5 exposes player, role, ability, source, faction, phase, cycle, outcome, and passive filters',async()=>{
  const [html,app]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../js/app.js',import.meta.url),'utf8')]);
  for(const id of ['statsPlayerFilter','statsRoleFilter','statsRoleMode','statsAbilityFilter','statsFactionFilter','statsSourceFilter','statsPhaseFilter','statsCycleFilter','statsOutcomeFilter','statsPassiveFilter','statsSort','officialUsageHistory'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(app,/const allRows=officialUsageRows\(\)/);assert.match(app,/No GM-approved outcome yet/);
});

test('v11.5 uses least privilege for new RPCs and useful partial indexes',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/revoke all on function public\.approve_and_apply_resolution/i);assert.match(sql,/grant execute .* to authenticated/i);assert.match(sql,/where approval_idempotency_key is not null/i);assert.match(sql,/where action_id is not null/i);
});
