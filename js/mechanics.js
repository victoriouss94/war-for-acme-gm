import {classifyAbility} from './global-abilities.js?v=11.7.2';

export const MECHANIC_SCHEMA_VERSION=2;

export const MECHANIC_TYPES=Object.freeze([
  'ACTIVE_ABILITY','PASSIVE','IMMUNITY','CONDITIONAL_IMMUNITY','TRIGGER','COUNTERATTACK','REFLECTION','REDIRECT','BLOCK','FACTION_BLOCK','STATUS_EFFECT','FACTION_EFFECT','GLOBAL_EFFECT','KILL_EFFECT','PROTECTION_EFFECT','CONVERSION_EFFECT','INVESTIGATION_EFFECT','SUPPORT_EFFECT','TARGET_RESTRICTION','EFFECT_ELIGIBILITY','PHASE_RESTRICTION','DURATION','USE_LIMIT','COOLDOWN','ABILITY_GRANT','ABILITY_MODIFIER','ADDITIONAL_USE','KILL_TIER_MODIFIER','PROTECTION_TIER_MODIFIER','DEATH_TRIGGER','REVIVAL','EXTRA_LIFE','FACTION_RULE','ROLE_RELATIONSHIP','DEPENDENCY','WIN_CONDITION','TRANSFORMATION','ESCALATION','ROLE_PROPERTY','FACTION_PROPERTY','CUSTOM_MECHANIC'
]);
export const INTERPRETATION_STATES=Object.freeze(['VERIFIED','HIGH_CONFIDENCE','PARTIALLY_UNDERSTOOD','NEEDS_REVIEW','UNRESOLVED']);
export const MECHANIC_ORIGINS=Object.freeze(['SOURCE_DOCUMENT','GM_MANUAL','GAME_RULE','GLOBAL_RULE','APPROVED_PRECEDENT','AI_INTERPRETATION_PENDING']);
export const TARGET_TYPES=Object.freeze(['ONE_PLAYER','MULTIPLE_PLAYERS','SELF','DEAD_PLAYER','ABILITY','FACTION','GLOBAL','NO_TARGET','CUSTOM_TARGET','OTHER']);
export const SELECTION_RULE_TYPES=Object.freeze(['HARD_SELECTION_RESTRICTION','SOFT_EFFECT_ELIGIBILITY','UNDEFINED']);
export const PASSIVE_BEHAVIORS=Object.freeze(['AUTOMATIC','OPTIONAL','NOT_APPLICABLE','UNDEFINED']);

const text=(value,limit=12000)=>String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
const list=(value,limit=100,itemLimit=2000)=>[...new Set((Array.isArray(value)?value:[]).slice(0,limit).map(item=>text(item,itemLimit)).filter(Boolean))];
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const nullableBoolean=value=>value===true?true:value===false?false:null;
const nullableNumber=(value,{minimum=0,maximum=100000}={})=>value===''||value==null||!Number.isFinite(Number(value))?null:Math.min(maximum,Math.max(minimum,Number(value)));
const key=value=>text(value,500).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const slug=value=>key(value).replace(/\s+/g,'_').slice(0,100);

function stableHash(value){
  let hash=2166136261;for(const character of String(value||'')){hash^=character.codePointAt(0);hash=Math.imul(hash,16777619)}return (hash>>>0).toString(36);
}

function enumValue(value,allowed,fallback){const normalized=text(value,80).toUpperCase().replace(/[\s-]+/g,'_');return allowed.includes(normalized)?normalized:fallback}

export function normalizeTargetType(value){
  const aliases={PLAYER:'ONE_PLAYER',MULTI_PLAYER:'MULTIPLE_PLAYERS',CUSTOM:'CUSTOM_TARGET'};
  const normalized=enumValue(value,[],String(value||'').toUpperCase().replace(/[\s-]+/g,'_'));
  return TARGET_TYPES.includes(aliases[normalized]||normalized)?aliases[normalized]||normalized:'ONE_PLAYER';
}

