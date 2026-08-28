import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import {DOCX_MIME,MAX_AI_DOCUMENT_CHARS,analyzeDocumentBlocks,compareGameImport,htmlToDocumentBlocks,matchImportAbilities,normalizeAiDocumentImport,prepareDocumentBlocksForAi,validateDocxFile,validateGameImport} from '../js/document-import.js';

const heading=(level,value)=>({type:'heading',level,text:value,bold:true});
const paragraph=value=>({type:'paragraph',text:value,boldLabel:value.split(':')[0]||''});

function simpleBlocks(){
  const blocks=[heading(1,'Jungle Game'),heading(1,'FACTIONS'),heading(2,'Jungle Alliance')];
  for(const name of ['Lion','Tiger','Hippo','Giraffe','Zebra'])blocks.push(heading(3,name),paragraph('Night Ability: Protect — Protect one player each night.'));
  blocks.push(heading(1,'RULES'),{type:'list-item',ordered:true,text:'1. No role revealing.'},{type:'list-item',ordered:true,text:'2. Dead players cannot participate.'});return blocks;
}

test('detects a game, one faction, five roles, abilities, and individual rules',()=>{
  const model=analyzeDocumentBlocks(simpleBlocks(),{fileName:'Jungle Game.docx'});matchImportAbilities(model,[{key:'protect',name:'Protect',builtIn:true}]);
  assert.equal(model.game.name,'Jungle Game');assert.equal(model.factions.length,1);assert.equal(model.roles.length,5);assert.equal(model.rules.length,2);assert.equal(model.abilities.length,1);assert.equal(model.abilities[0].decision,'use-existing');assert.equal(validateGameImport(model).valid,true);
});

test('preview corrections remain valid and editable before persistence',()=>{
  const model=analyzeDocumentBlocks(simpleBlocks(),{fileName:'Jungle Game.docx'});matchImportAbilities(model,[{key:'protect',name:'Protect',builtIn:true}]);model.roles[2].name='Hippopotamus';model.roles[2].notes='Corrected by the GM during review.';assert.equal(validateGameImport(model).valid,true);assert.equal(model.roles[2].name,'Hippopotamus');
});

test('assigns roles across multiple faction headings',()=>{
  const blocks=[heading(1,'War for Acme'),heading(1,'Factions'),heading(2,'Acme Defense Force'),heading(3,'Bugs Bunny'),paragraph('Ability: Advanced Ask — Investigate a player.'),heading(2,'Warner Syndicate'),heading(3,'The Brain'),paragraph('Ability: Redirect — Redirect one player.')];
  const model=analyzeDocumentBlocks(blocks,{fileName:'acme.docx'});assert.equal(model.factions.length,2);assert.deepEqual(model.roles.map(role=>role.factionName),['Acme Defense Force','Warner Syndicate']);
});

test('Word import distinguishes confirmed Basic Roles from possibly incomplete roles',()=>{
  const model=analyzeDocumentBlocks([heading(1,'Basic Game'),heading(1,'Factions'),heading(2,'Village'),heading(3,'Juror'),paragraph('No abilities.'),heading(3,'Mystery Role')],{fileName:'basic-game.docx'}),juror=model.roles.find(role=>role.name==='Juror'),mystery=model.roles.find(role=>role.name==='Mystery Role');
  assert.equal(juror.roleType,'BASIC');assert.equal(juror.abilityDataStatus,'INTENTIONALLY_NONE');assert.deepEqual(juror.abilityNames,[]);assert.equal(mystery.roleType,'STANDARD');assert.equal(mystery.abilityDataStatus,'POSSIBLY_INCOMPLETE');assert.ok(model.warnings.some(item=>item.code==='possibly-incomplete-role'&&item.relatedId===mystery.tempId));
});

test('parses Word-style role tables and separates active and passive abilities',()=>{
  const model=analyzeDocumentBlocks([heading(1,'Table Game'),{type:'table',headers:['Role','Faction','Ability','Passive'],rows:[['Bugs Bunny','Acme','Advanced Ask — Investigate a player','Investigation resistance'],['The Brain','Warner','Redirect — Redirect one player','Early immunity']]}],{fileName:'table.docx'});
  assert.equal(model.roles.length,2);assert.equal(model.factions.length,2);assert.ok(model.roles[0].activeAbilityName);assert.ok(model.roles[0].passiveAbilityName);assert.equal(model.roles[1].factionName,'Warner');
});

