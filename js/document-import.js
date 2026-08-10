export const MAX_DOCX_BYTES=10*1024*1024;
export const DOCX_MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let generatedId=0;
const text=value=>String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
export const normalizeImportName=(value='')=>text(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const tempId=prefix=>prefix+'-'+(++generatedId)+'-'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
const titleCase=value=>text(value).replace(/\b\w/g,letter=>letter.toUpperCase());
const splitList=value=>text(value).split(/[,;|]/).map(text).filter(Boolean);
const safeNumber=value=>{const match=String(value??'').match(/\d+/);return match?Number(match[0]):null};
const uniqueNames=values=>[...new Map(values.filter(Boolean).map(value=>[normalizeImportName(value),text(value)])).values()];

function decodeHtml(value){
  return String(value??'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_match,number)=>String.fromCodePoint(Number(number))).replace(/\s+/g,' ').trim();
}

function browserHtmlBlocks(html){
  const parsed=new DOMParser().parseFromString(String(html||''),'text/html'),blocks=[];
  const directText=element=>{
    const copy=element.cloneNode(true);copy.querySelectorAll('ul,ol,table').forEach(child=>child.remove());return text(copy.textContent);
  };
  const visit=element=>{
    const tag=element.tagName?.toLowerCase();if(!tag)return;
    if(/^h[1-6]$/.test(tag)){blocks.push({type:'heading',level:Number(tag[1]),text:text(element.textContent),bold:true});return}
    if(tag==='p'){
      const value=text(element.textContent);if(value)blocks.push({type:'paragraph',text:value,boldLabel:text(element.querySelector('strong,b')?.textContent||'')});return;
    }
    if(tag==='ul'||tag==='ol'){
      [...element.children].filter(child=>child.tagName?.toLowerCase()==='li').forEach(child=>{const value=directText(child);if(value)blocks.push({type:'list-item',text:value,ordered:tag==='ol'});[...child.children].filter(item=>['ul','ol'].includes(item.tagName?.toLowerCase())).forEach(visit)});return;
    }
    if(tag==='table'){
      const rows=[...element.querySelectorAll('tr')].map(row=>[...row.querySelectorAll(':scope > th,:scope > td')].map(cell=>text(cell.textContent))).filter(row=>row.some(Boolean));
      if(rows.length)blocks.push({type:'table',headers:rows[0],rows:rows.slice(1)});return;
    }
    [...element.children].forEach(visit);
  };
  [...parsed.body.children].forEach(visit);return blocks;
}

function fallbackHtmlBlocks(html){
  const blocks=[],source=String(html||''),tokenPattern=/<(h[1-6]|p|ul|ol|table)\b[^>]*>[\s\S]*?<\/\1>/gi;let match;
  while((match=tokenPattern.exec(source))){
    const tag=match[1].toLowerCase(),fragment=match[0];
    if(/^h[1-6]$/.test(tag)){blocks.push({type:'heading',level:Number(tag[1]),text:decodeHtml(fragment),bold:true});continue}
    if(tag==='p'){const value=decodeHtml(fragment),bold=(fragment.match(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/i)||[])[1];if(value)blocks.push({type:'paragraph',text:value,boldLabel:decodeHtml(bold)});continue}
    if(tag==='ul'||tag==='ol'){for(const item of fragment.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)){const value=decodeHtml(item[1]);if(value)blocks.push({type:'list-item',text:value,ordered:tag==='ol'})}continue}
    const rows=[...fragment.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>[...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell=>decodeHtml(cell[1]))).filter(row=>row.some(Boolean));
    if(rows.length)blocks.push({type:'table',headers:rows[0],rows:rows.slice(1)});
  }
  return blocks;
}

export function htmlToDocumentBlocks(html){
  return typeof DOMParser==='function'?browserHtmlBlocks(html):fallbackHtmlBlocks(html);
}

export function validateDocxFile(file){
  const errors=[];if(!file)errors.push('Choose a Word document.');
  const name=text(file?.name);if(name&&!/\.docx$/i.test(name))errors.push('Only .docx Word documents are supported.');
  if(Number(file?.size)<=0)errors.push('The selected document is empty.');
  if(Number(file?.size)>MAX_DOCX_BYTES)errors.push('The document is larger than the 10 MB upload limit.');
  const type=text(file?.type);if(type&&![DOCX_MIME,'application/octet-stream','application/zip'].includes(type))errors.push('The selected file does not use a supported Word document type.');
  return errors;
}

async function sha256Hex(arrayBuffer){
  if(!globalThis.crypto?.subtle)return '';
  const digest=await globalThis.crypto.subtle.digest('SHA-256',arrayBuffer);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function parseDocxFile(file,mammothApi=globalThis.mammoth){
  const errors=validateDocxFile(file);if(errors.length)throw new Error(errors.join(' '));
  if(!mammothApi?.convertToHtml)throw new Error('The Word document parser did not load. Refresh the page and try again.');
  const arrayBuffer=await file.arrayBuffer(),signature=[...new Uint8Array(arrayBuffer.slice(0,4))];
  if(signature[0]!==0x50||signature[1]!==0x4b||![0x03,0x05,0x07].includes(signature[2]))throw new Error('This file is not a valid .docx package.');
  let result;
  try{
    result=await mammothApi.convertToHtml({arrayBuffer},{includeDefaultStyleMap:true,includeEmbeddedStyleMap:false,styleMap:["p[style-name='Title'] => h1:fresh","p[style-name='Subtitle'] => p.subtitle:fresh"]});
  }catch(error){throw new Error('The Word document is corrupted or could not be read: '+(error?.message||'Unknown parser error'))}
  let blocks=htmlToDocumentBlocks(result.value);
  if(!blocks.length&&mammothApi.extractRawText){const fallback=await mammothApi.extractRawText({arrayBuffer});blocks=String(fallback.value||'').split(/\r?\n/).map(text).filter(Boolean).map(value=>({type:'paragraph',text:value,boldLabel:''}))}
  if(!blocks.length)throw new Error('No readable game information was found in the document.');
  return {blocks,messages:(result.messages||[]).map(message=>text(message.message||message)).filter(Boolean),source:{fileName:text(file.name),fileSize:Number(file.size)||arrayBuffer.byteLength,contentType:DOCX_MIME,lastModified:file.lastModified||null,sha256:await sha256Hex(arrayBuffer),parsedAt:new Date().toISOString()}};
}

const sectionAliases=new Map([
  ['faction','factions'],['factions','factions'],['teams','factions'],
  ['role','roles'],['roles','roles'],['characters','roles'],
  ['ability','abilities'],['abilities','abilities'],['powers','abilities'],
  ['rule','rules'],['rules','rules'],['game rules','rules'],
  ['game information','game'],['game info','game'],['overview','game'],['description','game']
]);
function sectionFor(value){return sectionAliases.get(normalizeImportName(value).replace(/\s+section$/,''))||null}
function labeledValue(value){const match=text(value).match(/^([^:]{1,45}):\s*(.*)$/);return match?{label:normalizeImportName(match[1]),value:text(match[2])}:null}
function looksLikeTitle(value){const clean=text(value);return clean.length>0&&clean.length<=90&&!/[.!?]$/.test(clean)&&clean.split(/\s+/).length<=10}
function inferFactionClass(name,alignment=''){
  const value=normalizeImportName(name+' '+alignment);if(/\b(neutral|wildcard|independent|solo)\b/.test(value))return 'NEUTRAL';if(/\b(den|mafia|syndicate|cult|hostile|evil|clan)\b/.test(value))return 'DEN';return 'VILLAGER';
}
function inferAbilityCategory(name,definition,type=''){
  const value=normalizeImportName(name+' '+definition+' '+type);if(/passive|immune|immunity|counterattack/.test(value))return 'Passive';if(/kill|poison|harm|duel|attack/.test(value))return 'Harmful';if(/ask|investigat|track|watch|check/.test(value))return 'Investigation';if(/protect|guard|save|heal|shield/.test(value))return 'Protection';if(/block|redirect|swap|convert|recruit/.test(value))return 'Control';if(/silence|communicat|message|speak/.test(value))return 'Communication';if(/amplif|additional|support|boost/.test(value))return 'Support';return 'Other';
}
function inferAbilityPhase(label,definition){const value=normalizeImportName(label+' '+definition);if(/passive/.test(value))return 'Passive';if(/\bday\b/.test(value))return 'Day';if(/\bnight\b/.test(value))return 'Night';return 'Any'}
const knownAbilityPrefixes=['action success guarantee','bulletproof passive immunity','additional uses','ability amplify','advanced ask','alignment ask','basic ask','role check','visitor check','regular kill','instant kill','super kill','omega kill','death immunity','duel fight','counterattack','roleblock','redirect','protect','guard','save','heal','watch','track','poison','mark','conversion','recruit','swap','silence','sober','drunk','reflection','map','gravedigger'];
function abilityFromValue(value,label,roleName=''){
  const clean=text(value),dash=clean.match(/^(.{1,80}?)\s+(?:—|–|-)\s+(.+)$/),colon=clean.match(/^([^:]{1,60}):\s*(.+)$/);let name='',definition=clean;
  if(dash){name=text(dash[1]);definition=text(dash[2])}else if(colon){name=text(colon[1]);definition=text(colon[2])}else{
    const normalizedValue=normalizeImportName(clean),prefix=knownAbilityPrefixes.find(candidate=>normalizedValue===candidate||normalizedValue.startsWith(candidate+' '));
    if(prefix)name=titleCase(prefix.replace('duel fight','duel / fight').replace('bulletproof passive immunity','bulletproof / passive immunity'));
  }
  const passive=/passive/.test(normalizeImportName(label));if(!name)name=text(roleName)+(passive?' Passive':' Ability');
  if(!text(roleName)&&!clean)name='';
  return {name,definition,category:inferAbilityCategory(name,definition,passive?'passive':label),phase:inferAbilityPhase(label,definition),type:passive?'passive':'active'};
}
function ruleFromText(value,index){const clean=text(value).replace(/^\d+[.)]\s*/,''),sentence=clean.split(/(?<=[.!?])\s+/)[0],title=text(sentence).slice(0,120)||'Rule '+(index+1);return {tempId:tempId('rule'),title,description:clean,category:'General',visibility:'public',notes:'',enabled:true,selected:true,confidence:.86,sourceText:text(value)};}

function createWarning(code,message,severity='warning',relatedId=null){return {id:tempId('warning'),code,message,severity,relatedId}}
function createFaction(name,fields={}){const clean=text(name);return {tempId:tempId('faction'),name:clean,description:'',alignment:'',className:inferFactionClass(clean),winCondition:'',notes:'',expectedRoleCount:null,selected:true,confidence:.78,sourceText:clean,...fields}}
function createRole(name,fields={}){const clean=text(name);return {tempId:tempId('role'),name:clean,factionTempId:null,factionName:'',alignment:'',description:'',activeAbilityName:'',passiveAbilityName:'',abilityNames:[],abilityUses:null,cooldowns:'',restrictions:[],immunities:[],winCondition:'',notes:'',gmNotes:'',tags:[],enabled:true,selected:true,confidence:.75,sourceText:clean,duplicateOfTempId:null,duplicateDecision:'merge',...fields}}
function createAbility(name,fields={}){const clean=text(name);return {tempId:tempId('ability'),name:clean,definition:'',category:'Other',phase:'Any',mechanics:[],selected:true,confidence:.72,matchStatus:'new',matchKey:'',decision:'create-new',possibleMatches:[],sourceText:clean,...fields}}

export function analyzeDocumentBlocks(blocks,source={}){
  const model={schemaVersion:1,source:{...source},game:{name:'',theme:'',description:'',playerCount:null,startingPhase:'Day',notes:'',selected:true},factions:[],roles:[],abilities:[],rules:[],warnings:[],sections:{game:true,factions:true,roles:true,abilities:true,rules:true}};
  const factionMap=new Map(),abilityMap=new Map();let section=null,sectionLevel=0,currentFaction=null,factionLevel=0,currentRole=null,currentAbility=null,pendingText='',gameDescription=[];
  const ensureFaction=(name,fields={})=>{const clean=text(name);if(!clean)return null;const key=normalizeImportName(clean);let faction=factionMap.get(key);if(!faction){faction=createFaction(clean,fields);model.factions.push(faction);factionMap.set(key,faction)}else Object.assign(faction,Object.fromEntries(Object.entries(fields).filter(([,value])=>value!==''&&value!=null)));return faction};
  const beginRole=(name,fields={})=>{const role=createRole(name,fields);if(currentFaction){role.factionTempId=currentFaction.tempId;role.factionName=currentFaction.name}model.roles.push(role);currentRole=role;pendingText='';return role};
  const ensureRoleFromPending=()=>{if(!currentRole&&pendingText)beginRole(pendingText);else if(pendingText&&currentRole&&normalizeImportName(pendingText)!==normalizeImportName(currentRole.name))beginRole(pendingText)};
  const addAbility=(role,abilityData)=>{if(!abilityData?.name)return null;const key=normalizeImportName(abilityData.name);let ability=abilityMap.get(key);if(!ability){ability=createAbility(abilityData.name,{definition:text(abilityData.definition),category:abilityData.category||'Other',phase:abilityData.phase||'Any',sourceText:text(abilityData.definition||abilityData.name)});abilityMap.set(key,ability);model.abilities.push(ability)}else if(!ability.definition&&abilityData.definition)ability.definition=text(abilityData.definition);if(role){role.abilityNames=uniqueNames([...role.abilityNames,ability.name]);if(abilityData.type==='passive')role.passiveAbilityName=ability.name;else if(!role.activeAbilityName)role.activeAbilityName=ability.name}return ability};
  const addRule=value=>{const clean=text(value);if(clean)model.rules.push(ruleFromText(clean,model.rules.length))};
  const assignLabel=(label,value,raw)=>{
    if(label==='role'||label==='role name'||label==='character'){beginRole(value);return true}
    if(label==='faction'||label==='team'||label==='alignment faction'){
      ensureRoleFromPending();const faction=ensureFaction(value);if(currentRole&&faction){currentRole.factionTempId=faction.tempId;currentRole.factionName=faction.name}currentFaction=faction||currentFaction;return true;
    }
    if(label==='faction win condition'){if(currentFaction)currentFaction.winCondition=value;return true}
    if(label==='role win condition'){ensureRoleFromPending();if(currentRole)currentRole.winCondition=value;return true}
    if(label==='win condition'||label==='win conditions'){ensureRoleFromPending();if(currentRole)currentRole.winCondition=value;else if(currentFaction)currentFaction.winCondition=value;else model.game.notes=[model.game.notes,'Win condition: '+value].filter(Boolean).join('\n');return true}
    if(label==='ability'||label==='active ability'||label==='night ability'||label==='day ability'||label==='power'){
      ensureRoleFromPending();if(currentRole)addAbility(currentRole,abilityFromValue(value,label,currentRole.name));else if(value)addAbility(null,abilityFromValue(value,label,''));return true;
    }
    if(label==='passive'||label==='passive ability'){
      ensureRoleFromPending();if(currentRole)addAbility(currentRole,abilityFromValue(value,label,currentRole.name));return true;
    }
    if(label==='abilities'||label==='powers'){
      ensureRoleFromPending();if(currentRole)splitList(value).forEach(name=>addAbility(currentRole,{name,definition:'',category:inferAbilityCategory(name,'',''),phase:'Any',type:'active'}));return true;
    }
    if(label==='ability uses'||label==='uses'){ensureRoleFromPending();if(currentRole)currentRole.abilityUses=safeNumber(value);return true}
    if(label==='cooldown'||label==='cooldowns'){ensureRoleFromPending();if(currentRole)currentRole.cooldowns=value;return true}
    if(label==='restrictions'||label==='restriction'){ensureRoleFromPending();if(currentRole)currentRole.restrictions=splitList(value);return true}
    if(label==='immunities'||label==='immunity'){ensureRoleFromPending();if(currentRole)currentRole.immunities=splitList(value);return true}
    if(label==='gm notes'||label==='gm note'){ensureRoleFromPending();if(currentRole)currentRole.gmNotes=value;return true}
    if(label==='role notes'||label==='role note'||label==='notes'){
      ensureRoleFromPending();if(currentRole)currentRole.notes=value;else if(currentFaction)currentFaction.notes=value;else model.game.notes=value;return true;
    }
    if(label==='faction notes'||label==='faction note'){if(currentFaction)currentFaction.notes=value;return true}
    if(label==='description'){
      ensureRoleFromPending();if(currentRole)currentRole.description=value;else if(currentFaction)currentFaction.description=value;else model.game.description=value;return true;
    }
    if(label==='theme'){model.game.theme=value;return true}
    if(label==='game name'||label==='name'){if(section==='game'||!model.game.name)model.game.name=value;return true}
    if(label==='players'||label==='player count'||label==='number of players'){model.game.playerCount=safeNumber(value);return true}
    if(label==='starting phase'||label==='start phase'){model.game.startingPhase=/night/i.test(value)?'Night':'Day';return true}
    if(label==='tags'){ensureRoleFromPending();if(currentRole)currentRole.tags=splitList(value);return true}
    if(label==='rule'){addRule(value);return true}
    return false;
  };
  const processTable=block=>{
    const headers=block.headers.map(normalizeImportName),find=(...names)=>headers.findIndex(header=>names.some(name=>header===name||header.includes(name)));
    const roleIndex=find('role','character'),factionIndex=find('faction','team'),abilityIndex=find('ability','power'),passiveIndex=find('passive'),winIndex=find('win condition'),descriptionIndex=find('description'),notesIndex=find('notes'),usesIndex=find('uses'),cooldownIndex=find('cooldown'),ruleIndex=find('rule');
    if(roleIndex>=0){
      block.rows.forEach(row=>{const roleName=text(row[roleIndex]);if(!roleName)return;const factionName=factionIndex>=0?text(row[factionIndex]):'';const faction=factionName?ensureFaction(factionName):null,role=beginRole(roleName,{description:descriptionIndex>=0?text(row[descriptionIndex]):'',winCondition:winIndex>=0?text(row[winIndex]):'',notes:notesIndex>=0?text(row[notesIndex]):'',abilityUses:usesIndex>=0?safeNumber(row[usesIndex]):null,cooldowns:cooldownIndex>=0?text(row[cooldownIndex]):''});if(faction){role.factionTempId=faction.tempId;role.factionName=faction.name}if(abilityIndex>=0&&text(row[abilityIndex]))addAbility(role,abilityFromValue(row[abilityIndex],'ability',role.name));if(passiveIndex>=0&&text(row[passiveIndex]))addAbility(role,abilityFromValue(row[passiveIndex],'passive',role.name))});return;
    }
    if(ruleIndex>=0){block.rows.forEach(row=>addRule(row[ruleIndex]));return}
    if(factionIndex>=0){block.rows.forEach(row=>{const faction=ensureFaction(row[factionIndex]);if(!faction)return;if(descriptionIndex>=0)faction.description=text(row[descriptionIndex]);if(winIndex>=0)faction.winCondition=text(row[winIndex]);if(notesIndex>=0)faction.notes=text(row[notesIndex])});return}
    model.warnings.push(createWarning('unrecognized-table','A document table could not be confidently classified and was skipped.','warning'));
  };
  for(const block of Array.isArray(blocks)?blocks:[]){
    if(block.type==='table'){processTable(block);continue}
    const value=text(block.text);if(!value)continue;
    if(block.type==='heading'){
      const nextSection=sectionFor(value);if(nextSection){section=nextSection;sectionLevel=Number(block.level)||1;currentRole=null;currentAbility=null;pendingText='';if(section!=='factions')currentFaction=null;continue}
      if(!model.game.name){model.game.name=value;continue}
      if(section==='factions'){
        if(currentFaction&&(Number(block.level)||6)>factionLevel){beginRole(value);continue}
        currentFaction=ensureFaction(value);factionLevel=Number(block.level)||sectionLevel+1;currentRole=null;pendingText='';continue;
      }
      if(section==='roles'){beginRole(value);continue}
      if(section==='abilities'){currentAbility=addAbility(null,{name:value,definition:'',category:inferAbilityCategory(value,'',''),phase:'Any'});continue}
      if(section==='rules'){addRule(value);continue}
      if(!section&&looksLikeTitle(value)){currentFaction=ensureFaction(value);section='factions';factionLevel=Number(block.level)||2;continue}
    }
    const labeled=labeledValue(value);if(labeled&&assignLabel(labeled.label,labeled.value,value))continue;
    if(section==='rules'||block.type==='list-item'&&section==='rules'){addRule(value);continue}
    if(section==='abilities'&&currentAbility){currentAbility.definition=[currentAbility.definition,value].filter(Boolean).join(' ');currentAbility.category=inferAbilityCategory(currentAbility.name,currentAbility.definition,'');continue}
    if(section==='factions'){
      if(!currentFaction&&looksLikeTitle(value)){currentFaction=ensureFaction(value);pendingText='';continue}
      if(looksLikeTitle(value)){pendingText=value;continue}
      if(pendingText)ensureRoleFromPending();if(currentRole){currentRole.description=[currentRole.description,value].filter(Boolean).join(' ')}else if(currentFaction){currentFaction.description=[currentFaction.description,value].filter(Boolean).join(' ')}continue;
    }
    if(section==='roles'){
      if(looksLikeTitle(value)&&!currentRole){beginRole(value);continue}
      if(currentRole)currentRole.description=[currentRole.description,value].filter(Boolean).join(' ');continue;
    }
    if(section==='game'){gameDescription.push(value);continue}
    if(!section&&!model.game.description)gameDescription.push(value);
  }
  if(!model.game.description&&gameDescription.length)model.game.description=gameDescription.join('\n').slice(0,2000);
  if(!model.game.name){model.game.name=text(source.fileName).replace(/\.docx$/i,'')||'Imported Game';model.warnings.push(createWarning('game-name-inferred','The game name could not be identified confidently and was inferred from the file name.'))}
  model.roles.forEach(role=>{if(role.factionName&&!role.factionTempId){const faction=ensureFaction(role.factionName);role.factionTempId=faction?.tempId||null}if(!role.factionTempId)model.warnings.push(createWarning('unassigned-faction','Could not determine a faction for '+role.name+'. Assign one before importing.','warning',role.tempId));if(!role.abilityNames.length)model.warnings.push(createWarning('missing-ability','No ability was detected for '+role.name+'. Add an ability or deselect the role.','warning',role.tempId))});
  const duplicateMap=new Map();model.roles.forEach(role=>{const key=normalizeImportName(role.name);const first=duplicateMap.get(key);if(first){role.duplicateOfTempId=first.tempId;role.selected=false;model.warnings.push(createWarning('duplicate-role','Possible duplicate role: '+role.name+'. It is set to merge; choose Keep Separate to import both.','warning',role.tempId))}else duplicateMap.set(key,role)});
  model.factions.forEach(faction=>{const match=faction.name.match(/(?:\(|-|:)\s*(\d+)\s*roles?\)?/i);if(match){faction.expectedRoleCount=Number(match[1]);faction.name=text(faction.name.replace(match[0],''))}const detected=model.roles.filter(role=>role.factionTempId===faction.tempId&&!role.duplicateOfTempId).length;if(faction.expectedRoleCount!=null&&detected!==faction.expectedRoleCount)model.warnings.push(createWarning('role-count-mismatch','Expected '+faction.expectedRoleCount+' '+faction.name+' roles but detected '+detected+'.','warning',faction.tempId));if(faction.className==='VILLAGER'&&!/villag|town|alliance|defen|good/i.test(faction.name))model.warnings.push(createWarning('faction-class-review','Review the inferred VILLAGER class for '+faction.name+'.','info',faction.tempId))});
  if(!model.factions.length)model.warnings.push(createWarning('no-factions','No factions were detected.','error'));
  if(!model.roles.length)model.warnings.push(createWarning('no-roles','No roles were detected.','error'));
  if(!model.rules.length)model.warnings.push(createWarning('no-rules','No individual game rules were detected.','info'));
  return model;
}

function abilitySimilarity(left,right){
  const a=normalizeImportName(left),b=normalizeImportName(right);if(!a||!b)return 0;if(a===b)return 1;const aa=new Set(a.split(' ')),bb=new Set(b.split(' ')),intersection=[...aa].filter(token=>bb.has(token)).length,union=new Set([...aa,...bb]).size;return intersection/Math.max(1,union);
}
export function matchImportAbilities(model,catalog=[]){
  const usable=(Array.isArray(catalog)?catalog:[]).filter(item=>text(item.name));
  model.abilities.forEach(ability=>{
    const ranked=usable.map(item=>({...item,score:abilitySimilarity(ability.name,item.name)})).filter(item=>item.score>=.5).sort((a,b)=>b.score-a.score||Number(Boolean(b.builtIn))-Number(Boolean(a.builtIn)));
    ability.possibleMatches=ranked.slice(0,5).map(item=>({key:item.key||item.id,name:item.name,score:item.score,sourceGameName:item.sourceGameName||'',builtIn:Boolean(item.builtIn)}));
    const exact=ranked.find(item=>item.score===1);if(exact){ability.matchStatus='exact';ability.matchKey=exact.key||exact.id;ability.decision='use-existing'}else if(ranked[0]?.score>=.72){ability.matchStatus='possible';ability.matchKey='';ability.decision='create-new';model.warnings.push(createWarning('possible-ability-match',ability.name+' may match '+ranked[0].name+'. Review the ability decision before import.','info',ability.tempId))}else{ability.matchStatus='new';ability.matchKey='';ability.decision='create-new'};
  });return model;
}

export function validateGameImport(model){
  const errors=[],warnings=[];if(!model||typeof model!=='object')return {valid:false,errors:['No parsed import is available.'],warnings};
  if(!text(model.game?.name)||text(model.game.name).length>100)errors.push('Game name must contain 1 to 100 characters.');
  const factions=(model.sections?.factions===false?[]:model.factions.filter(item=>item.selected)),roles=(model.sections?.roles===false?[]:model.roles.filter(item=>item.selected)),abilities=(model.sections?.abilities===false?[]:model.abilities.filter(item=>item.selected)),rules=(model.sections?.rules===false?[]:model.rules.filter(item=>item.selected));
  if(roles.length&&!factions.length)errors.push('Selected roles require at least one selected faction.');
  const factionIds=new Set(factions.map(item=>item.tempId)),roleNames=new Set();roles.forEach(role=>{const key=normalizeImportName(role.name);if(!key)errors.push('Every selected role needs a name.');else if(roleNames.has(key))errors.push('Selected role names must be unique: '+role.name+'.');else roleNames.add(key);if(!role.factionTempId||!factionIds.has(role.factionTempId))errors.push(role.name+' must be assigned to a selected faction.');if(!role.abilityNames?.length)errors.push(role.name+' needs at least one ability.');});
  const abilityNames=new Set();abilities.forEach(ability=>{const key=normalizeImportName(ability.name);if(!key)errors.push('Every selected ability needs a name.');else if(abilityNames.has(key))errors.push('Selected ability names must be unique: '+ability.name+'.');else abilityNames.add(key);if(ability.decision==='use-existing'&&!ability.matchKey)errors.push('Choose an existing Encyclopedia match for '+ability.name+'.')});
  roles.forEach(role=>role.abilityNames.forEach(name=>{if(!abilityNames.has(normalizeImportName(name)))errors.push(role.name+' references an ability that is not selected: '+name+'.')}));
  rules.forEach(rule=>{if(!text(rule.title)||!text(rule.description))errors.push('Every selected rule needs a title and description.')});
  return {valid:errors.length===0,errors:[...new Set(errors)],warnings};
}

function changedFields(current,incoming,fields){return fields.filter(field=>JSON.stringify(current?.[field]??null)!==JSON.stringify(incoming?.[field]??null)).map(field=>({field,current:current?.[field]??'',document:incoming?.[field]??''}))}
function compareCollection(currentItems,incomingItems,keyFor,fields,{skipMissing=()=>false}={}){
  const currentMap=new Map(currentItems.map(item=>[keyFor(item),item])),incomingMap=new Map(incomingItems.map(item=>[keyFor(item),item])),changes=[];
  incomingItems.forEach(item=>{const key=keyFor(item),current=currentMap.get(key);if(!current){changes.push({key,status:'NEW',current:null,document:item,differences:[],decision:'add'});return}const differences=changedFields(current,item,fields);changes.push({key,status:differences.length?'CHANGED':'UNCHANGED',current,document:item,differences,decision:'keep'})});
  currentItems.forEach(item=>{const key=keyFor(item);if(!incomingMap.has(key)&&!skipMissing(item))changes.push({key,status:'MISSING FROM DOCUMENT',current:item,document:null,differences:[],decision:'keep'})});return changes;
}
export function compareGameImport(model,currentDocument){
  const data=currentDocument?.data||{},game=currentDocument?.game||{},factionNameById=new Map((data.factions||[]).map(item=>[item.id,item.name])),importFactionNameById=new Map(model.factions.map(item=>[item.tempId,item.name]));
  const roleProjection=role=>({name:role.name,factionName:role.factionName||factionNameById.get(role.factionId)||importFactionNameById.get(role.factionTempId)||'',alignment:role.alignment||'',description:role.description||'',activeAbilityName:role.activeAbilityName||'',passiveAbilityName:role.passiveAbilityName||'',abilityNames:uniqueNames(role.abilityNames||role.tags||[]).sort(),abilityUses:role.abilityUses??null,cooldowns:role.cooldowns||'',restrictions:role.restrictions||[],immunities:role.immunities||[],winCondition:role.winCondition||'',notes:role.notes||'',gmNotes:role.gmNotes||'',tags:role.tags||[],enabled:role.enabled!==false});
  const currentRoles=(data.roles||[]).map(role=>({...roleProjection(role),_record:role})),incomingRoles=model.roles.filter(role=>role.selected).map(role=>({...roleProjection(role),_record:role}));
  const currentFactions=(data.factions||[]).map(item=>({name:item.name,className:item.class,description:item.description||'',alignment:item.alignment||'',winCondition:item.winCondition||'',notes:item.notes||'',_record:item})),incomingFactions=model.factions.filter(item=>item.selected).map(item=>({...item,_record:item}));
  const currentAbilities=(data.abilities||[]).map(item=>({name:item.name,definition:item.definition||'',category:item.category||'Other',phase:item.phase||'Any',mechanics:item.mechanics||[],builtIn:Boolean(item.builtIn),_record:item})),incomingAbilities=model.abilities.filter(item=>item.selected).map(item=>({...item,_record:item}));
  const currentRules=(data.rules||[]).map(item=>({title:item.title,description:item.description||'',category:item.category||'General',visibility:item.visibility||'public',notes:item.notes||'',enabled:item.enabled!==false,_record:item})),incomingRules=model.rules.filter(item=>item.selected).map(item=>({...item,_record:item}));
  const gameIncoming={name:model.game.name,theme:model.game.theme||'',description:model.game.description||'',notes:model.game.notes||'',currentPhase:model.game.startingPhase||'Day'},gameDifferences=changedFields(game,gameIncoming,['name','theme','description','notes','currentPhase']);
  return {game:{status:gameDifferences.length?'CHANGED':'UNCHANGED',current:game,document:gameIncoming,differences:gameDifferences,decision:'keep'},factions:compareCollection(currentFactions,incomingFactions,item=>normalizeImportName(item.name),['className','description','alignment','winCondition','notes']),roles:compareCollection(currentRoles,incomingRoles,item=>normalizeImportName(item.name),['factionName','alignment','description','activeAbilityName','passiveAbilityName','abilityNames','abilityUses','cooldowns','restrictions','immunities','winCondition','notes','gmNotes','tags','enabled']),abilities:compareCollection(currentAbilities,incomingAbilities,item=>normalizeImportName(item.name),['definition','category','phase','mechanics'],{skipMissing:item=>item.builtIn}),rules:compareCollection(currentRules,incomingRules,item=>normalizeImportName(item.title),['description','category','visibility','notes','enabled'])};
}

export function importSummary(model){
  const count=key=>model.sections?.[key]===false?0:model[key].filter(item=>item.selected).length;return {factions:count('factions'),roles:count('roles'),abilities:count('abilities'),rules:count('rules'),warnings:model.warnings.length};
}