export function normalizeTargeting(input={},fallback={}){
  const source={...record(fallback),...record(input)},type=normalizeTargetType(source.type??source.targetType),selectionRuleType=enumValue(source.selectionRuleType??source.selection_rule_type,SELECTION_RULE_TYPES,'UNDEFINED');
  return {
    type,selectionRuleType,
    minTargets:Math.max(0,Number(source.minTargets??source.min_targets)||0),
    maxTargets:Math.max(1,Number(source.maxTargets??source.max_targets)||1),
    selectionRules:list(source.selectionRules??source.selection_rules),
    effectEligibilityRules:list(source.effectEligibilityRules??source.effect_eligibility_rules),
    targetFactionRestrictions:list(source.targetFactionRestrictions??source.target_faction_restrictions,100,500),
    targetRoleRestrictions:list(source.targetRoleRestrictions??source.target_role_restrictions,100,500),
    livingOnly:Boolean(source.livingOnly??source.living_target_required),deadOnly:Boolean(source.deadOnly??source.dead_target_required),
    selfAllowed:nullableBoolean(source.selfAllowed??source.self_target_allowed),selfProhibited:Boolean(source.selfProhibited),
    factionMemberOnly:Boolean(source.factionMemberOnly),nonFactionMemberOnly:Boolean(source.nonFactionMemberOnly),
    hiddenInformationSafe:source.hiddenInformationSafe!==false,manuallyTriggerable:Boolean(source.manuallyTriggerable)
  };
}

function componentConfidence(value){
  const result={},entries=Array.isArray(value)?value.map(item=>[item?.component,item?.confidence]):Object.entries(record(value));for(const [component,level] of entries){const normalized=String(level||'').toUpperCase();if(component&&['HIGH','MEDIUM','LOW','UNKNOWN'].includes(normalized))result[text(component,100)]=normalized}return result;
}

