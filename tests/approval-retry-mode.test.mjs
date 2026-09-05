import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('approval retry mode effects come only from the saved approved ruling',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260905235541_use_approved_mode_effects_on_retry.sql',import.meta.url),'utf8');
  assert.match(sql,/coalesce\(result.final_resolution->'other_effects'/);
  assert.match(sql,/expected exactly one request-owned mode effect source/);
  assert.match(sql,/execute replace\(definition,needle,replacement\)/);
  assert.doesNotMatch(sql,/grant execute|drop constraint|disable trigger/i);
});
