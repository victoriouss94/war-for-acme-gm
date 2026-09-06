import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const legacy = await readFile(new URL('../supabase/migrations/20260906013303_close_legacy_game_rooms_anonymous_access.sql', import.meta.url), 'utf8');
const maintenance = await readFile(new URL('../supabase/migrations/20260906013822_restrict_client_table_maintenance_privileges.sql', import.meta.url), 'utf8');

test('legacy room hardening revokes client access and preserves stored records', () => {
  assert.match(legacy, /if to_regclass\('public\.game_rooms'\) is not null then/);
  assert.match(legacy, /revoke all privileges on table public\.game_rooms from public, anon, authenticated/);
  for (const operation of ['create', 'read', 'update']) {
    assert.ok(legacy.includes(`drop policy if exists "Allow GMs to ${operation} game rooms" on public.game_rooms`));
  }
  assert.doesNotMatch(legacy, /\b(delete from|truncate table|drop table|disable row level security)\b/i);
  assert.doesNotMatch(legacy, /\bfrom\s+service_role\b/i);
});

test('browser maintenance hardening leaves normal data operations and server permissions intact', () => {
  assert.match(maintenance, /revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated/);
  assert.match(maintenance, /alter default privileges for role postgres in schema public\s+revoke truncate, references, trigger on tables from public, anon, authenticated/);
  assert.doesNotMatch(maintenance, /revoke\s+(?:all|select|insert|update|delete)\b/i);
  assert.doesNotMatch(maintenance, /\b(delete from|truncate table|drop table|disable row level security)\b/i);
  assert.doesNotMatch(maintenance, /\bfrom\s+service_role\b/i);
});
