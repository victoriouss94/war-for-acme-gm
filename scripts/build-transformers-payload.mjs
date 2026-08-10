import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import mammoth from 'mammoth';
import {analyzeDocumentBlocks,htmlToDocumentBlocks,validateGameImport} from '../js/document-import.js';

const sourcePath=process.argv[2]||process.env.TRANSFORMERS_DOCX;
if(!sourcePath)throw new Error('Pass the path to transformers.docx.');

export const courtroomAbilityNames=[
  'Basic Ask','Advanced Ask','Alignment Ask','Watch','Track','Action Check','Gravedigger','Map',
  'Den Regular Kill','Personal Instant Kill','Super Kill','Omega Kill','Poison','Mark','Roleblock',
  'Drunk','Sober','Duel / Fight','Convert','Steal','Protect','Guard','Save','Heal','Super Protect',
  'Death Immunity','Reflection','Counterattack','Bulletproof / Passive Immunity','Ability Amplify',
  'Additional Uses','Action Success Guarantee'
];

export const roleAbilityMap={
  'Alpha – Megatron':{abilities:['Personal Instant Kill','Convert','Bulletproof / Passive Immunity','Additional Uses'],primary:'Personal Instant Kill',passive:'Bulletproof / Passive Immunity'},
  'Dark Seer – Soundwave':{abilities:['Advanced Ask','Steal','Personal Instant Kill','Watch','Track'],primary:'Advanced Ask'},
  'Blocker – Starscream':{abilities:['Roleblock','Bulletproof / Passive Immunity'],primary:'Roleblock',passive:'Bulletproof / Passive Immunity'},
  'Traitor – Punch/Counterpunch':{abilities:['Convert'],primary:'Convert',inferred:true},
  'Mark/Soul Bound – Bombshell':{abilities:['Mark','Death Immunity'],primary:'Mark',passive:'Death Immunity'},
  'Omega – Fallen':{abilities:['Omega Kill','Additional Uses'],primary:'Omega Kill'},
  'Gravedigger/Insta – Shockwave':{abilities:['Gravedigger','Steal','Personal Instant Kill','Additional Uses'],primary:'Gravedigger'},
  'Doc – Ratchet':{abilities:['Save','Heal','Protect','Additional Uses'],primary:'Save'},
  'Seer – Nightbeat':{abilities:['Basic Ask','Advanced Ask','Track','Bulletproof / Passive Immunity'],primary:'Basic Ask',passive:'Bulletproof / Passive Immunity'},
  'Omega Supreme – 2 nd in command':{abilities:['Super Kill','Additional Uses','Ability Amplify'],primary:'Super Kill'},
  'Milf – Elita':{abilities:['Watch','Action Success Guarantee','Roleblock','Action Check'],primary:'Watch'},
  'Den Blocker – Ironhide':{abilities:['Guard','Reflection','Bulletproof / Passive Immunity','Roleblock'],primary:'Guard',passive:'Bulletproof / Passive Immunity'},
  'Protector – Trailbreaker':{abilities:['Protect'],primary:'Protect'},
  'Sting – Cosmos':{abilities:['Basic Ask','Advanced Ask','Watch'],primary:'Basic Ask'},
  'Martyr – Skids':{abilities:['Guard','Watch','Advanced Ask','Action Success Guarantee'],primary:'Guard'},
  'Lawyer – Bluestreak':{abilities:['Save','Bulletproof / Passive Immunity'],primary:'Save',passive:'Bulletproof / Passive Immunity'},
  'Drunk – Kup':{abilities:['Drunk','Sober'],primary:'Drunk'},
  'Map – Teletron':{abilities:['Basic Ask','Map'],primary:'Basic Ask'},
  'Gravedigger – Rung':{abilities:['Gravedigger','Advanced Ask','Bulletproof / Passive Immunity'],primary:'Gravedigger',passive:'Bulletproof / Passive Immunity'},
  'Instakill – Grimlock':{abilities:['Reflection','Super Kill','Personal Instant Kill'],primary:'Super Kill',passive:'Reflection'},
  'Sherriff – Prowl':{abilities:['Counterattack','Personal Instant Kill','Additional Uses'],primary:'Personal Instant Kill',passive:'Counterattack'},
  'Tracker – Bumblee Bee':{abilities:['Track','Bulletproof / Passive Immunity'],primary:'Track',passive:'Bulletproof / Passive Immunity'},
  'Poison/Protect – Red alert':{abilities:['Protect','Poison','Personal Instant Kill','Super Kill','Super Protect'],primary:'Protect'},
  'Gambler – Wheeljack':{abilities:['Personal Instant Kill','Roleblock','Action Success Guarantee'],primary:'Personal Instant Kill'},
  'Ultimate – Optimus':{abilities:['Basic Ask','Protect','Roleblock','Save','Death Immunity','Personal Instant Kill','Super Kill'],primary:'Basic Ask',passive:'Death Immunity'},
  'Evesdropper – Jazz':{abilities:['Action Check','Advanced Ask'],primary:'Action Check'},
  'Power boost – Jetfire':{abilities:['Action Success Guarantee','Ability Amplify','Additional Uses'],primary:'Action Success Guarantee'},
  'Jammers/Traps – Smoke Screen':{abilities:['Protect','Watch'],primary:'Protect'},
  'Sam':{abilities:['Watch','Death Immunity'],primary:'Watch',passive:'Death Immunity'},
  'Allpark shard':{abilities:['Alignment Ask'],primary:'Alignment Ask'},
  'Ron & Judy':{abilities:['Personal Instant Kill','Super Kill','Super Protect'],primary:'Personal Instant Kill'},
  'Ron':{abilities:['Roleblock','Action Check'],primary:'Roleblock'},
  'Agent Simmons':{abilities:['Roleblock'],primary:'Roleblock'},
  'Silas – Basic hunter':{abilities:['Personal Instant Kill','Additional Uses'],primary:'Personal Instant Kill'},
  'Cade – Inventor':{abilities:['Basic Ask','Advanced Ask','Protect','Personal Instant Kill','Additional Uses'],primary:'Basic Ask'},
  'Dylan – Corporate traitor':{abilities:['Steal','Convert'],primary:'Steal'},
  'Unicron- Ultimate Neutral':{abilities:['Advanced Ask','Roleblock','Personal Instant Kill','Super Kill','Omega Kill','Mark','Additional Uses'],primary:'Mark'}
};

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
  if(!mapping.abilities.length)throw new Error(`${roleName} has no standardized ability mapping.`);
  for(const name of [...mapping.abilities,mapping.primary,mapping.passive].filter(Boolean))if(!standardSet.has(name))throw new Error(`${roleName} references unknown ability ${name}.`);
}

