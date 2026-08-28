export const GLOBAL_RESOLUTION_SCHEMA_VERSION=1;

export const GLOBAL_RESOLUTION_ORDER=Object.freeze([
  'BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC'
]);

export const GLOBAL_AUTHORITY_PRECEDENCE=Object.freeze([
  'CURRENT_GAME_RULE','ROLE_TEXT','CURRENT_GAME_PRECEDENT','GLOBAL_MASTER_ABILITY_ENCYCLOPEDIA','GLOBAL_PRECEDENT','GM_DECISION'
]);

export const PASSIVE_RESOLUTION_NOTE='PASSIVES — EVENT/TRIGGER BASED';
export const HEAL_RESOLUTION_NOTE='HEAL — DOC ABILITY / ANY-TIME RESOLUTION';

const clean=(value,limit=12000)=>String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
const key=value=>clean(value,500).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const slug=value=>key(value).replace(/\s+/g,'_');
const stableId=value=>value==='Bulletproof / Passive Immunity'?'bulletproof':slug(value);
const list=value=>Array.isArray(value)?value.filter(Boolean):[];
const priority=category=>GLOBAL_RESOLUTION_ORDER.indexOf(category)+1||null;

const entries=[
  ['Roleblock','Harmful','BLOCKS','Night','ACTIVE','Target one player and prevent applicable active abilities during the current cycle. Passives remain active unless an explicit role or game rule says otherwise.','block, player, active ability',['role block','stop a player from acting','prevent a player from acting']],
  ['Den Block','Harmful','BLOCKS','Night','ACTIVE','Target the entire Den faction and prevent applicable active abilities by Den members during the current cycle, including applicable faction-level Den actions. Passives remain active unless explicitly disabled.','block, faction, den, active ability',['block the den','denblock']],
  ['Villagers Block','Harmful','BLOCKS','Night','ACTIVE','Target the entire Villager faction and prevent applicable active abilities by Villager-aligned players during the current cycle. Passives remain active unless explicitly disabled.','block, faction, villager, active ability',['villager block','village block','block the villagers']],
  ['Action Success Guarantee','Support','GUARANTEE','Night','ACTIVE','Allows the selected action to execute despite an applicable block or other action-prevention effect. It does not guarantee that the effect defeats the target\'s defenses.','guarantee, action prevention, execute',['success guarantee','guarantee action']],
  ['Place Swap','Support','SWAPS','Night','ACTIVE','Swap two players for applicable action-targeting purposes. Actions aimed at either player land on the other; users, roles, factions, abilities, and ownership do not change.','swap, target, position',['position swap','swap places']],
  ['Role Swap','Support','SWAPS','Night','ACTIVE','Cause two players to act as each other\'s roles for the applicable resolution period. This is not a permanent role replacement, faction conversion, or permanent ability transfer. Undefined passive, faction, or immunity interactions require GM review.','swap, role, temporary',['swap roles']],
  ['Redirect','Support','REDIRECTS','Night','ACTIVE','Change the destination of an applicable targeted action without resolving the underlying ability. The transformed action waits for its natural category.','redirect, target, transformation',['redirect action']],
  ['Guard','Protection','REDIRECTS','Night','ACTIVE','Take an applicable incoming action or hit instead of the guarded player. Guard transfers the action; it does not cancel it.','guard, redirect, interception',['bodyguard','take the hit']],
  ['Drunk','Harmful','STATUS_EFFECTS','Night','ACTIVE','Apply Drunk after the entire Night resolves. It lasts from the end of Night resolution until the Hanging and restricts communication to emojis, GIFs, stickers, and reactions. It does not disable active abilities by default.','status, communication, delayed activation',['drunken']],
  ['Sober','Harmful','STATUS_EFFECTS','Night','ACTIVE','Apply Sober after the entire Night resolves. It lasts from the end of Night resolution until the Hanging and restricts communication to normal text only.','status, communication, delayed activation',[]],
  ['Steal','Harmful','STATUS_EFFECTS','Night','ACTIVE','Steal one available ability use. The original player loses that use and the thief gains it. Recurring or unlimited abilities transfer one usable instance by default, not permanent ownership.','status, ability, theft, uses',['steal ability','steal a use']],
  ['Poison','Harmful','STATUS_EFFECTS','Night','ACTIVE','Apply Poison. By global default it causes delayed death after two days unless Healed and may spread through applicable visits. The application is a status effect, not a Kill submission.','poison, status, delayed death, contagious',[]],
  ['Mark','Harmful','STATUS_EFFECTS','Night','ACTIVE','Apply a Mark. The Mark does not kill immediately; when its specified condition is met it may generate a later effect such as Personal Instant Kill, which waits for KILLS.','mark, status, generated effect',['mark target']],
  ['Ability Amplify','Support','STATUS_EFFECTS','Night','ACTIVE','Increase an ability\'s strength or effectiveness, such as Personal Instant Kill to Super Kill. Amplify changes strength, not use quantity.','status, strength, amplify',['amplify ability','upgrade ability']],
  ['Additional Uses','Support','STATUS_EFFECTS','Any','ACTIVE','Add one or more uses of an ability. Additional Uses changes quantity, not strength, and the added uses are tracked separately.','status, uses, quantity',['extra uses','additional use']],
  ['Protect','Protection','STATUS_EFFECTS','Night','ACTIVE','Apply normal protection against applicable normal harmful actions such as Personal Instant Kill. Protect does not stop Super Kill or Omega Kill unless explicitly modified.','protection, normal kill',['normal protect']],
  ['Super Protect','Protection','STATUS_EFFECTS','Night','ACTIVE','Apply enhanced protection against applicable normal kills, Super Kills, and Omega Kills unless an effect explicitly bypasses Super Protect.','protection, super kill, omega kill',['super protection']],
  ['Basic Ask','Investigation','INTEL','Night','ACTIVE','Learn a target\'s broad alignment category: Villager, Den, or Neutral, subject to explicit disguises, false results, immunities, or game rules.','investigation, broad alignment',['basic investigation']],
  ['Advanced Ask','Investigation','INTEL','Night','ACTIVE','Learn a target\'s exact role, subject to applicable false-result mechanics, disguises, immunities, or game rules.','investigation, exact role',['role investigation']],
  ['Alignment Ask','Investigation','INTEL','Night','ACTIVE','Learn a target\'s actual alignment or faction where appropriate. It can be more specific than Basic Ask.','investigation, faction, alignment',['alignment investigation']],
  ['Watch','Investigation','INTEL','Night','ACTIVE','Learn who visited the target during the applicable cycle. Watch means who came to the target.','investigation, visitors, incoming',['watcher']],
  ['Track','Investigation','INTEL','Night','ACTIVE','Learn whom the target visited during the applicable cycle. Track means where the target went and is not a synonym for Watch.','investigation, visits, outgoing',['tracker']],
  ['Action Check','Investigation','INTEL','Night','ACTIVE','Learn which abilities or actions were used on the target during the cycle. By default reveal the actions, not their users.','investigation, actions received',['check actions']],
  ['Gravedigger','Investigation','INTEL','Night','ACTIVE','Target a dead player and learn that player\'s role.','investigation, dead player, role',['grave digger']],
  ['Map','Investigation','INTEL','Night','ACTIVE','Reveal ability information or names still available among living players without revealing which player owns each ability unless explicitly stated.','investigation, global, ability inventory',['ability map']],
  ['Convert','Harmful','CONVERTS','Night','ACTIVE','Move a target to the converting faction before Kills. By default the target leaves the old faction and loses the old role and its abilities. Do not invent a replacement role or new abilities.','conversion, faction, role loss',['conversion']],
  ['Den Regular Kill','Harmful','KILLS','Night','ACTIVE','The standard collective Den faction action at Personal Instant Kill strength. Use game performer rules when defined; Den Block may prevent it unless Guarantee or an explicit exception applies.','kill, faction, den',['den kill','regular den kill']],
  ['Personal Instant Kill','Harmful','KILLS','Any','ACTIVE','A standard targeted kill that can be stopped or transformed by applicable Protect, Guard, Redirect, Reflection, Death Immunity, Bulletproof, or another relevant defense.','kill, normal strength',['instant kill','personal kill','regular kill']],
  ['Super Kill','Harmful','KILLS','Any','ACTIVE','A stronger targeted kill that bypasses normal Protect but may be stopped by Super Protect, Death Immunity, Bulletproof, or another valid high-level defense.','kill, super strength',['superkill']],
  ['Omega Kill','Harmful','KILLS','Any','ACTIVE','A Super Kill-strength action that affects the target and applicable visitors. Evaluate each affected player\'s defenses and immunities individually.','kill, omega, visitors',['omegakill']],
  ['Duel / Fight','Harmful','KILLS','Any','ACTIVE','Challenge a player to a fight to the death. Use the contest defined by role text, game rules, or GM-approved mechanics; do not invent a replacement contest.','kill, contest, duel',['duel','fight']],
  ['Save','Protection','DOC','Any','ACTIVE','React to an applicable impending lethal result and prevent that death. Preserve lethal outcomes as pending through KILLS until relevant Save interactions are evaluated in DOC.','rescue, pending death, reactive',['rescue']],
  ['Heal','Protection','DOC','Any','ACTIVE','Remove an applicable harmful status and cancel its pending consequence where appropriate, such as Poison and its death timer. Heal does not revive, protect against future attacks, or grant Protect. It may resolve at any valid time.','cleanse, status, any time',['cleanse']],
  ['Reflection','Protection','PASSIVES','Passive','PASSIVE','Mirror an applicable targeted action back to its original user. When a role defines Reflection as automatic, it is one passive trigger and is never duplicated as an active submission.','reflection, redirect, passive',['reflect','mirror']],
  ['Death Immunity','Protection','PASSIVES','Passive','PASSIVE','Automatically prevents death while applicable without preventing non-lethal effects. Only an explicit bypass defeats it.','passive, immunity, death',['death immune']],
  ['Counterattack','Protection','PASSIVES','Passive','PASSIVE','Automatically retaliate when the defined trigger occurs. If no other retaliation is defined, the default is Personal Instant Kill. It is a passive child effect, not a submitted attempt.','passive, retaliation, generated effect',['counter attack','retaliate']],
  ['Bulletproof / Passive Immunity','Protection','PASSIVES','Passive','PASSIVE','Automatic strong immunity against applicable targeted abilities, including Personal Instant Kill, Super Kill, and Omega Kill, unless an explicit mechanic bypasses it.','passive, immunity, bulletproof',['bulletproof','passive immunity']]
];

