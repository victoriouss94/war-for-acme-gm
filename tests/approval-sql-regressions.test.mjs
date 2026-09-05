import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('approval migration qualifies JSON consumed-action extraction and retains safeguards',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20260905185154_fix_approval_consumption_ambiguity.sql',import.meta.url),'utf8');
  assert.match(sql,/array_agg\(item\.value->>'action_id'\)/);
  assert.doesNotMatch(sql,/cross join lateral \(select item->>'action_id' value\)/);
  assert.match(sql,/public\.can_edit_game/);
  assert.match(sql,/approval_idempotency_key=target_idempotency_key/);
  assert.match(sql,/PT422/);
});

test('approval summary migration parenthesizes both JSON text expressions',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20260905185225_fix_approval_summary_operator_precedence.sql',import.meta.url),'utf8');
  assert.ok(sql.includes("$new$(item->>'ability_name')||': '||(item->>'result')$new$"));
});
