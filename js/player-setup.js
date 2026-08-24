export const ROLE_TYPES=Object.freeze({STANDARD:'STANDARD',BASIC:'BASIC'});
export const ABILITY_DATA_STATUSES=Object.freeze({COMPLETE:'COMPLETE',INTENTIONALLY_NONE:'INTENTIONALLY_NONE',POSSIBLY_INCOMPLETE:'POSSIBLY_INCOMPLETE'});
const BASIC_EVIDENCE=/\b(?:basic\s+role|no\s+(?:role\s+)?abilit(?:y|ies)|no\s+powers?|vanilla|regular\s+(?:villager|village|town|den|neutral)(?:\s+role)?)\b/i;
const text=value=>String(value??'').trim();
export const normalizedPlayerName=value=>text(value).replace(/\s+/g,' ').toLocaleLowerCase();

export function classifyRoleAbilityData(role={}){
  const evidence=text([role.basicEvidence,role.description,role.notes,role.gmNotes,role.sourceText].filter(Boolean).join('\n'));
  const hasAbilities=Boolean(role.activeAbilityId||role.passiveAbilityId||(role.abilityNames||role.tags||[]).length);
  const explicitType=text(role.roleType||role.role_type).toUpperCase();
  if(explicitType===ROLE_TYPES.BASIC||(!hasAbilities&&BASIC_EVIDENCE.test(evidence)))return {roleType:ROLE_TYPES.BASIC,abilityDataStatus:ABILITY_DATA_STATUSES.INTENTIONALLY_NONE,basicEvidence:text(role.basicEvidence)||evidence.match(BASIC_EVIDENCE)?.[0]||'Explicit Basic Role'};
  if(hasAbilities)return {roleType:ROLE_TYPES.STANDARD,abilityDataStatus:ABILITY_DATA_STATUSES.COMPLETE,basicEvidence:''};
  return {roleType:ROLE_TYPES.STANDARD,abilityDataStatus:ABILITY_DATA_STATUSES.POSSIBLY_INCOMPLETE,basicEvidence:''};
}

export function normalizeRoleSetup(role={}){
  const classification=classifyRoleAbilityData(role),slotCount=Math.max(1,Math.min(1000,Math.trunc(Number(role.slotCount??role.slot_count)||1)));
  return {...classification,slotCount};
}

function uniquePreservingOrder(values){
  const seen=new Set(),result=[];
  for(const value of values){const name=text(value).replace(/\s+/g,' '),key=normalizedPlayerName(name);if(!key||seen.has(key))continue;seen.add(key);result.push(name)}
  return result;
}

function parseCsvRows(source){
  const rows=[];let row=[],cell='',quoted=false;
  for(let index=0;index<=source.length;index++){
    const character=source[index]??'\n',next=source[index+1];
    if(quoted&&character==='"'&&next==='"'){cell+='"';index++;continue}
    if(character==='"'){quoted=!quoted;continue}
    if(!quoted&&character===','){row.push(cell);cell='';continue}
    if(!quoted&&(character==='\n'||character==='\r')){if(character==='\r'&&next==='\n')index++;row.push(cell);if(row.some(value=>text(value)))rows.push(row);row=[];cell='';continue}
    cell+=character;
  }
  return rows;
}

export function parsePlayerText(source,{format='txt'}={}){
  const raw=text(source);if(!raw)return [];
  if(format.toLowerCase()==='csv'){
    const rows=parseCsvRows(raw);if(!rows.length)return [];
    const header=rows[0].map(value=>normalizedPlayerName(value)),nameIndex=header.findIndex(value=>['name','player','player name','username','display name'].includes(value));
    const start=nameIndex>=0?1:0,column=nameIndex>=0?nameIndex:0;
    return rows.slice(start).map(row=>text(row[column])).filter(Boolean);
  }
  return raw.split(/\r?\n|;/).map(line=>text(line.replace(/^[-*•]\s*/,''))).filter(Boolean);
}

export async function parsePlayerFile(file,mammothApi=globalThis.mammoth){
  if(!file)throw new Error('Choose a player-list file.');
  if(Number(file.size)>5*1024*1024)throw new Error('Player-list files must be 5 MB or smaller.');
  const extension=text(file.name).split('.').pop().toLowerCase();
  if(extension==='txt'||extension==='csv')return parsePlayerText(await file.text(),{format:extension});
  if(extension==='docx'){
    if(!mammothApi?.extractRawText)throw new Error('Word document support is unavailable in this browser.');
    const result=await mammothApi.extractRawText({arrayBuffer:await file.arrayBuffer()});
    return parsePlayerText(result.value,{format:'txt'});
  }
  if(extension==='xlsx')throw new Error('XLSX player lists are not supported in this build. Export the name column as CSV and upload it again.');
  throw new Error('Use a TXT, CSV, or DOCX player list.');
}

function editDistance(left,right){
  const a=normalizedPlayerName(left),b=normalizedPlayerName(right),row=Array.from({length:b.length+1},(_,index)=>index);
  for(let i=1;i<=a.length;i++){let previous=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=old}}
  return row[b.length];
}

