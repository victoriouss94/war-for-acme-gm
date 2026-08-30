import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../supabase/migrations/20260829200000_deterministic_night_resolution_engine.sql',import.meta.url),'utf8');
const cloud=await readFile(new URL('../js/cloud.js',import.meta.url),'utf8');
const app=await readFile(new URL('../js/app.js',import.meta.url),'utf8');
const edge=await readFile(new URL('../supabase/functions/gm-copilot/index.ts',import.meta.url),'utf8');

test('migration adds deterministic simulation persistence without replacing legacy approval',()=>{
  for(const column of ['engine_proposal','engine_trace','random_outcomes','ai_adjudications','engine_status','simulation_version'])assert.match(migration,new RegExp(`add column if not exists ${column}`));
  assert.match(migration,/save_deterministic_resolution/);
  assert.doesNotMatch(migration,/drop table|truncate table/i);
  assert.match(app,/finalizeResolutionSession/);
  assert.match(cloud,/approve_and_apply_resolution/);
});

test('complete immutable snapshot includes runtime mechanics and authority',()=>{
  for(const key of ['players','roles','factions','abilities','rules','statuses','grants','modes','temporary_mode_access','precedents'])assert.match(migration,new RegExp(`'${key}'`));
  assert.match(migration,/pre_resolution_state=complete_snapshot/);
  assert.match(migration,/octet_length\(pre_resolution_state::text\)<=1500000/);
});

test('simulation save validates authorization concurrency and action cardinality',()=>{
  assert.match(migration,/can_edit_game\(session_row\.game_id\)/);
  assert.match(migration,/session_row\.lock_version is distinct from expected_lock_version/);
  assert.match(migration,/ENGINE_ACTION_SNAPSHOT_MISMATCH/);
  assert.match(migration,/jsonb_array_length\(proposal->'action_results'\)<>jsonb_array_length\(session_row\.submitted_actions\)/);
  assert.match(migration,/simulated_at=now\(\)/);
});

test('unknown mechanics use a compact isolated structured AI fallback',()=>{
  assert.match(edge,/adjudicate_interaction/);
  assert.match(edge,/isolated_mechanic_adjudication/);
  assert.match(edge,/maxOutputTokens:2500/);
  assert.match(edge,/INTERACTION_ACTION_MISMATCH/);
  assert.match(app,/unresolved_interactions/);
  assert.match(app,/adjudicateInteraction/);
});

test('isolated fallback reserves usage and uses a strict response schema',()=>{
  const branch=edge.slice(edge.indexOf("if(task==='adjudicate_interaction'){"),edge.indexOf("const requestId=crypto.randomUUID(),runId"));
  assert.match(branch,/reserve_ai_usage_internal/);
  assert.match(branch,/complete_ai_usage_internal/);
  assert.match(branch,/target_feature:'resolve_actions'/);
  const literal=edge.match(/const interactionSchema:any=(.*);/)[1];
  const schema=Function('return ('+literal+')')();
  const walk=value=>{if(value?.type==='object'){assert.equal(value.additionalProperties,false);assert.deepEqual([...value.required].sort(),Object.keys(value.properties).sort());for(const child of Object.values(value.properties))walk(child)}if(value?.items)walk(value.items)};
  walk(schema);
});

test('snapshot expiry is null-safe and reopening preserves the captured state',()=>{
  assert.match(migration,/and not coalesce/);
  assert.match(migration,/engine_snapshot_version.*='1' then return result/);
});

test('Resolve Night is engine-first and exposes trace',()=>{
  assert.match(app,/resolveNightDeterministically/);
  assert.match(app,/View Resolution Trace/);
  assert.match(app,/saveDeterministicResolution/);
  assert.doesNotMatch(app,/if\(analyze\)await analyzeSelectedResolution\(\)/);
});
