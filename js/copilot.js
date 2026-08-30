import {parseStatusProposalValue,statusLabel} from './statuses.js?v=12.0.0';
import {normalizeAiDraft,normalizeResolution} from './resolution.js?v=12.0.0';

export const COPILOT_MAX_MESSAGE_LENGTH=6000;
export const COPILOT_TASKS=new Set(['auto','assistant','roster_setup','phase_control','resolve_actions','explain_role','plan_session','create_role','create_ability','create_faction','create_rule','create_status','document_import','edit_content','analyze_balance','search_history','search_precedents','balance_role']);
export const COPILOT_DEPTHS=new Set(['standard','deep']);
export const COPILOT_CHANGE_KINDS=new Set(['remove_action','set_player_alive','set_player_role','set_player_faction','apply_status','resolve_status','add_history','update_role','update_ability','update_faction','update_rule','update_game','upsert_global_rule']);

const cleanText=(value,limit=12000)=>String(value??'').trim().slice(0,limit);

export function normalizeCopilotRequest(input={}){
  const message=cleanText(input.message,COPILOT_MAX_MESSAGE_LENGTH);
  if(!message)throw new Error('Ask the GM Copilot a question first.');
  const task=COPILOT_TASKS.has(input.task)?input.task:'auto';
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
  const proposedChanges=(Array.isArray(input.proposed_changes)?input.proposed_changes:[]).slice(0,50).map(change=>{
    const kind=cleanText(change?.kind,80);
    return {kind,target_id:cleanText(change?.target_id,100),value:cleanText(change?.value,kind==='upsert_global_rule'?100000:4000),reason:cleanText(change?.reason,2000)};
  }).filter(change=>change.value||change.kind==='remove_action');
  const sources=(Array.isArray(input.sources)?input.sources:[]).slice(0,30).map(source=>({id:cleanText(source?.id||source?.source_id,200),kind:cleanText(source?.kind,40),title:cleanText(source?.title,200),version:cleanText(source?.version,40),locator:cleanText(source?.locator,300),excerpt:cleanText(source?.excerpt,1200),claim:cleanText(source?.claim,1000),scope:cleanText(source?.scope,40),origin_game:cleanText(source?.originGame||source?.origin_game,120),applicability:cleanText(source?.applicability,40),authority_layer:cleanText(source?.authorityLayer||source?.authority_layer,80),compatibility_reasons:(Array.isArray(source?.compatibilityReasons||source?.compatibility_reasons)?source.compatibilityReasons||source.compatibility_reasons:[]).slice(0,10).map(item=>cleanText(item,500)).filter(Boolean)})).filter(source=>source.id&&source.title);
  const rawGlobal=input.global_knowledge&&typeof input.global_knowledge==='object'?input.global_knowledge:{};
  const references=(Array.isArray(input.referenced_entities)?input.referenced_entities:[]).slice(0,30).map(reference=>({type:cleanText(reference?.type,40),id:cleanText(reference?.id,120),name:cleanText(reference?.name||reference?.label,200)})).filter(reference=>reference.type&&reference.id&&reference.name);
  const rawProposal=input.proposal&&typeof input.proposal==='object'?input.proposal:null;
  return {
    intent:cleanText(input.intent,80)||'assistant',
    answer:cleanText(input.answer,20000)||'The GM Copilot did not return an answer.',
    confidence,
    authority:['saved_game','official_sources','gm_precedent','mixed','insufficient'].includes(input.authority)?input.authority:'insufficient',
    requires_gm_decision:Boolean(input.requires_gm_decision),
    requires_approval:Boolean(input.requires_approval),
    referenced_entities:references,
    ruling_basis:strings(input.ruling_basis),
    sources,
    warnings:strings(input.warnings),
    follow_up_questions:strings(input.follow_up_questions),
    proposed_changes:proposedChanges,
    resolution:normalizeResolution(input.resolution),
    draft:normalizeAiDraft(input.draft),
    proposal:rawProposal?{id:cleanText(rawProposal.id,100),status:cleanText(rawProposal.status,40)||'PENDING',version:Math.max(1,Number(rawProposal.version)||1),proposal_type:cleanText(rawProposal.proposal_type,40),created_at:cleanText(rawProposal.created_at,80)}:null,
    global_knowledge:{current_game_precedent_count:Math.max(0,Number(rawGlobal.current_game_precedent_count)||0),global_precedent_count:Math.max(0,Number(rawGlobal.global_precedent_count)||0),compatible_global_precedent_count:Math.max(0,Number(rawGlobal.compatible_global_precedent_count)||0),global_authority_used:Boolean(rawGlobal.global_authority_used),current_game_overrides:strings(rawGlobal.current_game_overrides),conflicts:strings(rawGlobal.conflicts),pattern_summary:cleanText(rawGlobal.pattern_summary,2000)}
  };
}

