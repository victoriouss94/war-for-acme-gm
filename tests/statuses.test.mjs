import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {groupPlayerStatuses,normalizePlayerStatus,parseStatusProposalValue,playerMatchesStatusFilter,statusMutationPayload} from '../js/statuses.js';
import {validateCopilotChanges} from '../js/copilot.js';

const gameState={
  players:[{id:'player-a',name:'Riz',roleId:'role-a',alive:true}],
  roles:[{id:'role-a',name:'Watcher',tags:['Roleblock']}],
  factions:[{id:'faction-a',name:'Village'}],
  actions:[]
};
const effects=[
  normalizePlayerStatus({id:'status-1',game_id:'game-1',player_id:'player-a',status_type:'ROLEBLOCK',status_name:'Roleblock',status_category:'HARMFUL',state:'ACTIVE',visibility:'GM_ONLY',expires_at_cycle:3,expires_at_phase:'Night'}),
  normalizePlayerStatus({id:'status-2',game_id:'game-1',player_id:'player-a',status_type:'PROTECT',status_name:'Protect',status_category:'PROTECTION',state:'PENDING'}),
  normalizePlayerStatus({id:'status-3',game_id:'game-1',player_id:'player-a',status_type:'POISON',status_name:'Poison',status_category:'HARMFUL',state:'RESOLVED'})
];

test('live status normalization remains separate from abilities owned',()=>{
  const groups=groupPlayerStatuses(effects,'player-a');
  assert.deepEqual(groups.active.map(item=>item.statusType),['ROLEBLOCK']);
  assert.deepEqual(groups.pending.map(item=>item.statusType),['PROTECT']);
  assert.deepEqual(groups.resolved.map(item=>item.statusType),['POISON']);
  assert.equal(playerMatchesStatusFilter(effects,'player-a','ROLEBLOCK',3,'Night'),true);
  assert.equal(playerMatchesStatusFilter(effects,'player-a','POISON',3,'Night'),false);
  assert.equal(playerMatchesStatusFilter(effects,'player-a','EXPIRING_CURRENT',3,'Night'),true);
  assert.deepEqual(gameState.roles[0].tags,['Roleblock']);
});

test('status payloads are structured, bounded, and preserve undefined duration',()=>{
  const parsed=parseStatusProposalValue(JSON.stringify({status_type:'MARK',status_name:'Mark',status_category:'HARMFUL',state:'ACTIVE',description:'Trigger not yet fulfilled.',visibility:'GM_ONLY'}));
  assert.equal(parsed.statusType,'MARK');assert.equal(parsed.remainingDuration,null);
  const payload=statusMutationPayload({...parsed,playerId:'player-a'});
  assert.equal(payload.player_id,'player-a');assert.equal(payload.remaining_duration,null);assert.equal(payload.visibility,'GM_ONLY');
  assert.equal(parseStatusProposalValue('{bad json'),null);
});

test('AI status proposals are allowlisted and revalidated against live IDs',()=>{
  const apply={kind:'apply_status',target_id:'player-a',value:JSON.stringify({status_type:'MARK',status_name:'Mark',status_category:'HARMFUL',state:'ACTIVE'}),reason:'Approved Mark action'};
  const resolve={kind:'resolve_status',target_id:'status-1',value:'',reason:'Heal resolved Roleblock'};
  const stale={kind:'resolve_status',target_id:'missing',value:'',reason:'stale'};
  const review=validateCopilotChanges([apply,resolve,stale],gameState,effects);
  assert.equal(review.valid.length,2);assert.equal(review.rejected.length,1);assert.equal(review.valid[0].status.playerId,'player-a');
});

test('database, AI, cloud, and GM UI implement controlled live status awareness',async()=>{
  const [sql,hardeningSql,edge,cloud,app,html]=await Promise.all([
    readFile('supabase/migrations/20260812011716_live_player_status_awareness.sql','utf8'),
    readFile('supabase/migrations/20260812011926_harden_player_status_mutations.sql','utf8'),
    readFile('supabase/functions/gm-copilot/index.ts','utf8'),readFile('js/cloud.js','utf8'),readFile('js/app.js','utf8'),readFile('index.html','utf8')
  ]);
  for(const pattern of [/create table public\.player_status_effects/,/create table public\.player_status_history/,/enable row level security/,/GM_ONLY/,/OWNER_VISIBLE/,/FACTION_VISIBLE/,/PUBLIC/,/mutate_player_status/,/apply_player_status_changes/,/get_player_state/,/get_player_statuses/,/get_players_by_status/,/get_active_effects/,/get_pending_effects/,/capture_player_status_history/,/supabase_realtime add table public\.player_status_effects/])assert.match(sql,pattern);
  assert.doesNotMatch(sql,/grant (insert|update|delete).*player_status_effects to authenticated/i);
  for(const pattern of [/validate_player_status_effect/,/STATUS_IDENTITY_IMMUTABLE/,/security invoker/,/grant select,insert,update on public\.player_status_effects to authenticated/])assert.match(hardeningSql,pattern);
  for(const pattern of [/rpc\('get_active_effects'/,/rpc\('get_pending_effects'/,/LIVE_GAME_DATABASE/,/Never infer that a player is blocked/,/apply_status/,/resolve_status/,/LIVE_STATUS_UNAVAILABLE/])assert.match(edge,pattern);
  for(const pattern of [/rpc\('mutate_player_status'/,/rpc\('apply_player_status_changes'/,/table:'player_status_effects'/])assert.match(cloud,pattern);
  for(const pattern of [/groupPlayerStatuses/,/refreshPlayerStatuses/,/applyPlayerStatusChanges/,/Abilities owned \(not current statuses\)/])assert.match(app,pattern);
  for(const id of ['playerStatusFilter','playerStatusManager','playerStatusForm','statusType','statusCategory','statusVisibility','playerStatusDetail','playerStatusHistory'])assert.match(html,new RegExp(`id="${id}"`));
});
