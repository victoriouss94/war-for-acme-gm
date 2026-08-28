import {TARGET_TYPES as MECHANIC_TARGET_TYPES,normalizeAbilityUnderstanding,normalizeTargeting} from './mechanics.js?v=11.6.2';
import {classifyAbility} from './global-abilities.js?v=11.6.2';

export const ABILITY_SOURCE_TYPES=Object.freeze(['ROLE','FACTION','GM_GRANT','TEMPORARY_GRANT','PERMANENT_GRANT','MINIGAME_REWARD','EVENT_REWARD','STOLEN','COPIED','STATUS_EFFECT','ITEM','SPECIAL_MECHANIC','OTHER']);
export const GRANT_DURATIONS=Object.freeze(['ONE_USE','LIMITED_USES','UNTIL_USED','UNTIL_END_OF_PHASE','UNTIL_END_OF_DAY','UNTIL_END_OF_NIGHT','UNTIL_END_OF_CYCLE','UNTIL_SPECIFIC_CYCLE','UNTIL_REMOVED','PERMANENT_FOR_GAME']);
export const GRANT_STATES=Object.freeze(['ACTIVE','CONSUMED','EXPIRED','REVOKED','SUPERSEDED']);
export const ACTION_SOURCE_TYPES=Object.freeze(['PLAYER','FACTION','GM_MANUAL','SYSTEM']);
export const TARGET_TYPES=Object.freeze([...MECHANIC_TARGET_TYPES]);

const clean=(value,limit=4000)=>String(value??'').trim().slice(0,limit);
const key=value=>clean(value,500).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const nullableInt=value=>value===''||value==null?null:Number.isInteger(Number(value))?Number(value):null;
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};

export function normalizeAbilityGrant(input={}){
  const sourceType=clean(input.source_type??input.sourceType,40).toUpperCase(),duration=clean(input.duration_type??input.durationType,40).toUpperCase(),status=clean(input.status,30).toUpperCase(),usesGranted=nullableInt(input.uses_granted??input.usesGranted),usesRemaining=nullableInt(input.uses_remaining??input.usesRemaining);
  return {
    id:clean(input.id,100),gameId:clean(input.game_id??input.gameId,100),playerId:clean(input.player_id??input.playerId,100),abilityId:clean(input.ability_id??input.abilityId,120),
    sourceType:ABILITY_SOURCE_TYPES.includes(sourceType)?sourceType:'OTHER',sourceReference:clean(input.source_reference??input.sourceReference,300),reason:clean(input.reason,4000),
    usesGranted:usesGranted==null?null:Math.max(0,usesGranted),usesRemaining:usesRemaining==null?null:Math.max(0,usesRemaining),durationType:GRANT_DURATIONS.includes(duration)?duration:'UNTIL_REMOVED',
    grantedCycle:nullableInt(input.granted_cycle??input.grantedCycle),grantedPhase:clean(input.granted_phase??input.grantedPhase,30),expiresAt:input.expires_at??input.expiresAt??null,expiresCycle:nullableInt(input.expires_cycle??input.expiresCycle),expiresPhase:clean(input.expires_phase??input.expiresPhase,30),
    phaseRestrictions:(Array.isArray(input.phase_restrictions??input.phaseRestrictions)?input.phase_restrictions??input.phaseRestrictions:[]).map(value=>clean(value,20)).filter(Boolean),specialConditions:record(input.special_conditions??input.specialConditions),survivesConversion:input.survives_conversion??input.survivesConversion??null,stealable:input.stealable!==false,
    status:GRANT_STATES.includes(status)?status:'ACTIVE',metadata:record(input.metadata),version:Math.max(1,Number(input.version)||1),grantedBy:clean(input.granted_by??input.grantedBy,100),createdAt:input.created_at??input.createdAt??null,updatedAt:input.updated_at??input.updatedAt??null,revokedAt:input.revoked_at??input.revokedAt??null
  };
}