export function normalizeMechanic(input={},context={}){
  const source=record(input),originalText=text(source.originalText??source.original_text??source.sourceText??source.source_text,12000),summary=text(source.summary??source.effect??source.customEffect??source.custom_effect,8000),type=enumValue(source.type??source.mechanicType??source.mechanic_type,MECHANIC_TYPES,'CUSTOM_MECHANIC'),state=enumValue(source.interpretationState??source.interpretation_state,INTERPRETATION_STATES,'NEEDS_REVIEW'),origin=enumValue(source.origin,MECHANIC_ORIGINS,'AI_INTERPRETATION_PENDING'),confidence=nullableNumber(source.confidence,{minimum:0,maximum:1})??0;
  const id=text(source.id??source.mechanicId??source.mechanic_id,160)||[context.roleId||context.abilityId||'mechanic',slug(type),stableHash([originalText,summary,context.sourceLocation,context.index].join('|'))].join(':');
  const unresolvedComponents=list(source.unresolvedComponents??source.unresolved_components,100,500),possibleInterpretations=list(source.possibleInterpretations??source.possible_interpretations,20,2000),passiveBehavior=enumValue(source.passiveBehavior??source.passive_behavior,PASSIVE_BEHAVIORS,type==='PASSIVE'?'UNDEFINED':'NOT_APPLICABLE');
  const targeting=normalizeTargeting(source.targeting||source,context.targeting||{}),automatic=passiveBehavior==='AUTOMATIC',optional=passiveBehavior==='OPTIONAL';
  const result={
    id,type,name:text(source.name,200),summary,originalText,sourceRoleId:text(source.sourceRoleId??source.source_role_id??context.roleId,160),sourceRoleName:text(source.sourceRoleName??source.source_role_name??context.roleName,200),sourceAbilityId:text(source.sourceAbilityId??source.source_ability_id??context.abilityId,160),sourceAbilityName:text(source.sourceAbilityName??source.source_ability_name??context.abilityName,200),
    baseStandardAbilityId:text(source.baseStandardAbilityId??source.base_standard_ability_id,160),baseStandardAbilityName:text(source.baseStandardAbilityName??source.base_standard_ability_name,200),customEffect:text(source.customEffect??source.custom_effect,8000),targeting,
    phaseRestrictions:list(source.phaseRestrictions??source.phase_restrictions,50,100),cycleRestrictions:list(source.cycleRestrictions??source.cycle_restrictions,50,500),uses:nullableNumber(source.uses),triggerLimit:nullableNumber(source.triggerLimit??source.trigger_limit),cooldown:text(source.cooldown,500),duration:text(source.duration,1000),conditions:list(source.conditions,100,2000),triggers:list(source.triggers,100,2000),dependencies:list(source.dependencies,100,2000),effects:list(source.effects,100,2000),statusApplied:text(source.statusApplied??source.status_applied,200),killTier:text(source.killTier??source.kill_tier,100),protectionTier:text(source.protectionTier??source.protection_tier,100),bypasses:list(source.bypasses,100,500),exceptions:list(source.exceptions,100,2000),interactionRules:list(source.interactionRules??source.interaction_rules,100,2000),roleSpecificModifiers:list(source.roleSpecificModifiers??source.role_specific_modifiers,100,2000),gameSpecificModifiers:list(source.gameSpecificModifiers??source.game_specific_modifiers,100,2000),passiveBehavior,automatic,optional,consumesUseOnFailure:nullableBoolean(source.consumesUseOnFailure??source.consumes_use_on_failure),factionAction:Boolean(source.factionAction??source.faction_action),blocksFactionActions:nullableBoolean(source.blocksFactionActions??source.blocks_faction_actions),disablesPassives:nullableBoolean(source.disablesPassives??source.disables_passives),affectedPlayerCount:nullableNumber(source.affectedPlayerCount??source.affected_player_count),
    interpretationState:state,confidence,componentConfidence:componentConfidence(source.componentConfidence??source.component_confidence),unresolvedComponents,possibleInterpretations,origin,sourceDocumentId:text(source.sourceDocumentId??source.source_document_id??context.sourceDocumentId,160),sourceVersion:text(source.sourceVersion??source.source_version??context.sourceVersion,160),sourceLocation:text(source.sourceLocation??source.source_location??context.sourceLocation,500)
  };
  result.requiresReview=Boolean(source.requiresReview??source.requires_review)||['NEEDS_REVIEW','UNRESOLVED','PARTIALLY_UNDERSTOOD'].includes(state)||unresolvedComponents.length>0||confidence<.75;
  return result;
}

export function normalizeMechanicList(value,context={}){
  return (Array.isArray(value)?value:[]).slice(0,1000).map((item,index)=>normalizeMechanic(item,{...context,index})).filter(item=>item.originalText||item.summary||item.name);
}

export function normalizeAbilityUnderstanding(ability={}){
  const raw=record(ability.understanding??ability.mechanicUnderstanding??ability.mechanic_understanding),mechanics=normalizeMechanicList(raw.mechanics??ability.mechanicalStatements??ability.mechanical_statements,{abilityId:ability.id,abilityName:ability.name,sourceLocation:ability.sourceLocation});
  const targeting=normalizeTargeting(raw.targeting??ability.targeting,mechanics.find(item=>item.targeting)?.targeting||{}),baseStandardAbilityId=text(raw.baseStandardAbilityId??raw.base_standard_ability_id??ability.baseStandardAbilityId??ability.standardAbilityId,160),customIdentity=Boolean(raw.customIdentity??raw.custom_identity??(ability.mapping==='CUSTOM'&&baseStandardAbilityId));
  const globalResolution=classifyAbility({...ability,...record(raw.globalResolution??raw.global_resolution)});
  return {schemaVersion:MECHANIC_SCHEMA_VERSION,mechanics,targeting,baseStandardAbilityId:baseStandardAbilityId||globalResolution.standardAbilityId,baseStandardAbilityName:text(raw.baseStandardAbilityName??raw.base_standard_ability_name,200)||globalResolution.standardizedAbilityType,customIdentity,factionAction:Boolean(raw.factionAction??raw.faction_action??mechanics.some(item=>item.factionAction||['FACTION_BLOCK','FACTION_EFFECT'].includes(item.type))),globalAction:Boolean(raw.globalAction??raw.global_action??mechanics.some(item=>item.type==='GLOBAL_EFFECT'||item.targeting.type==='GLOBAL')),performerRequired:Boolean(raw.performerRequired??raw.performer_required),sourceFactionIds:list(raw.sourceFactionIds??raw.source_faction_ids,100,160),unresolvedComponents:list(raw.unresolvedComponents??raw.unresolved_components,100,500),sourceVersion:text(raw.sourceVersion??raw.source_version??ability.sourceVersion,160),globalResolution};
}

