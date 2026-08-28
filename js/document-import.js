import {mechanicsReviewQueue,normalizeAbilityUnderstanding,normalizeMechanicList,normalizeRoleUnderstanding} from './mechanics.js?v=11.9.0';
import {classifyAbility,globalAbilityDefinition} from './global-abilities.js?v=11.9.0';

export const MAX_DOCX_BYTES=10*1024*1024;
export const DOCX_MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_AI_DOCUMENT_CHARS=800000;

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
  const visit=(element,listDepth=0)=>{
    const tag=element.tagName?.toLowerCase();if(!tag)return;
    if(/^h[1-6]$/.test(tag)){blocks.push({type:'heading',level:Number(tag[1]),text:text(element.textContent),bold:true});return}
    if(tag==='p'){
      const value=text(element.textContent);if(value)blocks.push({type:'paragraph',text:value,boldLabel:text(element.querySelector('strong,b')?.textContent||'')});return;
    }
    if(tag==='ul'||tag==='ol'){
      [...element.children].filter(child=>child.tagName?.toLowerCase()==='li').forEach(child=>{const value=directText(child);if(value)blocks.push({type:'list-item',text:value,ordered:tag==='ol',indent:listDepth});[...child.children].filter(item=>['ul','ol'].includes(item.tagName?.toLowerCase())).forEach(item=>visit(item,listDepth+1))});return;
    }
    if(tag==='table'){
      const rows=[...element.querySelectorAll('tr')].map(row=>[...row.querySelectorAll(':scope > th,:scope > td')].map(cell=>text(cell.textContent))).filter(row=>row.some(Boolean));
      if(rows.length)blocks.push({type:'table',headers:rows[0],rows:rows.slice(1)});return;
    }
    [...element.children].forEach(item=>visit(item,listDepth));
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
function createRole(name,fields={}){const clean=text(name);return {tempId:tempId('role'),name:clean,factionTempId:null,factionName:'',alignment:'',description:'',activeAbilityName:'',passiveAbilityName:'',abilityNames:[],roleWideAbilityNames:[],modes:[],modeSelectionPolicy:'CURRENT_ONLY',abilityUses:null,cooldowns:'',restrictions:[],immunities:[],abilityModifiers:[],statusInteractions:[],relationships:[],mechanicalStatements:[],understanding:{},unresolvedComponents:[],sourceVersion:'',winCondition:'',notes:'',gmNotes:'',tags:[],roleType:ROLE_TYPES.STANDARD,abilityDataStatus:ABILITY_DATA_STATUSES.POSSIBLY_INCOMPLETE,basicEvidence:'',slotCount:1,enabled:true,selected:true,confidence:.75,sourceText:clean,sourceLocation:'',duplicateOfTempId:null,duplicateDecision:'merge',...fields}}
function classifyImportedRole(role){const classification=classifyRoleAbilityData({...role,tags:role.abilityNames});role.roleType=classification.roleType;role.abilityDataStatus=classification.abilityDataStatus;role.basicEvidence=classification.basicEvidence;if(role.roleType===ROLE_TYPES.BASIC){role.abilityNames=[];role.activeAbilityName='';role.passiveAbilityName=''}return role}
function addMissingAbilityWarning(model,role){classifyImportedRole(role);if(role.abilityDataStatus===ABILITY_DATA_STATUSES.POSSIBLY_INCOMPLETE)model.warnings.push(createWarning('possibly-incomplete-role','No ability data or explicit Basic Role evidence was detected for '+role.name+'. Review before import.','warning',role.tempId))}
function createAbility(name,fields={}){const clean=text(name);return {tempId:tempId('ability'),name:clean,definition:'',category:'Other',phase:'Any',mechanics:[],mechanicalStatements:[],understanding:{},targeting:{},mapping:'CUSTOM',stableAbilityId:'',baseStandardAbilityId:'',baseStandardAbilityName:'',customIdentity:false,factionAction:false,globalAction:false,performerRequired:false,unresolvedComponents:[],modifiers:[],interactions:[],selected:true,confidence:.72,matchStatus:'new',matchKey:'',decision:'create-new',possibleMatches:[],sourceText:clean,sourceLocation:'',...fields}}

const flatFactionHeaders=new Map([
  ['den',{name:'Den',className:'DEN'}],['mafia',{name:'Mafia',className:'DEN'}],['wolves',{name:'Wolves',className:'DEN'}],['decepticons',{name:'Decepticons',className:'DEN'}],['cult',{name:'Cult',className:'DEN'}],
  ['villagers',{name:'Villagers',className:'VILLAGER'}],['town',{name:'Town',className:'VILLAGER'}],['autobots',{name:'Autobots',className:'VILLAGER'}],
  ['neutral',{name:'Neutrals',className:'NEUTRAL'}],['neutrals',{name:'Neutrals',className:'NEUTRAL'}]
]);
const flatDash='(?:\\u2014|\\u2013|-)';
function flatFactionHeader(value){return flatFactionHeaders.get(normalizeImportName(value))||null}
function flatModeHeader(value){
  const match=text(value).match(new RegExp('^(robot|alt)\\s+mode\\s*'+flatDash+'?\\s*(.*)$','i'));if(!match)return null;
  return {mode:/^robot$/i.test(match[1])?'Robot Mode':'Alt Mode',label:text(match[2])};
}
function flatDashParts(value){return text(value).split(new RegExp('\\s*'+flatDash+'\\s*')).map(text).filter(Boolean)}
function isFlatRoleTitle(blocks,index,faction){
  const block=blocks[index],value=text(block?.text),normalized=normalizeImportName(value);if(block?.type!=='paragraph'||!value||flatFactionHeader(value))return null;
  if(/^(round information|rooms|times|special mechanics?|rules?|wincon|win condition|all?sp?ark shard)\b/.test(normalized)||/^\d+\s+(?:basic|scrap|energon)\b/.test(normalized))return null;
  const next=blocks.slice(index+1).find(item=>text(item?.text)||item?.type==='table'),nextMode=next?.type==='list-item'&&flatModeHeader(next.text);
  if(faction.className!=='NEUTRAL'){
    if(nextMode)return {name:value,description:'',abilityLabel:''};
    const parts=flatDashParts(value);return parts.length>=2&&looksLikeTitle(value)&&!/^\d/.test(value)?{name:value,description:'',abilityLabel:''}:null;
  }
  const parts=flatDashParts(value);if(parts.length>=3&&/^(?:each|every|can|will|wins?|has|starts?|choose|once)\b/i.test(parts[2]))return {name:parts[0],description:parts.slice(2).join(' — '),abilityLabel:parts[1]};
  if(parts.length>=2&&/^(?:each|every|can|will|wins?|has|starts?|choose|once)\b/i.test(parts[1]))return {name:parts[0],description:parts.slice(1).join(' — '),abilityLabel:''};
  if(!looksLikeTitle(value))return null;
  return {name:value,description:'',abilityLabel:''};
}

function analyzeFlatRosterDocument(blocks,source={}){
  const usable=(Array.isArray(blocks)?blocks:[]).filter(block=>block?.type!=='table'&&text(block?.text));
  const factionIndexes=usable.map((block,index)=>flatFactionHeader(block.text)?index:-1).filter(index=>index>=0),modeCount=usable.filter(block=>block.type==='list-item'&&flatModeHeader(block.text)).length;
  if(!factionIndexes.length||modeCount<2)return null;
  const model={schemaVersion:1,source:{...source,structureMode:'flat-roster'},game:{name:text(source.fileName).replace(/\.docx$/i,'')||'Imported Game',theme:'',description:'',playerCount:null,startingPhase:'Day',notes:'',selected:true},factions:[],roles:[],abilities:[],rules:[],warnings:[],sections:{game:true,factions:true,roles:true,abilities:true,rules:true}};
  const abilityMap=new Map();let currentFaction=null,currentRole=null,currentAbility=null,currentMode=null,pendingRule=null;
  const addRule=(title,description='')=>{const rule=ruleFromText(description||title,model.rules.length);rule.title=text(title).replace(/:\s*$/,'')||rule.title;rule.description=text(description);model.rules.push(rule);return rule};
  const addAbility=(role,name,definition='',phase='Any')=>{
    const cleanName=text(name),key=normalizeImportName(cleanName);if(!role||!key)return null;let ability=abilityMap.get(key);
    if(!ability){ability=createAbility(cleanName,{definition:text(definition),category:inferAbilityCategory(cleanName,definition,''),phase:phase==='Passive'?'Passive':'Any',sourceText:text(definition||cleanName),confidence:.84});abilityMap.set(key,ability);model.abilities.push(ability)}else if(definition)ability.definition=[ability.definition,text(definition)].filter(Boolean).join(' ');
    role.abilityNames=uniqueNames([...role.abilityNames,ability.name]);if(!role.activeAbilityName&&phase!=='Passive')role.activeAbilityName=ability.name;if(phase==='Passive'&&!role.passiveAbilityName)role.passiveAbilityName=ability.name;currentAbility=ability;return ability;
  };
  const beginRole=details=>{const role=createRole(details.name,{factionTempId:currentFaction?.tempId||null,factionName:currentFaction?.name||'',description:text(details.description),sourceText:text(details.name),confidence:.86});model.roles.push(role);currentRole=role;currentAbility=null;currentMode=null;if(details.description)addAbility(role,role.name+' — '+(details.abilityLabel||'Ability'),details.description);return role};
  const preamble=[];
  for(let index=0;index<usable.length;index+=1){
    const block=usable[index],value=text(block.text),factionInfo=flatFactionHeader(value);
    if(factionInfo){
      if(pendingRule&&!pendingRule.description)pendingRule.description=pendingRule.title;
      currentFaction=createFaction(factionInfo.name,{className:factionInfo.className,confidence:.96,sourceText:value});model.factions.push(currentFaction);currentRole=null;currentAbility=null;currentMode=null;pendingRule=null;continue;
    }
    if(!currentFaction){
      if(/^special mechanics?\b/i.test(value)){pendingRule=addRule(value,'');continue}
      if(pendingRule&&!pendingRule.description){pendingRule.description=value;pendingRule.sourceText=value;pendingRule=null;continue}
      preamble.push(value);continue;
    }
    if(currentFaction.className==='NEUTRAL'&&/\b(?:special mechanic|family vacation)\b/i.test(value)&&looksLikeTitle(value)){
      pendingRule=addRule(value,'');currentRole=null;currentAbility=null;continue;
    }
    if(/^\d+\s+basics?\b/i.test(value)){currentFaction.notes=[currentFaction.notes,value].filter(Boolean).join(' ');currentRole=null;currentAbility=null;continue}
    const roleTitle=isFlatRoleTitle(usable,index,currentFaction);
    if(roleTitle){if(pendingRule&&!pendingRule.description){pendingRule.description=pendingRule.title;pendingRule=null}beginRole(roleTitle);continue}
    if(pendingRule&&!pendingRule.description){pendingRule.description=value;pendingRule.sourceText=value;pendingRule=null;continue}
    const mode=flatModeHeader(value);
    if(mode&&currentRole){currentMode={tempId:tempId('mode'),name:mode.mode,label:mode.label,abilityNames:[],sourceText:value,sourceLocation:'',description:''};currentRole.modes.push(currentMode);currentAbility=null;continue}
    if(!currentRole){currentFaction.description=[currentFaction.description,value].filter(Boolean).join(' ');continue}
    const normalized=normalizeImportName(value);
    if(/^wincon\b|^win condition\b/.test(normalized)){currentRole.winCondition=text(flatDashParts(value).slice(1).join(' — ')||value.replace(/^win\s*con(?:dition)?\s*:?/i,''));continue}
    const parts=flatDashParts(value);
    if(currentFaction.className==='NEUTRAL'&&parts.length>=2&&!/^\d/.test(value)&&parts[0].length<=60){addAbility(currentRole,currentRole.name+' — '+parts[0],parts.slice(1).join(' — '));currentRole.description=[currentRole.description,value].filter(Boolean).join(' ');continue}
    currentRole.description=[currentRole.description,value].filter(Boolean).join(' ');if(currentMode){currentMode.description=[currentMode.description,value].filter(Boolean).join(' ');currentMode.sourceText=[currentMode.sourceText,value].filter(Boolean).join('\n')}
    if(currentAbility){currentAbility.definition=[currentAbility.definition,value].filter(Boolean).join(' ');currentAbility.category=inferAbilityCategory(currentAbility.name,currentAbility.definition,'');currentAbility.phase=inferAbilityPhase('',currentAbility.definition)}
    else if(currentFaction.className==='NEUTRAL')addAbility(currentRole,currentRole.name+' — Ability',value);
  }
  model.game.description=preamble.join('\n').slice(0,2000);
  model.roles.forEach(role=>addMissingAbilityWarning(model,role));
  model.warnings.push(createWarning('flat-document-structure','This Word document uses ordinary paragraphs instead of heading styles. Its faction rosters and mode lists were recovered automatically.','info'));
  if(!model.rules.length)model.warnings.push(createWarning('no-rules','No individual game rules were detected.','info'));
  return model;
}

export function prepareDocumentBlocksForAi(blocks){
  const prepared=(Array.isArray(blocks)?blocks:[]).map(block=>{
    const type=['heading','paragraph','list-item','table'].includes(block?.type)?block.type:'paragraph';
    if(type==='table')return {type,headers:(block.headers||[]).map(value=>text(value).slice(0,2000)),rows:(block.rows||[]).slice(0,2000).map(row=>(Array.isArray(row)?row:[]).map(value=>text(value).slice(0,2000)))};
    return {type,level:type==='heading'?Math.min(6,Math.max(1,Number(block.level)||1)):null,indent:type==='list-item'?Math.max(0,Math.min(20,Number(block.indent)||0)):null,text:text(block.text).slice(0,12000),boldLabel:text(block.boldLabel).slice(0,500),ordered:Boolean(block.ordered)};
  }).filter(block=>block.type==='table'?block.headers.length||block.rows.length:block.text);
  if(!prepared.length)throw new Error('No readable game information was found for AI analysis.');
  if(JSON.stringify(prepared).length>MAX_AI_DOCUMENT_CHARS)throw new Error('This document contains too much extracted text for one AI analysis. Split it into smaller Word documents and try again.');
  return prepared;
}

function limitedText(value,limit=4000){return text(value).slice(0,limit)}
function limitedList(value,limit=100,itemLimit=500){return uniqueNames((Array.isArray(value)?value:[]).slice(0,limit).map(item=>limitedText(item,itemLimit)))}
function confidence(value,fallback=.8){const number=Number(value);return Number.isFinite(number)?Math.min(1,Math.max(0,number)):fallback}

export function normalizeAiDocumentImport(result,source={}){
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('The AI returned an invalid document analysis.');
  const rawGame=result.game||{},rawAnalysis=result.analysis||{},model={schemaVersion:3,source:{...source,analysisMode:'ai',aiModel:limitedText(result.model||source.aiModel,80),analyzedAt:new Date().toISOString()},game:{name:limitedText(rawGame.name,100),theme:limitedText(rawGame.theme,120),description:limitedText(rawGame.description,2000),playerCount:rawGame.player_count==null?null:Math.max(0,Math.min(10000,Number(rawGame.player_count)||0)),startingPhase:rawGame.starting_phase==='Night'?'Night':'Day',notes:limitedText(rawGame.notes,4000),selected:true},factions:[],roles:[],abilities:[],rules:[],statuses:[],specialMechanics:[],analysis:{globalFallbacks:limitedList(rawAnalysis.global_fallbacks,200,1000),duplicates:limitedList(rawAnalysis.duplicates,200,1000),ambiguities:limitedList(rawAnalysis.ambiguities,200,1000),conflicts:limitedList(rawAnalysis.conflicts,200,1000),customMechanics:limitedList(rawAnalysis.custom_mechanics,200,1000),mechanicsNeedingReview:limitedList(rawAnalysis.mechanics_needing_review,500,2000),sourceMismatches:limitedList(rawAnalysis.source_mismatches,500,2000),possiblyInventedMechanics:limitedList(rawAnalysis.possibly_invented_mechanics,500,2000)},warnings:[],sections:{game:true,factions:true,roles:true,abilities:true,rules:true}};
  const factionMap=new Map(),abilityMap=new Map();
  for(const raw of (Array.isArray(result.factions)?result.factions:[]).slice(0,500)){
    const name=limitedText(raw?.name,120),key=normalizeImportName(name);if(!key||factionMap.has(key))continue;
    const faction=createFaction(name,{description:limitedText(raw.description),alignment:limitedText(raw.alignment,500),className:['VILLAGER','DEN','NEUTRAL'].includes(raw.class_name)?raw.class_name:inferFactionClass(name,raw.alignment),winCondition:limitedText(raw.win_condition),notes:limitedText(raw.notes),expectedRoleCount:raw.expected_role_count==null?null:Math.max(0,Math.min(10000,Number(raw.expected_role_count)||0)),confidence:confidence(raw.confidence,.84),sourceText:limitedText(raw.source_text||name,2000)});model.factions.push(faction);factionMap.set(key,faction);
  }
  const ensureAbility=raw=>{
    const name=limitedText(typeof raw==='string'?raw:raw?.name,120),key=normalizeImportName(name);if(!key)return null;let ability=abilityMap.get(key);
    if(!ability){const semantic=globalAbilityDefinition({name,definition:raw?.definition}),classification=classifyAbility({...raw,name}),baseFields={definition:limitedText(raw?.definition),category:['Investigation','Harmful','Protection','Support','Control','Communication','Passive','Other'].includes(raw?.category)?raw.category:inferAbilityCategory(name,raw?.definition,raw?.category),phase:['Night','Day','Any','Passive'].includes(raw?.phase)?raw.phase:inferAbilityPhase(raw?.category,raw?.definition),mechanics:limitedList(raw?.mechanics,50,120),mapping:raw?.mapping==='STANDARDIZED'||semantic?'STANDARDIZED':'CUSTOM',stableAbilityId:limitedText(raw?.standard_ability_id,120)||semantic?.abilityId||'',baseStandardAbilityId:limitedText(raw?.base_standard_ability_id||raw?.standard_ability_id,120)||semantic?.abilityId||'',baseStandardAbilityName:limitedText(raw?.base_standard_ability_name,120)||semantic?.name||'',standardizedAbilityType:classification.standardizedAbilityType,resolutionCategory:classification.resolutionCategory,resolutionPriority:classification.resolutionPriority,resolutionTiming:classification.resolutionTiming,activePassive:classification.activePassive,customIdentity:Boolean(raw?.custom_identity),factionAction:Boolean(raw?.faction_action),globalAction:Boolean(raw?.global_action),performerRequired:Boolean(raw?.performer_required),unresolvedComponents:limitedList(raw?.unresolved_components,100,500),modifiers:limitedList(raw?.modifiers,100,1000),interactions:limitedList(raw?.interactions,100,1000),confidence:confidence(raw?.confidence,.82),sourceText:limitedText(raw?.source_text||raw?.definition||name,12000),sourceLocation:limitedText(raw?.source_location,500),sourceRoleName:limitedText(raw?.source_role_name,120)};baseFields.mechanicalStatements=normalizeMechanicList(raw?.mechanical_statements,{abilityId:name,abilityName:name,roleName:baseFields.sourceRoleName,sourceLocation:baseFields.sourceLocation});ability=createAbility(name,baseFields);ability.understanding=normalizeAbilityUnderstanding({...ability,targeting:raw?.targeting||semantic?.targeting});ability.targeting=ability.understanding.targeting;model.abilities.push(ability);abilityMap.set(key,ability)}
    else if(!ability.definition&&raw?.definition)ability.definition=limitedText(raw.definition);
    return ability;
  };
  for(const raw of (Array.isArray(result.abilities)?result.abilities:[]).slice(0,1000))ensureAbility(raw);
  const roleMap=new Map();
  for(const raw of (Array.isArray(result.roles)?result.roles:[]).slice(0,2000)){
    const name=limitedText(raw?.name,120);if(!name)continue;const factionName=limitedText(raw.faction_name,120),faction=factionMap.get(normalizeImportName(factionName));
    const modes=(Array.isArray(raw.modes)?raw.modes:[]).slice(0,50).map((mode,index)=>({tempId:tempId('mode'),name:limitedText(mode?.name,120)||`Configuration ${index+1}`,description:limitedText(mode?.description,4000),abilityNames:limitedList(mode?.ability_names??mode?.active_ability_names,100,120),passiveAbilityNames:limitedList(mode?.passive_ability_names,100,120),immunities:limitedList(mode?.immunities,100,500),protections:limitedList(mode?.protections,100,500),restrictions:limitedList(mode?.restrictions,100,500),statusBehavior:limitedList(mode?.status_behavior,100,500),investigationAppearance:mode?.investigation_appearance&&typeof mode.investigation_appearance==='object'?mode.investigation_appearance:{},cooldown:limitedText(mode?.cooldown,500),abilityUses:Object.fromEntries((Array.isArray(mode?.ability_uses)?mode.ability_uses:[]).map(item=>[limitedText(item?.ability_name,120),{baseUses:item?.base_uses??null,sharedPool:limitedText(item?.shared_pool,120)}]).filter(([name])=>name)),resourcePools:Object.fromEntries((Array.isArray(mode?.resource_pools)?mode.resource_pools:[]).map(item=>[limitedText(item?.name,120),{uses:item?.uses??null,abilityNames:limitedList(item?.ability_names,100,120),sharedAcrossModes:Boolean(item?.shared_across_modes)}]).filter(([name])=>name)),switchRules:mode?.switch_rules&&typeof mode.switch_rules==='object'?mode.switch_rules:{},specialRules:limitedList(mode?.special_rules,100,1000),reviewRequired:Boolean(mode?.review_required),reviewWarnings:limitedList(mode?.review_warnings,100,1000),sourceText:limitedText(mode?.source_text,12000),sourceLocation:limitedText(mode?.source_location,500)})),roleWideAbilityNames=limitedList(raw.role_wide_ability_names,100,120),roleWidePassiveAbilityNames=limitedList(raw.role_wide_passive_ability_names,100,120);
    const abilityNames=limitedList([...(Array.isArray(raw.ability_names)?raw.ability_names:[]),...roleWideAbilityNames,...roleWidePassiveAbilityNames,...modes.flatMap(mode=>[...mode.abilityNames,...mode.passiveAbilityNames]),raw.active_ability_name,raw.passive_ability_name],300,120);abilityNames.forEach(abilityName=>ensureAbility({name:abilityName,definition:'',category:'Other',phase:'Any',confidence:.55,source_text:abilityName}));
    const abilityModifiers=(Array.isArray(raw.role_modifiers)?raw.role_modifiers:[]).slice(0,100).map(item=>({abilityName:limitedText(item?.ability_name,120),modifier:limitedText(item?.modifier,4000)})).filter(item=>item.abilityName&&item.modifier),statusInteractions=limitedList(raw.status_interactions,100,1000),relationships=limitedList(raw.relationships,100,1000),gmNotes=[limitedText(raw.gm_notes),abilityModifiers.length&&'Role ability modifiers:\n'+abilityModifiers.map(item=>item.abilityName+': '+item.modifier).join('\n'),statusInteractions.length&&'Status interactions:\n'+statusInteractions.join('\n'),relationships.length&&'Relationships:\n'+relationships.join('\n')].filter(Boolean).join('\n\n');
    const explicitType=limitedText(raw.role_type,40).toUpperCase(),role=createRole(name,{factionTempId:faction?.tempId||null,factionName:faction?.name||factionName,alignment:limitedText(raw.alignment,500),description:limitedText(raw.description),activeAbilityName:limitedText(raw.active_ability_name,120),passiveAbilityName:limitedText(raw.passive_ability_name,120),abilityNames,roleWideAbilityNames,roleWidePassiveAbilityNames,modes,modeSelectionPolicy:raw.mode_selection_policy==='CHOOSE_BEFORE_ACTION'?'CHOOSE_BEFORE_ACTION':'CURRENT_ONLY',startingModeName:limitedText(raw.starting_mode_name,120),abilityUses:raw.ability_uses==null?null:Math.max(0,Math.min(10000,Number(raw.ability_uses)||0)),cooldowns:limitedText(raw.cooldowns,1000),restrictions:limitedList(raw.restrictions,100,500),immunities:limitedList(raw.immunities,100,500),abilityModifiers,statusInteractions,relationships,unresolvedComponents:limitedList(raw.unresolved_components,100,500),winCondition:limitedText(raw.win_condition),notes:limitedText(raw.notes),gmNotes,tags:limitedList(raw.tags,100,120),roleType:explicitType===ROLE_TYPES.BASIC?ROLE_TYPES.BASIC:ROLE_TYPES.STANDARD,abilityDataStatus:explicitType===ROLE_TYPES.BASIC?ABILITY_DATA_STATUSES.INTENTIONALLY_NONE:abilityNames.length?ABILITY_DATA_STATUSES.COMPLETE:ABILITY_DATA_STATUSES.POSSIBLY_INCOMPLETE,basicEvidence:limitedText(raw.basic_evidence,1000),slotCount:Math.max(1,Math.min(1000,Number(raw.slot_count)||1)),enabled:raw.enabled!==false,confidence:confidence(raw.confidence,.82),sourceText:limitedText(raw.source_text||name,12000),sourceLocation:limitedText(raw.source_location,500)});
    role.mechanicalStatements=normalizeMechanicList(raw.mechanical_statements,{roleId:role.tempId,roleName:role.name,sourceLocation:role.sourceLocation});role.understanding=normalizeRoleUnderstanding(role);
    const key=normalizeImportName(name),first=roleMap.get(key);if(first){role.duplicateOfTempId=first.tempId;role.selected=false;model.warnings.push(createWarning('duplicate-role','Possible duplicate role: '+name+'. It is set to merge; choose Keep Separate to import both.','warning',role.tempId))}else roleMap.set(key,role);model.roles.push(role);
  }
  for(const raw of (Array.isArray(result.rules)?result.rules:[]).slice(0,1000)){
    const title=limitedText(raw?.title,120),description=limitedText(raw?.description);if(!title&&!description||raw?.scope==='GLOBAL_FALLBACK_REFERENCE')continue;model.rules.push({tempId:tempId('rule'),title:title||limitedText(description,120)||'Imported Rule',ruleKey:limitedText(raw.rule_key,120),description,category:limitedText(raw.category,80)||'General',ruleType:limitedText(raw.rule_type,80)||'General',scope:raw.scope==='GAME_OVERRIDE'?'GAME_OVERRIDE':'GAME_SPECIFIC',globalRuleKey:limitedText(raw.fallback_rule_key,120),visibility:raw.visibility==='gm'?'gm':'public',notes:limitedText(raw.notes),conflicts:limitedList(raw.conflicts,100,1000),enabled:raw.enabled!==false,selected:true,confidence:confidence(raw.confidence,.82),sourceText:limitedText(raw.source_text||description,2000),sourceLocation:limitedText(raw.source_location,500)});
  }
  for(const raw of (Array.isArray(result.statuses)?result.statuses:[]).slice(0,500)){const name=limitedText(raw?.name,120),description=limitedText(raw?.description);if(!name&&!description)continue;const status={name:name||'Imported Status',statusType:limitedText(raw.status_type,80),category:limitedText(raw.category,80)||'Statuses',description,duration:limitedText(raw.duration,500),interactions:limitedList(raw.interactions,100,1000),confidence:confidence(raw.confidence,.82),sourceText:limitedText(raw.source_text||description,2000),sourceLocation:limitedText(raw.source_location,500)};model.statuses.push(status);model.rules.push({tempId:tempId('rule'),title:'Status: '+status.name,ruleKey:'STATUS_'+normalizeImportName(status.statusType||status.name).replace(/\s+/g,'_').toUpperCase(),description:[status.description,status.duration&&'Duration: '+status.duration,status.interactions.length&&'Interactions: '+status.interactions.join('; ')].filter(Boolean).join('\n'),category:'Statuses',ruleType:'STATUS_DEFINITION',scope:'GAME_SPECIFIC',globalRuleKey:'',visibility:'gm',notes:'Imported status definition',conflicts:[],enabled:true,selected:true,confidence:status.confidence,sourceText:status.sourceText,sourceLocation:status.sourceLocation})}
  for(const raw of (Array.isArray(result.special_mechanics)?result.special_mechanics:[]).slice(0,500)){const name=limitedText(raw?.name,120),description=limitedText(raw?.description);if(!name&&!description)continue;const mechanic={name:name||'Special Mechanic',description,category:limitedText(raw.category,80)||'Special Mechanics',interactions:limitedList(raw.interactions,100,1000),confidence:confidence(raw.confidence,.82),sourceText:limitedText(raw.source_text||description,2000),sourceLocation:limitedText(raw.source_location,500)};model.specialMechanics.push(mechanic);model.rules.push({tempId:tempId('rule'),title:mechanic.name,ruleKey:'MECHANIC_'+normalizeImportName(mechanic.name).replace(/\s+/g,'_').toUpperCase(),description:[mechanic.description,mechanic.interactions.length&&'Interactions: '+mechanic.interactions.join('; ')].filter(Boolean).join('\n'),category:mechanic.category,ruleType:'SPECIAL_MECHANIC',scope:'GAME_SPECIFIC',globalRuleKey:'',visibility:'gm',notes:'Imported special mechanic',conflicts:[],enabled:true,selected:true,confidence:mechanic.confidence,sourceText:mechanic.sourceText,sourceLocation:mechanic.sourceLocation})}
  for(const warning of (Array.isArray(result.warnings)?result.warnings:[]).slice(0,200))if(limitedText(warning,1000))model.warnings.push(createWarning('ai-review',limitedText(warning,1000),'warning'));
  if(!model.game.name){model.game.name=text(source.fileName).replace(/\.docx$/i,'')||'Imported Game';model.warnings.push(createWarning('game-name-inferred','The AI could not identify a game name, so it was inferred from the file name.'))}
  model.roles.forEach(role=>{if(!role.factionTempId)model.warnings.push(createWarning('unassigned-faction','Could not determine a faction for '+role.name+'. Assign one before importing.','warning',role.tempId));addMissingAbilityWarning(model,role)});
  model.abilities.forEach(ability=>{if(!ability.definition)model.warnings.push(createWarning('missing-ability-definition','No definition was detected for '+ability.name+'. Review and complete it before importing.','warning',ability.tempId))});
  if(!model.factions.length)model.warnings.push(createWarning('no-factions','No factions were detected.','error'));
  if(!model.roles.length)model.warnings.push(createWarning('no-roles','No roles were detected.','error'));
  if(!model.rules.length)model.warnings.push(createWarning('no-rules','No individual game rules were detected.','info'));
  const mechanicsReviews=mechanicsReviewQueue({game:model.game,roles:model.roles,abilities:model.abilities});model.analysis.mechanicsReview=mechanicsReviews;for(const item of mechanicsReviews.slice(0,500))model.warnings.push(createWarning('mechanic-review-required',(item.roleName||item.abilityName||'Mechanic')+': '+item.parsedUnderstanding,'warning',item.id));
  return model;
}

export function analyzeDocumentBlocks(blocks,source={}){
  const flatModel=analyzeFlatRosterDocument(blocks,source);if(flatModel)return flatModel;
  const model={schemaVersion:1,source:{...source},game:{name:'',theme:'',description:'',playerCount:null,startingPhase:'Day',notes:'',selected:true},factions:[],roles:[],abilities:[],rules:[],warnings:[],sections:{game:true,factions:true,roles:true,abilities:true,rules:true}};
  const factionMap=new Map(),abilityMap=new Map();let section=null,sectionLevel=0,currentFaction=null,factionLevel=0,currentRole=null,roleLevel=0,currentMode=null,currentAbility=null,pendingText='',gameDescription=[];
  const ensureFaction=(name,fields={})=>{const clean=text(name);if(!clean)return null;const key=normalizeImportName(clean);let faction=factionMap.get(key);if(!faction){faction=createFaction(clean,fields);model.factions.push(faction);factionMap.set(key,faction)}else Object.assign(faction,Object.fromEntries(Object.entries(fields).filter(([,value])=>value!==''&&value!=null)));return faction};
  const beginRole=(name,fields={},level=sectionLevel+1)=>{const role=createRole(name,fields);if(currentFaction){role.factionTempId=currentFaction.tempId;role.factionName=currentFaction.name}model.roles.push(role);currentRole=role;roleLevel=level;currentMode=null;pendingText='';return role};
  const beginMode=(name,fields={})=>{if(!currentRole)return null;const cleanName=text(name).replace(/:\s*$/,'');if(!cleanName)return null;const existing=currentRole.modes.find(mode=>normalizeImportName(mode.name)===normalizeImportName(cleanName));if(existing){currentMode=existing;return existing}currentMode={tempId:tempId('mode'),name:cleanName,description:'',abilityNames:[],passiveAbilityNames:[],immunities:[],protections:[],restrictions:[],statusBehavior:[],investigationAppearance:{},cooldown:'',abilityUses:{},resourcePools:{},switchRules:{},specialRules:[],reviewRequired:false,reviewWarnings:[],sourceText:text(fields.sourceText||name),sourceLocation:text(fields.sourceLocation||'')};currentRole.modes.push(currentMode);return currentMode};
  const ensureRoleFromPending=()=>{if(!currentRole&&pendingText)beginRole(pendingText);else if(pendingText&&currentRole&&normalizeImportName(pendingText)!==normalizeImportName(currentRole.name))beginRole(pendingText)};
  const addAbility=(role,abilityData)=>{if(!abilityData?.name)return null;const key=normalizeImportName(abilityData.name);let ability=abilityMap.get(key);if(!ability){ability=createAbility(abilityData.name,{definition:text(abilityData.definition),category:abilityData.category||'Other',phase:abilityData.phase||'Any',sourceText:text(abilityData.definition||abilityData.name)});abilityMap.set(key,ability);model.abilities.push(ability)}else if(!ability.definition&&abilityData.definition)ability.definition=text(abilityData.definition);if(role){role.abilityNames=uniqueNames([...role.abilityNames,ability.name]);if(currentMode){if(abilityData.type==='passive')currentMode.passiveAbilityNames=uniqueNames([...currentMode.passiveAbilityNames,ability.name]);else currentMode.abilityNames=uniqueNames([...currentMode.abilityNames,ability.name])}else if(abilityData.type==='passive')role.roleWidePassiveAbilityNames=uniqueNames([...(role.roleWidePassiveAbilityNames||[]),ability.name]);else role.roleWideAbilityNames=uniqueNames([...role.roleWideAbilityNames,ability.name]);if(abilityData.type==='passive')role.passiveAbilityName=role.passiveAbilityName||ability.name;else if(!role.activeAbilityName)role.activeAbilityName=ability.name}return ability};
  const addRule=value=>{const clean=text(value);if(clean)model.rules.push(ruleFromText(clean,model.rules.length))};
  const assignLabel=(label,value,raw)=>{
    if(label==='role'||label==='role name'||label==='character'){beginRole(value);return true}
    if(['mode','form','state','configuration','stance','transformation','phase'].includes(label)&&currentRole){beginMode(value,{sourceText:raw});return true}
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
    if(label==='ability uses'||label==='uses'){ensureRoleFromPending();if(currentMode)currentMode.abilityUses.default=safeNumber(value);else if(currentRole)currentRole.abilityUses=safeNumber(value);return true}
    if(label==='cooldown'||label==='cooldowns'){ensureRoleFromPending();if(currentMode)currentMode.cooldown=value;else if(currentRole)currentRole.cooldowns=value;return true}
    if(label==='switch cooldown'||label==='transformation cooldown'){ensureRoleFromPending();if(currentMode)currentMode.switchRules.cooldown=value;return true}
    if(label==='restrictions'||label==='restriction'){ensureRoleFromPending();if(currentMode)currentMode.restrictions=splitList(value);else if(currentRole)currentRole.restrictions=splitList(value);return true}
    if(label==='immunities'||label==='immunity'){ensureRoleFromPending();if(currentMode)currentMode.immunities=splitList(value);else if(currentRole)currentRole.immunities=splitList(value);return true}
    if(label==='protections'||label==='protection'){ensureRoleFromPending();if(currentMode)currentMode.protections=splitList(value);return true}
    if(label==='investigation appearance'||label==='appears as'||label==='investigation result'){ensureRoleFromPending();if(currentMode)currentMode.investigationAppearance.roleAppearance=value;return true}
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
  const documentBlocks=Array.isArray(blocks)?blocks:[],configurationHint=value=>/\b(?:mode|form|state|phase|transformation|configuration|stance|human|beast|monster|offensive|defensive|normal|enraged|before|after)\b/i.test(text(value));
  const structurallyStartsConfiguration=(block,index)=>{if(!currentRole||!looksLikeTitle(text(block?.text)))return false;if(block.type==='heading')return Number(block.level||6)>roleLevel;if(block.type!=='list-item'&&block.type!=='paragraph')return false;const next=documentBlocks.slice(index+1).find(item=>text(item?.text));return Boolean(next&&((Number(next.indent)||0)>(Number(block.indent)||0)||configurationHint(block.text)&&next.type==='list-item'))};
  for(let blockIndex=0;blockIndex<documentBlocks.length;blockIndex+=1){
    const block=documentBlocks[blockIndex];
    if(block.type==='table'){processTable(block);continue}
    const value=text(block.text);if(!value)continue;
    if(block.type==='heading'){
      const nextSection=sectionFor(value);if(nextSection){section=nextSection;sectionLevel=Number(block.level)||1;currentRole=null;currentMode=null;currentAbility=null;pendingText='';if(section!=='factions')currentFaction=null;continue}
      if(!model.game.name){model.game.name=value;continue}
      if(section==='factions'){
        const level=Number(block.level)||6;if(currentRole&&level>roleLevel){beginMode(value,{sourceText:value});continue}if(currentFaction&&level>factionLevel){beginRole(value,{},level);continue}
        currentFaction=ensureFaction(value);factionLevel=level||sectionLevel+1;currentRole=null;currentMode=null;pendingText='';continue;
      }
      if(section==='roles'){const level=Number(block.level)||6;if(currentRole&&level>roleLevel){beginMode(value,{sourceText:value});continue}beginRole(value,{},level);continue}
      if(section==='abilities'){currentAbility=addAbility(null,{name:value,definition:'',category:inferAbilityCategory(value,'',''),phase:'Any'});continue}
      if(section==='rules'){addRule(value);continue}
      if(!section&&looksLikeTitle(value)){currentFaction=ensureFaction(value);section='factions';factionLevel=Number(block.level)||2;continue}
    }
    if(structurallyStartsConfiguration(block,blockIndex)){beginMode(value,{sourceText:value});continue}
    const labeled=labeledValue(value);if(labeled&&assignLabel(labeled.label,labeled.value,value))continue;
    if(currentMode&&block.type==='list-item'){
      const normalizedValue=normalizeImportName(value),isPassive=/\b(?:passive|immune|immunity|bulletproof|reflection|counterattack|protection|invisible)\b/.test(normalizedValue),looksLikeAbility=knownAbilityPrefixes.some(prefix=>normalizedValue===prefix||normalizedValue.startsWith(prefix+' '))||/\s(?:—|–|-)\s|^[^:]{1,60}:\s*\S/.test(value);
      if(/\b(?:immune|immunity|bulletproof)\b/.test(normalizedValue))currentMode.immunities=uniqueNames([...currentMode.immunities,value]);
      if(/\b(?:protect|protection|shield|plates)\b/.test(normalizedValue))currentMode.protections=uniqueNames([...currentMode.protections,value]);
      if(/\b(?:appears? as|shows? as|invisible to|investigation)\b/.test(normalizedValue))currentMode.investigationAppearance.rules=uniqueNames([...(currentMode.investigationAppearance.rules||[]),value]);
      if(looksLikeAbility)addAbility(currentRole,abilityFromValue(value,isPassive?'passive':'ability',currentRole.name));else currentMode.specialRules=uniqueNames([...currentMode.specialRules,value]);
      continue;
    }
    if(section==='rules'||block.type==='list-item'&&section==='rules'){addRule(value);continue}
    if(section==='abilities'&&currentAbility){currentAbility.definition=[currentAbility.definition,value].filter(Boolean).join(' ');currentAbility.category=inferAbilityCategory(currentAbility.name,currentAbility.definition,'');continue}
    if(section==='factions'){
      if(!currentFaction&&looksLikeTitle(value)){currentFaction=ensureFaction(value);pendingText='';continue}
      if(looksLikeTitle(value)){pendingText=value;continue}
      if(pendingText)ensureRoleFromPending();if(currentMode){currentMode.description=[currentMode.description,value].filter(Boolean).join(' ')}else if(currentRole){currentRole.description=[currentRole.description,value].filter(Boolean).join(' ')}else if(currentFaction){currentFaction.description=[currentFaction.description,value].filter(Boolean).join(' ')}continue;
    }
    if(section==='roles'){
      if(looksLikeTitle(value)&&!currentRole){beginRole(value);continue}
      if(currentMode)currentMode.description=[currentMode.description,value].filter(Boolean).join(' ');else if(currentRole)currentRole.description=[currentRole.description,value].filter(Boolean).join(' ');continue;
    }
    if(section==='game'){gameDescription.push(value);continue}
    if(!section&&!model.game.description)gameDescription.push(value);
  }
  if(!model.game.description&&gameDescription.length)model.game.description=gameDescription.join('\n').slice(0,2000);
  if(!model.game.name){model.game.name=text(source.fileName).replace(/\.docx$/i,'')||'Imported Game';model.warnings.push(createWarning('game-name-inferred','The game name could not be identified confidently and was inferred from the file name.'))}
  model.roles.forEach(role=>{if(role.factionName&&!role.factionTempId){const faction=ensureFaction(role.factionName);role.factionTempId=faction?.tempId||null}if(!role.factionTempId)model.warnings.push(createWarning('unassigned-faction','Could not determine a faction for '+role.name+'. Assign one before importing.','warning',role.tempId));if(role.modes.length>1&&role.description&&/\b(?:ability|immune|protect|cooldown|use|cannot|may|can)\b/i.test(role.description))model.warnings.push(createWarning('ambiguous-mode-scope','Possible multi-configuration role detected. '+role.name+' has role-level mechanics whose ROLE_WIDE versus MODE_SPECIFIC scope is unclear. GM classification required.','warning',role.tempId));addMissingAbilityWarning(model,role)});
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
    const semantic=globalAbilityDefinition(ability),ranked=usable.map(item=>({...item,score:Math.max(abilitySimilarity(ability.name,item.name),semantic&&globalAbilityDefinition(item)?.abilityId===semantic.abilityId?0.8:0)})).filter(item=>item.score>=.5).sort((a,b)=>b.score-a.score||Number(Boolean(b.builtIn))-Number(Boolean(a.builtIn)));
    ability.possibleMatches=ranked.slice(0,5).map(item=>({key:item.key||item.id,name:item.name,score:item.score,sourceGameName:item.sourceGameName||'',builtIn:Boolean(item.builtIn)}));
    const exact=ranked.find(item=>item.score===1);if(exact){ability.matchStatus='exact';ability.matchKey=exact.key||exact.id;ability.stableAbilityId=ability.stableAbilityId||exact.stableId||exact.ability_id||'';ability.mapping=String(ability.stableAbilityId).length?'STANDARDIZED':ability.mapping;ability.decision='use-existing'}else if(ranked[0]?.score>=.72){ability.matchStatus='possible';ability.matchKey='';ability.decision='create-new';model.warnings.push(createWarning('possible-ability-match',ability.name+' may match '+ranked[0].name+'. Review the ability decision before import.','info',ability.tempId))}else{ability.matchStatus='new';ability.matchKey='';ability.decision='create-new'};
  });return model;
}

