import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const sql=await readFile(new URL('../supabase/migrations/20260906020625_preserve_future_status_timers.sql',import.meta.url),'utf8');
test('scheduled status countdowns use the same start boundary in preview and advance',()=>{
  assert.match(sql,/private\.phase_advance_preview\(uuid,uuid,integer\)/);
  assert.match(sql,/public\.advance_game_phase\(uuid,integer,uuid,integer,boolean,text\)/);
  assert.match(sql,/applied_at_cycle,target_cycle\)<=target_cycle/);
  assert.match(sql,/applied_at_phase='Night' and target_phase='Day'/);
  assert.match(sql,/remaining_duration=1 and private\.status_timer_has_started/);
  assert.match(sql,/remaining_duration>1 and private\.status_timer_has_started/);
  assert.match(sql,/revoke all on function private\.status_timer_has_started.*from public,anon,authenticated/);
  assert.doesNotMatch(sql,/\b(delete from|truncate table|drop table|disable row level security)\b/i);
});