export function normalizeRoleUnderstanding(role={}){
  const raw=record(role.understanding??role.mechanicUnderstanding??role.mechanic_understanding),mechanics=normalizeMechanicList(raw.mechanics??role.mechanicalStatements??role.mechanical_statements,{roleId:role.id,roleName:role.name,sourceDocumentId:role.sourceImportId,sourceVersion:role.sourceVersion,sourceLocation:role.sourceLocation});
  return {schemaVersion:MECHANIC_SCHEMA_VERSION,mechanics,activeAbilities:mechanics.filter(item=>item.type==='ACTIVE_ABILITY'),passives:mechanics.filter(item=>item.type==='PASSIVE'),immunities:mechanics.filter(item=>['IMMUNITY','CONDITIONAL_IMMUNITY'].includes(item.type)),triggers:mechanics.filter(item=>['TRIGGER','DEATH_TRIGGER'].includes(item.type)),factionEffects:mechanics.filter(item=>['FACTION_BLOCK','FACTION_EFFECT','FACTION_RULE'].includes(item.type)),globalEffects:mechanics.filter(item=>item.type==='GLOBAL_EFFECT'),unresolvedComponents:list(raw.unresolvedComponents??raw.unresolved_components,100,500),sourceVersion:text(raw.sourceVersion??raw.source_version??role.sourceVersion,160)};
}

function reviewItem({game={},role=null,ability=null,mechanic=null,code='',message='',current=null,proposed=null}){
  const type=mechanic?.type||code||'UNRESOLVED';return {id:mechanic?.id||[game.id||'game',role?.id||ability?.id||'record',slug(type),stableHash(message)].join(':'),gameId:game.id||'',gameName:game.name||'',roleId:role?.id||'',roleName:role?.name||'',abilityId:ability?.id||mechanic?.sourceAbilityId||'',abilityName:ability?.name||mechanic?.sourceAbilityName||'',mechanicType:type,confidence:mechanic?.confidence??0,interpretationState:mechanic?.interpretationState||'NEEDS_REVIEW',originalText:mechanic?.originalText||role?.sourceText||ability?.definition||'',parsedUnderstanding:mechanic?.summary||message,knownComponents:mechanic?[mechanic.type,...mechanic.effects,...mechanic.conditions].filter(Boolean):[],unknownComponents:mechanic?.unresolvedComponents||[],possibleInterpretations:mechanic?.possibleInterpretations||[],source:mechanic?.sourceLocation||role?.sourceLocation||ability?.sourceLocation||'',origin:mechanic?.origin||'AI_INTERPRETATION_PENDING',code,current,proposed};
}

