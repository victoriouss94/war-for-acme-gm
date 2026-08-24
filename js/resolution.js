export const RESOLUTION_STATES=new Set(['OPEN','AI_ANALYZING','AI_PROPOSED','GM_REVIEW','MODIFIED','APPROVED','FINALIZED','REJECTED']);
export const GM_DECISIONS=new Set(['APPROVE','MODIFY','REJECT']);
export const PRECEDENT_STATES=new Set(['ACTIVE','CONFLICTING','SUPERSEDED','ARCHIVED','INCORRECT']);
export const PRECEDENT_SCOPES=new Set(['GENERAL','GLOBAL','ABILITY_SPECIFIC','ROLE_SPECIFIC','GAME_SPECIFIC','ONE_TIME']);
export const TEACH_SCOPES=new Set(['GAME_SPECIFIC','GLOBAL']);
export const COMPATIBILITY_LEVELS=new Set(['EXACT','STRONG','PARTIAL','INCOMPATIBLE']);
export const AI_DRAFT_TYPES=new Set(['ROLE','ABILITY','FACTION','RULE','GAME','STATUS','DOCUMENT_IMPORT']);

const text=(value,limit=12000)=>String(value??'').trim().slice(0,limit);
const strings=(value,limit=100)=>Array.isArray(value)?value.slice(0,limit).map(item=>text(item,4000)).filter(Boolean):[];
const records=(value,limit=100)=>Array.isArray(value)?value.slice(0,limit).filter(item=>item&&typeof item==='object'&&!Array.isArray(item)):[];
const eventTypes=new Set(['SUCCESS','FAILURE','BLOCK','INELIGIBLE_EFFECT','CANCELLED','REDIRECT','REFLECT','TRANSFER','PASSIVE_TRIGGER','PASSIVE_PREVENTED','PROTECTION_USED','DEATH','SURVIVAL','CONVERSION','STATUS_ADDED','STATUS_REMOVED','ABILITY_CONSUMED','USE_REFUNDED','STATE_CHANGE','OTHER']);

