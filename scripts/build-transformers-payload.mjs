import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import mammoth from 'mammoth';
import {analyzeDocumentBlocks,htmlToDocumentBlocks,validateGameImport} from '../js/document-import.js';

export const courtroomAbilityNames=[
  'Basic Ask','Advanced Ask','Alignment Ask','Watch','Track','Action Check','Gravedigger','Map',
  'Den Regular Kill','Personal Instant Kill','Super Kill','Omega Kill','Poison','Mark','Roleblock',
  'Drunk','Sober','Duel / Fight','Convert','Steal','Protect','Guard','Den Block','Save','Heal','Super Protect',
  'Death Immunity','Reflection','Counterattack','Bulletproof / Passive Immunity','Ability Amplify',
  'Additional Uses','Action Success Guarantee','Villagers Block','Place Swap','Role Swap','Redirect'
];

export const roleAbilityMap={
  'Alpha – Megatron':{abilities:['Personal Instant Kill','Convert','Bulletproof / Passive Immunity'],primary:'Personal Instant Kill',passive:'Bulletproof / Passive Immunity'},
  'Dark Seer – Soundwave':{abilities:['Advanced Ask','Steal','Personal Instant Kill','Watch','Track'],primary:'Advanced Ask'},
  'Blocker – Starscream':{abilities:['Roleblock','Bulletproof / Passive Immunity'],primary:'Roleblock',passive:'Bulletproof / Passive Immunity'},
  'Traitor – Punch/Counterpunch':{abilities:[],primary:'',sourceOnly:true},
  'Mark/Soul Bound – Bombshell':{abilities:['Mark','Death Immunity'],primary:'Mark',passive:'Death Immunity'},
  'Omega – Fallen':{abilities:['Omega Kill'],primary:'Omega Kill'},
  'Gravedigger/Insta – Shockwave':{abilities:['Gravedigger','Steal','Personal Instant Kill'],primary:'Gravedigger'},
  'Doc – Ratchet':{abilities:['Save','Heal','Protect'],primary:'Save'},
  'Seer – Nightbeat':{abilities:['Basic Ask','Advanced Ask','Track','Bulletproof / Passive Immunity'],primary:'Basic Ask',passive:'Bulletproof / Passive Immunity'},
  'Omega Supreme – 2 nd in command':{abilities:['Super Kill'],primary:'Super Kill'},
  'Milf – Elita':{abilities:['Watch','Action Success Guarantee','Roleblock','Action Check'],primary:'Watch'},
  'Den Blocker – Ironhide':{abilities:['Guard','Reflection','Bulletproof / Passive Immunity','Den Block'],primary:'Guard',passive:'Bulletproof / Passive Immunity'},
  'Protector – Trailbreaker':{abilities:['Protect'],primary:'Protect'},
  'Sting – Cosmos':{abilities:['Basic Ask','Advanced Ask','Watch'],primary:'Basic Ask'},
  'Martyr – Skids':{abilities:['Guard','Watch','Advanced Ask','Action Success Guarantee'],primary:'Guard'},
  'Lawyer – Bluestreak':{abilities:['Save','Roleblock','Bulletproof / Passive Immunity'],primary:'Save',passive:'Bulletproof / Passive Immunity'},
  'Drunk – Kup':{abilities:['Drunk','Sober','Place Swap'],primary:'Drunk'},
  'Map – Teletron':{abilities:['Basic Ask','Map'],primary:'Basic Ask'},
  'Gravedigger – Rung':{abilities:['Gravedigger','Advanced Ask','Bulletproof / Passive Immunity'],primary:'Gravedigger',passive:'Bulletproof / Passive Immunity'},
  'Instakill – Grimlock':{abilities:['Reflection','Super Kill','Personal Instant Kill'],primary:'Super Kill',passive:'Reflection'},
  'Sherriff – Prowl':{abilities:['Counterattack','Personal Instant Kill'],primary:'Personal Instant Kill',passive:'Counterattack'},
  'Tracker – Bumblee Bee':{abilities:['Track','Bulletproof / Passive Immunity'],primary:'Track',passive:'Bulletproof / Passive Immunity'},
  'Poison/Protect – Red alert':{abilities:['Protect','Poison','Personal Instant Kill','Super Kill','Super Protect'],primary:'Protect'},
  'Gambler – Wheeljack':{abilities:['Personal Instant Kill','Roleblock','Action Success Guarantee'],primary:'Personal Instant Kill'},
  'Ultimate – Optimus':{abilities:['Basic Ask','Protect','Roleblock','Save','Death Immunity','Personal Instant Kill','Super Kill'],primary:'Basic Ask',passive:'Death Immunity'},
  'Evesdropper – Jazz':{abilities:['Action Check','Advanced Ask'],primary:'Action Check'},
  'Power boost – Jetfire':{abilities:['Action Success Guarantee','Ability Amplify'],primary:'Action Success Guarantee'},
  'Jammers/Traps – Smoke Screen':{abilities:['Protect','Watch'],primary:'Protect'},
  'Sam':{abilities:['Watch','Death Immunity'],primary:'Watch',passive:'Death Immunity'},
  'Allpark shard':{abilities:['Alignment Ask'],primary:'Alignment Ask'},
  'Ron & Judy':{abilities:[],primary:'',sourceOnly:true},
  'Ron':{abilities:['Roleblock','Action Check'],primary:'Roleblock'},
  'Agent Simmons':{abilities:['Roleblock'],primary:'Roleblock'},
  'Silas – Basic hunter':{abilities:['Personal Instant Kill'],primary:'Personal Instant Kill'},
  'Cade – Inventor':{abilities:['Basic Ask','Advanced Ask','Protect','Personal Instant Kill'],primary:'Basic Ask'},
  'Dylan – Corporate traitor':{abilities:['Steal','Convert'],primary:'Steal'},
  'Unicron- Ultimate Neutral':{abilities:['Advanced Ask','Roleblock','Personal Instant Kill','Super Kill','Omega Kill','Mark'],primary:'Mark'}
};

