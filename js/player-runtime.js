// Player-specific state, never a rewrite of the role encyclopedia.
const value=(record,camel,snake)=>record?.[camel]??record?.[snake];
const cycleNumber=value=>value==null||value===''?null:Number(value);

export function statusAppliesToPhase(effect={},game={}){
  if(String(effect.state).toUpperCase()!=='ACTIVE')return false;
  const cycle=Number(game.currentDay??game.cycle??game.round??0),phase=game.currentPhase??game.phase;
  const start=cycleNumber(value(effect,'appliedAtCycle','applied_at_cycle')),end=cycleNumber(value(effect,'expiresAtCycle','expires_at_cycle'));
  if(start!=null&&cycle<start||end!=null&&cycle>end)return false;
  const startPhase=value(effect,'appliedAtPhase','applied_at_phase'),endPhase=value(effect,'expiresAtPhase','expires_at_phase');
  if(cycle===start&&startPhase==='Night'&&phase==='Day')return false;
  if(cycle===end&&endPhase==='Day'&&phase==='Night')return false;
  const onlyCycle=cycleNumber(effect.metadata?.disabledCycle),onlyPhase=effect.metadata?.disabledPhase;
  return (onlyCycle==null||cycle===onlyCycle)&&(!onlyPhase||onlyPhase==='Any'||onlyPhase===phase);
}

export function abilityDisablingStatuses(statuses,playerId,game){
  return statuses.filter(effect=>String(value(effect,'playerId','player_id'))===String(playerId)&&statusAppliesToPhase(effect,game)&&(
    String(value(effect,'statusType','status_type')).toUpperCase()==='ABILITIES_DISABLED'||
    String(value(effect,'statusType','status_type')).toUpperCase()==='CAPTURED'&&effect.metadata?.abilitiesDisabled===true
  ));
}

export function roleAbilityCounter(grants,playerId,roleId,abilityId){
  // A consumed counter must still shadow the unlimited base option. Revoking
  // the counter is an explicit GM decision to restore the role's own limits.
  return grants.filter(grant=>String(value(grant,'playerId','player_id'))===String(playerId)&&
    String(value(grant,'abilityId','ability_id'))===String(abilityId)&&
    String(value(grant,'sourceReference','source_reference'))===String(roleId)&&
    String(value(grant,'sourceType','source_type'))==='ROLE'&&grant.metadata?.replacesRoleAbility===true&&
    ['ACTIVE','CONSUMED'].includes(grant.status)&&value(grant,'usesRemaining','uses_remaining')!=null
  ).sort((a,b)=>String(b.createdAt??b.created_at??b.id).localeCompare(String(a.createdAt??a.created_at??a.id)))[0]||null;
}