test('links exact Encyclopedia abilities and keeps uncertain custom abilities new',()=>{
  const model=analyzeDocumentBlocks([heading(1,'Ability Game'),heading(1,'Factions'),heading(2,'Town'),heading(3,'Scout'),paragraph('Ability: Advanced Ask — Learn a role.'),heading(3,'Inventor'),paragraph('Ability: Prototype System — Build a prototype.')],{fileName:'abilities.docx'});matchImportAbilities(model,[{key:'advanced',name:'Advanced Ask',builtIn:true},{key:'protect',name:'Protect',builtIn:true}]);
  const advanced=model.abilities.find(item=>item.name==='Advanced Ask'),custom=model.abilities.find(item=>item.name==='Prototype System');assert.equal(advanced.decision,'use-existing');assert.equal(custom.decision,'create-new');assert.equal(custom.matchStatus,'new');
});

test('normalizes an AI document analysis into the existing editable import model',()=>{
  const result={model:'gpt-5.6-terra',game:{name:'Freeform Game',theme:'Mystery',description:'A complete game.',player_count:12,starting_phase:'Night',notes:''},factions:[{name:'Town',description:'Defenders',alignment:'Good',class_name:'VILLAGER',win_condition:'Remove threats.',notes:'',expected_role_count:1,confidence:.95,source_text:'Town defenders'}],abilities:[{name:'Protect',definition:'Protect one player each night.',category:'Protection',phase:'Night',mechanics:['protection'],confidence:.96,source_text:'Protect one player'}],roles:[{name:'Guardian',faction_name:'Town',alignment:'Good',description:'Keeps players alive.',ability_names:['Protect'],active_ability_name:'Protect',passive_ability_name:'',ability_uses:null,cooldowns:'',immunities:[],restrictions:[],win_condition:'Win with Town.',notes:'',gm_notes:'',tags:['support'],enabled:true,confidence:.94,source_text:'Guardian protects'}],rules:[{title:'No role reveals',description:'Players may not reveal role cards.',category:'Communication',visibility:'public',notes:'',enabled:true,confidence:.9,source_text:'No role reveals'}],warnings:[]};
  const model=normalizeAiDocumentImport(result,{fileName:'freeform.docx',parsedAt:'2026-08-10T00:00:00.000Z'});matchImportAbilities(model,[{key:'protect',name:'Protect',builtIn:true}]);
  assert.equal(model.source.analysisMode,'ai');assert.equal(model.source.aiModel,'gpt-5.6-terra');assert.equal(model.roles[0].factionTempId,model.factions[0].tempId);assert.deepEqual(model.roles[0].abilityNames,['Protect']);assert.equal(model.abilities[0].decision,'use-existing');assert.equal(validateGameImport(model).valid,true);
});

test('AI normalization creates reviewable ability placeholders and warnings for incomplete relationships',()=>{
  const model=normalizeAiDocumentImport({game:{name:'Partial Game',starting_phase:'Day'},factions:[{name:'Town',class_name:'VILLAGER'}],abilities:[],roles:[{name:'Watcher',faction_name:'Town',ability_names:['Moon Sight'],active_ability_name:'Moon Sight'}],rules:[],warnings:['The source did not specify duration.']},{fileName:'partial.docx'});
  assert.equal(model.abilities[0].name,'Moon Sight');assert.ok(model.warnings.some(item=>item.code==='missing-ability-definition'));assert.ok(model.warnings.some(item=>item.code==='ai-review'));assert.equal(validateGameImport(model).valid,true);
});

test('AI block preparation preserves document structure and rejects oversized extracted text',()=>{
  assert.deepEqual(prepareDocumentBlocksForAi([heading(2,'Roles'),{type:'table',headers:['Role'],rows:[['Guardian']]}]).map(block=>block.type),['heading','table']);
  assert.throws(()=>prepareDocumentBlocksForAi(Array.from({length:Math.ceil(MAX_AI_DOCUMENT_CHARS/12000)+2},()=>({type:'paragraph',text:'x'.repeat(12000)}))),/too much extracted text/i);
});

