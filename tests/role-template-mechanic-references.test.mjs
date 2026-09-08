import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {templateFixture} from './helpers/role-template-fixture.mjs';

import {linkedTemplate} from './helpers/role-template-linked-fixture.mjs';

test('actual single-role template remaps nested ownership targeting and mode references',()=>{
  const f=linkedTemplate();f.context.state.roles.push({id:'dest-other-role',name:'Other Role'});
  const before=structuredClone(f.template);f.load();f.save();
  const role=f.context.state.roles.find(r=>r.id!=='dest-other-role');assert.ok(role,f.context.error);
  const mechanic=role.understanding.mechanics[0];
  assert.equal(mechanic.sourceRoleId,role.id);assert.equal(mechanic.sourceAbilityId,'dest-ask');
  assert.deepEqual(Array.from(mechanic.targeting.targetRoleRestrictions),['dest-other-role']);
  assert.deepEqual(Array.from(mechanic.targeting.targetFactionRestrictions),['destination-faction']);
  assert.equal(role.metadata.modeId,role.modes[1].id);
  assert.equal(mechanic.sourceDocumentId,'source-document');assert.equal(mechanic.baseStandardAbilityId,'global:ask');
  assert.equal(mechanic.originalText,'Synthetic Ask source-document audit-role');assert.deepEqual(f.template,before);
});
for(const ambiguous of [false,true])test((ambiguous?'ambiguous':'missing')+' referenced destination role blocks copying without changing the editor',()=>{
  const f=linkedTemplate();if(ambiguous)f.context.state.roles.push({id:'one',name:'Other Role'},{id:'two',name:'Other Role'});
  f.get('roleName').value='Existing unsaved editor';f.load();
  assert.equal(f.context.roleTemplateDraft,null);assert.equal(f.get('roleName').value,'Existing unsaved editor');
  assert.match(f.context.error,/dependency|missing|ambiguous/i);
});
test('nested ability dependencies are remapped but never granted just because they are referenced',()=>{
  const f=templateFixture();
  f.template.abilities.push({id:'source-dependent',name:'Dependent Ability'});
  f.context.state.abilities.push({id:'dest-dependent',name:'Dependent Ability'});
  f.template.role.mechanicalStatements=[{type:'ABILITY_MODIFIER',sourceAbilityId:'source-dependent',originalText:'Modify another ability'}];
  f.load();f.save();const role=f.context.state.roles[0];assert.ok(role,f.context.error);
  assert.equal(role.understanding.mechanics[0].sourceAbilityId,'dest-dependent');
  assert.ok(!role.tags.includes('Dependent Ability'));assert.ok(!role.roleWideAbilityIds.includes('dest-dependent'));
});
test('missing nested ability dependency is not silently retained as a source-game ID',()=>{
  const f=templateFixture();f.template.abilities.push({id:'source-dependent',name:'Dependent Ability'});
  f.template.role.mechanicalStatements=[{type:'ABILITY_MODIFIER',sourceAbilityId:'source-dependent',originalText:'Modify another ability'}];
  f.load();assert.equal(f.context.roleTemplateDraft,null);assert.match(f.context.error,/Dependent Ability/);
});
test('unreferenced source roles and abilities do not block a template copy',()=>{
  const f=templateFixture();f.template.roles=[f.template.role,{id:'unrelated',name:'Unrelated Role'}];f.template.abilities.push({id:'unrelated',name:'Unrelated Ability'});
  f.load();f.save();assert.equal(f.context.state.roles.length,1,f.context.error);
});
test('missing ability-keyed resource pool dependency blocks the copy',()=>{
  const f=templateFixture();f.template.abilities.push({id:'source-dependent',name:'Dependent Ability'});
  f.template.role.modes[1].resourcePools['source-dependent']=3;
  f.load();assert.equal(f.context.roleTemplateDraft,null);assert.match(f.context.error,/Dependent Ability/);
});

test('destination IDs overlapping other source IDs are mapped only once',()=>{
  const f=templateFixture();f.context.state.abilities.find(a=>a.name==='Ask').id='guard';f.context.state.abilities.find(a=>a.name==='Guard').id='ask';
  f.template.role.mechanicalStatements=[{type:'ACTIVE_ABILITY',sourceAbilityId:'ask',originalText:'Ask'}];
  f.load();f.save();const role=f.context.state.roles[0];assert.ok(role,f.context.error);
  assert.equal(role.activeAbilityId,'guard');assert.equal(role.modes[0].abilityIds[0],'guard');assert.equal(role.modes[1].abilityIds[0],'ask');
  assert.equal(role.understanding.mechanics[0].sourceAbilityId,'guard');
});
test('dependency-only mode counters map without granting the dependent ability',()=>{
  const f=templateFixture();f.template.abilities.push({id:'source-dependent',name:'Dependent Ability'});f.context.state.abilities.push({id:'dest-dependent',name:'Dependent Ability'});
  f.template.role.modes[1].abilityUses['source-dependent']=2;f.template.role.modes[1].resourcePools['source-dependent']=3;
  f.load();f.save();const role=f.context.state.roles[0];assert.ok(role,f.context.error);
  assert.equal(role.modes[1].abilityUses['dest-dependent'],2);assert.equal(role.modes[1].resourcePools['dest-dependent'],3);
  assert.ok(!role.tags.includes('Dependent Ability'));
});
test('cloud template loader carries source-role dependencies from the same RLS-protected document query',async()=>{
  const cloud=readFileSync(new URL('../js/cloud.js',import.meta.url),'utf8'),loader=cloud.split(/\r?\n/).find(line=>line.includes('async function roleTemplates()'));
  const roles=[{id:'source-one'},{id:'source-two'}],queries=[];
  const context={unwrap:value=>value,required:()=>({from:table=>({select:async columns=>{queries.push({table,columns});return [{game_id:'source-game',document:{game:{name:'Source'},data:{roles}}}]}})})};
  vm.createContext(context);vm.runInContext(loader,context);const result=await context.roleTemplates();
  assert.equal(result.length,2);assert.deepEqual(Array.from(result[0].roles),roles);assert.deepEqual(queries,[{table:'game_documents',columns:'game_id,document'}]);
});
