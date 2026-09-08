import test from 'node:test';
import assert from 'node:assert/strict';
import {formatRoleModeAssignments,parseRoleModeAssignments,roleModeContext} from '../js/role-modes.js';
import {abilities,source,formFixture} from './helpers/role-editor-fixture.mjs';

test('actual role editor renames a configuration without replacing its identity or hidden mechanics',()=>{
  const f=formFixture();f.get('roleModeAssignments').value=f.get('roleModeAssignments').value.replace('[Alt]','[Guarded Form]');
  const saved=f.save();assert.ok(saved,f.context.error);assert.equal(saved.modes[1].name,'Guarded Form');assert.equal(saved.modes[1].id,'import:alt');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.modes[1].abilityUses)),{guard:2});assert.equal(saved.modes[1].switchRules.cost,'1 energy');assert.equal(saved.startingModeId,'import:alt');
  const context=roleModeContext({player:{id:'p',modeState:{role_id:'audit-role',current_mode_id:'import:alt',temporary_mode_access:[{modeId:'import:robot'}]}},role:{...f.role,...saved},abilities});
  assert.equal(context.currentModeId,'import:alt');assert.deepEqual(context.temporaryModeIds,['import:robot']);
});
test('rename and reorder preserve the intended configuration and its transition references',()=>{
  const blocks=formatRoleModeAssignments(source,abilities).split('\n\n').reverse();
  blocks[0]=blocks[0].replace('[Alt]','[Guarded Form]');blocks[1]=blocks[1].replace('[Robot]','[Scan Form]');
  const parsed=parseRoleModeAssignments(blocks.join('\n\n'),abilities,abilities.map(a=>a.id),source);
  assert.deepEqual(parsed.errors,[]);assert.deepEqual(parsed.modes.map(m=>[m.id,m.name]),[['import:alt','Guarded Form'],['import:robot','Scan Form']]);assert.deepEqual(parsed.modes[0].switchRules.targetModeIds,['import:robot']);
});
test('a renamed mode can be edited again without persisting editor reference metadata',()=>{
  const renamed=parseRoleModeAssignments(formatRoleModeAssignments(source,abilities).replace('[Alt]','[Guarded Form]'),abilities,abilities.map(a=>a.id),source);
  const role={...source,modes:renamed.modes},again=parseRoleModeAssignments(formatRoleModeAssignments(role,abilities).replace('[Guarded Form]','[Final Form]'),abilities,abilities.map(a=>a.id),role);
  assert.deepEqual(again.errors,[]);assert.equal(again.modes[1].id,'import:alt');assert.equal(again.modes[1].name,'Final Form');assert.equal(JSON.stringify(again.modes).includes('editorReference'),false);
});
test('duplicate references cannot overwrite two modes with one identity',()=>{
  const text=formatRoleModeAssignments(source,abilities).replace('edit reference: "Alt"','edit reference: "Robot"');
  const parsed=parseRoleModeAssignments(text,abilities,abilities.map(a=>a.id),source);assert.match(parsed.errors.join(' '),/identity/i);
});
test('unknown, blank and repeated references are rejected by the actual editor',()=>{
  for(const reference of ['edit reference: "Unknown"','edit reference: ""','edit reference: "Alt"\nedit reference: "Alt"']){
    const f=formFixture();f.get('roleModeAssignments').value=f.get('roleModeAssignments').value.replace('edit reference: "Alt"',reference);assert.equal(f.save(),null);assert.match(f.context.error,/reference/i);
  }
});
test('copying a block requires removing its reference to create a new configuration',()=>{
  const text=formatRoleModeAssignments(source,abilities),block=text.split('\n\n')[1].replace('[Alt]','[Fresh Form]');
  assert.ok(parseRoleModeAssignments(text+'\n\n'+block,abilities,abilities.map(a=>a.id),source).errors.length);
  const added=parseRoleModeAssignments(text+'\n\n'+block.replace('edit reference: "Alt"\n',''),abilities,abilities.map(a=>a.id),source);assert.deepEqual(added.errors,[]);assert.equal(added.modes[2].id,'audit-role:mode:fresh-form');assert.deepEqual(added.modes[2].abilityUses,{});
});
test('legacy editor text without references still preserves unchanged mode identities',()=>{
  const text=formatRoleModeAssignments(source,abilities).split('\n').filter(line=>!line.startsWith('edit reference:')).join('\n');
  const parsed=parseRoleModeAssignments(text,abilities,abilities.map(a=>a.id),source);assert.deepEqual(parsed.errors,[]);assert.deepEqual(parsed.modes.map(m=>m.id),['import:robot','import:alt']);
});
test('two configurations can swap readable names without swapping their identities',()=>{
  const text=formatRoleModeAssignments(source,abilities).replace('[Robot]','[TEMP]').replace('[Alt]','[Robot]').replace('[TEMP]','[Alt]');
  const parsed=parseRoleModeAssignments(text,abilities,abilities.map(a=>a.id),source);assert.deepEqual(parsed.errors,[]);assert.deepEqual(parsed.modes.map(m=>[m.id,m.name]),[['import:robot','Alt'],['import:alt','Robot']]);
});
test('edit references use readable names rather than raw identifiers and preserve quoted names',()=>{
  const role=structuredClone(source);role.modes[1].name='The "Guard": stance';const text=formatRoleModeAssignments(role,abilities);
  assert.doesNotMatch(text,/import:alt/);assert.match(text,/edit reference:/);
  const parsed=parseRoleModeAssignments(text.replace('[The "Guard": stance]','[New Stance]'),abilities,abilities.map(a=>a.id),role);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.modes[1].id,'import:alt');
});