test('recovers flat Word rosters with faction paragraphs and Robot Mode / Alt Mode lists',()=>{
  const blocks=[
    paragraph('Round Information:'),paragraph('Special Mechanics — Hidden Sentinel:'),paragraph('A hidden role may change factions.'),
    paragraph('Den'),paragraph('The den may replace its leader.'),paragraph('Alpha — Megatron'),{type:'list-item',text:'Robot Mode — Fusion Cannon'},{type:'list-item',text:'Has two instant attacks.'},{type:'list-item',text:'Alt Mode — Tank'},{type:'list-item',text:'Protected against standard kills.'},paragraph('Traitor — Punch/Counterpunch'),
    paragraph('Villagers'),paragraph('Doc — Ratchet'),{type:'list-item',text:'Robot Mode — Medic'},{type:'list-item',text:'Has two saves.'},{type:'list-item',text:'Alt Mode — Ambulance'},{type:'list-item',text:'Protect one player.'},
    paragraph('Neutrals'),paragraph('Sam'),paragraph('Sam can give the Allspark to another player.'),paragraph('Wincon — The Allspark ends with an Autobot.'),paragraph('Agent Simmons'),paragraph('Each night he captures one transformer.')
  ];
  const model=analyzeDocumentBlocks(blocks,{fileName:'transformers.docx'}),alpha=model.roles.find(role=>role.name==='Alpha — Megatron'),traitor=model.roles.find(role=>role.name==='Traitor — Punch/Counterpunch');
  assert.deepEqual(model.factions.map(faction=>faction.className),['DEN','VILLAGER','NEUTRAL']);assert.equal(model.roles.length,5);assert.equal(alpha.abilityNames.length,0);assert.deepEqual(alpha.modes.map(mode=>mode.name),['Robot Mode','Alt Mode']);assert.match(alpha.modes[0].description,/instant attacks/i);assert.equal(model.abilities.some(ability=>/robot mode|alt mode/i.test(ability.name)),false);assert.equal(traitor.abilityNames.length,0);assert.equal(validateGameImport(model).valid,true);assert.ok(validateGameImport(model).warnings.some(message=>message.includes('Traitor')));
});

test('rejects an empty-role import even when a game name was inferred',()=>{
  const model=analyzeDocumentBlocks([paragraph('Unstructured notes only.')],{fileName:'empty.docx'}),validation=validateGameImport(model);assert.equal(validation.valid,false);assert.match(validation.errors.join(' '),/faction/i);assert.match(validation.errors.join(' '),/role/i);
});

const suppliedTransformersDocx=process.env.TRANSFORMERS_DOCX;
test('acceptance: the supplied Transformers DOCX yields a complete editable roster',{skip:!suppliedTransformersDocx||!existsSync(suppliedTransformersDocx)},async()=>{
  const converted=await mammoth.convertToHtml({buffer:readFileSync(suppliedTransformersDocx)}),blocks=htmlToDocumentBlocks(converted.value),model=analyzeDocumentBlocks(blocks,{fileName:'transformers.docx'}),names=new Set(model.roles.map(role=>role.name));
  assert.equal(model.factions.length,3);assert.ok(model.roles.length>=35,'roles='+model.roles.length+' '+JSON.stringify([...names]));assert.ok(model.abilities.length>=55,'abilities='+model.abilities.length);assert.ok(names.has('Alpha – Megatron'));assert.ok(names.has('Ultimate – Optimus'));assert.ok(names.has('Unicron- Ultimate Neutral'));assert.equal(validateGameImport(model).valid,true);
});

test('rejects unsupported, empty, and oversized uploads before parsing',()=>{
  assert.ok(validateDocxFile({name:'game.docm',size:100,type:'application/octet-stream'}).length);assert.ok(validateDocxFile({name:'game.docx',size:0,type:DOCX_MIME}).length);assert.ok(validateDocxFile({name:'game.docx',size:11*1024*1024,type:DOCX_MIME}).length);
});

