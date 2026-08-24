export const MASTER_GM_MAX_TOOL_CALLS=12;
export const MASTER_GM_TOOL_TIMEOUT_MS=8000;

const tool=(name,{permission='GM',readOnly=true,approvalRequired=false,gameScoped=true,inputs=[],output='object',audit=true}={})=>Object.freeze({name,permission,readOnly,approvalRequired,gameScoped,inputs:Object.freeze(inputs),output,audit});

export const MASTER_GM_TOOLS=Object.freeze({
  getCurrentGame:tool('getCurrentGame',{inputs:['gameId'],output:'focused game context'}),
  getGame:tool('getGame',{inputs:['gameId'],output:'authorized game metadata'}),
  searchGames:tool('searchGames',{gameScoped:false,inputs:['query'],output:'authorized GM game summaries'}),
  getGameRules:tool('getGameRules',{inputs:['gameId'],output:'active current-game rules'}),
  getGlobalSettings:tool('getGlobalSettings',{gameScoped:false,inputs:['gameId'],output:'owner-scoped versioned global fallback rules'}),
  getEffectiveRuleset:tool('getEffectiveRuleset',{inputs:['gameId'],output:'dynamic game overrides and granular global fallbacks'}),
  searchRules:tool('searchRules',{inputs:['gameId','query'],output:'matching rules'}),
  getPlayer:tool('getPlayer',{inputs:['gameId','playerId'],output:'player record'}),
  searchPlayers:tool('searchPlayers',{inputs:['gameId','query'],output:'matching player references'}),
  getPlayerState:tool('getPlayerState',{inputs:['gameId','playerId'],output:'live player state'}),
  getPlayerStatuses:tool('getPlayerStatuses',{inputs:['gameId','playerId'],output:'visible live effects'}),
  getPlayersByStatus:tool('getPlayersByStatus',{inputs:['gameId','statusType'],output:'matching live effects'}),
  getRosterAnalysis:tool('getRosterAnalysis',{inputs:['gameId'],output:'deterministic player, role-slot, Basic Role, and unassigned counts'}),
  getUnassignedPlayers:tool('getUnassignedPlayers',{inputs:['gameId'],output:'players without a live role assignment'}),
  getAvailableRoleSlots:tool('getAvailableRoleSlots',{inputs:['gameId'],output:'expanded existing role slots without changing game design'}),
  getRole:tool('getRole',{inputs:['gameId','roleId'],output:'role and linked abilities'}),
  searchRoles:tool('searchRoles',{inputs:['gameId','query'],output:'matching role references'}),
  getAbility:tool('getAbility',{inputs:['gameId','abilityId'],output:'game and standardized ability definitions'}),
  searchAbilities:tool('searchAbilities',{inputs:['gameId','query'],output:'matching ability references'}),
  getFaction:tool('getFaction',{inputs:['gameId','factionId'],output:'faction record'}),
  searchFactions:tool('searchFactions',{inputs:['gameId','query'],output:'matching faction references'}),
  getSubmittedActions:tool('getSubmittedActions',{inputs:['gameId','resolutionSessionId'],output:'queued or snapshotted actions'}),
  getResolutionSession:tool('getResolutionSession',{inputs:['gameId','resolutionSessionId'],output:'resolution snapshot'}),
  searchResolutions:tool('searchResolutions',{inputs:['gameId','query'],output:'matching historical resolutions'}),
  searchPrecedents:tool('searchPrecedents',{inputs:['gameId','signature','query'],output:'compatible current and global precedents'}),
  searchDocuments:tool('searchDocuments',{inputs:['gameId','query'],output:'authorized cited document chunks'}),
  getAuditHistory:tool('getAuditHistory',{inputs:['gameId','query'],output:'matching game change records'}),
  createRoleDraft:tool('createRoleDraft',{readOnly:false,inputs:['gameId','payload'],output:'reviewable role draft'}),
  createAbilityDraft:tool('createAbilityDraft',{readOnly:false,inputs:['gameId','payload'],output:'reviewable ability draft'}),
  createFactionDraft:tool('createFactionDraft',{readOnly:false,inputs:['gameId','payload'],output:'reviewable faction draft'}),
  createRuleDraft:tool('createRuleDraft',{readOnly:false,inputs:['gameId','payload'],output:'reviewable rule draft'}),
  createStatusDraft:tool('createStatusDraft',{readOnly:false,inputs:['gameId','payload'],output:'reviewable status draft'}),
  createDocumentImportDraft:tool('createDocumentImportDraft',{readOnly:false,inputs:['gameId','documentId'],output:'reviewable document-import draft'}),
  createAssignmentPreview:tool('createAssignmentPreview',{readOnly:false,inputs:['gameId','gameVersion','lockedAssignments','factionConstraints','replaceExisting'],output:'reviewable server-randomized preview'}),
  shuffleAssignmentPreview:tool('shuffleAssignmentPreview',{readOnly:false,inputs:['previewId','previewVersion'],output:'new preview preserving locks and constraints'}),
  applyApprovedAssignments:tool('applyApprovedAssignments',{readOnly:false,approvalRequired:true,inputs:['previewId','previewVersion','confirmActiveGame'],output:'audited existing player role assignments'}),
  proposeRoleUpdate:tool('proposeRoleUpdate',{readOnly:false,approvalRequired:true,inputs:['gameId','roleId','patch','sourceVersion'],output:'pending proposal'}),
  proposeAbilityUpdate:tool('proposeAbilityUpdate',{readOnly:false,approvalRequired:true,inputs:['gameId','abilityId','patch','sourceVersion'],output:'pending proposal'}),
  proposeFactionUpdate:tool('proposeFactionUpdate',{readOnly:false,approvalRequired:true,inputs:['gameId','factionId','patch','sourceVersion'],output:'pending proposal'}),
  proposeRuleUpdate:tool('proposeRuleUpdate',{readOnly:false,approvalRequired:true,inputs:['gameId','ruleId','patch','sourceVersion'],output:'pending proposal'}),
  proposeGameUpdate:tool('proposeGameUpdate',{readOnly:false,approvalRequired:true,inputs:['gameId','patch','sourceVersion'],output:'pending proposal'}),
  proposeGlobalRuleUpdate:tool('proposeGlobalRuleUpdate',{readOnly:false,approvalRequired:true,gameScoped:false,inputs:['gameId','globalRuleId','patch','expectedVersion'],output:'pending versioned global rule proposal'}),
  proposeStatusChange:tool('proposeStatusChange',{readOnly:false,approvalRequired:true,inputs:['gameId','playerId','statusPayload','sourceVersion'],output:'pending proposal'}),
  analyzeActions:tool('analyzeActions',{inputs:['gameId','resolutionSessionId'],output:'structured resolution analysis'}),
  applyApprovedProposal:tool('applyApprovedProposal',{readOnly:false,approvalRequired:true,inputs:['proposalId','expectedVersion','decision'],output:'atomic application result'})
});

