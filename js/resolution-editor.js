const RESULTS=new Set(['SUCCESS','FAILURE','BLOCKED','CANCELLED','INELIGIBLE_EFFECT']);
const USE_RESULTS=new Set(['CONSUMED','REFUNDED','NOT_CONSUMED','NOT_APPLICABLE']);
const LIFE_STATES=new Set(['UNCHANGED','ALIVE','DEAD','REVIVED']);
const PASSIVE_RESULTS=new Set(['SUCCESS','FAILURE','PREVENTED','NOT_TRIGGERED']);
const CONFIDENCE=new Set(['HIGH','MEDIUM','LOW']);
const text=(value,limit=12000)=>String(value??'').trim().slice(0,limit);
const array=(value,limit=1000)=>Array.isArray(value)?value.slice(0,limit):[];
const strings=(value,limit=1000)=>[...new Set(array(value,limit).map(item=>text(item,160)).filter(Boolean))];
const integer=(value,min=0,max=100000)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Math.trunc(Number(value)):min));
const upper=(value,fallback,allowed)=>allowed.has(String(value||'').toUpperCase())?String(value).toUpperCase():fallback;
const sourceType=value=>{
  const normalized=String(value||'ROLE').toUpperCase();
  if(normalized==='PLAYER')return 'ROLE';
  if(normalized==='MINI_GAME_REWARD')return 'MINIGAME_REWARD';
  if(normalized==='TEMPORARY')return 'TEMPORARY_GRANT';
  if(normalized==='GRANTED')return 'PERMANENT_GRANT';
  return normalized||'ROLE';
};
const grantSource=value=>{const normalized=String(value||'GM_GRANT').toUpperCase(),mapped=normalized==='TEMPORARY'?'TEMPORARY_GRANT':normalized==='GRANTED'?'PERMANENT_GRANT':normalized==='MINI_GAME_REWARD'?'MINIGAME_REWARD':normalized;return new Set(['ROLE','FACTION','GM_GRANT','TEMPORARY_GRANT','PERMANENT_GRANT','MINIGAME_REWARD','EVENT_REWARD','STOLEN','COPIED','STATUS_EFFECT','ITEM','SPECIAL_MECHANIC','OTHER']).has(mapped)?mapped:'GM_GRANT'};
const actionActor=action=>text(action?.sourcePlayerId||action?.actorId,100);
const actionAbility=action=>text(action?.abilityId||action?.baseAbilityId,120);
const actionTargets=action=>strings(action?.targetIds||[action?.targetId].filter(Boolean));
const eventFor=(events,actionId,types)=>events.find(event=>text(event?.action_id||event?.actionId,160)===actionId&&types.includes(String(event?.event_type||'').toUpperCase()));

const displayName=(item={})=>text(item.displayName||item.display_name||item.playerName||item.player_name||item.factionName||item.faction_name||item.roleName||item.role_name||item.abilityName||item.ability_name||item.statusName||item.status_name||item.title||item.name,300);
const entityId=(item={})=>text(item.id||item.player_id||item.playerId||item.faction_id||item.factionId||item.role_id||item.roleId||item.ability_id||item.abilityId||item.status_id||item.statusId||item.action_id||item.actionId,200);
const regexEscape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export function resolutionDisplayLookup({players=[],factions=[],roles=[],abilities=[],statuses=[],actions=[]}={}){
  const collections={player:array(players),faction:array(factions),role:array(roles),ability:array(abilities),status:array(statuses),action:array(actions)},byType={},all=new Map();
  for(const [type,items] of Object.entries(collections)){
    const map=new Map();
    for(const item of items){const id=entityId(item),name=displayName(item);if(!id||!name)continue;map.set(id,name);all.set(id,name)}
    byType[type]=map;
  }
  return {byType,all,players:array(players),factions:array(factions)};
}