test('flags case-insensitive duplicate role names and defaults the duplicate to merge',()=>{
  const blocks=[heading(1,'Duplicate Game'),heading(1,'Factions'),heading(2,'Town'),heading(3,'Bugs Bunny'),paragraph('Ability: Protect'),heading(3,'BUGS BUNNY'),paragraph('Ability: Protect')],model=analyzeDocumentBlocks(blocks,{fileName:'duplicate.docx'}),duplicate=model.roles[1];assert.equal(duplicate.selected,false);assert.equal(duplicate.duplicateDecision,'merge');assert.ok(model.warnings.some(item=>item.code==='duplicate-role'));
});

test('re-import comparison classifies new, changed, unchanged, and missing roles without overwriting by default',()=>{
  const model=analyzeDocumentBlocks([heading(1,'Reimport Game'),heading(1,'Factions'),heading(2,'Town'),heading(3,'Bugs Bunny'),paragraph('Ability: Protect'),paragraph('Description: Updated description'),heading(3,'Lioness'),paragraph('Ability: Protect')],{fileName:'v2.docx'});matchImportAbilities(model,[{key:'protect',name:'Protect',builtIn:true}]);
  const faction={id:'f1',name:'Town',class:'VILLAGER'},ability={id:'a1',name:'Protect',definition:'Protect',category:'Protection',phase:'Night',mechanics:[],builtIn:true},current={game:{id:'g1',name:'Reimport Game',theme:'',description:'',notes:'',currentPhase:'Day'},data:{factions:[faction],abilities:[ability],roles:[{id:'r1',name:'Bugs Bunny',factionId:'f1',description:'Old description',tags:['Protect'],enabled:true},{id:'r2',name:'Audience',factionId:'f1',description:'',tags:['Protect'],enabled:true}],rules:[]}};
  const comparison=compareGameImport(model,current),bugs=comparison.roles.find(item=>item.key==='bugs bunny'),lioness=comparison.roles.find(item=>item.key==='lioness'),audience=comparison.roles.find(item=>item.key==='audience');assert.equal(bugs.status,'CHANGED');assert.equal(bugs.decision,'keep');assert.equal(lioness.status,'NEW');assert.equal(lioness.decision,'add');assert.equal(audience.status,'MISSING FROM DOCUMENT');assert.equal(audience.decision,'keep');
});

function xmlEscape(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function wordParagraph(value,style=''){return '<w:p>'+(style?'<w:pPr><w:pStyle w:val="'+style+'"/></w:pPr>':'')+'<w:r><w:t>'+xmlEscape(value)+'</w:t></w:r></w:p>'}
function wordCell(value){return '<w:tc>'+wordParagraph(value)+'</w:tc>'}
function wordRow(values){return '<w:tr>'+values.map(wordCell).join('')+'</w:tr>'}
async function makeTableDocx(){
  const zip=new JSZip();zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');zip.folder('_rels').file('.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');zip.folder('word').folder('_rels').file('document.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');zip.folder('word').file('styles.xml','<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>');const table='<w:tbl>'+wordRow(['Role','Faction','Ability','Passive'])+wordRow(['Bugs Bunny','Acme Defense Force','Advanced Ask — Investigate a player','Investigation resistance'])+wordRow(['The Brain','Warner Syndicate','Redirect — Redirect one player','Early immunity'])+'</w:tbl>',body=wordParagraph('War for Acme 2.0','Title')+wordParagraph('FACTIONS','Heading1')+table+wordParagraph('RULES','Heading1')+wordParagraph('1. No role revealing.')+wordParagraph('2. Dead players cannot participate.');zip.folder('word').file('document.xml','<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr/></w:body></w:document>');return zip.generateAsync({type:'nodebuffer'});
}

test('a real DOCX table is converted by Mammoth and analyzed without flattening structure',async()=>{
  const buffer=await makeTableDocx(),converted=await mammoth.convertToHtml({buffer}),blocks=htmlToDocumentBlocks(converted.value),model=analyzeDocumentBlocks(blocks,{fileName:'War for Acme 2.0.docx'});assert.ok(blocks.some(block=>block.type==='table'));assert.equal(model.roles.length,2);assert.equal(model.factions.length,2);assert.equal(model.rules.length,2);
});
