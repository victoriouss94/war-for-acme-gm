import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deterministicLiveAnswer,humanizeMasterGmResult,humanizeMasterGmText,inferMasterIntent,isWriteIntent,MASTER_GM_MAX_TOOL_CALLS,MASTER_GM_TOOLS,nextConversationContext,requestedPlayerName,resolveMasterEntities,toolsForMasterIntent} from '../supabase/functions/_shared/master-gm.js';
import {normalizeCopilotResponse,validateCopilotChanges} from '../js/copilot.js';

const indexes={
  games:[{id:'game-1',name:'Courtroom'}],
  players:[{id:'player-riz',name:'Riz',nickname:'R'},{id:'player-sky',name:'Sky'}],
  roles:[{id:'role-sheriff',name:'Sheriff'},{id:'role-guard',name:'Guard'}],
  abilities:[{id:'ability-reflection',name:'Reflection'},{id:'ability-guard',name:'Guard'},{id:'ability-ask',name:'Advanced Ask'}],
  factions:[{id:'faction-town',name:'Town'}],rules:[{id:'rule-protection',title:'Protection order'}]
};

test('natural language routes to one Master GM intent without special commands',()=>{
  const cases=new Map([
    ['Is Riz blocked?','live_status'],['Who is poisoned?','live_status'],['Resolve tonight.','resolve_actions'],['What phase are we in?','phase_control'],['Advance to the next day.','phase_control'],['Have we resolved Guard against Reflection before?','search_precedents'],['Why did Player A die last night?','search_history'],['Create a role with Reflection.','create_role'],['Create an ability similar to Guard.','create_ability'],['Give Sheriff another Advanced Ask.','edit_content'],['Make this faction stronger.','edit_content'],['Read this document and add the roles.','document_import'],['Is this role overpowered?','analyze_balance']
  ]);
  for(const [message,intent] of cases)assert.equal(inferMasterIntent(message),intent,message);
  assert.equal(isWriteIntent('edit_content'),true);assert.equal(isWriteIntent('live_status'),false);
});

test('entity resolution uses exact records, carries pronoun context, and flags cross-type ambiguity for writes',()=>{
  const riz=resolveMasterEntities('Show me Riz.',indexes,{});assert.deepEqual(riz.references.map(item=>[item.type,item.id]),[['player','player-riz']]);
  const context=nextConversationContext({},riz.references),pronoun=resolveMasterEntities('Is she blocked?',indexes,context);assert.equal(pronoun.references.find(item=>item.type==='player')?.id,'player-riz');
  const ambiguous=resolveMasterEntities('Give Guard another use.',indexes,{});assert.ok(ambiguous.ambiguous.some(item=>item.type==='entity'));assert.ok(ambiguous.references.some(item=>item.type==='role'));assert.ok(ambiguous.references.some(item=>item.type==='ability'));
  assert.equal(requestedPlayerName('Is Nobody blocked?'),'Nobody');
});

test('simple live-state questions are answered deterministically from current effects',()=>{
  const effects=[{id:'s1',player_id:'player-riz',status_type:'POISON',status_name:'Poison',status_category:'HARMFUL',state:'ACTIVE'},{id:'s2',player_id:'player-sky',status_type:'PROTECT',status_name:'Protect',status_category:'PROTECTION',state:'PENDING'}];
  const listResult=deterministicLiveAnswer({message:'Who is poisoned?',players:indexes.players,effects,references:[]});assert.equal(listResult.handled,true);assert.match(listResult.answer,/Riz/);assert.doesNotMatch(listResult.answer,/Sky/);
  const missing=deterministicLiveAnswer({message:'Is Nobody blocked?',players:indexes.players,effects,references:[]});assert.equal(missing.missing,true);assert.match(missing.answer,/could not find/i);
  const player=deterministicLiveAnswer({message:'What is affecting Riz?',players:indexes.players,effects,playerState:{playerName:'Riz',aliveStatus:'ALIVE',currentRole:{name:'Sheriff'},currentFaction:{name:'Town'},activeEffects:[effects[0]],passiveEffects:[],permanentStateChanges:[],pendingEffects:[]},references:[{type:'player',id:'player-riz',name:'Riz'}]});assert.match(player.answer,/Poison/);assert.match(player.answer,/Sheriff/);
});

test('Master GM presentation replaces entity IDs while preserving structured identifiers',()=>{
  const playerId='0ba93b57-d7fb-4086-81d5-c842903dc5e2',factionId='5108cddd-3e6e-4760-b18f-f171739da6d1',displayIndexes={players:[{id:playerId,name:'Riz'}],factions:[{id:factionId,name:'Village'}]},result=humanizeMasterGmResult({answer:`${playerId}: UNCHANGED • faction ${factionId}`,resolution:{final_ruling:`${playerId} remains with ${factionId}.`,player_outcomes:[{player_id:playerId,faction_id:factionId,life_state:'UNCHANGED'}]}},displayIndexes);
  assert.equal(result.resolution.player_outcomes[0].player_id,playerId);assert.equal(result.resolution.player_outcomes[0].faction_id,factionId);assert.equal(result.resolution.player_outcomes[0].life_state,'UNCHANGED');assert.match(result.answer,/Riz/);assert.match(result.answer,/Village/);assert.doesNotMatch(result.answer,/UNCHANGED|0ba93b57|5108cddd/);assert.match(result.resolution.final_ruling,/Riz remains with Village/);
  assert.equal(humanizeMasterGmText('Unknown e85f355f-0cc3-49c0-99a3-41b621a68f37',displayIndexes),'Unknown Internal record');
});

