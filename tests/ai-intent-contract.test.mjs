import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {inferMasterIntent} from '../supabase/functions/_shared/master-gm.js';

const root=new URL('../',import.meta.url);
const source=await readFile(new URL('supabase/functions/gm-copilot/index.ts',root),'utf8');
const migrationName=(await readdir(new URL('supabase/migrations/',root))).find(name=>name.endsWith('_align_ai_usage_with_master_gm_intents.sql'));
assert.ok(migrationName,'The intent-contract migration must exist');
const migration=await readFile(new URL('supabase/migrations/'+migrationName,root),'utf8');
const unquoted=migration.replaceAll("''","'");
const labels=value=>[...value.matchAll(/'([a-z_]+)'/g)].map(match=>match[1]);
const predicates=[...unquoted.matchAll(/target_feature not in \(([^)]+)\)/g)];
const rpcLabels=new Set(labels(predicates.at(-1)[1]));
const tableLabels=new Set(labels(migration.match(/check \(feature in \(([^)]+)\)\)/)[1]));
const tasks=labels(source.match(/const allowedTasks=new Set\(\[([^\]]+)\]\)/)[1]);
const schemaIntents=labels(source.match(/intent:\{type:'string',enum:\[([^\]]+)\]/)[1]);

test('reservation contract accepts every currently reachable Master GM intent',()=>{
  const resolvedTasks=tasks.map(task=>task==='adjudicate_interaction'?'resolve_actions':inferMasterIntent('',task));
  for(const intent of new Set([...resolvedTasks,...schemaIntents])){
    assert.ok(rpcLabels.has(intent),'Reservation rejects current intent: '+intent);
    assert.ok(tableLabels.has(intent),'Usage table rejects current intent: '+intent);
  }
});
test('reservation labels retain legacy aliases without enabling deleted game generation',()=>{
  for(const feature of ['explain_role','balance_role','knowledge_ingest'])assert.ok(rpcLabels.has(feature));
  for(const feature of ['create_game','auto']){assert.ok(tableLabels.has(feature),'Historical row must remain valid');assert.ok(!rpcLabels.has(feature),'Retired/unresolved intent must not become a callable feature');}
  assert.equal(rpcLabels.size,23);
  assert.match(migration,/target_feature is null/);assert.match(migration,/target_model is null/);
});
test('intent migration only adjusts validation and the existing feature constraint',()=>{
  assert.match(migration,/Unexpected AI usage validation predicate/);
  assert.doesNotMatch(migration,/\b(?:grant|revoke|delete|truncate|update)\s+(?:all|public|table|on|from)/i);
  for(const feature of rpcLabels)assert.ok(tableLabels.has(feature));
});
