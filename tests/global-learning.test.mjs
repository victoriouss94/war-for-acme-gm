import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {manualResolutionPayload,precedentVisibility,validateManualResolution} from '../js/resolution.js';
import {normalizeCopilotResponse} from '../js/copilot.js';

const migrationPath='supabase/migrations/20260812024815_global_master_gm_ai.sql';
const runtimeFixPath='supabase/migrations/20260812034700_fix_global_learning_runtime.sql';
const [sql,runtimeFix,edge,app,cloud,html]=await Promise.all([
  readFile(migrationPath,'utf8'),
  readFile(runtimeFixPath,'utf8'),
  readFile('supabase/functions/gm-copilot/index.ts','utf8'),
  readFile('js/app.js','utf8'),
  readFile('js/cloud.js','utf8'),
  readFile('index.html','utf8')
]);

test('Teach AI defaults to Global for new rulings and preserves role isolation',()=>{
  const base=manualResolutionPayload({results:'Guard receives the kill.',interactionSignature:'PERSONAL INSTANT KILL + GUARD',signatureTokens:'personal instant kill\nguard',contextRoleIds:['guard'],abilityContext:[{id:'kill',version:2}],roleContext:[{id:'guard'}],roleModifierContext:[]});
  assert.equal(base.scope,'GAME_SPECIFIC');
  assert.deepEqual(base.context_role_ids,['guard']);
  assert.equal(base.ability_context[0].version,2);
  assert.deepEqual(validateManualResolution('MODIFY',base,true,'Approved ruling.',undefined,true),[]);
  assert.deepEqual(validateManualResolution('MODIFY',base,true,'Approved ruling.','GAME_SPECIFIC',true),[]);
  assert.deepEqual(validateManualResolution('MODIFY',base,true,'Approved ruling.','GLOBAL',true),[]);
  assert.match(validateManualResolution('MODIFY',base,true,'Approved ruling.','GLOBAL',false)[0],/authorized GM/i);
  assert.match(validateManualResolution('MODIFY',{...base,scope:'ROLE_SPECIFIC',role_ids:['sheriff']},true,'Role exception.','GLOBAL',true)[0],/stay with this game/i);
  assert.match(validateManualResolution('MODIFY',{...base,scope:'ONE_TIME'},true,'One-time exception.','GLOBAL',true)[0],/stay with this game/i);
  assert.equal(precedentVisibility({scope:'GLOBAL',authority:'GLOBAL_OFFICIAL_RULE'},'game-a'),'GLOBAL OFFICIAL RULE');
});

test('global source metadata remains transparent and bounded in AI responses',()=>{
  const result=normalizeCopilotResponse({answer:'Current game rule applies.',confidence:'high',sources:[{id:'precedent:1',title:'GM Precedent #1',scope:'GLOBAL',originGame:'Courtroom',applicability:'STRONG',authorityLayer:'GLOBAL_APPROVED_GM_PRECEDENT',compatibilityReasons:['Same approved mechanical concept.']}],global_knowledge:{current_game_precedent_count:1,global_precedent_count:6,compatible_global_precedent_count:5,global_authority_used:true,current_game_overrides:['Guard cancels the attack.'],conflicts:[],pattern_summary:'Guard usually transfers normal harm.'}});
  assert.equal(result.sources[0].origin_game,'Courtroom');
  assert.equal(result.sources[0].applicability,'STRONG');
  assert.equal(result.global_knowledge.global_authority_used,true);
  assert.deepEqual(result.global_knowledge.current_game_overrides,['Guard cancels the attack.']);
});

