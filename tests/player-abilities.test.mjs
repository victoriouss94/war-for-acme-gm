import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {abilityTargeting,effectivePlayerAbilities,grantIsCurrent,normalizeAbilityGrant,queueCompleteness,validateActionTargets} from '../js/player-abilities.js';
import {inferMasterIntent,MASTER_GM_TOOLS,toolsForMasterIntent} from '../supabase/functions/_shared/master-gm.js';

const player={id:'p1',name:'AJ',roleId:'basic',alive:true,currentFactionId:'village'};
const target={id:'p2',name:'Sky',roleId:'powered',alive:true,currentFactionId:'neutral'};
const dead={id:'p3',name:'Ruby',roleId:'powered',alive:false,currentFactionId:'village'};
const abilities=[
  {id:'kill',name:'Super Kill',category:'Harmful',definition:'Kill a target.',phase:'Night',mechanics:['kill'],targeting:{type:'ONE_PLAYER',livingOnly:true,selfProhibited:true},cooldownCycles:2},
  {id:'ask',name:'Advanced Ask',category:'Investigation',definition:'Learn a role.',phase:'Night',mechanics:['investigation'],targeting:{type:'ONE_PLAYER'}},
  {id:'protect',name:'Protect',category:'Protection',definition:'Protect a target.',phase:'Any',mechanics:['protection'],targeting:{type:'ONE_PLAYER'}},
  {id:'passive',name:'Reflection',category:'Protection',definition:'Reflect.',phase:'Passive',mechanics:['reflection'],targeting:{type:'NO_TARGET'}},
  {id:'multi',name:'Council Vote',category:'Support',definition:'Choose players.',phase:'Day',mechanics:[],targeting:{type:'MULTIPLE_PLAYERS',minTargets:2,maxTargets:3}},
  {id:'amplified',name:'Omega Kill',category:'Harmful',definition:'Amplified kill.',phase:'Night',mechanics:['kill'],targeting:{type:'ONE_PLAYER'}}
];
const standardRole={id:'powered',name:'Sheriff',roleType:'STANDARD',activeAbilityId:'ask',passiveAbilityId:'passive',tags:['Advanced Ask','Reflection'],abilityUses:2};
const basicRole={id:'basic',name:'Basic Villager',roleType:'BASIC',activeAbilityId:'',passiveAbilityId:'',tags:[],abilityUses:null};
const grant=(patch={})=>normalizeAbilityGrant({id:'g1',game_id:'game',player_id:'p1',ability_id:'kill',source_type:'MINIGAME_REWARD',source_reference:'Trivia',reason:'Won trivia.',uses_granted:1,uses_remaining:1,duration_type:'UNTIL_USED',granted_cycle:3,granted_phase:'Night',status:'ACTIVE',version:1,...patch});

test('Basic Role stays ability-free while its player receives an existing granted ability',()=>{
  const result=effectivePlayerAbilities({player,role:basicRole,abilities,grants:[grant()],statuses:[],resolutionEvents:[],game:{currentDay:3,currentPhase:'Night'}});
  assert.equal(basicRole.tags.length,0);assert.equal(result.abilities.length,1);assert.equal(result.abilities[0].abilityId,'kill');assert.equal(result.abilities[0].sourceType,'MINIGAME_REWARD');assert.equal(result.abilities[0].usesRemaining,1);assert.equal(abilities.filter(item=>item.id==='kill').length,1);
});

test('Role and granted abilities coexist without merging or duplicating definitions',()=>{
  const poweredPlayer={...player,roleId:'powered'};const result=effectivePlayerAbilities({player:poweredPlayer,role:standardRole,abilities,grants:[grant({player_id:'p1',ability_id:'protect',source_type:'GM_GRANT'})],game:{currentDay:3,currentPhase:'Night'}});
  assert.deepEqual(result.abilities.map(item=>item.sourceType).sort(),['GM_GRANT','ROLE','ROLE']);assert.equal(abilities.filter(item=>item.id==='protect').length,1);assert.deepEqual(standardRole.tags,['Advanced Ask','Reflection']);
});