export function grantIsCurrent(rawGrant,game={},at=new Date()){
  const grant=normalizeAbilityGrant(rawGrant);if(grant.status!=='ACTIVE'||grant.usesRemaining===0)return false;
  if(grant.expiresAt&&!Number.isNaN(new Date(grant.expiresAt).valueOf())&&new Date(grant.expiresAt)<=at)return false;
  const cycle=Number(game.currentDay??game.cycle??0),phase=clean(game.currentPhase??game.phase,20);
  if(grant.expiresCycle!=null&&cycle>grant.expiresCycle)return false;
  const grantedCycle=grant.grantedCycle??cycle;
  if(grant.durationType==='UNTIL_END_OF_PHASE'&&(cycle>grantedCycle||cycle===grantedCycle&&grant.grantedPhase&&phase&&grant.grantedPhase!==phase))return false;
  if(grant.durationType==='UNTIL_END_OF_DAY'&&(cycle>grantedCycle||cycle===grantedCycle&&grant.grantedPhase==='Day'&&phase==='Night'))return false;
  if(['UNTIL_END_OF_NIGHT','UNTIL_END_OF_CYCLE'].includes(grant.durationType)&&cycle>grantedCycle)return false;
  return true;
}

function abilityIdsForRole(role,abilities){
  if(!role||String(role.roleType).toUpperCase()==='BASIC')return [];
  const ids=[role.activeAbilityId,role.passiveAbilityId].filter(Boolean),tags=new Set((role.tags||[]).map(key));
  for(const ability of abilities)if(tags.has(key(ability.name)))ids.push(ability.id);
  return [...new Set(ids)];
}

function warningLabels(statuses,playerId){
  const warningTypes=new Set(['ROLEBLOCK','MARK','POISON','DRUNK','SILENCED','ACTION_SUCCESS_GUARANTEE','ABILITY_AMPLIFY','ADDITIONAL_USES']);
  return statuses.filter(status=>String(status.playerId??status.player_id)===playerId&&String(status.state).toUpperCase()==='ACTIVE'&&warningTypes.has(String(status.statusType??status.status_type).toUpperCase())).map(status=>clean(status.statusName??status.status_name??status.statusType??status.status_type,120));
}

export function abilityTargeting(ability){
  const configured=record(ability?.understanding?.targeting??ability?.targeting),requested=clean(configured.type??ability?.targetType,40).toUpperCase(),normalized=normalizeTargeting(configured,{type:ability?.targetType});
  return {...normalized,legacy:!requested,selfAllowed:normalized.selfAllowed!==false,manuallyTriggerable:Boolean(normalized.manuallyTriggerable??ability?.manuallyTriggerable)};
}

function consumptionCount(events,playerId,abilityId){return events.filter(event=>String(event.actorPlayerId??event.actor_player_id)===playerId&&String(event.abilityId??event.ability_id)===abilityId&&String(event.eventType??event.event_type).toUpperCase()==='ABILITY_CONSUMED').length}

function statusUses(statuses,playerId,abilityId){return statuses.filter(status=>String(status.playerId??status.player_id)===playerId&&String(status.state).toUpperCase()==='ACTIVE'&&String(status.statusType??status.status_type).toUpperCase()==='ADDITIONAL_USES'&&String(status.metadata?.abilityId??status.metadata?.ability_id??'')===abilityId).reduce((sum,status)=>sum+Math.max(0,Number(status.remainingDuration??status.remaining_duration??status.stackCount??status.stack_count)||0),0)}

function amplifiedAbility(statuses,playerId,abilityId,abilities){
  const effect=statuses.find(status=>String(status.playerId??status.player_id)===playerId&&String(status.state).toUpperCase()==='ACTIVE'&&String(status.statusType??status.status_type).toUpperCase()==='ABILITY_AMPLIFY'&&(!status.metadata?.baseAbilityId||String(status.metadata.baseAbilityId)===abilityId));
  const effectiveId=clean(effect?.metadata?.effectiveAbilityId??effect?.metadata?.amplifiedAbilityId,120);return effectiveId?abilities.find(ability=>ability.id===effectiveId)||null:null;
}