export function resolutionEntityName(lookup,id,type='entity'){
  const value=text(id,200),fallback={player:'Unknown player',faction:'Unknown faction',role:'Unknown role',ability:'Unknown ability',status:'Unknown status',action:'Unknown action'}[type]||'Unknown record';
  return lookup?.byType?.[type]?.get(value)||lookup?.all?.get(value)||fallback;
}

export function humanizeResolutionText(value,lookup){
  let readable=String(value??'');
  const entries=[...(lookup?.all||new Map()).entries()].sort((left,right)=>right[0].length-left[0].length);
  for(const [id,name] of entries){
    if(!id||id===name)continue;
    const expression=new RegExp(`(^|[^A-Za-z0-9_-])${regexEscape(id)}(?=$|[^A-Za-z0-9_-])`,'g');
    readable=readable.replace(expression,(_match,prefix)=>prefix+name);
  }
  return readable.replace(/\bUNCHANGED\b/gi,'no change').replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,'Internal record');
}

export function playerOutcomeDisplayRows(outcomes=[],lookup){
  return array(outcomes).map(outcome=>{
    const playerId=text(outcome?.player_id||outcome?.playerId,200),player=lookup?.players?.find(item=>entityId(item)===playerId)||{},finalFactionId=text(outcome?.faction_id||outcome?.factionId||player.currentFactionId||player.current_faction_id||player.factionId||player.faction_id,200);
    return `${resolutionEntityName(lookup,playerId,'player')} — ${resolutionEntityName(lookup,finalFactionId,'faction')}`;
  });
}

export function normalizeActionResult(input={},action={},index=0,events=[]){
  const normalizedAction=normalizeResolutionAction(action),actionId=text(input.action_id||input.actionId||action.id,160),primary=eventFor(events,actionId,['SUCCESS','FAILURE','BLOCK','INELIGIBLE_EFFECT','CANCELLED']),redirect=eventFor(events,actionId,['REDIRECT']),reflection=eventFor(events,actionId,['REFLECT']),consumed=eventFor(events,actionId,['ABILITY_CONSUMED']),refunded=eventFor(events,actionId,['USE_REFUNDED']);
  const result=upper(input.result||primary?.result||primary?.event_type?.replace('BLOCK','BLOCKED'),'PENDING',new Set([...RESULTS,'PENDING'])),activePassive=text(input.active_passive||normalizedAction.activePassive,20).toUpperCase()==='PASSIVE'?'PASSIVE':'ACTIVE',candidateCategory=text(input.resolution_category||normalizedAction.resolutionCategory,40).toUpperCase().replace(/[\s-]+/g,'_'),resolutionCategory=activePassive==='PASSIVE'?'PASSIVES':candidateCategory,resolutionPriority=GLOBAL_RESOLUTION_ORDER.includes(resolutionCategory)?GLOBAL_RESOLUTION_ORDER.indexOf(resolutionCategory)+1:null,resolutionTiming=resolutionCategory==='PASSIVES'?'EVENT_TRIGGERED':text(input.resolution_timing||normalizedAction.resolutionTiming||'ORDERED_STAGE',40).toUpperCase().replace(/[\s-]+/g,'_');
  return {
    action_id:actionId,order:integer(input.order??index+1,1,10000),actor_player_id:text(input.actor_player_id||actionActor(action),100),ability_id:text(input.ability_id||actionAbility(action),120),ability_name:text(input.ability_name||action.name,200),standardized_ability_type:text(input.standardized_ability_type||normalizedAction.standardizedAbilityType,200),resolution_category:resolutionCategory,resolution_priority:resolutionPriority,resolution_timing:resolutionTiming,active_passive:activePassive,ability_source:sourceType(input.ability_source||action.abilitySource||action.sourceType),source_type:sourceType(input.source_type||action.abilitySource||action.sourceType),source_faction_id:text(input.source_faction_id||action.sourceFactionId,100),role_id:text(input.role_id||action.roleId||action.sourceRoleId,100),role_version:integer(input.role_version||action.roleVersion||1,1,100000),source_game_rule:text(input.source_game_rule||normalizedAction.sourceGameRule,500),global_rule_used:text(input.global_rule_used||normalizedAction.globalRuleUsed,500),gm_override:input.gm_override??normalizedAction.gmOverride??null,original_target_ids:strings(input.original_target_ids||normalizedAction.originalTargetIds||actionTargets(action)),final_target_ids:strings(input.final_target_ids||input.affected_player_ids||primary?.affected_player_ids||redirect?.affected_player_ids||normalizedAction.effectiveTargetIds||actionTargets(action)),affected_player_ids:strings(input.affected_player_ids||primary?.affected_player_ids||normalizedAction.effectiveTargetIds||actionTargets(action)),transformation_history:array(input.transformation_history||normalizedAction.transformationHistory).slice(0,100).map(item=>({...item})),generated:Boolean(input.generated??normalizedAction.generated),parent_action_id:text(input.parent_action_id||normalizedAction.parentActionId,160),submitted_attempt:input.submitted_attempt??normalizedAction.submittedAttempt,generated_child_effects:array(input.generated_child_effects).slice(0,100).map(item=>({...item})),passive_triggers:array(input.passive_triggers).slice(0,100).map(item=>({...item})),result,reason:text(input.reason||primary?.summary,4000),attempted:input.attempted!==false,redirected:Boolean(input.redirected||redirect),reflected:Boolean(input.reflected||reflection),protected:Boolean(input.protected),immune:Boolean(input.immune),faction_action:Boolean(input.faction_action||String(action.sourceType||'').toUpperCase()==='FACTION'),use_disposition:upper(input.use_disposition||(consumed?'CONSUMED':refunded?'REFUNDED':action.playerAbilityGrantId?'NOT_CONSUMED':'NOT_APPLICABLE'),'NOT_APPLICABLE',USE_RESULTS),player_ability_grant_id:text(input.player_ability_grant_id||action.playerAbilityGrantId,100),cooldown:text(input.cooldown,200)
  };
}