export const roleModeAbilityMap={
  'Alpha – Megatron':{modes:{'Robot Mode':['Personal Instant Kill','Convert'],'Alt Mode':['Bulletproof / Passive Immunity']},roleWide:[]},
  'Dark Seer – Soundwave':{modes:{'Robot Mode':['Advanced Ask','Steal','Personal Instant Kill'],'Alt Mode':['Advanced Ask','Watch','Track']},roleWide:[]},
  'Blocker – Starscream':{modes:{'Robot Mode':['Roleblock'],'Alt Mode':['Bulletproof / Passive Immunity']},roleWide:[]},
  'Mark/Soul Bound – Bombshell':{modes:{'Robot Mode':['Mark'],'Alt Mode':['Mark','Death Immunity']},roleWide:[]},
  'Omega – Fallen':{modes:{'Robot Mode':[],'Alt Mode':['Omega Kill']},roleWide:[]},
  'Gravedigger/Insta – Shockwave':{modes:{'Robot Mode':['Gravedigger','Steal'],'Alt Mode':['Personal Instant Kill']},roleWide:[]},
  'Doc – Ratchet':{modes:{'Robot Mode':['Save','Heal'],'Alt Mode':['Protect']},roleWide:[]},
  'Seer – Nightbeat':{modes:{'Robot Mode':['Basic Ask','Advanced Ask'],'Alt Mode':['Track','Bulletproof / Passive Immunity']},roleWide:[]},
  'Omega Supreme – 2 nd in command':{modes:{'Robot Mode':[],'Alt Mode':['Super Kill']},roleWide:[]},
  'Milf – Elita':{modes:{'Robot Mode':['Watch','Action Check'],'Alt Mode':['Action Success Guarantee','Roleblock','Action Check']},roleWide:[]},
  'Den Blocker – Ironhide':{modes:{'Robot Mode':['Guard','Reflection','Bulletproof / Passive Immunity'],'Alt Mode':['Den Block']},roleWide:[]},
  'Protector – Trailbreaker':{modes:{'Robot Mode':['Protect'],'Alt Mode':['Protect']},roleWide:[]},
  'Sting – Cosmos':{modes:{'Robot Mode':['Basic Ask','Watch'],'Alt Mode':['Advanced Ask']},roleWide:[]},
  'Martyr – Skids':{modes:{'Robot Mode':['Guard','Advanced Ask'],'Alt Mode':['Watch','Action Success Guarantee']},roleWide:[]},
  'Lawyer – Bluestreak':{modes:{'Robot Mode':['Save','Bulletproof / Passive Immunity'],'Alt Mode':['Roleblock','Bulletproof / Passive Immunity']},roleWide:[]},
  'Drunk – Kup':{modes:{'Robot Mode':['Drunk','Sober'],'Alt Mode':['Drunk','Place Swap']},roleWide:[]},
  'Map – Teletron':{modes:{'Robot Mode':['Basic Ask'],'Alt Mode':['Map']},roleWide:[]},
  'Gravedigger – Rung':{modes:{'Robot Mode':['Bulletproof / Passive Immunity'],'Alt Mode':['Gravedigger','Advanced Ask']},roleWide:[]},
  'Instakill – Grimlock':{modes:{'Robot Mode':['Reflection'],'Alt Mode':['Super Kill','Personal Instant Kill']},roleWide:[]},
  'Sherriff – Prowl':{modes:{'Robot Mode':['Counterattack'],'Alt Mode':['Personal Instant Kill']},roleWide:[]},
  'Tracker – Bumblee Bee':{modes:{'Robot Mode':['Track'],'Alt Mode':['Bulletproof / Passive Immunity']},roleWide:[]},
  'Poison/Protect – Red alert':{modes:{'Robot Mode':['Protect','Poison','Personal Instant Kill'],'Alt Mode':['Super Kill','Super Protect']},roleWide:[]},
  'Gambler – Wheeljack':{modes:{'Robot Mode':['Personal Instant Kill','Roleblock'],'Alt Mode':['Action Success Guarantee']},roleWide:[]},
  'Ultimate – Optimus':{modes:{'Robot Mode':['Basic Ask','Protect','Roleblock','Save','Death Immunity'],'Alt Mode':['Personal Instant Kill','Super Kill']},roleWide:[]},
  'Evesdropper – Jazz':{modes:{'Robot Mode':['Action Check'],'Alt Mode':['Advanced Ask']},roleWide:[]},
  'Power boost – Jetfire':{modes:{'Robot Mode':['Action Success Guarantee'],'Alt Mode':['Ability Amplify']},roleWide:[]},
  'Jammers/Traps – Smoke Screen':{modes:{'Robot Mode':['Protect'],'Alt Mode':['Protect','Watch']},roleWide:[]}
};