function availability({ability,passive,usesRemaining,grant,game,cooldownUntil}){
  const reasons=[],phase=clean(game.currentPhase,20),abilityPhase=clean(ability.phase,30);
  if(passive&&!abilityTargeting(ability).manuallyTriggerable)reasons.push('PASSIVE');
  if(usesRemaining===0)reasons.push('NO_USES_REMAINING');
  if(abilityPhase&& !['Any','Passive'].includes(abilityPhase)&&phase&&abilityPhase!==phase)reasons.push('WRONG_PHASE');
  if(grant?.phaseRestrictions?.length&&phase&&!grant.phaseRestrictions.includes('Any')&&!grant.phaseRestrictions.includes(phase))reasons.push('GRANT_PHASE_RESTRICTION');
  if(cooldownUntil!=null&&Number(game.currentDay??0)<cooldownUntil)reasons.push('ON_COOLDOWN');
  return {available:reasons.length===0,reasons};
}

export function effectivePlayerAbilities({player,role,abilities=[],grants=[],statuses=[],resolutionEvents=[],roleModifiers=[],game={}}={}){
  if(!player)return {abilities:[],warnings:[]};const byId=new Map(abilities.map(ability=>[String(ability.id),ability])),result=[];
  for(const abilityId of abilityIdsForRole(role,abilities)){
    const ability=byId.get(String(abilityId));if(!ability)continue;const passive=String(role?.passiveAbilityId)===String(abilityId)||clean(ability.phase,30)==='Passive',baseUses=role?.abilityUses==null?null:Math.max(0,Number(role.abilityUses)||0),additional=statusUses(statuses,player.id,ability.id),consumed=consumptionCount(resolutionEvents,player.id,ability.id),usesRemaining=baseUses==null?null:Math.max(0,baseUses+additional-consumed),amplified=amplifiedAbility(statuses,player.id,ability.id,abilities),cooldownCycles=Math.max(0,Number(ability.cooldownCycles)||0),lastCycle=Math.max(-1,...resolutionEvents.filter(event=>String(event.actorPlayerId??event.actor_player_id)===player.id&&String(event.abilityId??event.ability_id)===ability.id&&String(event.eventType??event.event_type).toUpperCase()==='ABILITY_CONSUMED').map(event=>Number(event.cycle??event.resolutionCycle??-1))),cooldownUntil=cooldownCycles&&lastCycle>=0?lastCycle+cooldownCycles:null,availabilityState=availability({ability,passive,usesRemaining,game,cooldownUntil});
    const understanding=normalizeAbilityUnderstanding(amplified||ability),classification=classifyAbility(amplified||ability);result.push({key:'ROLE:'+ability.id,abilityId:ability.id,baseAbilityId:ability.id,effectiveAbilityId:amplified?.id||ability.id,name:ability.name,effectiveName:amplified?.name||ability.name,definition:ability.definition,category:ability.category||'Custom',phase:ability.phase||'Any',mechanics:ability.mechanics||[],understanding,...classification,targeting:abilityTargeting(amplified||ability),sourceType:'ROLE',sourceLabel:'Role',sourceReference:role?.id||'',grantId:null,grantVersion:null,passive,usesGranted:baseUses,usesRemaining,additionalUses:additional,cooldownUntil,modifiers:roleModifiers.filter(modifier=>String(modifier.role_id??modifier.roleId)===String(role?.id)&&String(modifier.ability_id??modifier.abilityId)===ability.id),...availabilityState});
  }
  for(const rawGrant of grants){const grant=normalizeAbilityGrant(rawGrant);if(grant.playerId!==player.id||!grantIsCurrent(grant,game))continue;const ability=byId.get(grant.abilityId);if(!ability)continue;const passive=clean(ability.phase,30)==='Passive',amplified=amplifiedAbility(statuses,player.id,ability.id,abilities),cooldownCycles=Math.max(0,Number(ability.cooldownCycles)||0),lastCycle=Math.max(-1,...resolutionEvents.filter(event=>String(event.actorPlayerId??event.actor_player_id)===player.id&&String(event.abilityId??event.ability_id)===ability.id&&String(event.eventType??event.event_type).toUpperCase()==='ABILITY_CONSUMED').map(event=>Number(event.cycle??event.resolutionCycle??-1))),cooldownUntil=cooldownCycles&&lastCycle>=0?lastCycle+cooldownCycles:null,availabilityState=availability({ability,passive,usesRemaining:grant.usesRemaining,grant,game,cooldownUntil}),understanding=normalizeAbilityUnderstanding(amplified||ability),classification=classifyAbility(amplified||ability);result.push({key:'GRANT:'+grant.id,abilityId:ability.id,baseAbilityId:ability.id,effectiveAbilityId:amplified?.id||ability.id,name:ability.name,effectiveName:amplified?.name||ability.name,definition:ability.definition,category:ability.category||'Custom',phase:ability.phase||'Any',mechanics:ability.mechanics||[],understanding,...classification,targeting:abilityTargeting(amplified||ability),sourceType:grant.sourceType,sourceLabel:grant.sourceType.replaceAll('_',' '),sourceReference:grant.sourceReference,grantId:grant.id,grantVersion:grant.version,passive,usesGranted:grant.usesGranted,usesRemaining:grant.usesRemaining,additionalUses:0,cooldownUntil,durationType:grant.durationType,grantedCycle:grant.grantedCycle,grantedPhase:grant.grantedPhase,expiresAt:grant.expiresAt,expiresCycle:grant.expiresCycle,expiresPhase:grant.expiresPhase,reason:grant.reason,modifiers:[],...availabilityState});}
  return {abilities:result.sort((a,b)=>a.passive-b.passive||a.category.localeCompare(b.category)||a.name.localeCompare(b.name)),warnings:warningLabels(statuses,player.id)};
}