export function normalizePassiveResult(input={}){
  const triggered=Boolean(input.triggered);
  return {id:text(input.id||crypto?.randomUUID?.()||Math.random(),160),source_action_id:text(input.source_action_id||input.action_id,160),player_id:text(input.player_id||input.actor_player_id,100),ability_id:text(input.ability_id,120),ability_name:text(input.ability_name,200),role_id:text(input.role_id,100),role_version:integer(input.role_version||1,1,100000),triggered,result:upper(input.result,triggered?'SUCCESS':'NOT_TRIGGERED',PASSIVE_RESULTS),target_ids:strings(input.target_ids||input.affected_player_ids),affected_player_ids:strings(input.affected_player_ids||input.target_ids),uses_consumed:integer(input.uses_consumed),uses_refunded:integer(input.uses_refunded),trigger_count:integer(input.trigger_count,triggered?1:0,1000),duration:text(input.duration,200),effect:text(input.effect||input.summary,4000),reason:text(input.reason,4000)};
}

export function normalizeStatusEffect(input={}){
  return {id:text(input.id||crypto?.randomUUID?.()||Math.random(),160),operation:String(input.operation||'APPLY').toUpperCase()==='REMOVE'?'REMOVE':'APPLY',status_id:text(input.status_id,100),player_id:text(input.player_id,100),status_type:text(input.status_type||input.type,64).toUpperCase().replace(/[^A-Z0-9_]/g,'_'),status_name:text(input.status_name||input.name||input.status_type||input.type,120),status_category:text(input.status_category||input.category||'TEMPORARY',40).toUpperCase(),state:text(input.state||'ACTIVE',40).toUpperCase(),source_player_id:text(input.source_player_id,100),source_role_id:text(input.source_role_id,100),source_ability_id:text(input.source_ability_id,120),description:text(input.description,4000),duration:text(input.duration,200),expires_at_cycle:input.expires_at_cycle==null?'':integer(input.expires_at_cycle,0,9999),expires_at_phase:text(input.expires_at_phase,40),remaining_duration:input.remaining_duration==null?'':integer(input.remaining_duration,0,9999),visibility:text(input.visibility||'GM_ONLY',40).toUpperCase(),reason:text(input.reason,2000)};
}