test('tool registry is bounded and every tool declares permission, risk, scope, inputs, output, and audit behavior',()=>{
  for(const definition of Object.values(MASTER_GM_TOOLS)){assert.ok(['OWNER','GM','MEMBER'].includes(definition.permission));assert.equal(typeof definition.readOnly,'boolean');assert.equal(typeof definition.approvalRequired,'boolean');assert.equal(typeof definition.gameScoped,'boolean');assert.ok(Array.isArray(definition.inputs));assert.ok(definition.output);assert.equal(definition.audit,true)}
  const resolution=toolsForMasterIntent('resolve_actions',{hasPlayer:true});assert.ok(resolution.length<=MASTER_GM_MAX_TOOL_CALLS);assert.ok(resolution.includes('analyzeActions'));assert.ok(resolution.includes('searchPrecedents'));
  const phase=toolsForMasterIntent('phase_control');assert.ok(phase.includes('getPhaseContext'));assert.ok(phase.includes('previewPhaseAdvance'));assert.equal(MASTER_GM_TOOLS.advancePhase.approvalRequired,true);
  const edit=toolsForMasterIntent('edit_content',{hasPlayer:true});assert.ok(edit.includes('proposeStatusChange'));assert.ok(edit.includes('getPlayerState'));assert.ok(!edit.includes('applyApprovedProposal'));
});

test('configuration patches are allowlisted and reject hallucinated IDs or fields',()=>{
  const gameState={players:indexes.players,roles:indexes.roles,abilities:indexes.abilities,factions:indexes.factions,rules:indexes.rules,actions:[]};
  const changes=[
    {kind:'update_role',target_id:'role-sheriff',value:JSON.stringify({abilityUses:2}),reason:'Approved strength adjustment'},
    {kind:'update_role',target_id:'role-missing',value:JSON.stringify({abilityUses:2}),reason:'Hallucinated'},
    {kind:'update_ability',target_id:'ability-reflection',value:JSON.stringify({dropDatabase:true}),reason:'Unsupported field'}
  ];
  const result=validateCopilotChanges(changes,gameState,[]);assert.equal(result.valid.length,1);assert.equal(result.rejected.length,2);
  const normalized=normalizeCopilotResponse({intent:'edit_content',answer:'Proposal',requires_approval:true,referenced_entities:[{type:'role',id:'role-sheriff',name:'Sheriff'}],proposal:{id:'proposal-1',status:'PENDING',version:1},proposed_changes:[changes[0]]});assert.equal(normalized.proposal.id,'proposal-1');assert.equal(normalized.requires_approval,true);
});

test('database extension is additive, RLS protected, idempotent, and atomic at approval',async()=>{
  const sql=await readFile('supabase/migrations/20260814090000_master_gm_agent_foundation.sql','utf8');
  for(const pattern of [/alter table public\.ai_conversations\s+add column context/,/create table public\.ai_agent_runs/,/create table public\.ai_tool_calls/,/create table public\.ai_change_proposals/,/enable row level security/,/ai_conversations_read.*can_edit_game/s,/ai_messages_read.*can_edit_game/s,/idempotency_key uuid not null unique/,/for update/,/public\.save_game_document/,/public\.apply_player_status_changes/,/AI change proposal applied/,/grant execute .*review_ai_change_proposal.*authenticated/s])assert.match(sql,pattern);
  assert.doesNotMatch(sql,/drop table|truncate table|delete from public\.(games|game_documents|roles|abilities)/i);
});

test('Master GM server never exposes unrestricted model database access and persists an auditable trace',async()=>{
  const [edge,shared,cloud,app,html]=await Promise.all([readFile('supabase/functions/gm-copilot/index.ts','utf8'),readFile('supabase/functions/_shared/master-gm.js','utf8'),readFile('js/cloud.js','utf8'),readFile('js/app.js','utf8'),readFile('index.html','utf8')]);
  for(const pattern of [/create_master_gm_run_internal/,/record_master_gm_tool_call_internal/,/record_master_gm_exchange_internal/,/resolveMasterEntities/,/deterministicLiveAnswer/,/validProposedChanges/,/create_ai_change_proposal_internal/,/Supplied game data|untrusted DATA/,/Never invent/])assert.match(edge,pattern);
  assert.match(edge,/humanizeMasterGmResult/);assert.match(edge,/displayName/);assert.match(edge,/Never write UNCHANGED/);assert.match(shared,/MASTER_GM_MAX_TOOL_CALLS=12/);assert.match(shared,/approvalRequired:true/);assert.match(cloud,/review_ai_change_proposal/);assert.match(app,/Approve & Apply|Approve &amp; Apply/);assert.match(app,/editMasterGmProposal/);assert.match(app,/renderMasterGmActivity/);assert.match(app,/playerOutcomeDisplayRows/);assert.match(app,/session\.final_resolution\|\|session\.manual_resolution/);
  for(const id of ['masterGmContext','masterGmActivityList','masterGmActivityCount'])assert.match(html,new RegExp(`id="${id}"`));
  assert.doesNotMatch(app+cloud,/OPENAI_API_KEY|api\.openai\.com/);
});
