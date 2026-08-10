export const KNOWLEDGE_MAX_FILE_SIZE=10*1024*1024;
export const KNOWLEDGE_TYPES=new Set(['GAME_MASTER_RULESET','CHARACTER_ROLE_GUIDE','ABILITY_ENCYCLOPEDIA','ACTION_RESOLUTION_RULES','PLAYER_FAQ','CUSTOM']);
export const KNOWLEDGE_MIME_BY_EXTENSION={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf',txt:'text/plain'};

const text=(value,limit=4000)=>String(value??'').trim().slice(0,limit);
export function knowledgeFileMetadata(file){
  const name=text(file?.name,255),extension=name.toLowerCase().split('.').pop()||'',contentType=KNOWLEDGE_MIME_BY_EXTENSION[extension]||'';
  return {name,extension,contentType,size:Number(file?.size)||0};
}
export function validateKnowledgeFile(file){
  const metadata=knowledgeFileMetadata(file),errors=[];
  if(!metadata.contentType)errors.push('Choose a DOCX, PDF, or TXT document.');
  if(metadata.size<1)errors.push('The document is empty.');
  if(metadata.size>KNOWLEDGE_MAX_FILE_SIZE)errors.push('The document must be 10 MB or smaller.');
  return errors;
}
export function knowledgeDocumentKey(title,id){
  const slug=text(title,80).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70)||'document';
  return `${slug}-${String(id||'').replace(/-/g,'').slice(0,12)}`;
}
export function reconcileOfficialAbilities(officialAbilities=[],gameState={}){
  const normalize=value=>text(value,200).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),gameAbilities=Array.isArray(gameState.abilities)?gameState.abilities:[],roles=Array.isArray(gameState.roles)?gameState.roles:[];
  const rows=officialAbilities.map(official=>{
    const names=[official.display_name,...(Array.isArray(official.aliases)?official.aliases:[])].map(normalize),gameAbility=gameAbilities.find(ability=>names.includes(normalize(ability.name))),usedByRoles=roles.filter(role=>(role.tags||[]).some(tag=>names.includes(normalize(tag)))).map(role=>role.name);
    return {abilityId:official.ability_id,displayName:official.display_name,definitionStatus:official.definition_status,gameAbilityId:gameAbility?.id||null,gameAbilityName:gameAbility?.name||null,usedByRoles};
  });
  return {rows,matched:rows.filter(row=>row.gameAbilityId).length,unmatched:rows.filter(row=>!row.gameAbilityId).length,missingDefinitions:rows.filter(row=>row.definitionStatus==='NEEDS_SOURCE_TEXT').length,roleLinks:rows.reduce((sum,row)=>sum+row.usedByRoles.length,0)};
}