export function normalizeResolution(input){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  return {
    actions_analyzed:strings(input.actions_analyzed),player_states:strings(input.player_states),relevant_rules:strings(input.relevant_rules),relevant_abilities:strings(input.relevant_abilities),role_modifiers:strings(input.role_modifiers),precedents:strings(input.precedents),proposed_order:strings(input.proposed_order),expected_results:strings(input.expected_results),status_changes:strings(input.status_changes),deaths:strings(input.deaths),conversions:strings(input.conversions),abilities_consumed:strings(input.abilities_consumed),reasoning:text(input.reasoning),interaction_signature:text(input.interaction_signature,1000),signature_tokens:[...new Set(strings(input.signature_tokens).map(item=>item.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')).filter(Boolean))],
    events:(Array.isArray(input.events)?input.events:[]).slice(0,1000).map(item=>({action_id:text(item?.action_id??item?.actionId,160),event_type:eventTypes.has(item?.event_type)?item.event_type:'OTHER',actor_player_id:text(item?.actor_player_id,100),target_player_id:text(item?.target_player_id,100),ability_id:text(item?.ability_id,120),affected_player_ids:[...new Set(strings(item?.affected_player_ids??item?.affectedPlayerIds,1000))],uses_consumed:Math.max(0,Number(item?.uses_consumed)||0),uses_refunded:Math.max(0,Number(item?.uses_refunded)||0),result:text(item?.result,80),summary:text(item?.summary,4000)})).filter(item=>item.summary)
  };
}

export function normalizeAiDraft(input){
  if(!input||typeof input!=='object'||!AI_DRAFT_TYPES.has(input.draft_type)||!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload))return null;
  const payload=input.payload;
  return {draft_type:input.draft_type,title:text(input.title,200)||text(payload.name,200)||'Untitled draft',possible_duplicate:Boolean(input.possible_duplicate),duplicate_notes:text(input.duplicate_notes,4000),payload:{
    name:text(payload.name,120),faction_id:text(payload.faction_id,100),faction_name:text(payload.faction_name,120),role_type:text(payload.role_type,40).toUpperCase()==='BASIC'?'BASIC':'STANDARD',slot_count:Math.max(1,Math.min(1000,Number(payload.slot_count)||1)),description:text(payload.description,8000),standard_ability_ids:strings(payload.standard_ability_ids),role_modifiers:strings(payload.role_modifiers),active_abilities:strings(payload.active_abilities),passive_abilities:strings(payload.passive_abilities),uses:text(payload.uses,200),cooldowns:text(payload.cooldowns,500),immunities:strings(payload.immunities),special_mechanics:strings(payload.special_mechanics),win_condition:text(payload.win_condition,4000),resolution_notes:strings(payload.resolution_notes),potential_interactions:strings(payload.potential_interactions),category:text(payload.category,80),targeting:text(payload.targeting,1000),active_passive:text(payload.active_passive,120),resolution_behavior:text(payload.resolution_behavior,8000),exceptions:strings(payload.exceptions),balance_notes:strings(payload.balance_notes),alignment:text(payload.alignment,200),visibility:text(payload.visibility,80),relationships:strings(payload.relationships),rule_title:text(payload.rule_title,200),rule_category:text(payload.rule_category,80),rule_description:text(payload.rule_description,8000),game_theme:text(payload.game_theme,200),game_player_count:Math.max(0,Number(payload.game_player_count)||0),status_type:text(payload.status_type,80),status_category:text(payload.status_category,80),status_state:text(payload.status_state,80),status_duration:text(payload.status_duration,200)
  }};
}

export function manualResolutionPayload(fields={}){
  const lines=value=>String(value||'').split(/\r?\n/).map(item=>item.trim()).filter(Boolean).slice(0,1000);
  const signatureTokens=[...new Set(lines(fields.signatureTokens).map(item=>item.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')).filter(Boolean))];
  const eventLines=lines(fields.events),events=eventLines.map(summary=>({action_id:'',event_type:'OTHER',actor_player_id:'',target_player_id:'',ability_id:'',affected_player_ids:[],uses_consumed:0,uses_refunded:0,result:'',summary}));
  return {title:text(fields.title,200),summary:text(fields.summary,4000),interaction_signature:text(fields.interactionSignature,1000),signature_tokens:signatureTokens,scope:['ABILITY_SPECIFIC','ROLE_SPECIFIC','GAME_SPECIFIC','ONE_TIME'].includes(fields.scope)?fields.scope:'GAME_SPECIFIC',conditions:{notes:text(fields.conditions,8000)},ability_ids:[...new Set(strings(fields.abilityIds))],role_ids:[...new Set(strings(fields.roleIds))],context_role_ids:[...new Set(strings(fields.contextRoleIds))],status_types:[...new Set(strings(fields.statusTypes).map(item=>item.toUpperCase()))],ability_context:records(fields.abilityContext),role_context:records(fields.roleContext),role_modifier_context:records(fields.roleModifierContext),tags:strings(fields.tags),resolution_order:lines(fields.resolutionOrder),expected_results:lines(fields.results),status_changes:lines(fields.statusChanges),deaths:lines(fields.deaths),conversions:lines(fields.conversions),abilities_consumed:lines(fields.abilitiesConsumed),events,reasoning:text(fields.reasoning,12000),post_resolution_state:{notes:text(fields.postState,12000)}};
}

export function validateManualResolution(decision,payload,teachAi=false,explanation='',teachScope='GLOBAL',canTeachGlobally=false){
  const errors=[];
  if(!GM_DECISIONS.has(decision))errors.push('Choose Approve, Modify, or Reject.');
  if(decision==='MODIFY'&&!payload?.expected_results?.length&&!payload?.events?.length)errors.push('A modified resolution needs at least one expected result or event.');
  if(teachAi&&String(explanation).trim().length<3)errors.push('Explain why this ruling should become a precedent.');
  if(teachAi&&!String(payload?.interaction_signature||'').trim())errors.push('Enter an interaction signature before teaching the AI.');
  if(teachAi&&!payload?.signature_tokens?.length)errors.push('Enter at least one signature token before teaching the AI.');
  if(teachAi&&!TEACH_SCOPES.has(teachScope))errors.push('Choose whether to teach this game or all games.');
  if(teachAi&&teachScope==='GLOBAL'&&!canTeachGlobally)errors.push('Only an authorized GM can approve knowledge for all games.');
  if(teachAi&&teachScope==='GLOBAL'&&(payload?.scope==='ROLE_SPECIFIC'||payload?.scope==='ONE_TIME'||payload?.role_ids?.length))errors.push('Role-specific and one-time rulings must stay with this game.');
  return errors;
}

export function precedentVisibility(record,currentGameId){
  if(record?.scope==='GLOBAL')return record?.authority==='GLOBAL_OFFICIAL_RULE'?'GLOBAL OFFICIAL RULE':'GLOBAL';
  return record?.game_id===currentGameId?'CURRENT GAME':String(record?.scope||'GAME_SPECIFIC').replaceAll('_',' ');
}