test('safe migration extends existing learning, resolution, document, status, and audit systems',()=>{
  for(const pattern of [
    /alter table public\.gm_precedents/,
    /add column teach_scope text not null default 'GAME_SPECIFIC'/,
    /alter table public\.resolution_sessions alter column teach_scope set default 'GLOBAL'/,
    /add column scope text not null default 'GAME_SPECIFIC'/,
    /approved_for_global_use/,
    /compatibility_metadata/,
    /normalized_actions/,
    /correction_metadata/,
    /origin_game_name_snapshot/,
    /legacy_scope_review/,
    /GLOBAL_OFFICIAL_RULE/,
    /change_history/,
    /public\.can_edit_game/,
    /enable row level security/,
    /grant select on public\.global_ability_concepts,public\.ability_concept_mappings to authenticated/
  ])assert.match(sql,pattern);
  assert.doesNotMatch(sql,/create table public\.(gm_precedents|resolution_sessions|resolution_session_events|player_status_effects|change_history)/);
  assert.doesNotMatch(sql,/drop table|truncate table|delete from public\.(games|gm_precedents|resolution_sessions|player_status_effects)/i);
  assert.match(sql,/approved_for_global_use=\(precedent\.scope='GLOBAL'\)/);
  assert.match(sql,/legacy_scope_review=\(precedent\.scope<>'GLOBAL'\)/);
  const historicalBackfill=sql.match(/update public\.gm_precedents precedent[\s\S]*?where game\.id=precedent\.game_id and precedent\.origin_game_name_snapshot='';/)?.[0]||'';
  assert.doesNotMatch(historicalBackfill,/\n\s*scope\s*=/i);
});

test('all five learning choices are exposed with Global first and corrections share that default',()=>{
  assert.match(html,/id="teachAiAudience"><option value="GLOBAL" selected>Global — All Games \(default\)<\/option>/);
  for(const scope of ['GLOBAL','GAME_SPECIFIC','ABILITY_SPECIFIC','ROLE_SPECIFIC','ONE_TIME'])assert.match(html,new RegExp(`<option value="${scope}"`));
  assert.doesNotMatch(html,/id="teachAiAudience"[^>]*>[\s\S]{0,500}<option value="GENERAL"/);
  assert.match(cloud,/teachScope='GLOBAL'/);
  assert.match(sql,/target_teach_scope text default 'GLOBAL'/);
  assert.match(sql,/decision in \('MODIFY','REJECT'\)/);
});

test('compatibility context, narrower-scope warning, and audited legacy bulk review reuse existing systems',()=>{
  for(const pattern of [/contextRoleIds/,/abilityContext/,/roleContext/,/roleModifierContext/])assert.match(app,pattern);
  for(const pattern of [/originRoleIds/,/abilityContext/,/roleContext/,/roleModifierContext/,/'statuses',status_values/,/'conditions'/,/'outcome',final_value/,/'reasoning'/,/sourceVersions/,/suggestedNarrowerScope/])assert.match(sql,pattern);
  assert.match(app,/Global remains selected, but review whether a narrower scope is safer/);
  assert.match(app,/GLOBAL GM PRECEDENT FOUND/);
  assert.match(app,/CROSS-GAME CONSISTENT GM PATTERN/);
  assert.match(app,/promoteSelectedLegacyPrecedents/);
  assert.match(app,/GMCloud\.managePrecedent/);
  assert.match(html,/id="bulkPromoteGlobalBtn"/);
  assert.match(sql,/legacy_scope_review=false/);
  assert.doesNotMatch(sql,/create (table|function)[^;]*bulk.*global/i);
});

test('cross-game retrieval is current-game first, scoped, mapped, and compatibility aware',()=>{
  for(const pattern of [
    /CURRENT_GAME_APPROVED_PRECEDENT/,
    /GLOBAL_OFFICIAL_GM_RULE/,
    /GLOBAL_APPROVED_GM_PRECEDENT/,
    /precedent\.scope<>'ONE_TIME'/,
    /precedent\.scope<>'ROLE_SPECIFIC'.*cardinality\(precedent\.role_ids\)>0/,
    /precedent\.scope<>'ABILITY_SPECIFIC'.*cardinality\(precedent\.ability_ids\)>0/,
    /eligible\.global_concept_ids&&eligible\.requested_tokens/,
    /versionCheckRequired/,
    /statusContextMismatch/
  ])assert.match(sql,pattern);
  for(const pattern of [
    /evaluatePrecedentCompatibility/,
    /Important live-status conditions differ/,
    /approved ability mapping marks the mechanics incompatible/,
    /precedent may be outdated/,
    /Never use an INCOMPATIBLE precedent/,
    /Current-game authority always overrides global knowledge/,
    /LIVE_GAME_DATABASE is the sole authority/,
    /global_official_document/,
    /global_gm_precedent/,
    /target_used_precedent_ids/
  ])assert.match(edge,pattern);
});