export async function buildTransformersPayload(sourcePath){
if(!sourcePath)throw new Error('Pass the path to transformers.docx.');
const converted=await mammoth.convertToHtml({buffer:readFileSync(sourcePath)});
const model=analyzeDocumentBlocks(htmlToDocumentBlocks(converted.value),{fileName:'transformers.docx'});
const validation=validateGameImport(model);
if(!validation.valid)throw new Error(validation.errors.join(' '));

const standardSet=new Set(courtroomAbilityNames);
const detectedNames=new Set(model.roles.map(role=>role.name));
const mappingNames=new Set(Object.keys(roleAbilityMap));
const missing=[...detectedNames].filter(name=>!mappingNames.has(name));
const extra=[...mappingNames].filter(name=>!detectedNames.has(name));
if(missing.length||extra.length)throw new Error(`Role mapping mismatch. Missing: ${missing.join(', ')}. Extra: ${extra.join(', ')}.`);
for(const [roleName,mapping] of Object.entries(roleAbilityMap)){
  if(!mapping.abilities.length&&!mapping.sourceOnly)throw new Error(`${roleName} has no standardized ability mapping.`);
  for(const name of [...mapping.abilities,mapping.primary,mapping.passive].filter(Boolean))if(!standardSet.has(name))throw new Error(`${roleName} references unknown ability ${name}.`);
}
const detectedModeRoleNames=new Set(model.roles.filter(role=>role.modes.length).map(role=>role.name));
const mappedModeRoleNames=new Set(Object.keys(roleModeAbilityMap));
const missingModeMappings=[...detectedModeRoleNames].filter(name=>!mappedModeRoleNames.has(name));
const extraModeMappings=[...mappedModeRoleNames].filter(name=>!detectedModeRoleNames.has(name));
if(missingModeMappings.length||extraModeMappings.length)throw new Error(`Mode mapping mismatch. Missing: ${missingModeMappings.join(', ')}. Extra: ${extraModeMappings.join(', ')}.`);
for(const [roleName,modeMapping] of Object.entries(roleModeAbilityMap)){
  const assigned=new Set([...Object.values(modeMapping.modes).flat(),...modeMapping.roleWide]);
  const expected=new Set(roleAbilityMap[roleName].abilities);
  const missing=[...expected].filter(name=>!assigned.has(name)),extra=[...assigned].filter(name=>!expected.has(name));
  if(missing.length||extra.length)throw new Error(`${roleName} mode coverage mismatch. Missing: ${missing.join(', ')}. Extra: ${extra.join(', ')}.`);
}

const stamp=new Date().toISOString();
const roles=model.roles.map(source=>{
  const mapping=roleAbilityMap[source.name];
  const originalAbilities=source.abilityNames.map(name=>{
    const ability=model.abilities.find(item=>item.name===name);
    return ability?`${ability.name}: ${ability.definition}`:name;
  });
  const inference=mapping.sourceOnly?' The Word document did not provide a selectable action for this role, so no action was invented.':'';
  const modeMapping=roleModeAbilityMap[source.name],modeSource=new Map((source.modes||[]).map(mode=>[mode.name,mode]));
  return {
    id:randomUUID(),name:source.name,factionName:source.factionName,alignment:source.alignment||'',
    description:source.description||'The source document listed this role without a mechanics description.',
    tags:mapping.abilities,primaryAbility:mapping.primary||mapping.abilities[0],passiveAbility:mapping.passive||'',
    modes:modeMapping?Object.entries(modeMapping.modes).map(([name,abilityNames])=>({name,abilityNames,sourceText:modeSource.get(name)?.sourceText||'',sourceLocation:modeSource.get(name)?.sourceLocation||''})):[],roleWideAbilityNames:modeMapping?.roleWide||mapping.abilities,modeSelectionPolicy:modeMapping?'CHOOSE_BEFORE_ACTION':'CURRENT_ONLY',
    abilityUses:source.abilityUses??null,cooldowns:source.cooldowns||'',immunities:source.immunities||[],
    restrictions:source.restrictions||[],winCondition:source.winCondition||'',notes:source.notes||'',
    gmNotes:`Encyclopedia mappings: ${mapping.abilities.join(', ')||'No selectable action in source'}. Role-specific text in Description and mode source text overrides standardized defaults when explicit.${inference}${originalAbilities.length?` Original Word abilities: ${originalAbilities.join(' | ')}`:''}`,
    labels:['source:transformers.docx',...(mapping.sourceOnly?['gm-review-required']:[])],enabled:true,
    archivedAt:null,version:1,createdAt:stamp,updatedAt:stamp,updatedBy:null
  };
});

const factions=model.factions.map((source,index)=>({
  id:randomUUID(),name:source.name,class:source.className,alias:source.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
  teamNumber:index+1,alignment:source.alignment||'',description:source.description||'',
  winCondition:source.winCondition||'',notes:source.notes||''
}));
const rules=model.rules.map((source,index)=>({
  id:randomUUID(),title:source.title,description:source.description,category:source.category||'General',
  sortOrder:index,visibility:source.visibility==='gm'?'gm':'public',enabled:source.enabled!==false,
  notes:source.notes||'',version:1,createdAt:stamp,updatedAt:stamp,updatedBy:null
}));

return {
  source:{fileName:'transformers.docx',roleCount:model.roles.length,detectedAbilityCount:model.abilities.length,factionCount:model.factions.length,ruleCount:model.rules.length},
  game:{theme:'Transformers',description:model.game.description,playerCount:model.roles.length,notes:model.game.notes||''},
  factions,roles,rules,
  warnings:[...model.warnings.map(warning=>warning.message),'Every document mechanic remains in role descriptions and mode source text while selectable actions use the existing Master Ability Encyclopedia.']
};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const sourcePath=process.argv[2]||process.env.TRANSFORMERS_DOCX;
  process.stdout.write(JSON.stringify(await buildTransformersPayload(sourcePath)));
}