const normalized=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const unique=value=>[...new Set(value)];

export function inferMasterIntent(message,requestedTask='auto'){
  const explicit=String(requestedTask||'auto');
  if(explicit==='explain_role')return 'explain_content';
  if(explicit==='balance_role')return 'analyze_balance';
  if(explicit&&explicit!=='auto'&&explicit!=='assistant')return explicit;
  const query=normalized(message);
  if(/\b(resolve|process|analy[sz]e)\b.*\b(actions?|tonight|queue|night)\b|\bresolve tonight\b/.test(query))return 'resolve_actions';
  if(/\b(read|import|add|build|create)\b.*\b(document|docx|pdf|file)\b/.test(query))return 'document_import';
  if(/\b(global settings?|global fallback|global rules?|every game|all games|from now on)\b/.test(query)&&/\b(add|create|change|edit|update|set|remove|disable|enable|use)\b/.test(query))return 'edit_content';
  if(/\b(give|change|edit|update|increase|decrease|remove|mark|block|protect|poison|make .*stronger|make .*weaker)\b/.test(query))return 'edit_content';
  if(/\b(create|make|design|draft|add)\b.*\b(role)\b/.test(query))return 'create_role';
  if(/\b(roster|unassigned players?|unused roles?|role slots?|random(?:ly|ize)?|shuffle|reroll|assign everyone|assign players?)\b/.test(query))return 'roster_setup';
  if(/\b(create|make|design|draft|add)\b.*\b(ability|power)\b/.test(query))return 'create_ability';
  if(/\b(create|make|design|draft|add)\b.*\b(faction|team|alignment)\b/.test(query))return 'create_faction';
  if(/\b(create|make|draft|add)\b.*\b(rule)\b/.test(query))return 'create_rule';
  if(/\b(create|make|design|draft|build)\b.*\b(game)\b/.test(query))return 'assistant';
  if(/\b(create|make|draft|add)\b.*\b(status|effect)\b/.test(query))return 'create_status';
  if(/\b(balance|overpowered|underpowered|advantage|too many|compare)\b/.test(query))return 'analyze_balance';
  if(/\b(last night|yesterday|why .*die|what happened|show me what changed|audit|history)\b/.test(query))return 'search_history';
  if(/\b(have we|seen this|last time|normally rule|usually resolve|precedent)\b/.test(query))return 'search_precedents';
  if(/\b(blocked|roleblock|marked|poisoned|protected|guarded|death immune|bulletproof|redirected|converted|status|effect|affecting|can .* act|unable to act)\b/.test(query))return 'live_status';
  if(/\b(what does|what is|explain|abilities does|roles use)\b/.test(query))return 'explain_content';
  if(/\b(plan|next phase|next day|next night)\b/.test(query))return 'plan_session';
  return 'assistant';
}