test('temporary, permanent, stolen, copied, and reward sources share one grant model',()=>{
  for(const sourceType of ['TEMPORARY_GRANT','PERMANENT_GRANT','STOLEN','COPIED','MINIGAME_REWARD','EVENT_REWARD'])assert.equal(normalizeAbilityGrant({...grant(),source_type:sourceType}).sourceType,sourceType);
  assert.equal(grantIsCurrent(grant({uses_remaining:null,uses_granted:null,duration_type:'PERMANENT_FOR_GAME'}),{currentDay:99,currentPhase:'Day'}),true);
  assert.equal(grantIsCurrent(grant({status:'REVOKED'}),{currentDay:3,currentPhase:'Night'}),false);
  assert.equal(grantIsCurrent(grant({uses_remaining:0,status:'CONSUMED'}),{currentDay:3,currentPhase:'Night'}),false);
  assert.equal(grantIsCurrent(grant({duration_type:'UNTIL_END_OF_PHASE',granted_cycle:3,granted_phase:'Night',expires_cycle:3,expires_phase:'Night'}),{currentDay:3,currentPhase:'Night'}),true);
  assert.equal(grantIsCurrent(grant({duration_type:'UNTIL_END_OF_PHASE',granted_cycle:3,granted_phase:'Night',expires_cycle:3,expires_phase:'Night'}),{currentDay:4,currentPhase:'Day'}),false);
});

test('remaining uses, cooldown, phase, passive, Additional Uses, and Amplify remain distinct',()=>{
  const poweredPlayer={...player,roleId:'powered'};const statuses=[
    {playerId:'p1',state:'ACTIVE',statusType:'ADDITIONAL_USES',statusName:'Additional Uses',metadata:{abilityId:'ask'},remainingDuration:1},
    {playerId:'p1',state:'ACTIVE',statusType:'ABILITY_AMPLIFY',statusName:'Ability Amplify',metadata:{baseAbilityId:'ask',effectiveAbilityId:'amplified'}},
    {playerId:'p1',state:'ACTIVE',statusType:'ROLEBLOCK',statusName:'Roleblocked'},
    {playerId:'p1',state:'ACTIVE',statusType:'ACTION_SUCCESS_GUARANTEE',statusName:'Action Success Guarantee'}
  ];
  const events=[{actorPlayerId:'p1',abilityId:'ask',eventType:'ABILITY_CONSUMED',cycle:2}];
  const result=effectivePlayerAbilities({player:poweredPlayer,role:standardRole,abilities,grants:[],statuses,resolutionEvents:events,game:{currentDay:3,currentPhase:'Night'}}),ask=result.abilities.find(item=>item.abilityId==='ask'),passive=result.abilities.find(item=>item.abilityId==='passive');
  assert.equal(ask.usesGranted,2);assert.equal(ask.additionalUses,1);assert.equal(ask.usesRemaining,2);assert.equal(ask.effectiveAbilityId,'amplified');assert.equal(ask.effectiveName,'Omega Kill');assert.equal(passive.available,false);assert.ok(passive.reasons.includes('PASSIVE'));assert.deepEqual(result.warnings.sort(),['Ability Amplify','Action Success Guarantee','Additional Uses','Roleblocked'].sort());
  const cooldown=effectivePlayerAbilities({player,role:basicRole,abilities,grants:[grant()],resolutionEvents:[{actorPlayerId:'p1',abilityId:'kill',eventType:'ABILITY_CONSUMED',cycle:3}],game:{currentDay:4,currentPhase:'Night'}}).abilities[0];assert.equal(cooldown.available,false);assert.ok(cooldown.reasons.includes('ON_COOLDOWN'));
  const wrongPhase=effectivePlayerAbilities({player,role:basicRole,abilities,grants:[grant()],game:{currentDay:3,currentPhase:'Day'}}).abilities[0];assert.ok(wrongPhase.reasons.includes('WRONG_PHASE'));
});

test('structured target validation supports player, multiple, self, dead, ability, faction, custom, and no target',()=>{
  const players=[player,target,dead],factions=[{id:'village'},{id:'neutral'}];
  assert.deepEqual(validateActionTargets({actor:player,players,factions,ability:{targeting:abilityTargeting(abilities[0])},targetIds:['p2']}),[]);
  assert.ok(validateActionTargets({actor:player,players,factions,ability:{targeting:abilityTargeting(abilities[0])},targetIds:['p1']}).includes('SELF_TARGET_PROHIBITED'));
  assert.deepEqual(validateActionTargets({actor:player,players,factions,ability:{targeting:abilityTargeting(abilities[4])},targetIds:['p2','p3']}),[]);
  assert.deepEqual(validateActionTargets({actor:player,players,factions,ability:{targeting:{type:'SELF'}},targetIds:['p1']}),[]);
  assert.deepEqual(validateActionTargets({actor:player,players,factions,ability:{targeting:{type:'DEAD_PLAYER'}},targetIds:['p3']}),[]);
  assert.deepEqual(validateActionTargets({actor:player,players,factions,ability:{targeting:{type:'ABILITY'}},targetAbilityId:'kill'}),[]);
  assert.deepEqual(validateActionTargets({actor:player,players,factions,ability:{targeting:{type:'FACTION'}},targetFactionId:'neutral'}),[]);
  assert.deepEqual(validateActionTargets({actor:player,players,factions,ability:{targeting:{type:'CUSTOM_TARGET'}},customTarget:'The court'}),[]);
  assert.deepEqual(validateActionTargets({actor:player,players,factions,ability:{targeting:{type:'NO_TARGET'}},targetIds:[]}),[]);
});

