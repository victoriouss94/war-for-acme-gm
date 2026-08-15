import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inferMasterIntent,MASTER_GM_TOOLS,toolsForMasterIntent} from '../supabase/functions/_shared/master-gm.js';
import {normalizeAiDocumentImport,importSummary} from '../js/document-import.js';

test('Global Settings migration is additive, versioned, owner-scoped, and snapshotted',async()=>{
  const sql=await readFile('supabase/migrations/20260814160000_document_driven_global_rules.sql','utf8');
  for(const pattern of [/create table public\.global_rules/,/create table public\.global_rule_versions/,/unique\(owner_id,rule_key\)/,/enable row level security/,/member_role in \('owner','gm'\)/,/create or replace function public\.get_effective_ruleset/,/'gameOverrides'/,/'globalFallbacks'/,/'standardAbilities'/,/'roleModifiers'/,/'globalRules'/,/AI global rule proposal applied/])assert.match(sql,pattern);
  assert.doesNotMatch(sql,/drop table|truncate table|delete from public\.(games|game_documents|roles|abilities)/i);
});

test('one Master GM uses effective rules and cannot route whole-game generation',()=>{
  assert.ok(MASTER_GM_TOOLS.getEffectiveRuleset);assert.ok(MASTER_GM_TOOLS.getGlobalSettings);assert.ok(MASTER_GM_TOOLS.proposeGlobalRuleUpdate);assert.equal(MASTER_GM_TOOLS.createGameDraft,undefined);
  assert.equal(inferMasterIntent('Build a complete new game for me.'),'assistant');
  assert.equal(inferMasterIntent('From now on update the global protection rule.'),'edit_content');
  assert.ok(toolsForMasterIntent('edit_content',{}).includes('getEffectiveRuleset'));
});

test('document analysis preserves modifiers, statuses, fallbacks, and conflicts for review',()=>{
  const model=normalizeAiDocumentImport({
    game:{name:'Document Game',starting_phase:'Night'},
    factions:[{name:'Town',class_name:'VILLAGER'}],
    abilities:[{name:'Protect',definition:'Protect one player.',category:'Protection',phase:'Night',mechanics:['protection'],mapping:'STANDARDIZED',standard_ability_id:'protect',modifiers:[],interactions:['Kill'],confidence:.9,source_text:'Protect one player',source_location:'Roles > Guardian'}],
    roles:[{name:'Guardian',faction_name:'Town',ability_names:['Protect'],active_ability_name:'Protect',passive_ability_name:'',role_modifiers:[{ability_name:'Protect',modifier:'Also stops poison.'}],status_interactions:['Poison'],relationships:[],confidence:.9,source_text:'Guardian',source_location:'Roles > Guardian'}],
    rules:[{title:'Protection order',rule_key:'PROTECTION_ORDER',description:'Protection resolves first.',category:'Actions',rule_type:'ACTION_ORDER',scope:'GAME_OVERRIDE',fallback_rule_key:'PROTECTION_ORDER',visibility:'gm',notes:'',enabled:true,conflicts:[],confidence:.9,source_text:'Protection first',source_location:'Rules'}],
    statuses:[{name:'Poisoned',status_type:'POISON',category:'HARMFUL',description:'Dies later.',duration:'2 days',interactions:['Heal'],confidence:.9,source_text:'Poison',source_location:'Statuses'}],
    special_mechanics:[{name:'Hidden ballot',description:'Votes are hidden.',category:'Voting',interactions:[],confidence:.9,source_text:'Hidden ballot',source_location:'Mechanics'}],
    analysis:{global_fallbacks:['Tie votes use Global Settings.'],duplicates:[],ambiguities:['Duration boundary unclear.'],conflicts:['Protection order differs from global.'],custom_mechanics:['Hidden ballot']},warnings:[]
  },{fileName:'document-game.docx'});
  const summary=importSummary(model);assert.equal(model.roles[0].abilityModifiers.length,1);assert.match(model.roles[0].gmNotes,/Also stops poison/);assert.equal(model.statuses.length,1);assert.equal(model.specialMechanics.length,1);assert.ok(model.rules.some(rule=>rule.ruleType==='STATUS_DEFINITION'));assert.equal(summary.globalFallbacks,1);assert.equal(summary.conflicts,1);assert.equal(summary.roleModifiers,1);
});

