export const STATUS_STATES=Object.freeze(['ACTIVE','PENDING','RESOLVED','EXPIRED','CONSUMED']);
export const STATUS_CATEGORIES=Object.freeze(['HARMFUL','PROTECTION','PASSIVE','TEMPORARY','PERMANENT','CUSTOM']);
export const STATUS_VISIBILITIES=Object.freeze(['GM_ONLY','OWNER_VISIBLE','FACTION_VISIBLE','PUBLIC']);

export const PLAYER_STATUS_TYPES=Object.freeze([
  {value:'ROLEBLOCK',label:'Blocked',name:'Roleblock',category:'HARMFUL'},
  {value:'MARK',label:'Marked',name:'Mark',category:'HARMFUL'},
  {value:'POISON',label:'Poisoned',name:'Poison',category:'HARMFUL'},
  {value:'DRUNK',label:'Drunk',name:'Drunk',category:'HARMFUL'},
  {value:'SOBER',label:'Sober',name:'Sober',category:'HARMFUL'},
  {value:'SILENCED',label:'Silenced',name:'Silenced',category:'HARMFUL'},
  {value:'PROTECT',label:'Protected',name:'Protect',category:'PROTECTION'},
  {value:'SUPER_PROTECT',label:'Super Protected',name:'Super Protect',category:'PROTECTION'},
  {value:'DEATH_IMMUNITY',label:'Death Immune',name:'Death Immunity',category:'PASSIVE'},
  {value:'BULLETPROOF',label:'Bulletproof',name:'Bulletproof',category:'PASSIVE'},
  {value:'GUARDED',label:'Guarded',name:'Guard',category:'PROTECTION'},
  {value:'REDIRECT',label:'Redirected',name:'Redirect',category:'TEMPORARY'},
  {value:'CONVERTED',label:'Converted',name:'Converted',category:'PERMANENT'},
  {value:'HEALING_PENDING',label:'Healing Pending',name:'Healing Pending',category:'TEMPORARY'},
  {value:'ACTION_SUCCESS_GUARANTEE',label:'Action Guaranteed',name:'Action Success Guarantee',category:'TEMPORARY'},
  {value:'ABILITY_AMPLIFY',label:'Ability Amplified',name:'Ability Amplify',category:'TEMPORARY'},
  {value:'ADDITIONAL_USES',label:'Additional Uses',name:'Additional Uses',category:'TEMPORARY'},
  {value:'TEMPORARY_IMMUNITY',label:'Temporary Immunity',name:'Temporary Immunity',category:'TEMPORARY'},
  {value:'TEMPORARY_RESTRICTION',label:'Temporary Restriction',name:'Temporary Restriction',category:'TEMPORARY'},
  {value:'CUSTOM',label:'Other',name:'Custom Status',category:'CUSTOM'}
]);

const typeByValue=new Map(PLAYER_STATUS_TYPES.map(item=>[item.value,item]));
const clean=(value,limit=4000)=>String(value??'').trim().slice(0,limit);
const nullableNumber=value=>value===''||value==null?null:Number.isFinite(Number(value))?Number(value):null;

export function statusTypeDefinition(value){return typeByValue.get(clean(value,64).toUpperCase())||typeByValue.get('CUSTOM')}