export function normalizePlayerOutcome(input={},player={}){
  return {player_id:text(input.player_id||player.id,100),life_state:upper(input.life_state,'UNCHANGED',LIFE_STATES),role_id:text(input.role_id||player.roleId,100),faction_id:text(input.faction_id||player.currentFactionId,100),summary:text(input.summary,2000)};
}

export function buildResolutionDraft({proposal={},actions=[],players=[]}={}){
  const resolution=proposal&&typeof proposal==='object'?proposal:{},events=array(resolution.events),providedActions=array(resolution.action_results),providedPassives=array(resolution.passive_results),providedPlayers=array(resolution.player_outcomes),classified=classifyAndOrderActions(actions),orderedActions=[...classified.ordered,...classified.passives],involved=new Set([...actions.flatMap(action=>[actionActor(action),...actionTargets(action)]),...providedPlayers.map(item=>text(item.player_id,100))].filter(Boolean));
  const actionResults=orderedActions.map((action,index)=>normalizeActionResult(providedActions.find(item=>text(item.action_id||item.actionId,160)===text(action.id,160))||{},action,index,events));
  const legacyPassives=events.filter(event=>['PASSIVE_TRIGGER','PASSIVE_PREVENTED'].includes(String(event.event_type||'').toUpperCase())).map(event=>({...event,triggered:true,result:event.event_type==='PASSIVE_PREVENTED'?'PREVENTED':event.result}));
  const defaultOrder=GLOBAL_RESOLUTION_ORDER.map(category=>category.replaceAll('_',' ')),providedOrder=array(resolution.resolution_order).length?resolution.resolution_order:array(resolution.proposed_order).length?resolution.proposed_order:defaultOrder;return {schema_version:2,title:text(resolution.title,200),summary:text(resolution.summary,4000),resolution_order:strings(providedOrder),action_results:actionResults,passive_results:(providedPassives.length?providedPassives:legacyPassives).map(normalizePassiveResult),status_effects:array(resolution.status_effects).map(normalizeStatusEffect),player_outcomes:players.filter(player=>involved.has(String(player.id))).map(player=>normalizePlayerOutcome(providedPlayers.find(item=>String(item.player_id)===String(player.id))||{},player)),faction_results:array(resolution.faction_results).map(item=>({faction_id:text(item.faction_id,100),ability_id:text(item.ability_id,120),performer_player_id:text(item.performer_player_id,100),result:upper(item.result,'FAILURE',RESULTS),affected_player_ids:strings(item.affected_player_ids),summary:text(item.summary,4000)})),grant_effects:array(resolution.grant_effects).slice(0,100).map(item=>({operation:['GRANT','REVOKE','SET_USES'].includes(String(item.operation).toUpperCase())?String(item.operation).toUpperCase():'GRANT',grant_id:text(item.grant_id,100),grant_version:integer(item.grant_version,0,100000),player_id:text(item.player_id,100),ability_id:text(item.ability_id,120),source_type:grantSource(item.source_type),source_reference:text(item.source_reference,200),uses:integer(item.uses,0,100000),duration_type:text(item.duration_type||'UNTIL_REMOVED',80).toUpperCase(),expires_at:text(item.expires_at,80),expires_cycle:integer(item.expires_cycle,0,9999),expires_phase:text(item.expires_phase,40),phase_restrictions:strings(item.phase_restrictions),special_conditions:item.special_conditions&&typeof item.special_conditions==='object'&&!Array.isArray(item.special_conditions)?item.special_conditions:{},survives_conversion:Boolean(item.survives_conversion),stealable:item.stealable!==false,reason:text(item.reason,4000)})),other_effects:array(resolution.other_effects).slice(0,100).map(item=>({type:text(item.type||'OTHER',80),player_id:text(item.player_id,100),target_id:text(item.target_id,100),value:text(item.value,1000),duration:text(item.duration,200),summary:text(item.summary,4000)})),final_ruling:text(resolution.final_ruling||resolution.summary||array(resolution.expected_results)[0],12000),why:text(resolution.why||resolution.reasoning,12000),authority_used:strings(resolution.authority_used||resolution.relevant_rules),confidence:upper(resolution.confidence,'MEDIUM',CONFIDENCE),consistency_warnings:strings(resolution.consistency_warnings)};
}

