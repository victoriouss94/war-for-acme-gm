import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {manualResolutionPayload,normalizeAiDraft,normalizeResolution,validateManualResolution} from '../js/resolution.js';

test('structured resolutions and events are bounded and normalized',()=>{
  const result=normalizeResolution({actions_analyzed:['A attacks B'],proposed_order:['Only if a rule supports this step'],expected_results:['B survives'],events:[{event_type:'DEATH',target_player_id:'b',summary:'B dies'},{event_type:'DROP_DATABASE',summary:'Rejected type becomes Other'}],interaction_signature:'SUPER_KILL + SUPER_PROTECT',signature_tokens:['Super Kill','super-kill','Super Protect']});
  assert.deepEqual(result.signature_tokens,['super_kill','super_protect']);
  assert.equal(result.events[0].event_type,'DEATH');assert.equal(result.events[1].event_type,'OTHER');
  assert.equal(normalizeResolution(null),null);
});

test('manual precedent learning requires a reason and normalized signature',()=>{
  const payload=manualResolutionPayload({title:'Guard ruling',results:'Kill transfers',events:'Guard receives the action',interactionSignature:'PERSONAL INSTANT KILL + GUARD',signatureTokens:'personal instant kill\nguard',scope:'ABILITY_SPECIFIC'});
  assert.deepEqual(payload.signature_tokens,['personal_instant_kill','guard']);
  assert.equal(validateManualResolution('MODIFY',payload,true,'Guard transfers applicable normal harm.','GAME_SPECIFIC',true).length,0);
  assert.match(validateManualResolution('MODIFY',{...payload,signature_tokens:[]},true,'why','GAME_SPECIFIC',true)[0],/signature token/i);
  assert.match(validateManualResolution('MODIFY',payload,true,'','GAME_SPECIFIC',true)[0],/Explain why/i);
});

test('AI role and ability drafts remain structured drafts',()=>{
  const draft=normalizeAiDraft({draft_type:'ROLE',title:'Mirror Judge',possible_duplicate:false,payload:{name:'Mirror Judge',standard_ability_ids:['reflection'],role_modifiers:['May trigger twice.']}});
  assert.equal(draft.draft_type,'ROLE');assert.deepEqual(draft.payload.standard_ability_ids,['reflection']);assert.equal(draft.payload.role_modifiers[0],'May trigger twice.');
  assert.equal(normalizeAiDraft({draft_type:'GAME',payload:{}}),null);
});

test('database and UI implement one GM-controlled resolution and precedent architecture',async()=>{
  const [sql,edge,app,cloud,html]=await Promise.all([readFile('supabase/migrations/20260812020135_consolidated_ai_gm_resolution_learning.sql','utf8'),readFile('supabase/functions/gm-copilot/index.ts','utf8'),readFile('js/app.js','utf8'),readFile('js/cloud.js','utf8'),readFile('index.html','utf8')]);
  for(const table of ['resolution_sessions','resolution_session_events','gm_precedents','ai_drafts','ability_interactions','ai_usage_events','ai_usage_limits'])assert.match(sql,new RegExp(`create table public\\.${table}`));
  for(const pattern of [/for update/,/RESOLUTION_VERSION_CONFLICT/,/RESOLUTION_ALREADY_FINALIZED/,/target_teach_ai/,/interaction_signature/,/CONFLICTING/,/enable row level security/,/public\.can_edit_game/,/reserve_ai_usage_internal/,/complete_ai_usage_internal/])assert.match(sql,pattern);
  assert.doesNotMatch(sql,/grant (insert|update|delete).*resolution_sessions.*authenticated/i);
  for(const pattern of [/resolution_sessions/,/search_gm_precedents/,/record_resolution_ai_proposal_internal/,/create_ai_draft_internal/,/Never invent a missing value or universal action order/,/requires_gm_decision/])assert.match(edge,pattern);
  for(const pattern of [/startResolutionSession/,/finalizeResolutionSession/,/reviewAiDraft/,/managePrecedent/,/setAiUsageLimit/,/table:'resolution_sessions'/])assert.match(cloud,pattern);
  assert.doesNotMatch(app,/priorityMap/);assert.doesNotMatch(html,/Blocks<\/li><li>Role Control/);
  for(const id of ['resolutionsView','resolutionSessionList','analyzeResolutionBtn','manualResolutionForm','teachAiFromResolution','learningView','precedentList','aiDraftList','abilityInteractionList','aiUsageLimitForm'])assert.match(html,new RegExp(`id="${id}"`));
});