export function mechanicsReviewQueue({game={},roles=[],abilities=[]}={}){
  const reviews=[],abilityById=new Map(abilities.map(item=>[String(item.id),item]));
  for(const role of roles){const understanding=normalizeRoleUnderstanding(role);for(const mechanic of understanding.mechanics)if(mechanic.requiresReview)reviews.push(reviewItem({game,role,ability:abilityById.get(mechanic.sourceAbilityId),mechanic,current:mechanic,proposed:null}));
    const source=text(role.sourceText,12000),owned=[role.activeAbilityId,role.passiveAbilityId,...(role.tags||[])].filter(Boolean);if(source.length>300&&owned.length<=1&&/\b(if|when|unless|only|except|all|entire|until|after|before)\b/i.test(source)&&!understanding.mechanics.length)reviews.push(reviewItem({game,role,code:'SOURCE_STRUCTURE_MISSING',message:'The source contains conditional or scoped language but no structured mechanical statements.',current:understanding,proposed:null}));
    if(role.passiveAbilityId&&source.length>120&&!/\b(passive|automatically|whenever|when targeted|cannot be|immune|first time|upon death|after death)\b/i.test(source)&&!understanding.passives.length)reviews.push(reviewItem({game,role,ability:abilityById.get(role.passiveAbilityId),code:'POSSIBLY_INVENTED_PASSIVE',message:'A stored passive is not supported by the preserved role source text. Preserve it until a GM reviews its origin.',current:understanding,proposed:null}));
  }
  for(const ability of abilities){const understanding=normalizeAbilityUnderstanding(ability);for(const mechanic of understanding.mechanics)if(mechanic.requiresReview&&!reviews.some(item=>item.id===mechanic.id))reviews.push(reviewItem({game,ability,mechanic,current:mechanic,proposed:null}));}
  return reviews;
}

export function abilityUsageStatistics({actions=[],events=[],abilityId='',playerId=''}={}){
  const relevantActions=(Array.isArray(actions)?actions:[]).filter(action=>(!abilityId||String(action.abilityId??action.ability_id)===String(abilityId))&&(!playerId||String(action.sourcePlayerId??action.actorId??action.actor_player_id)===String(playerId))),byId=new Map(relevantActions.map(action=>[String(action.id),action])),matchedEvents=(Array.isArray(events)?events:[]).filter(event=>(!abilityId||String(event.abilityId??event.ability_id)===String(abilityId))&&(!playerId||String(event.actorPlayerId??event.actor_player_id)===String(playerId)));for(const event of matchedEvents){const id=String(event.actionId??event.action_id??event.outcome?.action_id??'');if(id&&!byId.has(id))byId.set(id,{id,abilityId:event.abilityId??event.ability_id,sourcePlayerId:event.actorPlayerId??event.actor_player_id})}
  const outcomeFor=(type)=>new Set(matchedEvents.filter(event=>String(event.eventType??event.event_type).toUpperCase()===type).map(event=>String(event.actionId??event.action_id??event.outcome?.action_id??'')).filter(Boolean)).size;
  const passive=matchedEvents.filter(event=>String(event.eventType??event.event_type).toUpperCase()==='PASSIVE_TRIGGER');
  const affected=new Set(matchedEvents.flatMap(event=>list(event.affectedPlayerIds??event.affected_player_ids??event.outcome?.affected_player_ids,1000,160)));
  return {attempts:byId.size,successful:outcomeFor('SUCCESS'),failed:outcomeFor('FAILURE'),blocked:outcomeFor('BLOCK'),ineligible:outcomeFor('INELIGIBLE_EFFECT'),redirected:outcomeFor('REDIRECT'),reflected:outcomeFor('REFLECT'),cancelled:outcomeFor('CANCELLED'),usesConsumed:outcomeFor('ABILITY_CONSUMED'),usesRefunded:outcomeFor('USE_REFUNDED'),passiveTriggers:passive.length,passiveSuccessful:passive.filter(event=>!['FAILURE','PREVENTED'].includes(String(event.outcome?.result??event.result).toUpperCase())).length,passivePrevented:matchedEvents.filter(event=>String(event.eventType??event.event_type).toUpperCase()==='PASSIVE_PREVENTED').length,affectedPlayers:affected.size};
}