export function resolutionEvents(draft={}){
  const events=[];
  for(const action of array(draft.action_results).slice().sort((a,b)=>a.order-b.order)){
    const type={BLOCKED:'BLOCK'}[action.result]||action.result;
    events.push({action_id:action.action_id,event_type:type,actor_player_id:action.actor_player_id,target_player_id:action.final_target_ids[0]||'',ability_id:action.ability_id,affected_player_ids:strings(action.affected_player_ids),uses_consumed:action.use_disposition==='CONSUMED'?1:0,uses_refunded:action.use_disposition==='REFUNDED'?1:0,result:action.result,summary:action.reason||`${action.ability_name||action.ability_id}: ${action.result}`,role_id:action.role_id,role_version:action.role_version,ability_source:action.ability_source,source_type:action.source_type,source_faction_id:action.source_faction_id,standardized_ability_type:action.standardized_ability_type,resolution_category:action.resolution_category,resolution_priority:action.resolution_priority,resolution_timing:action.resolution_timing,source_game_rule:action.source_game_rule,global_rule_used:action.global_rule_used,gm_override:action.gm_override,original_target_ids:strings(action.original_target_ids),final_target_ids:strings(action.final_target_ids),transformation_history:array(action.transformation_history),generated:action.generated,parent_action_id:action.parent_action_id,submitted_attempt:action.submitted_attempt});
    if(action.redirected)events.push({...events.at(-1),event_type:'REDIRECT',result:'REDIRECTED',summary:'Redirected to the approved final target(s).'});
    if(action.reflected)events.push({...events.at(-1),event_type:'REFLECT',result:'REFLECTED',summary:'Reflected to the approved final target(s).'});
    if(action.use_disposition==='CONSUMED')events.push({...events.at(-1),event_type:'ABILITY_CONSUMED',result:'CONSUMED',summary:'One approved ability use consumed.',uses_consumed:1,uses_refunded:0});
    if(action.use_disposition==='REFUNDED')events.push({...events.at(-1),event_type:'USE_REFUNDED',result:'REFUNDED',summary:'One approved ability use refunded.',uses_consumed:0,uses_refunded:1});
  }
  for(const passive of array(draft.passive_results).filter(item=>item.triggered))events.push({action_id:passive.source_action_id,event_type:passive.result==='PREVENTED'?'PASSIVE_PREVENTED':'PASSIVE_TRIGGER',actor_player_id:passive.player_id,target_player_id:passive.target_ids[0]||'',ability_id:passive.ability_id,affected_player_ids:strings(passive.affected_player_ids),uses_consumed:passive.uses_consumed,uses_refunded:passive.uses_refunded,result:passive.result,summary:passive.effect||passive.reason||`${passive.ability_name||passive.ability_id} triggered.`,role_id:passive.role_id,role_version:passive.role_version,ability_source:'ROLE',source_type:'ROLE',source_faction_id:'',original_target_ids:strings(passive.target_ids),final_target_ids:strings(passive.target_ids),trigger_count:passive.trigger_count,duration:passive.duration});
  for(const status of array(draft.status_effects))events.push({action_id:'',event_type:status.operation==='REMOVE'?'STATUS_REMOVED':'STATUS_ADDED',actor_player_id:status.source_player_id,target_player_id:status.player_id,ability_id:status.source_ability_id,affected_player_ids:[status.player_id].filter(Boolean),uses_consumed:0,uses_refunded:0,result:status.operation,summary:status.reason||`${status.status_name} ${status.operation==='REMOVE'?'removed':'applied'}.`,role_id:status.source_role_id,role_version:1,ability_source:'ROLE',source_type:'ROLE',source_faction_id:'',original_target_ids:[status.player_id].filter(Boolean),final_target_ids:[status.player_id].filter(Boolean)});
  for(const outcome of array(draft.player_outcomes)){
    if(outcome.life_state==='DEAD')events.push({action_id:'',event_type:'DEATH',actor_player_id:'',target_player_id:outcome.player_id,ability_id:'',affected_player_ids:[outcome.player_id],uses_consumed:0,uses_refunded:0,result:'DEAD',summary:outcome.summary||'Player died.',role_id:outcome.role_id,role_version:1,ability_source:'',source_type:'',source_faction_id:'',original_target_ids:[outcome.player_id],final_target_ids:[outcome.player_id]});
    if(['ALIVE','REVIVED'].includes(outcome.life_state))events.push({action_id:'',event_type:outcome.life_state==='REVIVED'?'STATE_CHANGE':'SURVIVAL',actor_player_id:'',target_player_id:outcome.player_id,ability_id:'',affected_player_ids:[outcome.player_id],uses_consumed:0,uses_refunded:0,result:outcome.life_state,summary:outcome.summary||`Player ${outcome.life_state.toLowerCase()}.`,role_id:outcome.role_id,role_version:1,ability_source:'',source_type:'',source_faction_id:'',original_target_ids:[outcome.player_id],final_target_ids:[outcome.player_id]});
    if(outcome.faction_id)events.push({action_id:'',event_type:'CONVERSION',actor_player_id:'',target_player_id:outcome.player_id,ability_id:'',affected_player_ids:[outcome.player_id],uses_consumed:0,uses_refunded:0,result:'FACTION_SET',summary:outcome.summary||'Final faction state recorded.',role_id:outcome.role_id,role_version:1,ability_source:'',source_type:'',source_faction_id:outcome.faction_id,original_target_ids:[outcome.player_id],final_target_ids:[outcome.player_id]});
  }
  return events.slice(0,2000);
}