const targetFor=name=>{
  if(['Death Immunity','Counterattack','Bulletproof / Passive Immunity','Reflection'].includes(name))return {type:'NO_TARGET',selectionRuleType:'HARD_SELECTION_RESTRICTION'};
  if(name==='Map')return {type:'GLOBAL',selectionRuleType:'HARD_SELECTION_RESTRICTION'};
  if(name==='Gravedigger')return {type:'DEAD_PLAYER',selectionRuleType:'HARD_SELECTION_RESTRICTION',deadOnly:true,selfAllowed:false};
  if(['Place Swap','Role Swap'].includes(name))return {type:'MULTIPLE_PLAYERS',selectionRuleType:'HARD_SELECTION_RESTRICTION',minTargets:2,maxTargets:2,livingOnly:true};
  if(['Den Block','Villagers Block'].includes(name))return {type:'FACTION',selectionRuleType:'HARD_SELECTION_RESTRICTION'};
  return {type:'ONE_PLAYER',selectionRuleType:'SOFT_EFFECT_ELIGIBILITY',livingOnly:name!=='Heal',selfAllowed:true};
};

export const GLOBAL_ABILITY_DEFINITIONS=Object.freeze(entries.map(([name,category,resolutionCategory,phase,activePassive,definition,mechanics,aliases])=>Object.freeze({
  abilityId:stableId(name),name,category,resolutionCategory,resolutionPriority:resolutionCategory==='PASSIVES'?null:priority(resolutionCategory),resolutionTiming:name==='Heal'?'ANY_TIME':resolutionCategory==='PASSIVES'?'EVENT_TRIGGERED':'ORDERED_STAGE',phase,activePassive,definition,mechanics:mechanics.split(',').map(item=>item.trim()),aliases:Object.freeze(aliases),targeting:Object.freeze(targetFor(name)),globalDefault:true
})));