test('queue completeness counts players once while allowing multiple actions',()=>{const result=queueCompleteness([player,target,dead],[{sourcePlayerId:'p1'},{sourcePlayerId:'p1'}]);assert.equal(result.players,2);assert.equal(result.playersWithActions,1);assert.deepEqual(result.missing.map(item=>item.id),['p2'])});

test('Supabase migration is additive, GM-only, audited, live, random on the server, and atomic with resolution consumption',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260824110000_dynamic_player_abilities_action_queue.sql',import.meta.url),'utf8');
  assert.equal((sql.match(/create table public\.player_ability_grants \(/g)||[]).length,1);assert.equal((sql.match(/create table public\.player_ability_grant_events \(/g)||[]).length,1);assert.doesNotMatch(sql,/create table public\.(?:action_queue|reward_abilities|player_abilities)\b/i);assert.match(sql,/references public\.games\(id\)/);assert.match(sql,/ability_id text not null/);assert.doesNotMatch(sql,/delete from public\.player_ability_grants/);
  assert.match(sql,/enable row level security/);assert.match(sql,/using \(public\.can_edit_game\(game_id\)\)/);assert.match(sql,/revoke all on table .*authenticated/);assert.match(sql,/revoke all on function private\./);assert.doesNotMatch(sql,/grant execute on function private\./);assert.match(sql,/security definer set search_path=''/);
  assert.match(sql,/order by gen_random_uuid\(\)/);assert.match(sql,/target_ability_pool/);assert.match(sql,/GRANT_USES_ALREADY_QUEUED/);assert.match(sql,/ABILITY_ON_COOLDOWN/);assert.match(sql,/PLAYER_DOES_NOT_OWN_ABILITY/);assert.match(sql,/GM_OVERRIDE_REASON_REQUIRED/);assert.match(sql,/SOURCE_FACTION_NOT_FOUND/);assert.match(sql,/TARGET_ABILITY_NOT_FOUND/);assert.match(sql,/TARGET_FACTION_REQUIRED/);assert.match(sql,/deadOnly/);
  assert.match(sql,/result:=private\.finalize_resolution_session/);assert.match(sql,/for update/);assert.match(sql,/GRANT_VERSION_CONFLICT/);assert.match(sql,/NOT_ENOUGH_GRANT_USES/);assert.match(sql,/player_ability_grant_events/);assert.match(sql,/change_history/);assert.match(sql,/alter publication supabase_realtime add table public\.player_ability_grants/);
});

test('cloud and UI extend the existing queue and expose review-only deterministic Master GM flows',async()=>{
  const [app,cloud,html,edge]=await Promise.all(['../js/app.js','../js/cloud.js','../index.html','../supabase/functions/gm-copilot/index.ts'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
  for(const token of ['playerAbilityManager','grantAbilityId','actionActorSearch','actionAbilityPicker','actionTargetPicker','queueCompleteness','resolutionGrantConsumptions'])assert.match(html,new RegExp(token));
  for(const token of ['effectiveAbilitiesForPlayer','deterministicAbilityCommand','GMCloud.bulkGrantPlayerAbilities','GMCloud.grantRandomPlayerAbility','GMCloud.queuePlayerAction','consumedActionIds'])assert.match(app,new RegExp(token.replaceAll('.','\\.')));
  for(const token of ['playerAbilityState','grantPlayerAbility','bulkGrantPlayerAbilities','grantRandomPlayerAbility','mutatePlayerAbilityGrant','queuePlayerAction','removeQueuedAction','finalize_resolution_with_grants'])assert.match(cloud,new RegExp(token));
  assert.match(edge,/player_ability_grants/);assert.match(edge,/queued action records an ATTEMPT/);assert.match(edge,/never claim the grant or action was applied/);assert.equal(inferMasterIntent('AJ won a mini game reward; grant one Super Kill.'),'ability_grant');assert.equal(inferMasterIntent('Queue AJ to attack Sky.'),'queue_action');assert.ok(toolsForMasterIntent('ability_grant',{hasPlayer:true,hasAbility:true}).includes('prepareAbilityGrant'));assert.equal(MASTER_GM_TOOLS.prepareRandomReward.approvalRequired,true);
});
