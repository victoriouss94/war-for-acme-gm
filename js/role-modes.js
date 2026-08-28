const clean=(value,limit=4000)=>String(value??'').trim().slice(0,limit);
const key=value=>clean(value,500).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const list=value=>Array.isArray(value)?value:[];
const unique=value=>[...new Set(list(value).map(item=>clean(item,160)).filter(Boolean))];
const slug=value=>key(value).replace(/\s+/g,'-')||'mode';

export const MODE_SELECTION_POLICIES=Object.freeze(['CURRENT_ONLY','CHOOSE_BEFORE_ACTION']);

export function isModeContextAbility(ability={},role={}){
  if(ability.modeContextOnly===true||ability.selectableAsAction===false||String(ability.recordType||'').toUpperCase()==='MODE_CONTEXT')return true;
  const name=clean(ability.name,300),roleName=clean(role.name,200);
  if(!/\b(?:robot|alt)\s+mode\b/i.test(name))return false;
  return !roleName||key(name).startsWith(key(roleName)+' ');
}

export function normalizeRoleModes(role={},abilities=[]){
  const byId=new Map(abilities.map(ability=>[String(ability.id),ability])),byName=new Map(abilities.map(ability=>[key(ability.name),ability]));
  let modes=list(role.modes).map((mode,index)=>{
    const name=clean(mode?.name||mode?.label||`Mode ${index+1}`,120),abilityNames=unique(mode?.abilityNames??mode?.ability_names),passiveAbilityNames=unique(mode?.passiveAbilityNames??mode?.passive_ability_names);
    return {
      id:clean(mode?.id||`${role.id||'role'}:mode:${slug(name)}`,160),name,
      abilityIds:unique([...(mode?.abilityIds||mode?.ability_ids||[]),...abilityNames.map(name=>byName.get(key(name))?.id)]).filter(id=>byId.has(String(id))||!abilities.length),
      passiveAbilityIds:unique([...(mode?.passiveAbilityIds||mode?.passive_ability_ids||[]),...passiveAbilityNames.map(name=>byName.get(key(name))?.id)]).filter(id=>byId.has(String(id))||!abilities.length),
      sourceAbilityId:clean(mode?.sourceAbilityId??mode?.source_ability_id,160),sourceText:clean(mode?.sourceText??mode?.source_text,12000),sourceLocation:clean(mode?.sourceLocation??mode?.source_location,500)
    };
  }).filter(mode=>mode.name);
  if(!modes.length&&abilities.length){
    const tagKeys=new Set(list(role.tags).map(key));
    modes=abilities.filter(ability=>tagKeys.has(key(ability.name))&&isModeContextAbility(ability,role)).map((ability,index)=>{
      const raw=clean(ability.name).replace(new RegExp('^'+clean(role.name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*[—–-]\\s*','i'),'');
      const match=raw.match(/((?:Robot|Alt)\s+Mode)(?:\s*:\s*(.+))?/i),name=match?match[1].replace(/^\w/,letter=>letter.toUpperCase()):raw||`Mode ${index+1}`;
      return {id:`${role.id||'role'}:mode:${slug(name)}`,name,abilityIds:[],passiveAbilityIds:[],sourceAbilityId:String(ability.id),sourceText:ability.sourceText||ability.definition||ability.name,sourceLocation:ability.sourceLocation||''};
    });
  }
  const seen=new Set();modes=modes.filter(mode=>{const normalized=key(mode.name);if(!normalized||seen.has(normalized))return false;seen.add(normalized);return true});
  const modeAbilityIds=new Set(modes.flatMap(mode=>[...mode.abilityIds,...mode.passiveAbilityIds]).map(String));
  const explicitWide=unique(role.roleWideAbilityIds??role.role_wide_ability_ids),tagKeys=new Set(list(role.tags).map(key));
  const derivedWide=abilities.filter(ability=>tagKeys.has(key(ability.name))&&!isModeContextAbility(ability,role)&&!modeAbilityIds.has(String(ability.id))).map(ability=>String(ability.id));
  const roleWideAbilityIds=unique(explicitWide.length?explicitWide:derivedWide).filter(id=>byId.has(String(id))||!abilities.length);
  const policy=MODE_SELECTION_POLICIES.includes(String(role.modeSelectionPolicy||'').toUpperCase())?String(role.modeSelectionPolicy).toUpperCase():'CURRENT_ONLY';
  return {modes,roleWideAbilityIds,modeSelectionPolicy:policy};
}

function metadataModeIds(value={}){return unique([...(value.modeIds||value.mode_ids||[]),...(value.modeAccessIds||value.mode_access_ids||[])]);}

export function roleModeContext({player={},role={},abilities=[],grants=[],statuses=[],selectedModeId=''}={}){
  const model=normalizeRoleModes(role,abilities),modeIds=new Set(model.modes.map(mode=>mode.id));
  let currentModeId=clean(player.currentModeId??player.current_mode_id,160);if(!modeIds.has(currentModeId))currentModeId=model.modes.length===1?model.modes[0].id:'';
  const temporaryModeIds=new Set();
  for(const status of statuses)if(String(status.playerId??status.player_id)===String(player.id)&&String(status.state||'ACTIVE').toUpperCase()==='ACTIVE')for(const id of metadataModeIds(status.metadata||{}))if(modeIds.has(id))temporaryModeIds.add(id);
  for(const grant of grants)if(String(grant.playerId??grant.player_id)===String(player.id)&&String(grant.status||'ACTIVE').toUpperCase()==='ACTIVE')for(const id of [...metadataModeIds(grant.specialConditions??grant.special_conditions??{}),...metadataModeIds(grant.metadata||{})])if(modeIds.has(id))temporaryModeIds.add(id);
  let selected=clean(selectedModeId,160);if(!modeIds.has(selected))selected=currentModeId||model.modes[0]?.id||'';
  const accessibleModeIds=new Set(temporaryModeIds);if(currentModeId)accessibleModeIds.add(currentModeId);if(model.modeSelectionPolicy==='CHOOSE_BEFORE_ACTION')for(const id of modeIds)accessibleModeIds.add(id);if(!currentModeId&&selected)accessibleModeIds.add(selected);
  return {...model,currentModeId,selectedModeId:selected,temporaryModeIds:[...temporaryModeIds],accessibleModeIds:[...accessibleModeIds]};
}

export function abilityModeAccess({abilityId,context}){
  const id=String(abilityId||''),wide=context.roleWideAbilityIds.includes(id),modes=context.modes.filter(mode=>mode.abilityIds.includes(id)||mode.passiveAbilityIds.includes(id)),selectedMode=modes.find(mode=>mode.id===context.selectedModeId)||null,temporaryModes=modes.filter(mode=>context.temporaryModeIds.includes(mode.id));
  const available=wide||Boolean(selectedMode&&context.accessibleModeIds.includes(selectedMode.id))||temporaryModes.length>0;
  return {available,roleWide:wide,modes,selectedMode,temporaryModes,modeId:selectedMode?.id||temporaryModes[0]?.id||'',modeName:selectedMode?.name||temporaryModes[0]?.name||''};
}

export function parseRoleModeAssignments(value,abilities=[],selectedAbilityIds=[]){
  const selected=new Set(selectedAbilityIds.map(String)),byName=new Map(abilities.map(ability=>[key(ability.name),ability])),modes=[],used=new Set(),errors=[];
  for(const [index,line] of clean(value,12000).split(/\r?\n/).map(item=>item.trim()).filter(Boolean).entries()){
    const separator=line.indexOf(':');if(separator<1){errors.push(`Mode line ${index+1} must use "Mode: Ability, Ability".`);continue}
    const name=clean(line.slice(0,separator),120),names=line.slice(separator+1).split(',').map(item=>clean(item,120)).filter(Boolean);if(!name){errors.push(`Mode line ${index+1} needs a name.`);continue}if(modes.some(mode=>key(mode.name)===key(name))){errors.push(`Mode name "${name}" is duplicated.`);continue}
    const abilityIds=[];for(const abilityName of names){const ability=byName.get(key(abilityName));if(!ability){errors.push(`Mode "${name}" references unknown ability "${abilityName}".`);continue}if(!selected.has(String(ability.id))){errors.push(`Select "${ability.name}" in Role Abilities before assigning it to ${name}.`);continue}if(isModeContextAbility(ability)){errors.push(`"${ability.name}" is mode context, not a selectable action.`);continue}abilityIds.push(String(ability.id));used.add(String(ability.id))}
    modes.push({id:`mode:${slug(name)}`,name,abilityIds:[...new Set(abilityIds)],passiveAbilityIds:[],sourceAbilityId:'',sourceText:'',sourceLocation:''});
  }
  return {modes,roleWideAbilityIds:[...selected].filter(id=>!used.has(id)),errors};
}

export function formatRoleModeAssignments(role={},abilities=[]){
  const byId=new Map(abilities.map(ability=>[String(ability.id),ability]));return normalizeRoleModes(role,abilities).modes.map(mode=>`${mode.name}: ${[...mode.abilityIds,...mode.passiveAbilityIds].map(id=>byId.get(String(id))?.name).filter(Boolean).join(', ')}`).join('\n');
}