const byName=new Map(GLOBAL_ABILITY_DEFINITIONS.flatMap(ability=>[[key(ability.name),ability],...ability.aliases.map(alias=>[key(alias),ability])]));

export function globalAbilityDefinition(value){
  if(!value)return null;
  const direct=byName.get(key(typeof value==='string'?value:value.display_name||value.name||value.ability_id||value.standardAbilityId));
  if(direct)return direct;
  const source=key(typeof value==='string'?value:[value.name,value.definition,value.description,value.originalText].filter(Boolean).join(' '));
  const matches=GLOBAL_ABILITY_DEFINITIONS.filter(ability=>ability.aliases.some(alias=>source.includes(key(alias)))||source.includes(key(ability.name)));
  return matches.length===1?matches[0]:null;
}

export function classifyAbility(ability={},overrides={}){
  const standard=globalAbilityDefinition(ability),explicitCategory=clean(overrides.resolutionCategory??ability.resolutionCategory??ability.resolution_category,40).toUpperCase().replace(/[\s-]+/g,'_'),explicitTiming=clean(overrides.resolutionTiming??ability.resolutionTiming??ability.resolution_timing,40).toUpperCase().replace(/[\s-]+/g,'_'),activePassive=clean(overrides.activePassive??ability.activePassive??ability.active_passive??standard?.activePassive??(ability.phase==='Passive'?'PASSIVE':'ACTIVE'),20).toUpperCase()==='PASSIVE'?'PASSIVE':'ACTIVE',candidateCategory=GLOBAL_RESOLUTION_ORDER.includes(explicitCategory)||explicitCategory==='PASSIVES'?explicitCategory:standard?.resolutionCategory||'UNCLASSIFIED',category=activePassive==='PASSIVE'?'PASSIVES':candidateCategory;
  return {standardAbilityId:standard?.abilityId||clean(ability.standardAbilityId??ability.standard_ability_id,120),standardizedAbilityType:standard?.name||clean(ability.name??ability.display_name,200),resolutionCategory:category,resolutionPriority:category==='PASSIVES'?null:GLOBAL_RESOLUTION_ORDER.includes(category)?priority(category):null,resolutionTiming:category==='PASSIVES'?'EVENT_TRIGGERED':explicitTiming||standard?.resolutionTiming||'ORDERED_STAGE',activePassive,classificationSource:explicitCategory?'EXPLICIT_GAME_OR_ROLE_OVERRIDE':standard?'GLOBAL_MASTER_ABILITY_ENCYCLOPEDIA':'GM_CLASSIFICATION_REQUIRED',requiresGmClassification:category==='UNCLASSIFIED'};
}