export function isWriteIntent(intent){return ['create_role','create_ability','create_faction','create_rule','create_status','document_import','edit_content'].includes(intent)}

function aliases(record){return unique([record?.name,record?.nickname,record?.display_name,...(Array.isArray(record?.aliases)?record.aliases:[]),...(Array.isArray(record?.labels)?record.labels:[])].map(normalized).filter(value=>value.length>1));}
function entityRef(type,record){return {type,id:String(record?.id||''),name:String(record?.name||record?.title||record?.display_name||record?.id||''),label:String(record?.name||record?.title||record?.display_name||record?.id||'')};}

export function resolveMasterEntities(message,indexes={},conversationContext={}){
  const query=' '+normalized(message)+' ';let refs=[];const ambiguous=[];
  const groups=[['player',indexes.players],['role',indexes.roles],['ability',indexes.abilities],['faction',indexes.factions],['rule',indexes.rules],['game',indexes.games]];
  for(const [type,records] of groups){
    const matches=(Array.isArray(records)?records:[]).filter(record=>aliases(record).some(alias=>query.includes(' '+alias+' ')));
    const byName=new Map();for(const record of matches){const key=normalized(record.name||record.title);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(record)}
    for(const recordsWithName of byName.values())if(recordsWithName.length>1)ambiguous.push({type,query:recordsWithName[0]?.name||recordsWithName[0]?.title||'',matches:recordsWithName.slice(0,10).map(record=>entityRef(type,record))});else refs.push(entityRef(type,recordsWithName[0]));
  }
  const directPlayers=refs.filter(ref=>ref.type==='player');
  if(!directPlayers.length&&/\b(she|her|hers|he|him|his|they|them|their|that player|this player)\b/i.test(message)){
    const previous=(Array.isArray(conversationContext?.last_entities)?conversationContext.last_entities:[]).filter(ref=>ref?.type==='player'&&ref?.id);
    if(previous.length===1)refs.push({...previous[0],from_context:true});else if(previous.length>1)ambiguous.push({type:'player',query:'conversation pronoun',matches:previous.slice(0,10)});
  }
  const crossType=new Map();for(const ref of refs){const key=normalized(ref.name);if(!crossType.has(key))crossType.set(key,[]);crossType.get(key).push(ref)}
  const intent=inferMasterIntent(message),preferredType={create_role:'role',create_ability:'ability',create_faction:'faction',create_rule:'rule'}[intent]||(/\bplayer\b/i.test(message)?'player':/\brole\b/i.test(message)?'role':/\bability\b/i.test(message)?'ability':/\bfaction\b/i.test(message)?'faction':/\brule\b/i.test(message)?'rule':'');
  if(isWriteIntent(intent)){for(const [name,matches] of crossType)if(matches.length>1){const preferred=matches.filter(item=>item.type===preferredType);if(preferred.length===1)refs=refs.filter(item=>normalized(item.name)!==name||item.type===preferredType);else ambiguous.push({type:'entity',query:name,matches})}}
  const seen=new Set();return {references:refs.filter(ref=>{const key=ref.type+':'+ref.id;if(seen.has(key))return false;seen.add(key);return true}),ambiguous};
}

