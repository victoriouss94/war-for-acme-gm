export const COPILOT_MAX_MESSAGE_LENGTH=6000;
export const COPILOT_TASKS=new Set(['assistant','resolve_actions','explain_role','plan_session']);
export const COPILOT_DEPTHS=new Set(['standard','deep']);
export const COPILOT_CHANGE_KINDS=new Set(['remove_action','set_player_alive','set_player_role','add_history','set_game_phase','set_game_day']);

const cleanText=(value,limit=12000)=>String(value??'').trim().slice(0,limit);

export function normalizeCopilotRequest(input={}){
  const message=cleanText(input.message,COPILOT_MAX_MESSAGE_LENGTH);
  if(!message)throw new Error('Ask the GM Copilot a question first.');
  const task=COPILOT_TASKS.has(input.task)?input.task:'assistant';
  const depth=COPILOT_DEPTHS.has(input.depth)?input.depth:'standard';
  const history=(Array.isArray(input.history)?input.history:[]).slice(-8).map(item=>({
    role:item?.role==='assistant'?'assistant':'user',
    content:cleanText(item?.content,2000)
  })).filter(item=>item.content);
  const conversationId=cleanText(input.conversationId,100);
  return {message,task,depth,history,conversationId};
}

export function normalizeCopilotResponse(input={}){
  const confidence=['high','medium','low'].includes(input.confidence)?input.confidence:'low';
  const strings=(value,limit=20)=>Array.isArray(value)?value.slice(0,limit).map(item=>cleanText(item,2000)).filter(Boolean):[];
  const proposedChanges=(Array.isArray(input.proposed_changes)?input.proposed_changes:[]).slice(0,50).map(change=>({
    kind:cleanText(change?.kind,80),
    target_id:cleanText(change?.target_id,100),
    value:cleanText(change?.value,4000),
    reason:cleanText(change?.reason,2000)
  })).filter(change=>change.value||change.kind==='remove_action');
  const sources=(Array.isArray(input.sources)?input.sources:[]).slice(0,30).map(source=>({id:cleanText(source?.id||source?.source_id,200),kind:cleanText(source?.kind,40),title:cleanText(source?.title,200),version:cleanText(source?.version,40),locator:cleanText(source?.locator,300),excerpt:cleanText(source?.excerpt,1200),claim:cleanText(source?.claim,1000)})).filter(source=>source.id&&source.title);
  return {
    answer:cleanText(input.answer,20000)||'The GM Copilot did not return an answer.',
    confidence,
    authority:['saved_game','official_sources','mixed','insufficient'].includes(input.authority)?input.authority:'insufficient',
    requires_gm_decision:Boolean(input.requires_gm_decision),
    ruling_basis:strings(input.ruling_basis),
    sources,
    warnings:strings(input.warnings),
    follow_up_questions:strings(input.follow_up_questions),
    proposed_changes:proposedChanges
  };
}

export function validateCopilotChanges(changes,gameState={}){
  const players=new Map((gameState.players||[]).map(player=>[player.id,player]));
  const roles=new Map((gameState.roles||[]).map(role=>[role.id,role]));
  const actions=new Map((gameState.actions||[]).map(action=>[action.id,action]));
  const valid=[],rejected=[];
  for(const original of Array.isArray(changes)?changes:[]){
    const change={...original};let reason='';
    if(!COPILOT_CHANGE_KINDS.has(change.kind))reason='Unsupported change type.';
    else if(change.kind==='remove_action'&&!actions.has(change.target_id))reason='The queued action no longer exists.';
    else if(change.kind==='set_player_alive'&&(!players.has(change.target_id)||!['true','false'].includes(change.value)))reason='The player or alive value is invalid.';
    else if(change.kind==='set_player_role'&&(!players.has(change.target_id)||!roles.has(change.value)))reason='The player or role no longer exists.';
    else if(change.kind==='add_history'&&!cleanText(change.value,4000))reason='The history note is empty.';
    else if(change.kind==='set_game_phase'&&!['Day','Night'].includes(change.value))reason='The phase must be Day or Night.';
    else if(change.kind==='set_game_day'&&(!/^\d{1,3}$/.test(change.value)||Number(change.value)>999))reason='The day must be between 0 and 999.';
    if(reason)rejected.push({change,reason});else valid.push(change);
  }
  return {valid,rejected};
}

export function copilotChangeLabel(change,gameState={}){
  const player=(gameState.players||[]).find(item=>item.id===change.target_id),role=(gameState.roles||[]).find(item=>item.id===change.value),action=(gameState.actions||[]).find(item=>item.id===change.target_id);
  if(change.kind==='remove_action')return 'Resolve and remove action: '+(action?.name||change.target_id);
  if(change.kind==='set_player_alive')return (change.value==='true'?'Revive ':'Mark dead ')+(player?.name||change.target_id);
  if(change.kind==='set_player_role')return 'Set '+(player?.name||change.target_id)+' role to '+(role?.name||change.value);
  if(change.kind==='set_game_phase')return 'Set phase to '+change.value;
  if(change.kind==='set_game_day')return 'Set day to '+change.value;
  return 'Add history note: '+cleanText(change.value,140);
}