export function createGlobalAbilityCatalog({idFactory=()=>globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)}={}){
  return GLOBAL_ABILITY_DEFINITIONS.map(definition=>({id:idFactory(),name:definition.name,defaultName:definition.name,category:definition.category,definition:definition.definition,phase:definition.phase,mechanics:[...definition.mechanics],resolutionCategory:definition.resolutionCategory,resolutionPriority:definition.resolutionPriority,resolutionTiming:definition.resolutionTiming,activePassive:definition.activePassive,standardAbilityId:definition.abilityId,targeting:{...definition.targeting},understanding:{targeting:{...definition.targeting},globalResolution:{category:definition.resolutionCategory,priority:definition.resolutionPriority,timing:definition.resolutionTiming,activePassive:definition.activePassive}},builtIn:true,revisions:[]}));
}

export function normalizeResolutionAction(input={},context={}){
  const classification=classifyAbility(context.ability||input,context.override||{}),originalTargetIds=[...new Set(list(input.originalTargetIds??input.original_target_ids??input.targetIds??input.target_ids).map(String))],effectiveTargetIds=[...new Set(list(input.effectiveTargetIds??input.effective_target_ids??input.currentTargetIds??input.final_target_ids??originalTargetIds).map(String))],generated=Boolean(input.generated??input.isGenerated??input.is_generated),actionId=clean(input.id??input.actionId??input.action_id,160);
  return {...input,id:actionId,actionId,abilityName:clean(input.abilityName??input.name??context.ability?.name,200),standardizedAbilityType:classification.standardizedAbilityType,resolutionCategory:classification.resolutionCategory,resolutionPriority:classification.resolutionPriority,resolutionTiming:classification.resolutionTiming,activePassive:classification.activePassive,classificationSource:classification.classificationSource,requiresGmClassification:classification.requiresGmClassification,actionUserId:clean(input.actionUserId??input.sourcePlayerId??input.actorId??input.actor_player_id,100),sourceFactionId:clean(input.sourceFactionId??input.source_faction_id,100),sourceRoleId:clean(input.sourceRoleId??input.roleId??input.role_id,100),sourceGameRule:clean(input.sourceGameRule??input.source_game_rule,500),globalRuleUsed:clean(input.globalRuleUsed??input.global_rule_used??(classification.classificationSource==='GLOBAL_MASTER_ABILITY_ENCYCLOPEDIA'?classification.standardAbilityId:''),500),gmOverride:input.gmOverride??input.gm_override??null,originalTargetIds,effectiveTargetIds,transformationHistory:list(input.transformationHistory??input.transformation_history).map(item=>({...item})),generated,parentActionId:clean(input.parentActionId??input.parent_action_id,160),submittedAttempt:input.submittedAttempt??input.submitted_attempt??!generated,status:clean(input.status||'QUEUED',40).toUpperCase(),result:clean(input.result||'PENDING',40).toUpperCase(),reason:clean(input.reason,4000),usesConsumed:Number(input.usesConsumed??input.uses_consumed??0)||0,usesRefunded:Number(input.usesRefunded??input.uses_refunded??0)||0};
}

