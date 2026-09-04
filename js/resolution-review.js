const list=value=>Array.isArray(value)?value:[];
const text=value=>String(value??'').trim();
const upper=value=>text(value).toUpperCase();
const idOf=value=>text(value?.id||value?.player_id||value?.playerId);
const playerRoleId=player=>text(player?.roleId||player?.role_id);
const playerFactionId=player=>text(player?.currentFactionId||player?.current_faction_id||player?.factionId||player?.faction_id);
const statusPlayerId=status=>text(status?.playerId||status?.player_id);
const actionActorId=action=>text(action?.actor_player_id||action?.actorPlayerId||action?.sourcePlayerId||action?.actorId);
const actionId=action=>text(action?.action_id||action?.actionId||action?.id);
const unique=values=>[...new Set(values.filter(Boolean))];

export const TRACKER_RESULT_BADGES=Object.freeze({
  SUCCESS:{label:'SUCCESS',icon:'✅',tone:'success'},
  FAILURE:{label:'FAILED',icon:'❌',tone:'failure'},
  FAILED:{label:'FAILED',icon:'❌',tone:'failure'},
  BLOCKED:{label:'BLOCKED',icon:'⛔',tone:'blocked'},
  PROTECTED:{label:'PROTECTED',icon:'🛡️',tone:'protected'},
  SURVIVED:{label:'SURVIVED',icon:'🛡️',tone:'protected'},
  DEAD:{label:'DEAD',icon:'☠️',tone:'dead'},
  REDIRECTED:{label:'REDIRECTED',icon:'↪️',tone:'redirected'},
  REFLECTED:{label:'REFLECTED',icon:'↩️',tone:'reflected'},
  IMMUNE:{label:'IMMUNE',icon:'🛡️',tone:'immune'},
  CONVERTED:{label:'CONVERTED',icon:'🔄',tone:'converted'},
  MARKED:{label:'MARKED',icon:'⚠️',tone:'marked'},
  POISONED:{label:'POISONED',icon:'⚠️',tone:'poisoned'},
  PENDING:{label:'PENDING',icon:'⚠️',tone:'pending'},
  NO_EFFECT:{label:'NO EFFECT',icon:'—',tone:'no-effect'},
  CANCELLED:{label:'NO EFFECT',icon:'—',tone:'no-effect'},
  INELIGIBLE_EFFECT:{label:'NO EFFECT',icon:'—',tone:'no-effect'},
  INTEL:{label:'INTEL',icon:'🔎',tone:'intel'}
});

export function trackerActionBadges(action={}){
  const keys=[],result=upper(action.result)||'PENDING';
  if(action.reflected)keys.push('REFLECTED');
  else if(action.redirected)keys.push('REDIRECTED');
  if(action.protected)keys.push('PROTECTED');
  if(action.immune)keys.push('IMMUNE');
  if(upper(action.resolution_category)==='INTEL')keys.push('INTEL');
  if(!keys.length||!['SUCCESS','PENDING'].includes(result))keys.push(result);
  else if(result==='PENDING')keys.push('PENDING');
  else if(result==='SUCCESS'&&!keys.includes('INTEL'))keys.unshift('SUCCESS');
  return unique(keys).map(key=>TRACKER_RESULT_BADGES[key]||{label:key.replaceAll('_',' '),icon:'',tone:'pending'});
}

function targetIds(action={}){
  return unique(list(action.final_target_ids||action.effectiveTargetIds||action.targetIds||[action.targetId].filter(Boolean)).map(text));
}

function originalTargetIds(action={},submitted={}){
  return unique(list(action.original_target_ids||submitted.targetIds||[submitted.targetId].filter(Boolean)).map(text));
}

function currentStatusesFor(statuses,playerId){
  return list(statuses).filter(status=>statusPlayerId(status)===playerId&&['ACTIVE','PENDING','PERMANENT'].includes(upper(status.state)));
}

function proposedStatusesFor(draft,playerId,current){
  const removals=new Set(list(draft.status_effects).filter(status=>upper(status.operation)==='REMOVE'&&text(status.player_id)===playerId).map(status=>text(status.status_id)));
  const retained=current.filter(status=>!removals.has(text(status.id)));
  const added=list(draft.status_effects).filter(status=>upper(status.operation||'APPLY')==='APPLY'&&text(status.player_id)===playerId);
  return [...retained,...added.map(status=>({...status,proposed:true}))];
}

function proposedChanges({player,outcome,currentRoleId,currentFactionId,proposedRoleId,proposedFactionId,currentAlive,proposedAlive,draft}){
  const changes=[];
  if(currentAlive!==proposedAlive)changes.push({type:'LIFE',label:proposedAlive?'REVIVED':'DEAD'});
  if(currentRoleId!==proposedRoleId)changes.push({type:'ROLE',label:'ROLE CHANGED'});
  if(currentFactionId!==proposedFactionId)changes.push({type:'FACTION',label:'CONVERTED'});
  for(const status of list(draft.status_effects).filter(item=>text(item.player_id)===idOf(player)))changes.push({type:'STATUS',label:upper(status.operation)==='REMOVE'?`${text(status.status_name||status.status_type)||'STATUS'} REMOVED`:text(status.status_name||status.status_type)||'STATUS ADDED'});
  for(const grant of list(draft.grant_effects).filter(item=>text(item.player_id)===idOf(player)))changes.push({type:'ABILITY',label:`ABILITY ${upper(grant.operation)||'CHANGED'}`});
  if(outcome?.summary&&!changes.length)changes.push({type:'OUTCOME',label:text(outcome.summary)});
  return changes;
}