export function finalResolutionPayload(draft={},legacy={}){
  const clean=buildResolutionDraft({proposal:draft,actions:array(draft.action_results).map(item=>({id:item.action_id,abilityId:item.ability_id,name:item.ability_name,sourcePlayerId:item.actor_player_id,sourceFactionId:item.source_faction_id,roleId:item.role_id,roleVersion:item.role_version,targetIds:item.original_target_ids,abilitySource:item.ability_source})),players:array(draft.player_outcomes).map(item=>({id:item.player_id,roleId:item.role_id,currentFactionId:item.faction_id}))});
  clean.events=resolutionEvents(clean);clean.proposed_order=clean.resolution_order;clean.expected_results=clean.action_results.map(item=>`${item.ability_name||item.ability_id}: ${item.result}${item.reason?' — '+item.reason:''}`);clean.status_changes=clean.status_effects.map(item=>`${item.operation}: ${item.status_name} → ${item.player_id}`);clean.deaths=clean.player_outcomes.filter(item=>item.life_state==='DEAD').map(item=>item.player_id);clean.conversions=clean.player_outcomes.filter(item=>item.faction_id).map(item=>`${item.player_id} → ${item.faction_id}`);clean.abilities_consumed=clean.action_results.filter(item=>item.use_disposition==='CONSUMED').map(item=>item.action_id);clean.reasoning=clean.why;return {...legacy,...clean};
}