export function validateActionTargets({actor,players=[],factions=[],roles=[],ability,targetIds=[],targetAbilityId='',targetFactionId='',customTarget=''}={}){
  const errors=[],targeting=ability?.targeting||{type:'ONE_PLAYER'},ids=[...new Set((targetIds||[]).filter(Boolean))],targets=ids.map(id=>players.find(player=>player.id===id)).filter(Boolean);
  if(targets.length!==ids.length)errors.push('TARGET_NOT_FOUND');
  if(['NO_TARGET','GLOBAL','FACTION','ABILITY','CUSTOM_TARGET','OTHER'].includes(targeting.type)&&ids.length)errors.push('TARGET_NOT_ALLOWED');
  if(targeting.type==='SELF'&&(ids.length!==1||ids[0]!==actor?.id))errors.push('SELF_TARGET_REQUIRED');
  if(['ONE_PLAYER','DEAD_PLAYER'].includes(targeting.type)&&ids.length!==1)errors.push('ONE_TARGET_REQUIRED');
  if(targeting.type==='MULTIPLE_PLAYERS'&&(ids.length<Math.max(1,targeting.minTargets||1)||ids.length>(targeting.maxTargets||1000)))errors.push('INVALID_TARGET_COUNT');
  if(targeting.type==='ABILITY'&&!targetAbilityId)errors.push('TARGET_ABILITY_REQUIRED');
  if(targeting.type==='FACTION'&&!factions.some(faction=>faction.id===targetFactionId))errors.push('TARGET_FACTION_REQUIRED');
  if(['CUSTOM_TARGET','OTHER'].includes(targeting.type)&&!clean(customTarget,1000))errors.push('CUSTOM_TARGET_REQUIRED');
  if(targeting.type==='DEAD_PLAYER'&&targets.some(target=>target.alive!==false))errors.push('DEAD_TARGET_REQUIRED');
  if(targeting.livingOnly&&targets.some(target=>target.alive===false))errors.push('LIVING_TARGET_REQUIRED');
  if(targeting.deadOnly&&targets.some(target=>target.alive!==false))errors.push('DEAD_TARGET_REQUIRED');
  if(targeting.selfProhibited&&ids.includes(actor?.id))errors.push('SELF_TARGET_PROHIBITED');
  if(targeting.selfAllowed===false&&ids.includes(actor?.id))errors.push('SELF_TARGET_PROHIBITED');
  const actorFaction=actor?.currentFactionId||actor?.factionId||'';
  const hardEligibility=targeting.selectionRuleType==='HARD_SELECTION_RESTRICTION'||targeting.legacy;
  if(hardEligibility&&targeting.factionMemberOnly&&targets.some(target=>(target.currentFactionId||target.factionId||'')!==actorFaction))errors.push('FACTION_MEMBER_TARGET_REQUIRED');
  if(hardEligibility&&targeting.nonFactionMemberOnly&&targets.some(target=>(target.currentFactionId||target.factionId||'')===actorFaction))errors.push('NON_FACTION_TARGET_REQUIRED');
  if(hardEligibility&&targeting.targetFactionRestrictions?.length&&targets.some(target=>{const targetFactionId=String(target.currentFactionId||target.factionId||''),targetFaction=factions.find(faction=>String(faction.id)===targetFactionId);return !targeting.targetFactionRestrictions.some(value=>[targetFactionId,targetFaction?.name].some(candidate=>key(candidate)===key(value)))}))errors.push('TARGET_FACTION_RESTRICTED');
  if(hardEligibility&&targeting.targetRoleRestrictions?.length&&targets.some(target=>{const targetRole=roles.find(role=>String(role.id)===String(target.roleId||''));return !targeting.targetRoleRestrictions.some(value=>[target.roleId,targetRole?.name].some(candidate=>key(candidate)===key(value)))}))errors.push('TARGET_ROLE_RESTRICTED');
  return [...new Set(errors)];
}

