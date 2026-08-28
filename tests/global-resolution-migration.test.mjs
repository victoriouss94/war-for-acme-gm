import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GLOBAL_ABILITY_DEFINITIONS} from '../js/global-abilities.js';

const migrationPath=new URL('../supabase/migrations/20260828001801_global_master_ability_resolution_order.sql',import.meta.url);
const sql=await readFile(migrationPath,'utf8');

test('v11.6 migration installs the exact global order and all 37 seeded abilities',()=>{
  assert.match(sql,/array\['BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC'\]/);
  assert.match(sql,/count\(\*\) from global_master_ability_seed\)<>37/);
  const seedSection=sql.match(/insert into global_master_ability_seed values([\s\S]*?);\s*\n\s*update public\.standard_ability_datasets/i)?.[1]||'';
  assert.equal((seedSection.match(/^\('/gm)||[]).length,37);
  assert.deepEqual([...seedSection.matchAll(/^\('([^']+)'/gm)].map(match=>match[1]),GLOBAL_ABILITY_DEFINITIONS.map(item=>item.abilityId));
  const seedRows=seedSection.split(/\r?\n/).filter(line=>line.startsWith("('"));
  seedRows.forEach((line,index)=>{const tail=line.match(/,'([A-Z_]+)',(null|\d+),'([A-Z_]+)','(ACTIVE|PASSIVE)','\{.*\}'\),?$/);assert.ok(tail,`Resolution metadata missing from seed row ${index+1}`);const definition=GLOBAL_ABILITY_DEFINITIONS[index];assert.deepEqual([tail[1],tail[2]==='null'?null:Number(tail[2]),tail[3],tail[4]],[definition.resolutionCategory,definition.resolutionPriority,definition.resolutionTiming,definition.activePassive])});
  for(const ability of ['den_block','villagers_block','place_swap','role_swap','redirect','heal','counterattack'])assert.match(seedSection,new RegExp(`\\('${ability}'`));
});

test('v11.6 migration is additive and secures the new profile table',()=>{
  assert.doesNotMatch(sql,/\bdrop\s+(?:table|schema|database)\b/i);
  assert.doesNotMatch(sql,/\btruncate\b/i);
  assert.doesNotMatch(sql,/delete\s+from\s+public\.(?:games|players|roles|abilities|actions|resolution_sessions)\b/i);
  assert.doesNotMatch(sql,/alter\s+publication|realtime\./i);
  assert.match(sql,/alter table public\.global_resolution_profiles enable row level security/i);
  assert.match(sql,/grant select on table public\.global_resolution_profiles to authenticated/i);
  assert.match(sql,/revoke all on function private\.approve_and_apply_resolution[\s\S]*?from public,anon/i);
});

test('v11.6 migration validates typed resolution history before approval',()=>{
  for(const field of ['effective_target_ids','transformation_history','generated','parent_action_id','submitted_attempt'])assert.match(sql,new RegExp(`add column ${field}`));
  assert.match(sql,/event_row\.outcome\|\|jsonb_build_object[\s\S]*?'original_target_ids'[\s\S]*?'effective_target_ids'/);
  for(const guard of ['ABILITY_CLASSIFICATION_REQUIRED','INVALID_GLOBAL_RESOLUTION_ORDER','INVALID_GENERATED_EFFECT_LINEAGE','INVALID_TRANSFORMATION_HISTORY','ORIGINAL_TARGETS_IMMUTABLE'])assert.match(sql,new RegExp(guard));
  assert.match(sql,/globalResolutionProfile/);
});