test('global concepts, mappings, promotions, downgrades, superseding, and audits require GM-controlled RPCs',()=>{
  for(const table of ['global_ability_concepts','ability_concept_mappings'])assert.match(sql,new RegExp(`create table public\\.${table}`));
  for(const pattern of [
    /compatibility_level text not null check \(compatibility_level in \('EXACT','STRONG','PARTIAL','INCOMPATIBLE'\)\)/,
    /create_global_ability_concept/,
    /approve_ability_concept_mapping/,
    /remove_ability_concept_mapping/,
    /promote_global_pattern/,
    /GLOBAL_PRECEDENT_REASON_REQUIRED/,
    /GLOBAL_RULE_REASON_REQUIRED/,
    /target_status.*SUPERSEDED/s,
    /next_scope<>'GLOBAL'.*next_authority:='GM_PRECEDENT'/s
  ])assert.match(sql,pattern);
  for(const pattern of [/createGlobalAbilityConcept/,/approveAbilityConceptMapping/,/removeAbilityConceptMapping/,/promoteGlobalPattern/,/managePrecedent/])assert.match(cloud,pattern);
  for(const id of ['teachAiAudience','scopeCompatibilityWarning','bulkPromoteGlobalBtn','knowledgeScope','precedentScopeFilter','crossGamePatternList','globalConceptForm','abilityConceptMappingForm'])assert.match(html,new RegExp(`id="${id}"`));
  for(const pattern of [/syncResolutionLearningControls/,/changePrecedentScope/,/promoteCrossGamePattern/,/createGlobalConcept/,/saveAbilityConceptMapping/])assert.match(app,pattern);
});

test('repository still has one precedent, resolution, status, retrieval, audit, and AI service architecture',async()=>{
  const migrationFiles=(await readdir('supabase/migrations')).filter(name=>name.endsWith('.sql'));
  const migrations=(await Promise.all(migrationFiles.map(name=>readFile(`supabase/migrations/${name}`,'utf8')))).join('\n');
  assert.equal((migrations.match(/create table public\.gm_precedents\s*\(/g)||[]).length,1);
  assert.equal((migrations.match(/create table public\.resolution_sessions\s*\(/g)||[]).length,1);
  assert.equal((migrations.match(/create table public\.player_status_effects\s*\(/g)||[]).length,1);
  assert.equal((migrations.match(/create table public\.change_history\s*\(/g)||[]).length,1);
  assert.equal((migrations.match(/create function public\.match_game_knowledge\s*\(/g)||[]).length,1,'the existing retrieval RPC is replaced in place');
  const functionFolders=(await readdir('supabase/functions',{withFileTypes:true})).filter(entry=>entry.isDirectory()&&!entry.name.startsWith('_')).map(entry=>entry.name);
  assert.equal(functionFolders.filter(name=>name==='gm-copilot').length,1);
  assert.equal(functionFolders.filter(name=>/global-ai|courtroom-ai|jungle-ai|war-for-acme-ai/i.test(name)).length,0);
});

test('global learning runtime summaries avoid ambiguous owner references and private Realtime receives the active JWT',()=>{
  assert.match(runtimeFix,/declare target_owner_id uuid/);
  assert.doesNotMatch(runtimeFix,/declare owner_id uuid/);
  assert.match(runtimeFix,/game\.owner_id=target_owner_id/);
  assert.match(cloud,/realtime\.setAuth\(session\.access_token\)/);
});