export function effectiveFactionAbilities({faction,players=[],abilities=[],statuses=[]}={}){
  if(!faction)return [];
  const eligiblePerformers=players.filter(player=>player.alive!==false&&String(player.currentFactionId||player.factionId||'')===String(faction.id)&&!statuses.some(status=>String(status.playerId??status.player_id)===String(player.id)&&String(status.state).toUpperCase()==='ACTIVE'&&['DEN_BLOCKED','FACTION_ACTION_BLOCKED'].includes(String(status.statusType??status.status_type).toUpperCase())));
  return abilities.map(ability=>({ability,understanding:normalizeAbilityUnderstanding(ability)})).filter(item=>item.understanding.factionAction&&(!item.understanding.sourceFactionIds.length||item.understanding.sourceFactionIds.includes(String(faction.id)))).map(({ability,understanding})=>({key:'FACTION:'+ability.id,abilityId:ability.id,baseAbilityId:ability.id,effectiveAbilityId:ability.id,name:ability.name,effectiveName:ability.name,definition:ability.definition,category:ability.category||'Custom',phase:ability.phase||'Any',mechanics:ability.mechanics||[],understanding,...classifyAbility(ability),targeting:abilityTargeting(ability),sourceType:'FACTION',sourceLabel:'Faction',sourceReference:faction.id,grantId:null,grantVersion:null,passive:false,usesGranted:null,usesRemaining:null,available:!understanding.performerRequired||eligiblePerformers.length>0,reasons:understanding.performerRequired&&!eligiblePerformers.length?['NO_ELIGIBLE_FACTION_PERFORMER']:[],eligiblePerformers}));
}

export function queueCompleteness(players=[],actions=[]){const expected=players.filter(player=>player.alive!==false),withActions=new Set(actions.map(action=>action.actorId||action.sourcePlayerId).filter(Boolean)),submitted=expected.filter(player=>withActions.has(player.id)),missing=expected.filter(player=>!withActions.has(player.id));return {players:expected.length,playersWithActions:submitted.length,playersWithoutActions:missing.length,missing};}

export function naturalNumber(text){const match=clean(text,1000).match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);if(!match)return 1;const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};return Number(match[1])||words[match[1].toLowerCase()]||1}