export function buildTrackerResolutionReview({draft={},roster=[],snapshotPlayers=[],roles=[],factions=[],submittedActions=[],statuses=[]}={}){
  const roleById=new Map(list(roles).map(item=>[idOf(item),item])),factionById=new Map(list(factions).map(item=>[idOf(item),item])),submittedById=new Map(list(submittedActions).map(item=>[actionId(item),item])),outcomeByPlayer=new Map(list(draft.player_outcomes).map(item=>[text(item.player_id),item])),actions=list(draft.action_results).slice().sort((left,right)=>(Number(left.order)||0)-(Number(right.order)||0)),actionsByPlayer=new Map();
  for(const action of actions){const actorId=actionActorId(action);if(!actorId||action.faction_action)continue;if(!actionsByPlayer.has(actorId))actionsByPlayer.set(actorId,[]);actionsByPlayer.get(actorId).push(action)}
  const snapshotById=new Map(list(snapshotPlayers).map(item=>[idOf(item),item])),liveById=new Map(list(roster).map(item=>[idOf(item),item])),ordered=list(roster).length?list(roster):list(snapshotPlayers),seen=new Set(),players=[];
  for(const item of ordered){
    const playerId=idOf(item);if(!playerId||seen.has(playerId))continue;seen.add(playerId);
    const player={...(snapshotById.get(playerId)||{}),...(liveById.get(playerId)||{}),...item},outcome=outcomeByPlayer.get(playerId),currentRoleId=playerRoleId(player),currentFactionId=playerFactionId(player),proposedRoleId=text(outcome?.role_id)||currentRoleId,proposedFactionId=text(outcome?.faction_id)||currentFactionId,currentAlive=player.alive!==false,lifeState=upper(outcome?.life_state),proposedAlive=lifeState==='DEAD'?false:['ALIVE','REVIVED'].includes(lifeState)?true:currentAlive,currentStatuses=currentStatusesFor(statuses,playerId),proposedStatuses=proposedStatusesFor(draft,playerId,currentStatuses);
    const playerActions=list(actionsByPlayer.get(playerId)).map(action=>{
      const submitted=submittedById.get(actionId(action))||{},originalIds=originalTargetIds(action,submitted),finalIds=targetIds(action);
      return {...action,id:actionId(action),submittedAbility:text(submitted.abilityNameSnapshot||submitted.abilityName||submitted.name||action.ability_name||action.standardized_ability_type)||'Unnamed action',submittedTargetIds:originalIds,submittedTargets:originalIds.map(id=>text(liveById.get(id)?.name||snapshotById.get(id)?.name)||'Unknown player'),effectiveTargetIds:finalIds,effectiveTargets:finalIds.map(id=>text(liveById.get(id)?.name||snapshotById.get(id)?.name)||'Unknown player'),badges:trackerActionBadges(action),conciseResult:text(action.ruling||action.reason)||upper(action.result).replaceAll('_',' '),explanation:text(action.reason),intelResult:upper(action.resolution_category)==='INTEL'?text(action.ruling||action.reason):'',triggeredPassives:list(action.triggered_passives||action.passive_triggers),generatedEffects:list(action.generated_effects||action.generated_child_effects)};
    });
    players.push({id:playerId,name:text(player.name)||'Unknown player',currentAlive,proposedAlive,currentRoleId,proposedRoleId,currentRoleName:text(roleById.get(currentRoleId)?.name)||'No role',proposedRoleName:text(roleById.get(proposedRoleId)?.name)||text(outcome?.role_after_resolution)||'No role',currentFactionId,proposedFactionId,currentFactionName:text(factionById.get(currentFactionId)?.name)||'No faction',proposedFactionName:text(factionById.get(proposedFactionId)?.name)||'No faction',factionClass:text(factionById.get(proposedFactionId)?.class||factionById.get(currentFactionId)?.class),modeName:text(outcome?.mode_after_resolution||player.modeName||player.mode_name||playerActions[0]?.actor_mode_name),currentStatuses,proposedStatuses,actions:playerActions,outcome,changes:proposedChanges({player,outcome,currentRoleId,currentFactionId,proposedRoleId,proposedFactionId,currentAlive,proposedAlive,draft})});
  }
  const playerById=new Map(players.map(player=>[player.id,player])),deaths=players.filter(player=>player.currentAlive&&!player.proposedAlive),conversions=players.filter(player=>player.currentFactionId!==player.proposedFactionId),pending=actions.filter(action=>upper(action.result)==='PENDING'),intel=actions.filter(action=>upper(action.resolution_category)==='INTEL'),reflected=actions.filter(action=>action.reflected),attackTargets=unique(actions.filter(action=>upper(action.resolution_category)==='KILLS'&&!['CANCELLED','INELIGIBLE_EFFECT'].includes(upper(action.result))).flatMap(targetIds)),survived=attackTargets.map(id=>playerById.get(id)).filter(player=>player?.proposedAlive),statusChanges=list(draft.status_effects),grantChanges=list(draft.grant_effects),factionActions=actions.filter(action=>!actionActorId(action)||action.faction_action);
  return {players,factionActions,summary:{beforeAlive:players.filter(player=>player.currentAlive).length,afterAlive:players.filter(player=>player.proposedAlive).length,deaths,survived,statusChanges,intel,conversions,pending,reflected,grantChanges},isComplete:pending.length===0};
}