const patchFields={update_role:new Set(['name','factionId','roleType','abilityDataStatus','basicEvidence','slotCount','alignment','description','activeAbilityId','passiveAbilityId','tags','abilityUses','cooldowns','immunities','restrictions','mechanicalStatements','understanding','unresolvedComponents','sourceVersion','winCondition','notes','gmNotes','labels','enabled','archivedAt']),update_ability:new Set(['name','category','definition','phase','mechanics','mechanicalStatements','understanding','targeting','baseStandardAbilityId','standardAbilityId','mapping','unresolvedComponents','sourceVersion']),update_faction:new Set(['name','class','alignment','description','winCondition','notes','alias','teamNumber']),update_rule:new Set(['title','description','category','visibility','notes','enabled','sortOrder']),update_game:new Set(['name','theme','description','notes'])};
function parsedPatch(change){try{const value=JSON.parse(change.value);if(!value||typeof value!=='object'||Array.isArray(value))return null;const allowed=patchFields[change.kind];if(!allowed||Object.keys(value).some(key=>!allowed.has(key)))return null;return value}catch{return null}}

export function validateCopilotChanges(changes,gameState={},statusEffects=[]){
  const players=new Map((gameState.players||[]).map(player=>[player.id,player]));
  const roles=new Map((gameState.roles||[]).map(role=>[role.id,role]));
  const factions=new Map((gameState.factions||[]).map(faction=>[faction.id,faction]));
  const actions=new Map((gameState.actions||[]).map(action=>[action.id,action]));
  const statuses=new Map((Array.isArray(statusEffects)?statusEffects:[]).map(status=>[status.id,status]));
  const valid=[],rejected=[];
  for(const original of Array.isArray(changes)?changes:[]){
    const change={...original};let reason='';
    if(!COPILOT_CHANGE_KINDS.has(change.kind))reason='Unsupported change type.';
    else if(change.kind==='remove_action'&&!actions.has(change.target_id))reason='The queued action no longer exists.';
    else if(change.kind==='set_player_alive'&&(!players.has(change.target_id)||!['true','false'].includes(change.value)))reason='The player or alive value is invalid.';
    else if(change.kind==='set_player_role'&&(!players.has(change.target_id)||!roles.has(change.value)))reason='The player or role no longer exists.';
    else if(change.kind==='set_player_faction'&&(!players.has(change.target_id)||!factions.has(change.value)))reason='The player or faction no longer exists.';
    else if(change.kind==='apply_status'){
      const status=parseStatusProposalValue(change.value);
      if(!players.has(change.target_id)||!status||!['ACTIVE','PENDING'].includes(status.state))reason='The proposed live status is invalid.';
      else change.status={...status,playerId:change.target_id};
    }
    else if(change.kind==='resolve_status'){
      const status=statuses.get(change.target_id);
      if(!status||!['ACTIVE','PENDING'].includes(String(status.state||'').toUpperCase()))reason='The live status no longer exists or is already resolved.';
    }
    else if(change.kind==='add_history'&&!cleanText(change.value,4000))reason='The history note is empty.';
    else if(change.kind==='set_game_phase'&&!['Day','Night'].includes(change.value))reason='The phase must be Day or Night.';
    else if(change.kind==='set_game_day'&&(!/^\d{1,3}$/.test(change.value)||Number(change.value)>999))reason='The day must be between 0 and 999.';
    else if(change.kind==='update_role'&&(!roles.has(change.target_id)||!parsedPatch(change)))reason='The role update is invalid or the role no longer exists.';
    else if(change.kind==='update_ability'&&(!(gameState.abilities||[]).some(item=>item.id===change.target_id)||!parsedPatch(change)))reason='The ability update is invalid or the ability no longer exists.';
    else if(change.kind==='update_faction'&&(!factions.has(change.target_id)||!parsedPatch(change)))reason='The faction update is invalid or the faction no longer exists.';
    else if(change.kind==='update_rule'&&(!(gameState.rules||[]).some(item=>item.id===change.target_id)||!parsedPatch(change)))reason='The rule update is invalid or the rule no longer exists.';
    else if(change.kind==='update_game'&&!parsedPatch(change))reason='The game update contains unsupported fields.';
    else if(change.kind==='upsert_global_rule'){
      try{const value=JSON.parse(change.value),allowed=new Set(['rule_key','name','category','description','structured_data','notes','active','expected_version']),existing=Boolean(change.target_id),version=Number(value.expected_version);if(!value||typeof value!=='object'||Array.isArray(value)||!/^[A-Z0-9][A-Z0-9_]{2,119}$/.test(String(value.rule_key||''))||!String(value.name||'').trim()||!String(value.description||'').trim()||Object.keys(value).some(key=>!allowed.has(key))||existing&&(!Number.isInteger(version)||version<1))reason='The Global Settings rule proposal is invalid.'}catch{reason='The Global Settings rule proposal must be valid JSON.'}
    }
    if(reason)rejected.push({change,reason});else valid.push(change);
  }
  return {valid,rejected};
}

