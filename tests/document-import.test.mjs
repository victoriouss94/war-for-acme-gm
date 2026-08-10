import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import {DOCX_MIME,analyzeDocumentBlocks,compareGameImport,htmlToDocumentBlocks,matchImportAbilities,validateDocxFile,validateGameImport} from '../js/document-import.js';

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

test('parses Word-style role tables and separates active and passive abilities',()=>{
  const model=analyzeDocumentBlocks([heading(1,'Table Game'),{type:'table',headers:['Role','Faction','Ability','Passive'],rows:[['Bugs Bunny','Acme','Advanced Ask — Investigate a player','Investigation resistance'],['The Brain','Warner','Redirect — Redirect one player','Early immunity']]}],{fileName:'table.docx'});
  assert.equal(model.roles.length,2);assert.equal(model.factions.length,2);assert.ok(model.roles[0].activeAbilityName);assert.ok(model.roles[0].passiveAbilityName);assert.equal(model.roles[1].factionName,'Warner');
});

test('links exact Encyclopedia abilities and keeps uncertain custom abilities new',()=>{
  const model=analyzeDocumentBlocks([heading(1,'Ability Game'),heading(1,'Factions'),heading(2,'Town'),heading(3,'Scout'),paragraph('Ability: Advanced Ask — Learn a role.'),heading(3,'Inventor'),paragraph('Ability: Prototype System — Build a prototype.')],{fileName:'abilities.docx'});matchImportAbilities(model,[{key:'advanced',name:'Advanced Ask',builtIn:true},{key:'protect',name:'Protect',builtIn:true}]);
  const advanced=model.abilities.find(item=>item.name==='Advanced Ask'),custom=model.abilities.find(item=>item.name==='Prototype System');assert.equal(advanced.decision,'use-existing');assert.equal(custom.decision,'create-new');assert.equal(custom.matchStatus,'new');
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
