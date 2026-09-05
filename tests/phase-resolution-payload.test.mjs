import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('phase history references the complete saved ruling without changing finalization safeguards',async()=>{
  const migration=await readFile(new URL('../supabase/migrations/20260905230622_compact_phase_resolution_audit_references.sql',import.meta.url),'utf8');
  assert.match(migration,/expected exactly two full-ruling phase copies/);
  assert.match(migration,/execute replace\(definition,needle,replacement\)/);
  assert.match(migration,/'resolutionSessionId',result.id/);
  assert.match(migration,/'finalResolutionStoredIn','resolution_sessions.final_resolution'/);
  assert.doesNotMatch(migration,/drop constraint|grant execute|disable|delete from/i);
});
