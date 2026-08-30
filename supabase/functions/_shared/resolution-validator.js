const FINAL_RESULTS=new Set(['SUCCESS','FAILURE','BLOCKED','CANCELLED','INELIGIBLE_EFFECT']);
const STATUSES=new Set(['RESOLVED','RESOLVED_WITH_AI_ASSISTANCE','GM_REVIEW_REQUIRED','TECHNICAL_FAILURE']);
const array=value=>Array.isArray(value)?value:[];
const text=value=>String(value??'').trim();
const id=value=>text(value).toLowerCase();
const actionId=action=>text(action?.id||action?.action_id);
const actorId=action=>text(action?.sourcePlayerId||action?.actorId||action?.actor_player_id);
const abilityId=action=>text(action?.abilityId||action?.baseAbilityId||action?.ability_id);
const abilityName=action=>text(action?.abilityNameSnapshot||action?.abilityName||action?.name||action?.ability_name);
const modeName=action=>text(action?.modeName||action?.configurationName||action?.actor_mode_name);
const refs=result=>[
  result?.actor_player_id,
  ...array(result?.original_target_ids),
  ...array(result?.final_target_ids),
  ...array(result?.affected_player_ids)
].map(text).filter(Boolean);

export function validateStructuredResolution(resolution,{queuedActions=[],players=[]}={}){
  const errors=[],affectedActionIds=[],queued=array(queuedActions),results=array(resolution?.action_results),knownPlayers=new Set(array(players).map(player=>text(player?.id)).filter(Boolean)),queuedIds=new Set(queued.map(actionId)),seen=new Set();
  const fail=(message,action='')=>{errors.push(message);if(action)affectedActionIds.push(action)};
  if(!resolution||typeof resolution!=='object'||Array.isArray(resolution))return {valid:false,errors:['No structured resolution object was returned.'],affectedActionIds:queued.map(actionId).filter(Boolean)};
  if(!STATUSES.has(text(resolution.resolution_status).toUpperCase()))fail('resolution_status must be RESOLVED, RESOLVED_WITH_AI_ASSISTANCE, GM_REVIEW_REQUIRED, or TECHNICAL_FAILURE.');
  if(text(resolution.resolution_status).toUpperCase()==='TECHNICAL_FAILURE')fail('A technical failure cannot be saved as a GM ruling.');
  if(!text(resolution?.master_ruling?.headline))fail('The MASTER GM RULING headline is missing.');
  if(!text(resolution?.master_ruling?.summary)&&!text(resolution.final_ruling))fail('The MASTER GM RULING summary is missing.');
  if(!text(resolution.final_ruling))fail('The final Master GM ruling is missing.');
  if(!Array.isArray(resolution.player_outcomes))fail('player_outcomes must be present, even when empty.');
  if(results.length!==queued.length)fail(`Expected ${queued.length} action result(s), received ${results.length}.`);
  for(const result of results){
    const currentId=text(result?.action_id),queuedAction=queued.find(action=>actionId(action)===currentId);
    if(!currentId||!queuedIds.has(currentId)){fail('An action result references an unknown queued action.',currentId);continue}
    if(seen.has(currentId)){fail('A queued action was resolved more than once.',currentId);continue}seen.add(currentId);
    const outcome=text(result?.result).toUpperCase();
    if(!FINAL_RESULTS.has(outcome))fail('The action does not have a firm final outcome.',currentId);
    if(!text(result?.ruling)&&!text(result?.reason))fail('The action result has no readable ruling.',currentId);
    if(actorId(queuedAction)!==text(result?.actor_player_id))fail('The action result changed the immutable actor.',currentId);
    if(abilityId(queuedAction)&&abilityId(queuedAction)!==text(result?.ability_id||result?.selected_ability_id))fail('The action result changed the selected ability.',currentId);
    const queuedAbility=abilityName(queuedAction),returnedAbility=text(result?.ability_name||result?.selected_ability_name);
    if(queuedAbility&&id(queuedAbility)!==id(returnedAbility))fail('The action result does not name the selected ability.',currentId);
    if(modeName(queuedAction)&&id(modeName(queuedAction))===id(returnedAbility)&&id(queuedAbility)!==id(modeName(queuedAction)))fail('The role mode was returned as the action instead of the selected ability.',currentId);
    for(const reference of refs(result))if(knownPlayers.size&&!knownPlayers.has(reference))fail('The action result references a nonexistent player.',currentId);
    if(text(result?.actor_player_id)&&!text(result?.actor_name))fail('The action result is missing the actor name.',currentId);
    if(array(result?.original_target_ids).length!==array(result?.original_target_names).length)fail('Original target IDs and names do not match.',currentId);
    if(array(result?.final_target_ids).length!==array(result?.effective_target_names).length)fail('Effective target IDs and names do not match.',currentId);
  }
  for(const queuedAction of queued)if(!seen.has(actionId(queuedAction)))affectedActionIds.push(actionId(queuedAction));
  for(const outcome of array(resolution.player_outcomes)){const playerId=text(outcome?.player_id);if(!playerId||knownPlayers.size&&!knownPlayers.has(playerId))fail('A player outcome references a nonexistent player.');if(playerId&&!text(outcome?.player_name))fail('A player outcome is missing its readable player name.');if(!Array.isArray(outcome?.changes))fail('A player outcome must contain a structured changes array.');}
  const status=text(resolution.resolution_status).toUpperCase(),questions=array(resolution.unresolved_questions).filter(item=>text(item));
  if(status==='GM_REVIEW_REQUIRED'&&!questions.length)fail('GM_REVIEW_REQUIRED must identify the exact unresolved question.');
  if(['RESOLVED','RESOLVED_WITH_AI_ASSISTANCE'].includes(status)&&questions.length)fail('A resolved ruling cannot contain unresolved material questions.');
  return {valid:errors.length===0,errors:[...new Set(errors)],affectedActionIds:[...new Set(affectedActionIds.filter(Boolean))]};
}

export function resolutionRepairInput({request,originalResult,validationErrors}){
  return {original_structured_request:request,original_ai_result:originalResult,validation_errors:array(validationErrors)};
}

export function resolutionFailureDetails(review,{queuedActions=[],phase='',round=0,model='',requestId='',repairAttempts=0}={}){
  return {phase:text(phase),round_number:Number(round)||0,queued_action_count:array(queuedActions).length,model:text(model),request_id:text(requestId),validation_errors:array(review?.errors),affected_action_ids:array(review?.affectedActionIds),repair_attempt_count:Number(repairAttempts)||0};
}