export function copilotChangeLabel(change,gameState={},statusEffects=[]){
  const player=(gameState.players||[]).find(item=>item.id===change.target_id),role=(gameState.roles||[]).find(item=>item.id===change.value),faction=(gameState.factions||[]).find(item=>item.id===change.value),action=(gameState.actions||[]).find(item=>item.id===change.target_id);
  if(change.kind==='remove_action')return 'Resolve and remove action: '+(action?.name||'Unknown action');
  if(change.kind==='set_player_alive')return (change.value==='true'?'Revive ':'Mark dead ')+(player?.name||'Unknown player');
  if(change.kind==='set_player_role')return 'Set '+(player?.name||'Unknown player')+' role to '+(role?.name||'Unknown role');
  if(change.kind==='set_player_faction')return 'Set '+(player?.name||'Unknown player')+' current faction to '+(faction?.name||'Unknown faction');
  if(change.kind==='apply_status')return 'Apply '+statusLabel(parseStatusProposalValue(change.value)||{})+' to '+(player?.name||'Unknown player');
  if(change.kind==='resolve_status'){const status=(statusEffects||[]).find(item=>item.id===change.target_id),target=(gameState.players||[]).find(item=>item.id===(status?.playerId||status?.player_id));return 'Resolve '+(status?statusLabel(status):'live status')+(target?' on '+target.name:'')}
  if(change.kind==='set_game_phase')return 'Set phase to '+change.value;
  if(change.kind==='set_game_day')return 'Set day to '+change.value;
  if(change.kind==='upsert_global_rule'){try{const value=JSON.parse(change.value);return (change.target_id?'Create a new version of ':'Create global fallback ')+(value.name||value.rule_key)+' ('+value.rule_key+')'}catch{return 'Update Global Settings fallback'}}
  if(change.kind.startsWith('update_')){const type=change.kind.slice(7),records=type==='role'?gameState.roles:type==='ability'?gameState.abilities:type==='faction'?gameState.factions:type==='rule'?gameState.rules:[],record=(records||[]).find(item=>item.id===change.target_id),patch=parsedPatch(change)||{},fields=Object.entries(patch).map(([key,value])=>key+': '+(Array.isArray(value)?value.join(', '):String(value))).join('; ');return 'Update '+(record?.name||record?.title||type)+': '+fields}
  return 'Add history note: '+cleanText(change.value,140);
}