export function normalizePlayerStatus(input={}){
  const statusType=clean(input.status_type??input.statusType,64).toUpperCase()||'CUSTOM',definition=statusTypeDefinition(statusType);
  const state=clean(input.state,20).toUpperCase(),category=clean(input.status_category??input.statusCategory,30).toUpperCase(),visibility=clean(input.visibility,30).toUpperCase();
  return {
    id:clean(input.id,100),gameId:clean(input.game_id??input.gameId,100),playerId:clean(input.player_id??input.playerId,100),subjectUserId:clean(input.subject_user_id??input.subjectUserId,100),
    statusType,statusName:clean(input.status_name??input.statusName,120)||definition.name,statusCategory:STATUS_CATEGORIES.includes(category)?category:definition.category,
    sourcePlayerId:clean(input.source_player_id??input.sourcePlayerId,100),sourceRoleId:clean(input.source_role_id??input.sourceRoleId,100),sourceAbilityId:clean(input.source_ability_id??input.sourceAbilityId,100),
    description:clean(input.description),appliedAtCycle:nullableNumber(input.applied_at_cycle??input.appliedAtCycle),appliedAtPhase:clean(input.applied_at_phase??input.appliedAtPhase,30),
    duration:clean(input.duration,200),expiresAtCycle:nullableNumber(input.expires_at_cycle??input.expiresAtCycle),expiresAtPhase:clean(input.expires_at_phase??input.expiresAtPhase,30),remainingDuration:nullableNumber(input.remaining_duration??input.remainingDuration),
    stackCount:Math.max(1,nullableNumber(input.stack_count??input.stackCount)||1),state:STATUS_STATES.includes(state)?state:'ACTIVE',visibility:STATUS_VISIBILITIES.includes(visibility)?visibility:'GM_ONLY',
    dispellable:input.dispellable!==false,metadata:input.metadata&&typeof input.metadata==='object'&&!Array.isArray(input.metadata)?input.metadata:{},createdAt:input.created_at??input.createdAt??null,updatedAt:input.updated_at??input.updatedAt??null,
    createdBy:clean(input.created_by??input.createdBy,100),updatedBy:clean(input.updated_by??input.updatedBy,100)
  };
}

export function statusLabel(effect){const status=normalizePlayerStatus(effect),definition=statusTypeDefinition(status.statusType);return status.statusType==='CUSTOM'?status.statusName:definition.label}
export function statusIsCurrent(effect){return ['ACTIVE','PENDING'].includes(normalizePlayerStatus(effect).state)}

export function statusesForPlayer(statuses,playerId){return (Array.isArray(statuses)?statuses:[]).map(normalizePlayerStatus).filter(status=>status.playerId===playerId)}

export function groupPlayerStatuses(statuses,playerId){
  const playerStatuses=statusesForPlayer(statuses,playerId),current=playerStatuses.filter(status=>status.state==='ACTIVE'),pending=playerStatuses.filter(status=>status.state==='PENDING'),resolved=playerStatuses.filter(status=>['RESOLVED','EXPIRED','CONSUMED'].includes(status.state));
  return {
    active:current.filter(status=>!['PASSIVE','PERMANENT'].includes(status.statusCategory)),
    passive:current.filter(status=>status.statusCategory==='PASSIVE'),
    pending,
    permanent:current.filter(status=>status.statusCategory==='PERMANENT'),
    resolved
  };
}

export function playerMatchesStatusFilter(statuses,playerId,filter,currentCycle,currentPhase){
  if(!filter||filter==='ALL')return true;
  const items=statusesForPlayer(statuses,playerId);
  if(filter==='ANY_ACTIVE')return items.some(status=>status.state==='ACTIVE');
  if(filter==='PENDING')return items.some(status=>status.state==='PENDING');
  if(filter==='EXPIRING_CURRENT')return items.some(status=>status.state==='ACTIVE'&&status.expiresAtCycle===Number(currentCycle)&&(!status.expiresAtPhase||status.expiresAtPhase===currentPhase));
  return items.some(status=>status.state==='ACTIVE'&&status.statusType===filter);
}

export function parseStatusProposalValue(value){
  let parsed=value;
  if(typeof value==='string'){try{parsed=JSON.parse(value)}catch{return null}}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
  const normalized=normalizePlayerStatus(parsed);
  if(!/^[A-Z][A-Z0-9_]{1,63}$/.test(normalized.statusType))return null;
  if(normalized.statusType==='CUSTOM'&&!normalized.statusName)return null;
  return normalized;
}

export function statusMutationPayload(status={}){
  const value=normalizePlayerStatus(status);
  return {
    player_id:value.playerId,subject_user_id:value.subjectUserId||null,status_type:value.statusType,status_name:value.statusName,status_category:value.statusCategory,
    source_player_id:value.sourcePlayerId||null,source_role_id:value.sourceRoleId||null,source_ability_id:value.sourceAbilityId||null,description:value.description,
    applied_at_cycle:value.appliedAtCycle,applied_at_phase:value.appliedAtPhase||null,duration:value.duration||null,expires_at_cycle:value.expiresAtCycle,expires_at_phase:value.expiresAtPhase||null,
    remaining_duration:value.remainingDuration,stack_count:value.stackCount,state:value.state,visibility:value.visibility,dispellable:value.dispellable,metadata:value.metadata
  };
}
