const array=value=>Array.isArray(value)?value:[];
const integer=(value,fallback=0)=>Number.isInteger(Number(value))?Number(value):fallback;

export function normalizePhaseName(value){
  return String(value||'').toLowerCase()==='night'?'Night':'Day';
}

export function phaseTitle(phase){
  if(!phase)return 'Game not started';
  return `${normalizePhaseName(phase.phase)} ${Math.max(0,integer(phase.cycle))}`;
}

export function nextPhase(phase){
  const current=normalizePhaseName(phase?.phase),cycle=Math.max(0,integer(phase?.cycle));
  return current==='Night'?{phase:'Day',cycle:cycle+1}:{phase:'Night',cycle};
}

export function normalizePhaseContext(raw={}){
  const phases=array(raw.phases).map(phase=>({
    ...phase,
    id:String(phase.id||''),
    phase:normalizePhaseName(phase.phase),
    cycle:Math.max(0,integer(phase.cycle)),
    sequence:Math.max(1,integer(phase.phase_sequence??phase.sequence,1)),
    queueVersion:Math.max(1,integer(phase.queue_version??phase.queueVersion,1)),
    status:String(phase.status||'COMPLETED').toUpperCase(),
    actions:array(phase.action_queue??phase.actions),
    resolutionSummary:phase.resolution_summary??phase.resolutionSummary??{}
  })).sort((left,right)=>right.sequence-left.sequence);
  const currentId=String(raw.current_phase_id??raw.currentPhaseId??raw.current_phase?.id??raw.currentPhase?.id??'');
  const current=phases.find(phase=>phase.id===currentId)||phases.find(phase=>phase.status==='CURRENT')||null;
  return {
    current,
    phases,
    events:array(raw.events),
    sessions:array(raw.sessions),
    gameStatus:String(raw.game_status??raw.gameStatus??'SETUP').toUpperCase(),
    preview:raw.preview&&typeof raw.preview==='object'?raw.preview:null
  };
}

export function phaseById(context,phaseId){
  const normalized=normalizePhaseContext(context);
  return normalized.phases.find(phase=>phase.id===String(phaseId||''))||normalized.current;
}

export function expectedPhaseActors(players,effectiveAbilities,phaseName){
  const phase=normalizePhaseName(phaseName),resolver=typeof effectiveAbilities==='function'?effectiveAbilities:()=>[];
  return array(players).filter(player=>player?.alive!==false).filter(player=>{
    const resolved=resolver(player),abilities=array(resolved?.abilities??resolved);
    return abilities.some(ability=>ability&&!ability.passive&&ability.available!==false&&['Any',phase].includes(String(ability.phase||'Any')));
  });
}

export function queuePhaseSummary({players=[],actions=[],effectiveAbilities,phase='Day'}={}){
  const expected=expectedPhaseActors(players,effectiveAbilities,phase),submittedIds=new Set(array(actions).map(action=>String(action.sourcePlayerId||action.actorId||'')).filter(Boolean));
  const submitted=expected.filter(player=>submittedIds.has(String(player.id))),missing=expected.filter(player=>!submittedIds.has(String(player.id)));
  return {expected,submitted,missing,noAction:missing,expectedCount:expected.length,submittedCount:submitted.length,actionCount:array(actions).length};
}

export function resolutionResultsForPhase(phase,sessions=[]){
  const matching=array(sessions).filter(session=>String(session.phase_id||session.phaseId||'')===String(phase?.id||''));
  const byActionId=new Map();
  for(const session of matching){
    const final=session.final_resolution||session.manual_resolution||session.ai_proposal?.resolution||{};
    for(const event of array(final.events)){
      const actionId=String(event?.action_id||event?.actionId||'');
      if(actionId)byActionId.set(actionId,{status:String(session.status||''),summary:String(event.summary||event.result||''),sessionId:session.id});
    }
    for(const action of array(session.submitted_actions)){
      const actionId=String(action.id||'');
      if(actionId&&!byActionId.has(actionId)&&['FINALIZED','REJECTED'].includes(String(session.status||'')))byActionId.set(actionId,{status:String(session.status),summary:String(final.summary||session.gm_explanation||'Resolution finalized.'),sessionId:session.id});
    }
  }
  return byActionId;
}

export function normalizeAdvancePreview(raw={}){
  const next=raw.next_phase??raw.nextPhase??{};
  return {
    currentPhaseId:String(raw.current_phase_id??raw.currentPhaseId??''),
    currentPhaseVersion:Math.max(1,integer(raw.current_phase_version??raw.currentPhaseVersion,1)),
    next:{phase:normalizePhaseName(next.phase),cycle:Math.max(0,integer(next.cycle))},
    actionCount:Math.max(0,integer(raw.action_count??raw.actionCount)),
    resolvedCount:Math.max(0,integer(raw.resolved_count??raw.resolvedCount)),
    unresolvedCount:Math.max(0,integer(raw.unresolved_count??raw.unresolvedCount)),
    unresolvedActionIds:array(raw.unresolved_action_ids??raw.unresolvedActionIds).map(String),
    openSessionCount:Math.max(0,integer(raw.open_session_count??raw.openSessionCount)),
    expiringStatuses:array(raw.expiring_statuses??raw.expiringStatuses),
    decrementingStatuses:array(raw.decrementing_statuses??raw.decrementingStatuses),
    expiringGrants:array(raw.expiring_grants??raw.expiringGrants),
    cooldownUpdates:array(raw.cooldown_updates??raw.cooldownUpdates),
    abilityRefreshes:array(raw.ability_refreshes??raw.abilityRefreshes),
    pendingEffects:array(raw.pending_effects??raw.pendingEffects),
    timers:array(raw.timers)
  };
}