export function validateResolutionDraft(draft,{actions=[],players=[],roles=[],abilities=[],factions=[],allowWarnings=false}={}){
  const errors=[],warnings=[],playerIds=new Set(players.map(item=>String(item.id))),roleIds=new Set(roles.map(item=>String(item.id))),abilityIds=new Set(abilities.map(item=>String(item.id))),factionIds=new Set(factions.map(item=>String(item.id))),actionIds=new Set(actions.map(item=>String(item.id))),seen=new Set();
  if(!array(draft.action_results).length&&actions.length)errors.push('Every submitted action needs a final result.');
  for(const result of array(draft.action_results)){
    if(!result.action_id||!actionIds.has(result.action_id))errors.push('A result references an unknown queued action.');
    if(seen.has(result.action_id))errors.push(`Duplicate action attempt ID: ${result.action_id}.`);seen.add(result.action_id);
    if(!RESULTS.has(result.result))errors.push(`${result.ability_name||result.action_id} needs a firm final result.`);
    if(result.actor_player_id&&!playerIds.has(result.actor_player_id)&&!result.faction_action)errors.push(`${result.ability_name||result.action_id} references an unknown player.`);
    if(result.ability_id&&!abilityIds.has(result.ability_id))errors.push(`${result.ability_name||result.action_id} references an unknown ability.`);
    if(result.role_id&&!roleIds.has(result.role_id))errors.push(`${result.ability_name||result.action_id} references an unknown historical role.`);
    if(result.source_faction_id&&!factionIds.has(result.source_faction_id))errors.push(`${result.ability_name||result.action_id} references an unknown faction.`);
    if(result.final_target_ids.some(id=>!playerIds.has(id)))errors.push(`${result.ability_name||result.action_id} has an unknown final target.`);
    if(result.resolution_category==='UNCLASSIFIED')errors.push(`${result.ability_name||result.action_id} needs GM classification before resolution.`);
    if(result.resolution_category!=='PASSIVES'&&!GLOBAL_RESOLUTION_ORDER.includes(result.resolution_category))errors.push(`${result.ability_name||result.action_id} has an invalid global resolution category.`);
    if(result.generated&&result.submitted_attempt)errors.push(`${result.ability_name||result.action_id} cannot be both a generated child effect and an independently submitted attempt.`);
    if(result.generated&&!result.parent_action_id)errors.push(`${result.ability_name||result.action_id} is generated but has no parent action.`);
    if(result.transformation_history.length&&JSON.stringify(result.original_target_ids)===JSON.stringify(result.final_target_ids)&&!result.reflected)warnings.push(`${result.ability_name||result.action_id} has transformation history but unchanged effective targets; verify the history.`);
    if(result.use_disposition==='CONSUMED'&&result.use_disposition==='REFUNDED')errors.push(`${result.ability_name||result.action_id} cannot be consumed and refunded.`);
    if(result.faction_action&&result.result==='SUCCESS'&&!result.actor_player_id)warnings.push(`${result.ability_name||result.action_id} is a successful faction action without an eligible performer.`);
    if(result.source_type==='ROLE'&&result.role_id){const role=roles.find(item=>String(item.id)===result.role_id),ability=abilities.find(item=>String(item.id)===result.ability_id);if(role?.roleType==='BASIC')warnings.push(`${role.name} is Basic but this action is marked role-owned.`);if(ability&&!array(role?.tags).some(tag=>String(tag).toLowerCase()===String(ability.name).toLowerCase()))warnings.push(`${ability.name} is marked role-owned by ${role?.name||result.role_id}, but that role does not currently list it.`)}
  }
  let lastPriority=0;for(const result of array(draft.action_results).slice().sort((left,right)=>left.order-right.order)){if(result.resolution_category==='PASSIVES'||result.resolution_timing==='ANY_TIME')continue;const currentPriority=GLOBAL_RESOLUTION_ORDER.indexOf(result.resolution_category)+1;if(currentPriority>0&&currentPriority<lastPriority)errors.push('Action results must follow the global category order.');if(currentPriority>0)lastPriority=currentPriority}
  for(const passive of array(draft.passive_results)){if(passive.triggered&&!passive.ability_id)errors.push('A triggered passive needs an ability.');if(!passive.triggered&&passive.trigger_count)warnings.push(`${passive.ability_name||'Passive'} is not triggered but has a trigger count.`)}
  for(const status of array(draft.status_effects)){if(!playerIds.has(status.player_id))errors.push('A status effect references an unknown player.');if(status.operation==='APPLY'&&(!status.status_type||!status.status_name))errors.push('An applied status needs a type and name.');if(status.operation==='REMOVE'&&!status.status_id)errors.push('Removing a status requires its saved status ID.')}
  for(const grant of array(draft.grant_effects)){if(grant.operation==='GRANT'&&(!playerIds.has(grant.player_id)||!abilityIds.has(grant.ability_id)))errors.push('A granted ability effect needs a known player and ability.');if(['REVOKE','SET_USES'].includes(grant.operation)&&(!grant.grant_id||grant.grant_version<1))errors.push('Changing an existing grant requires its grant ID and current version.');if(String(grant.reason||'').trim().length<3)errors.push('Every grant change needs a reason.')}
  const successfulDeathTargets=new Set(array(draft.action_results).filter(item=>item.result==='SUCCESS').flatMap(item=>item.affected_player_ids));for(const outcome of array(draft.player_outcomes)){if(!playerIds.has(outcome.player_id))errors.push('A player outcome references an unknown player.');if(outcome.life_state==='DEAD'&&!successfulDeathTargets.has(outcome.player_id)){const playerName=players.find(item=>String(item.id)===String(outcome.player_id))?.name||'Unknown player';warnings.push(`${playerName} is marked dead without an explicitly successful effect affecting them.`)}}
  if(!text(draft.final_ruling))errors.push('Enter the final Master GM ruling.');
  if(warnings.length&&!allowWarnings)errors.push('Review the consistency warnings and explicitly enable GM override before applying.');
  return {errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
}

export function resolutionDifferences(aiDraft={},finalDraft={}){
  const changes=[],compare=(path,before,after)=>{if(JSON.stringify(before??null)!==JSON.stringify(after??null))changes.push({path,before:before??null,after:after??null})};
  const aiActions=new Map(array(aiDraft.action_results).map(item=>[item.action_id,item]));for(const item of array(finalDraft.action_results)){const before=aiActions.get(item.action_id)||{};for(const key of ['order','resolution_category','resolution_priority','resolution_timing','result','final_target_ids','affected_player_ids','transformation_history','generated_child_effects','passive_triggers','redirected','reflected','protected','immune','use_disposition','reason'])compare(`actions.${item.action_id}.${key}`,before[key],item[key])}
  for(const key of ['passive_results','status_effects','player_outcomes','faction_results','grant_effects','other_effects','final_ruling','why','authority_used','confidence'])compare(key,aiDraft[key],finalDraft[key]);return changes.slice(0,1000);
}

export function usageAggregates(rows=[]){
  const totals=items=>items.reduce((sum,item)=>{for(const key of ['attempts','successful','failed','blocked','cancelled','ineligible','redirected','reflected','uses_consumed','uses_refunded','passive_triggers','passive_successful','passive_failed','affected_players','faction_action_attempts'])sum[key]=(sum[key]||0)+Number(item[key]||0);return sum},{});
  const group=key=>[...array(rows).reduce((map,row)=>{const id=String(row[key]||'');if(!id)return map;if(!map.has(id))map.set(id,[]);map.get(id).push(row);return map},new Map())].map(([id,items])=>({id,name:items[0][key.replace('_id','_name')]||({player_id:'Unknown player',role_id:'Unknown role',ability_id:'Unknown ability',faction_id:'Unknown faction'}[key]||'Unknown record'),...totals(items),abilities:items}));
  return {players:group('player_id'),roles:group('role_id'),abilities:group('ability_id'),totals:totals(rows)};
}
import {GLOBAL_RESOLUTION_ORDER,classifyAndOrderActions,normalizeResolutionAction} from './global-abilities.js?v=11.7.0';