export function classifyAndOrderActions(actions=[],abilityLookup=()=>null){
  const normalized=actions.map((action,index)=>({...normalizeResolutionAction(action,{ability:abilityLookup(action)}),submissionIndex:index})),passives=normalized.filter(action=>action.activePassive==='PASSIVE'||action.resolutionCategory==='PASSIVES'),ordered=normalized.filter(action=>!passives.includes(action)).sort((left,right)=>{
    const leftPriority=left.resolutionTiming==='ANY_TIME'&&Number.isInteger(Number(left.triggerPriority))?Number(left.triggerPriority):left.resolutionPriority??999,rightPriority=right.resolutionTiming==='ANY_TIME'&&Number.isInteger(Number(right.triggerPriority))?Number(right.triggerPriority):right.resolutionPriority??999;
    return leftPriority-rightPriority||left.submissionIndex-right.submissionIndex;
  });
  return {ordered,passives,unclassified:normalized.filter(action=>action.requiresGmClassification)};
}

export function transformAction(rawAction,{type,fromTargetIds,toTargetIds,byActionId='',reason=''}={}){
  const action=normalizeResolutionAction(rawAction),from=list(fromTargetIds).length?list(fromTargetIds).map(String):[...action.effectiveTargetIds],to=[...new Set(list(toTargetIds).map(String))];
  return {...action,effectiveTargetIds:to,transformationHistory:[...action.transformationHistory,{sequence:action.transformationHistory.length+1,type:clean(type||'TARGET_CHANGE',40).toUpperCase(),fromTargetIds:from,toTargetIds:to,byActionId:clean(byActionId,160),reason:clean(reason,1000)}]};
}

export function createGeneratedEffect(parent,effect={}){
  const source=normalizeResolutionAction(parent),child=normalizeResolutionAction({...effect,generated:true,submittedAttempt:false,parentActionId:source.actionId,originalTargetIds:effect.targetIds??effect.originalTargetIds??source.effectiveTargetIds,effectiveTargetIds:effect.targetIds??effect.effectiveTargetIds??source.effectiveTargetIds});
  return {...child,generationDepth:Number(parent.generationDepth||0)+1};
}

export function globalInteractionOutcome({action,defense='',blocked=false,guaranteed=false}={}){
  const ability=globalAbilityDefinition(action),attack=ability?.name||clean(action,200),guard=globalAbilityDefinition(defense)?.name||clean(defense,200);
  if(blocked&&!guaranteed)return {actionAllowed:false,effectSucceeded:false,reason:'Applicable action prevention blocked execution.'};
  if(['Personal Instant Kill','Super Kill','Omega Kill','Den Regular Kill'].includes(attack)){
    if(['Death Immunity','Bulletproof / Passive Immunity'].includes(guard))return {actionAllowed:true,effectSucceeded:false,reason:`${guard} prevented the death.`};
    if(guard==='Super Protect')return {actionAllowed:true,effectSucceeded:false,reason:'Super Protect stopped the applicable kill.'};
    if(guard==='Protect'&&['Personal Instant Kill','Den Regular Kill'].includes(attack))return {actionAllowed:true,effectSucceeded:false,reason:'Protect stopped the normal-strength kill.'};
    if(guard==='Protect')return {actionAllowed:true,effectSucceeded:true,reason:`${attack} bypassed normal Protect.`};
  }
  return {actionAllowed:true,effectSucceeded:true,reason:guaranteed&&blocked?'Guarantee allowed execution; target defenses remain applicable.':'No global prevention rule stopped the effect.'};
}

export function globalStatusTiming(statusName){
  const name=globalAbilityDefinition(statusName)?.name||clean(statusName,100);
  if(['Drunk','Sober'].includes(name))return {resolutionCategory:'STATUS_EFFECTS',activates:'AFTER_NIGHT_RESOLUTION',expires:'AFTER_HANGING'};
  if(name==='Poison')return {resolutionCategory:'STATUS_EFFECTS',activates:'ON_APPLICATION',delayedDeathAfterDays:2,healCancelsConsequence:true};
  if(name==='Heal')return {resolutionCategory:'DOC',resolutionTiming:'ANY_TIME'};
  return null;
}

export function globalResolutionProfile(){return {schemaVersion:GLOBAL_RESOLUTION_SCHEMA_VERSION,name:'Global Master Ability Resolution',resolutionOrder:[...GLOBAL_RESOLUTION_ORDER],passivePolicy:'EVENT_TRIGGERED',healTiming:'ANY_TIME',authorityPrecedence:[...GLOBAL_AUTHORITY_PRECEDENCE]};}