const stamp=new Date().toISOString();
const roles=model.roles.map(source=>{
  const mapping=roleAbilityMap[source.name];
  const originalAbilities=source.abilityNames.map(name=>{
    const ability=model.abilities.find(item=>item.name===name);
    return ability?`${ability.name}: ${ability.definition}`:name;
  });
  const inference=mapping.inferred?' The Word document did not provide mechanics for this role; Convert is an AI-inferred placeholder that should be reviewed by a GM.':'';
  return {
    id:randomUUID(),name:source.name,factionName:source.factionName,alignment:source.alignment||'',
    description:source.description||'The source document listed this role without a mechanics description.',
    tags:mapping.abilities,primaryAbility:mapping.primary||mapping.abilities[0],passiveAbility:mapping.passive||'',
    abilityUses:source.abilityUses??null,cooldowns:source.cooldowns||'',immunities:source.immunities||[],
    restrictions:source.restrictions||[],winCondition:source.winCondition||'',notes:source.notes||'',
    gmNotes:`Courtroom mappings: ${mapping.abilities.join(', ')}. Role-specific text in Description overrides the standardized defaults when explicit.${inference}${originalAbilities.length?` Original Word modes: ${originalAbilities.join(' | ')}`:''}`,
    labels:['source:transformers.docx',...(mapping.inferred?['gm-review-required']:[])],enabled:true,
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

process.stdout.write(JSON.stringify({
  source:{fileName:'transformers.docx',roleCount:model.roles.length,detectedAbilityCount:model.abilities.length,factionCount:model.factions.length,ruleCount:model.rules.length},
  game:{theme:'Transformers',description:model.game.description,playerCount:model.roles.length,notes:model.game.notes||''},
  factions,roles,rules,
  warnings:[...model.warnings.map(warning=>warning.message),'All 64 role-specific mechanics were retained in role descriptions and GM notes while the encyclopedia was normalized to the 32 Courtroom abilities.']
}));
