import test from 'node:test';
import assert from 'node:assert/strict';
import {templateFixture} from './helpers/role-template-fixture.mjs';

test('actual template load/save retains Standard Role modes, slots, passives and hidden mechanics',()=>{
  const f=templateFixture(),original=structuredClone(f.template);f.load();f.save();
  const role=f.context.state.roles[0];assert.ok(role,f.context.error);
  assert.equal(role.slotCount,4);assert.equal(role.modes.length,2);assert.equal(role.modeSelectionPolicy,'CHOOSE_BEFORE_ACTION');
  assert.equal(role.startingModeId,role.modes[1].id);assert.deepEqual(Array.from(role.roleWidePassiveAbilityIds),['dest-passive','dest-passive2']);
  assert.equal(role.modes[1].abilityUses['dest-guard'],2);assert.equal(role.modes[1].investigationAppearance.basicAsk,'Neutral');
  assert.equal(role.modes[1].switchRules.cost,'1 energy');assert.ok(role.modes[1].id.startsWith(role.id+':mode:'));
  assert.deepEqual(f.template,original);assert.equal(f.context.roleTemplateDraft,null);
});
test('actual Basic Role template remains basic and intentionally ability-free',()=>{
  const f=templateFixture({basic:true});f.load();f.save();
  const role=f.context.state.roles[0];assert.ok(role,f.context.error);assert.equal(role.roleType,'BASIC');assert.equal(role.slotCount,4);
  assert.equal(role.tags.length,0);assert.equal(role.modes.length,0);assert.equal(role.abilityDataStatus,'INTENTIONALLY_NONE');
});
for(const issue of ['missing','ambiguous'])test(issue+' destination ability mapping prevents incomplete template copy',()=>{
  const f=templateFixture({[issue]:true});f.load();assert.equal(f.context.roleTemplateDraft,null);assert.equal(f.context.state.roles.length,0);
  assert.match(f.context.error,/missing|ambiguous|more than one/i);
});
test('canceling a template clears its hidden metadata before an ordinary new role',()=>{
  const f=templateFixture();f.load();f.context.clearRoleForm();assert.equal(f.context.roleTemplateDraft,null);
});
test('unauthorized viewers cannot load a role template into the editor',()=>{
  const f=templateFixture({authorized:false});f.load();assert.equal(f.get('roleName').value,'');assert.equal(f.context.roleTemplateDraft,null);
});
test('switching games rejects a stale template instead of applying cross-game ability references',()=>{
  const f=templateFixture();f.load();f.game.id='another-game';assert.equal(f.fields(),null);assert.match(f.context.error,/game|template/i);
});
test('template mode rules deliberately edited before Add are retained with original hidden metadata',()=>{
  const f=templateFixture();f.load();f.get('roleModeAssignments').value=f.get('roleModeAssignments').value.replace('switch type: ABILITY_TRIGGERED','switch type: GM_TRIGGERED');
  f.save();const role=f.context.state.roles[0];assert.ok(role,f.context.error);
  assert.equal(role.modes[1].switchRules.type,'GM_TRIGGERED');assert.equal(role.modes[1].switchRules.cost,'1 energy');
});

test('editing an existing role after loading a template clears the pending copy',()=>{
  const f=templateFixture();f.load();
  const existing=f.context.normalizeRole({id:'existing',name:'Existing Role',factionId:'destination-faction',roleType:'BASIC'},f.game.id);
  f.context.state.roles.push(existing);f.context.beginRoleEdit(existing.id);
  assert.equal(f.context.roleTemplateDraft,null);assert.equal(f.context.editingRoleId,'existing');
});
test('game reset clears template context and cannot carry copied metadata to another game',()=>{
  const f=templateFixture();f.load();Object.assign(f.context,{selectedActionTargetIds:new Set()});
  f.context.resetEditorContext();assert.equal(f.context.roleTemplateDraft,null);
});
test('deselecting a required mode ability after loading fails validation instead of silently removing it',()=>{
  const f=templateFixture();f.load();f.context.selectedRoleAbilityIds.delete('dest-guard');
  assert.equal(f.fields(),null);assert.match(f.context.error,/select.*Guard/i);
});