export function previewPlayerImport(names=[],existingPlayers=[]){
  const detected=names.map(name=>text(name).replace(/\s+/g,' ')).filter(Boolean),invalid=names.map(name=>String(name??'')).filter(name=>!text(name));
  const counts=new Map();detected.forEach(name=>{const key=normalizedPlayerName(name);counts.set(key,(counts.get(key)||0)+1)});
  const duplicates=uniquePreservingOrder(detected.filter(name=>(counts.get(normalizedPlayerName(name))||0)>1));
  const existingByName=new Map(existingPlayers.map(player=>[normalizedPlayerName(player.name),player]));
  const existing=uniquePreservingOrder(detected.filter(name=>existingByName.has(normalizedPlayerName(name))));
  const newPlayers=uniquePreservingOrder(detected.filter(name=>!existingByName.has(normalizedPlayerName(name))));
  const incomingKeys=new Set(detected.map(normalizedPlayerName)),removed=existingPlayers.filter(player=>!incomingKeys.has(normalizedPlayerName(player.name))).map(player=>player.name),unchanged=existingPlayers.filter(player=>incomingKeys.has(normalizedPlayerName(player.name))).map(player=>player.name);
  const possibleRenames=[];
  for(const oldName of removed){const candidate=newPlayers.map(name=>({name,distance:editDistance(oldName,name)})).sort((a,b)=>a.distance-b.distance)[0];if(candidate&&candidate.distance>0&&candidate.distance<=Math.max(1,Math.floor(Math.max(oldName.length,candidate.name.length)*.25)))possibleRenames.push({from:oldName,to:candidate.name})}
  return {detected,count:detected.length,duplicates,existing,invalid,newPlayers,removed,unchanged,possibleRenames};
}

export function expandRoleSlots(roles=[]){
  return roles.filter(role=>role&&role.enabled!==false&&!role.archivedAt).flatMap(role=>Array.from({length:Math.max(1,Math.min(1000,Math.trunc(Number(role.slotCount)||1)))},(_,slotIndex)=>({key:String(role.id)+':'+(slotIndex+1),roleId:String(role.id),slotIndex:slotIndex+1,factionId:String(role.factionId||''),roleType:normalizeRoleSetup(role).roleType,roleName:String(role.name||'Untitled Role')})));
}

export function rosterAnalysis(players=[],roles=[]){
  const slots=expandRoleSlots(roles),assignedRoleIds=new Set(players.map(player=>player.roleId).filter(Boolean));
  return {players:players.length,roleSlots:slots.length,difference:players.length-slots.length,unassignedPlayers:players.filter(player=>!player.roleId).length,assignedPlayers:players.length-players.filter(player=>!player.roleId).length,basicRoleSlots:slots.filter(slot=>slot.roleType===ROLE_TYPES.BASIC).length,unusedRoleSlots:Math.max(0,slots.length-players.length),assignedRoleIds:[...assignedRoleIds]};
}

function secureShuffle(values,randomInt){
  const result=[...values];
  for(let index=result.length-1;index>0;index--){const swap=randomInt(index+1);[result[index],result[swap]]=[result[swap],result[index]]}
  return result;
}

function browserRandomInt(limit){
  if(!globalThis.crypto?.getRandomValues)throw new Error('Secure randomness is unavailable.');
  const maximum=0x100000000-(0x100000000%limit),array=new Uint32Array(1);do globalThis.crypto.getRandomValues(array);while(array[0]>=maximum);return array[0]%limit;
}

export function createAssignmentPlan({players=[],roles=[],lockedAssignments={},factionConstraints={},replaceExisting=false,randomInt=browserRandomInt}={}){
  const slots=expandRoleSlots(roles),roleById=new Map(roles.map(role=>[String(role.id),role])),playerById=new Map(players.map(player=>[String(player.id),player])),assignments={},available=[...slots],locked=new Set();
  const reserve=(playerId,roleId,isLocked=true)=>{
    if(!playerById.has(playerId)||!roleById.has(roleId))throw new Error('A locked assignment references a missing player or role.');
    const index=available.findIndex(slot=>slot.roleId===roleId);if(index<0)throw new Error('A locked role has no remaining slot.');
    assignments[playerId]=roleId;available.splice(index,1);if(isLocked)locked.add(playerId);
  };
  if(!replaceExisting)players.filter(player=>player.roleId).forEach(player=>reserve(String(player.id),String(player.roleId)));
  for(const [playerId,roleId] of Object.entries(lockedAssignments)){if(assignments[playerId]){if(assignments[playerId]!==roleId)throw new Error('A locked assignment conflicts with an existing assignment.');locked.add(playerId)}else reserve(playerId,String(roleId))}
  const remainingPlayers=secureShuffle(players.filter(player=>!assignments[String(player.id)]),randomInt);
  if(remainingPlayers.length>available.length)throw new Error('NOT_ENOUGH_ROLE_SLOTS:'+(remainingPlayers.length-available.length));
  for(const player of remainingPlayers){const playerId=String(player.id),constraint=String(factionConstraints[playerId]||'');const eligible=available.filter(slot=>!constraint||slot.factionId===constraint);if(!eligible.length)throw new Error('NO_ELIGIBLE_ROLE_SLOT:'+playerId);const selected=eligible[randomInt(eligible.length)],index=available.findIndex(slot=>slot.key===selected.key);assignments[playerId]=selected.roleId;available.splice(index,1)}
  return {assignments,locked:[...locked],unusedSlots:available,summary:{players:players.length,assigned:Object.keys(assignments).length,unassigned:players.length-Object.keys(assignments).length,availableRoleSlots:slots.length,unusedRoleSlots:available.length,basicRoleAssignments:Object.values(assignments).filter(roleId=>normalizeRoleSetup(roleById.get(roleId)).roleType===ROLE_TYPES.BASIC).length}};
}
