import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {knowledgeDocumentKey,knowledgeFileMetadata,reconcileOfficialAbilities,validateKnowledgeFile} from '../js/knowledge.js';
import {normalizeCopilotResponse} from '../js/copilot.js';

const migration=await readFile('supabase/migrations/20260810120000_phase1_ai_knowledge_and_official_abilities.sql','utf8');
const completedMigration=await readFile('supabase/migrations/20260810072548_complete_courtroom_encyclopedia.sql','utf8');
const html=await readFile('index.html','utf8'),app=await readFile('js/app.js','utf8'),cloud=await readFile('js/cloud.js','utf8'),copilot=await readFile('supabase/functions/gm-copilot/index.ts','utf8'),ingest=await readFile('supabase/functions/gm-knowledge-ingest/index.ts','utf8');

test('official knowledge uploads accept only bounded DOCX, PDF, and TXT files',()=>{
  assert.deepEqual(validateKnowledgeFile({name:'rules.docx',size:100}),[]);
  assert.deepEqual(validateKnowledgeFile({name:'rules.pdf',size:100}),[]);
  assert.deepEqual(validateKnowledgeFile({name:'rules.txt',size:100}),[]);
  assert.match(validateKnowledgeFile({name:'rules.exe',size:100})[0],/DOCX, PDF, or TXT/);
  assert.match(validateKnowledgeFile({name:'empty.txt',size:0})[0],/empty/);
  assert.ok(validateKnowledgeFile({name:'large.pdf',size:11*1024*1024}).some(error=>/10 MB/.test(error)));
  assert.equal(knowledgeFileMetadata({name:'RULES.PDF',size:9}).contentType,'application/pdf');
  assert.match(knowledgeDocumentKey('Courtroom Rules!','12345678-aaaa'),/^courtroom-rules-[a-z0-9]+$/);
});