export function validateGameImport(model){
  const errors=[],warnings=[];if(!model||typeof model!=='object')return {valid:false,errors:['No parsed import is available.'],warnings};
  if(!text(model.game?.name)||text(model.game.name).length>100)errors.push('Game name must contain 1 to 100 characters.');
  const factions=(model.sections?.factions===false?[]:model.factions.filter(item=>item.selected)),roles=(model.sections?.roles===false?[]:model.roles.filter(item=>item.selected)),abilities=(model.sections?.abilities===false?[]:model.abilities.filter(item=>item.selected)),rules=(model.sections?.rules===false?[]:model.rules.filter(item=>item.selected));
  if(!factions.length)errors.push('Import at least one faction.');
  if(!roles.length)errors.push('Import at least one role.');
  const factionIds=new Set(factions.map(item=>item.tempId)),roleNames=new Set();roles.forEach(role=>{classifyImportedRole(role);const key=normalizeImportName(role.name),mechanics=normalizeRoleUnderstanding(role).mechanics;if(!key)errors.push('Every selected role needs a name.');else if(roleNames.has(key))errors.push('Selected role names must be unique: '+role.name+'.');else roleNames.add(key);if(!role.factionTempId||!factionIds.has(role.factionTempId))errors.push(role.name+' must be assigned to a selected faction.');if(role.roleType===ROLE_TYPES.BASIC&&(role.abilityNames?.length||mechanics.length))errors.push(role.name+' is Basic and cannot own role abilities or invented mechanics.');if(role.abilityDataStatus===ABILITY_DATA_STATUSES.POSSIBLY_INCOMPLETE)warnings.push(role.name+' may be missing ability data; it was not silently classified as Basic.');if(role.passiveAbilityName&&!mechanics.some(item=>item.type==='PASSIVE'))warnings.push(role.name+' has a passive ability label without a source-backed structured passive. GM review is required.');for(const mechanic of mechanics)if(!mechanic.originalText&&['VERIFIED','HIGH_CONFIDENCE'].includes(mechanic.interpretationState))errors.push(role.name+' has a verified mechanic without preserved source text.');});
  const abilityNames=new Set();abilities.forEach(ability=>{const key=normalizeImportName(ability.name),understanding=normalizeAbilityUnderstanding(ability);if(!key)errors.push('Every selected ability needs a name.');else if(abilityNames.has(key))errors.push('Selected ability names must be unique: '+ability.name+'.');else abilityNames.add(key);if(ability.decision==='use-existing'&&!ability.matchKey)errors.push('Choose an existing Encyclopedia match for '+ability.name+'.');if(understanding.customIdentity&&ability.decision==='use-existing')errors.push(ability.name+' is a role-specific custom ability and cannot be flattened into an existing Encyclopedia entry. Create it as a custom ability while retaining its base mechanic.');if(understanding.targeting.type==='FACTION'&&!understanding.mechanics.some(item=>item.targeting.type==='FACTION'||['FACTION_BLOCK','FACTION_EFFECT'].includes(item.type)))warnings.push(ability.name+' uses a faction target without a source-backed faction mechanic.');});
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
  const roleProjection=role=>({name:role.name,factionName:role.factionName||factionNameById.get(role.factionId)||importFactionNameById.get(role.factionTempId)||'',roleType:role.roleType||ROLE_TYPES.STANDARD,abilityDataStatus:role.abilityDataStatus||ABILITY_DATA_STATUSES.POSSIBLY_INCOMPLETE,basicEvidence:role.basicEvidence||'',slotCount:Math.max(1,Number(role.slotCount)||1),alignment:role.alignment||'',description:role.description||'',activeAbilityName:role.activeAbilityName||'',passiveAbilityName:role.passiveAbilityName||'',abilityNames:uniqueNames(role.abilityNames||role.tags||[]).sort(),roleWideAbilityNames:uniqueNames(role.roleWideAbilityNames||role.role_wide_ability_names||[]).sort(),roleWidePassiveAbilityNames:uniqueNames(role.roleWidePassiveAbilityNames||role.role_wide_passive_ability_names||[]).sort(),modes:role.modes||[],modeSelectionPolicy:role.modeSelectionPolicy||role.mode_selection_policy||'CURRENT_ONLY',startingModeName:role.startingModeName||role.starting_mode_name||'',abilityUses:role.abilityUses??null,cooldowns:role.cooldowns||'',restrictions:role.restrictions||[],immunities:role.immunities||[],mechanicalStatements:role.mechanicalStatements||role.understanding?.mechanics||[],understanding:role.understanding||{},unresolvedComponents:role.unresolvedComponents||[],winCondition:role.winCondition||'',notes:role.notes||'',gmNotes:role.gmNotes||'',tags:role.tags||[],enabled:role.enabled!==false});
  const currentRoles=(data.roles||[]).map(role=>({...roleProjection(role),_record:role})),incomingRoles=model.roles.filter(role=>role.selected).map(role=>({...roleProjection(role),_record:role}));
  const currentFactions=(data.factions||[]).map(item=>({name:item.name,className:item.class,description:item.description||'',alignment:item.alignment||'',winCondition:item.winCondition||'',notes:item.notes||'',_record:item})),incomingFactions=model.factions.filter(item=>item.selected).map(item=>({...item,_record:item}));
  const currentAbilities=(data.abilities||[]).map(item=>({name:item.name,definition:item.definition||'',category:item.category||'Other',phase:item.phase||'Any',mechanics:item.mechanics||[],understanding:item.understanding||{},builtIn:Boolean(item.builtIn),_record:item})),incomingAbilities=model.abilities.filter(item=>item.selected).map(item=>({...item,_record:item}));
  const currentRules=(data.rules||[]).map(item=>({title:item.title,description:item.description||'',category:item.category||'General',visibility:item.visibility||'public',notes:item.notes||'',enabled:item.enabled!==false,_record:item})),incomingRules=model.rules.filter(item=>item.selected).map(item=>({...item,_record:item}));
  const gameIncoming={name:model.game.name,theme:model.game.theme||'',description:model.game.description||'',notes:model.game.notes||'',currentPhase:model.game.startingPhase||'Day'},gameDifferences=changedFields(game,gameIncoming,['name','theme','description','notes','currentPhase']);
  return {game:{status:gameDifferences.length?'CHANGED':'UNCHANGED',current:game,document:gameIncoming,differences:gameDifferences,decision:'keep'},factions:compareCollection(currentFactions,incomingFactions,item=>normalizeImportName(item.name),['className','description','alignment','winCondition','notes']),roles:compareCollection(currentRoles,incomingRoles,item=>normalizeImportName(item.name),['factionName','roleType','abilityDataStatus','slotCount','alignment','description','activeAbilityName','passiveAbilityName','abilityNames','roleWideAbilityNames','roleWidePassiveAbilityNames','modes','modeSelectionPolicy','startingModeName','abilityUses','cooldowns','restrictions','immunities','mechanicalStatements','understanding','unresolvedComponents','winCondition','notes','gmNotes','tags','enabled']),abilities:compareCollection(currentAbilities,incomingAbilities,item=>normalizeImportName(item.name),['definition','category','phase','mechanics','understanding'],{skipMissing:item=>item.builtIn}),rules:compareCollection(currentRules,incomingRules,item=>normalizeImportName(item.title),['description','category','visibility','notes','enabled'])};
}

export function importSummary(model){
  const count=key=>model.sections?.[key]===false?0:(model[key]||[]).filter(item=>item.selected).length,analysis=model.analysis||{};return {factions:count('factions'),roles:count('roles'),abilities:count('abilities'),rules:count('rules'),mechanics:(model.roles||[]).filter(item=>item.selected).reduce((sum,item)=>sum+(item.mechanicalStatements||[]).length,0),mechanicsReview:(analysis.mechanicsReview||[]).length,roleModifiers:(model.roles||[]).filter(item=>item.selected).reduce((sum,item)=>sum+(item.abilityModifiers||[]).length,0),statuses:(model.statuses||[]).length,specialMechanics:(model.specialMechanics||[]).length,globalFallbacks:(analysis.globalFallbacks||[]).length,duplicates:(analysis.duplicates||[]).length,ambiguities:(analysis.ambiguities||[]).length,conflicts:(analysis.conflicts||[]).length,warnings:(model.warnings||[]).length};
}
import {ABILITY_DATA_STATUSES,ROLE_TYPES,classifyRoleAbilityData} from './player-setup.js?v=11.9.0';