export function statusTypeFromMessage(message){
  const query=normalized(message),pairs=[['ACTION_SUCCESS_GUARANTEED','action success guarantee'],['SUPER_PROTECT','super protect'],['DEATH_IMMUNITY','death immune'],['ROLEBLOCK','roleblock'],['ROLEBLOCK','blocked'],['BULLETPROOF','bulletproof'],['POISON','poison'],['MARK','marked'],['PROTECT','protected'],['GUARDED','guarded'],['REDIRECT','redirected'],['CONVERTED','converted'],['DRUNK','drunk'],['SOBER','sober'],['AMPLIFIED','amplified']];
  return pairs.find(([,term])=>query.includes(term))?.[0]||'';
}

export function requestedPlayerName(message){
  const text=String(message||'').trim();
  const patterns=[/^(?:is|can|why can(?:not|'t)?|what(?:'s| is))\s+(.+?)\s+(?:blocked|marked|poisoned|protected|guarded|affected|unable|able|doing|happening)/i,/^(?:show|tell)\s+me\s+(?:about\s+)?(.+?)[?.!]*$/i,/what(?:'s| is)\s+(?:happening with|affecting)\s+(.+?)[?.!]*$/i,/remove\s+(.+?)(?:'s|s')\s+/i,/\b(?:mark|block|protect)\s+(.+?)(?:\s+(?:tonight|today))?[?.!]*$/i];
  return String(patterns.map(pattern=>text.match(pattern)?.[1]||'').find(Boolean)||'').replace(/[?.!,]+$/,'').trim();
}

export function toolsForMasterIntent(intent,{hasPlayer=false,hasAbility=false,hasRole=false,hasFaction=false}={}){
  const tools=['getCurrentGame','getEffectiveRuleset'];
  if(intent==='live_status')tools.push(hasPlayer?'getPlayerState':'getPlayersByStatus');
  if(intent==='roster_setup')tools.push('getRosterAnalysis','getUnassignedPlayers','getAvailableRoleSlots','createAssignmentPreview','shuffleAssignmentPreview','applyApprovedAssignments');
  if(intent==='explain_content')tools.push(hasAbility?'getAbility':hasRole?'getRole':'searchAbilities','searchRoles');
  if(intent==='search_history')tools.push('searchResolutions','getAuditHistory');
  if(intent==='search_precedents')tools.push('searchPrecedents');
  if(intent==='resolve_actions')tools.push('getSubmittedActions','getPlayerStatuses','getGameRules','searchPrecedents','searchDocuments','analyzeActions');
  if(['create_role','create_ability','create_faction','create_rule','create_status','edit_content','analyze_balance','plan_session'].includes(intent))tools.push('searchRoles','searchAbilities','searchFactions','getGameRules');
  const draftTool={create_role:'createRoleDraft',create_ability:'createAbilityDraft',create_faction:'createFactionDraft',create_rule:'createRuleDraft',create_status:'createStatusDraft',document_import:'createDocumentImportDraft'}[intent];if(draftTool)tools.push(draftTool);
  if(intent==='edit_content')tools.push(hasPlayer?'proposeStatusChange':hasRole?'proposeRoleUpdate':hasAbility?'proposeAbilityUpdate':hasFaction?'proposeFactionUpdate':'proposeGameUpdate');
  if(intent==='edit_content')tools.push('getGlobalSettings','proposeGlobalRuleUpdate');
  if(intent==='edit_content'&&hasPlayer)tools.push('getPlayerState');
  if(['assistant','explain_content','create_role','create_ability','create_rule','edit_content','analyze_balance','plan_session'].includes(intent))tools.push('searchDocuments');
  if(hasFaction&&intent==='assistant')tools.push('getFaction');
  return unique(tools).filter(name=>MASTER_GM_TOOLS[name]).slice(0,MASTER_GM_MAX_TOOL_CALLS);
}

const effectLabel=effect=>String(effect?.status_name||effect?.status_type||'Unknown effect').replaceAll('_',' ');
export function deterministicLiveAnswer({message,players=[],roles=[],factions=[],effects=[],playerState=null,references=[]}={}){
  const query=normalized(message),statusType=statusTypeFromMessage(message),playerRef=references.find(ref=>ref.type==='player');
  if(/^who\b|\beveryone\b|\bshow\b/.test(query)&&(/status|effect|affecting|harmful/.test(query)||statusType)){
    const active=effects.filter(effect=>String(effect?.state||'').toUpperCase()==='ACTIVE').filter(effect=>statusType?String(effect?.status_type||'').toUpperCase()===statusType:/harmful/.test(query)?String(effect?.status_category||'').toUpperCase()==='HARMFUL':true);
    const ids=unique(active.map(effect=>String(effect.player_id||effect.playerId||'')).filter(Boolean)),names=ids.map(id=>players.find(player=>String(player.id)===id)?.name||id);
    return {handled:true,answer:names.length?(statusType?`${names.length} player${names.length===1?' is':'s are'} ${statusType.toLowerCase().replaceAll('_',' ')}: ${names.join(', ')}.`:`${names.length} player${names.length===1?' has':'s have'} matching active effects: ${names.join(', ')}.`):statusType?`No player currently has an active ${statusType.toLowerCase().replaceAll('_',' ')} status.`:'No player currently has a matching active effect.',references:ids.map(id=>entityRef('player',players.find(player=>String(player.id)===id)||{id,name:id})),statusType};
  }
  if(playerRef&&playerState&&(/status|effect|affecting|happening|blocked|marked|poison|protect|guard|immune|bulletproof|redirect|convert|can .* act/.test(query))){
    const active=[...(playerState.activeEffects||[]),...(playerState.passiveEffects||[]),...(playerState.permanentStateChanges||[])],pending=playerState.pendingEffects||[],role=playerState.currentRole?.name||'not assigned',faction=playerState.currentFaction?.name||'not assigned';
    let answer=`${playerState.playerName||playerRef.name} is ${String(playerState.aliveStatus||'UNKNOWN').toLowerCase()}, with role ${role} and faction ${faction}.`;
    if(statusType){const found=active.some(effect=>String(effect.status_type||'').toUpperCase()===statusType);answer+=` ${found?'They currently have':'They do not currently have'} an active ${statusType.toLowerCase().replaceAll('_',' ')} status.`}
    else answer+=active.length?` Active effects: ${active.map(effectLabel).join(', ')}.`:' No active effects are recorded.';
    if(pending.length)answer+=` Pending effects: ${pending.map(effectLabel).join(', ')}.`;
    return {handled:true,answer,references:[playerRef],statusType};
  }
  const requested=requestedPlayerName(message);
  if(requested&&!playerRef&&intentLooksLikePlayerStatus(message))return {handled:true,missing:true,answer:`I could not find a player named “${requested}” in the current game, so I did not infer or change any status.`,references:[],statusType};
  return {handled:false};
}

export function intentLooksLikePlayerStatus(message){return inferMasterIntent(message)==='live_status'}

export function publicToolTrace(trace=[]){const seen=new Set();return (Array.isArray(trace)?trace:[]).filter(item=>{const name=String(item?.name||'');if(!name||seen.has(name)||seen.size>=MASTER_GM_MAX_TOOL_CALLS)return false;seen.add(name);return true}).map(item=>{const summary=item?.summary||(item?.output?.matches!=null?`${item.output.matches} matching record(s)`:item?.success===false?'Lookup failed.':'Completed.');return {name:String(item?.name||''),success:Boolean(item?.success),duration_ms:Math.max(0,Number(item?.duration_ms)||0),summary:String(summary).slice(0,500)}})}

export function nextConversationContext(current={},references=[]){
  const latest=Array.isArray(references)?references.filter(ref=>ref?.type&&ref?.id).slice(-20):[];
  const previous=Array.isArray(current?.last_entities)?current.last_entities:[];
  const combined=[...latest,...previous].filter((ref,index,all)=>all.findIndex(item=>item.type===ref.type&&item.id===ref.id)===index).slice(0,20);
  return {last_entities:combined,updated_at:new Date().toISOString()};
}