test('Courtroom seed contains exactly the requested 32 stable IDs and preserves missing definitions',()=>{
  const ids=['basic_ask','advanced_ask','alignment_ask','watch','track','action_check','gravedigger','map','den_regular_kill','personal_instant_kill','super_kill','omega_kill','poison','mark','roleblock','drunk','sober','duel_fight','convert','steal','protect','guard','save','heal','super_protect','death_immunity','reflection','counterattack','bulletproof','ability_amplify','additional_uses','action_success_guarantee'];
  for(const id of ids)assert.match(migration,new RegExp(`\\('${id}','courtroom-master-ability-encyclopedia'`));
  const seedBlock=migration.match(/insert into public\.standard_abilities[\s\S]*?on conflict\(id\) do nothing;/)?.[0]||'';
  assert.equal((seedBlock.match(/\('[-a-z_]+','courtroom-master-ability-encyclopedia'/g)||[]).length,32);
  assert.match(migration,/\('basic_ask','NEEDS_SOURCE_TEXT',null::text/);
  assert.match(migration,/\('personal_instant_kill','DEFINED'/);
  assert.match(migration,/Do not invent missing technical values|must not be invented/);
});

test('the completed Courtroom source defines all 32 abilities and replaces legacy saved-game copies',()=>{
  const abilityBlock=app.match(/const standardAbilities=\(\)=>\[([\s\S]*?)\n\]\.map/)?.[1]||'';
  assert.equal((abilityBlock.match(/^  \['/gm)||[]).length,32);
  for(const name of ['Action Check','Den Regular Kill','Personal Instant Kill','Super Protect','Steal','Convert'])assert.match(abilityBlock,new RegExp(`\\['${name.replace('/','\\/')}'`));
  for(const removed of ['Role Check','Visitor Check','Regular Kill','Instant Kill','Redirect','Swap','Silence','Conversion','Recruit'])assert.doesNotMatch(abilityBlock,new RegExp(`\\['${removed.replace('/','\\/')}'`));
  assert.equal((completedMigration.match(/^\('[a-z_]+','[^']+','(?:Investigation|Harmful|Protection|Support)',\d+,/gm)||[]).length,32);
  assert.match(completedMigration,/select s\.ability_id,2,'ACTIVE','DEFINED'/);
  assert.match(completedMigration,/Courtroom Master Ability Encyclopedia installed with exactly 32 abilities/);
  assert.match(completedMigration,/COURTROOM_ABILITY_COUNT_MISMATCH/);
  assert.match(completedMigration,/COURTROOM_ABILITY_DEFINITION_INCOMPLETE/);
});

test('reconciliation reports matches without mutating roles or abilities',()=>{
  const state={abilities:[{id:'a1',name:'Protect'}],roles:[{id:'r1',name:'Guardian',tags:['Protect']} ]},before=JSON.stringify(state);
  const report=reconcileOfficialAbilities([{ability_id:'protect',display_name:'Protect',definition_status:'DEFINED'},{ability_id:'guard',display_name:'Guard',definition_status:'DEFINED'}],state);
  assert.equal(report.matched,1);assert.equal(report.unmatched,1);assert.equal(report.roleLinks,1);assert.equal(JSON.stringify(state),before);
});

test('AI responses retain bounded citations, authority, and GM decision state',()=>{
  const result=normalizeCopilotResponse({answer:'The order is undefined.',confidence:'low',authority:'insufficient',requires_gm_decision:true,ruling_basis:[],warnings:['No ordering rule.'],follow_up_questions:['Choose an order?'],sources:[{id:'doc:1',kind:'official_document',title:'Rules',version:'2',locator:'p. 4',excerpt:'No order is defined.',claim:'Ordering is absent.'}],proposed_changes:[]});
  assert.equal(result.requires_gm_decision,true);assert.equal(result.authority,'insufficient');assert.equal(result.sources[0].id,'doc:1');
});

test('Phase 1 schema is versioned, RLS protected, immutable by default, and explicitly granted',()=>{
  for(const table of ['official_documents','official_document_versions','official_document_chunks','standard_ability_datasets','standard_abilities','standard_ability_versions','game_ability_datasets','role_ability_modifiers','ai_conversations','ai_messages'])assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`));
  for(const pattern of [/game-knowledge-documents/,/match_game_knowledge/,/create_standard_ability_version/,/save_role_ability_modifier/,/record_ai_exchange/,/grant select on public\.official_documents/,/revoke all on function public\.complete_knowledge_ingestion/,/supabase_realtime add table public\.ai_messages/])assert.match(migration,pattern);
  assert.doesNotMatch(migration,/grant (insert|update|delete) on public\.(official|standard|role_ability|ai_)/i);
});

test('Phase 1 UI and Edge Functions wire retrieval, citations, activation, persistent chat, and human control',()=>{
  for(const id of ['knowledgeFile','uploadKnowledgeBtn','knowledgeDocumentList','officialAbilityList','activateOfficialDatasetBtn','abilityReconciliationReport','officialAbilityEditor','roleModifierPanel'])assert.match(html,new RegExp(`id="${id}"`));
  for(const pattern of [/uploadKnowledgeDocument/,/activateAbilityDataset/,/createStandardAbilityVersion/,/saveRoleAbilityModifier/,/startNewAiConversation/])assert.match(cloud,pattern);
  for(const pattern of [/match_game_knowledge/,/source_catalog/,/requires_gm_decision/,/Never invent a missing value or universal action order/,/record_ai_exchange/])assert.match(copilot,pattern);
  for(const pattern of [/input_file/,/application\/pdf/,/createEmbeddings/,/complete_knowledge_ingestion/,/fail_knowledge_ingestion/])assert.match(ingest,pattern);
  assert.match(cloud,/official_document_versions!official_document_versions_document_id_fkey/);
  assert.match(app,/if\(currentGame\(\)\)\{await refreshOpenGame\(\);await subscribeToOpenGame\(\)\}/);
  assert.match(app,/Reference data could not be loaded:/);
  assert.doesNotMatch(app,/class="danger delete-role"/);
});
