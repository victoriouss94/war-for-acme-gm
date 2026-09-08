import test from 'node:test';
import assert from 'node:assert/strict';
import {formatRoleModeAssignments,parseRoleModeAssignments,normalizeRoleModes,roleModeContext} from '../js/role-modes.js';
import {abilities,source,formFixture} from './helpers/role-editor-fixture.mjs';

test('actual role editor preserves imported mode IDs and every normalized mode property on notes-only edit',()=>{
  const f=formFixture();f.get('roleNotes').value='GM changed only notes';
  const saved=f.save();assert.ok(saved,f.context.error);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.modes)),normalizeRoleModes(f.role,abilities).modes);
});
test('actual role editor preserves player current mode and multiple role-wide passives',()=>{
  const f=formFixture(),saved=f.save();assert.ok(saved,f.context.error);
  const role={...f.role,...saved},context=roleModeContext({role,abilities,player:{currentModeId:'import:alt'}});
  assert.equal(context.currentModeId,'import:alt');
  assert.deepEqual(Array.from(saved.roleWidePassiveAbilityIds),['passive','passive2']);
});
test('editing one displayed mode rule preserves unrelated hidden rules and stable IDs',()=>{
  const text=formatRoleModeAssignments(source,abilities).replace('switch type: ABILITY_TRIGGERED','switch type: GM_TRIGGERED');
  const parsed=parseRoleModeAssignments(text,abilities,abilities.map(a=>a.id),source);
  assert.deepEqual(parsed.errors,[]);
  assert.equal(parsed.modes[1].id,'import:alt');
  assert.equal(parsed.modes[1].switchRules.type,'GM_TRIGGERED');
  assert.equal(parsed.modes[1].switchRules.cost,'1 energy');
  assert.deepEqual(parsed.modes[1].abilityUses,{guard:2});
});
test('removing a displayed rule clears it instead of restoring its previous value',()=>{
  const role=structuredClone(source);role.modes[1].protections=['Standard Kill'];
  const text=formatRoleModeAssignments(role,abilities).replace('protections: Standard Kill\n','');
  const parsed=parseRoleModeAssignments(text,abilities,abilities.map(a=>a.id),role);
  assert.deepEqual(parsed.errors,[]);assert.deepEqual(parsed.modes[1].protections,[]);
  assert.equal(parsed.modes[1].id,'import:alt');
});
test('multiline imported mode text round-trips through the editor without being read as new fields',()=>{
  const role=structuredClone(source);role.modes[1].description='First line\nSecond line: explanation';
  const parsed=parseRoleModeAssignments(formatRoleModeAssignments(role,abilities),abilities,abilities.map(a=>a.id),role);
  assert.deepEqual(parsed.errors,[]);
  assert.equal(parsed.modes[1].description,role.modes[1].description);
});
test('unselected primary active/passive abilities cannot be saved as dangling links',()=>{
  for(const field of ['roleActiveAbility','rolePassiveAbility']){
    const f=formFixture();f.get(field).value='missing';assert.equal(f.save(),null);assert.match(f.context.error,/select|ability/i);
  }
});
test('new mode records remain distinct and use the current role namespace',()=>{
  const parsed=parseRoleModeAssignments(formatRoleModeAssignments(source,abilities)+'\n\n[New Form]\nactive: Ask',abilities,abilities.map(a=>a.id),source);
  assert.deepEqual(parsed.errors,[]);assert.equal(parsed.modes[0].id,'import:robot');
  assert.equal(parsed.modes[2].id,'audit-role:mode:new-form');assert.deepEqual(parsed.modes[2].resourcePools,{});
});
test('mode parsing still rejects unknown and deselected abilities',()=>{
  for(const [text,ids] of [['[Alt]\nactive: Unknown',['ask']],['[Alt]\nactive: Guard',['ask']]]){
    assert.ok(parseRoleModeAssignments(text,abilities,ids,source).errors.length);
  }
});

test('changing a mode cooldown resets obsolete numeric metadata and infers the new duration',()=>{
  for(const [text,expected] of [['3 cycles',3],['',null]]){
    const role=structuredClone(source);role.modes[1].switchRules.cooldown='2 cycles';
    const rendered=formatRoleModeAssignments(role,abilities).replace('switch cooldown: 2 cycles',text?'switch cooldown: '+text:'');
    const result=parseRoleModeAssignments(rendered,abilities,abilities.map(a=>a.id),role);
    assert.deepEqual(result.errors,[]);assert.equal(result.modes[1].switchRules.cooldownCycles,expected);
  }
});
test('mode reordering preserves identities and input objects are never mutated',()=>{
  const role=structuredClone(source),before=structuredClone(role);
  const rendered=formatRoleModeAssignments(role,abilities).split('\n\n').reverse().join('\n\n');
  const result=parseRoleModeAssignments(rendered,abilities,abilities.map(a=>a.id),role);
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.modes.map(m=>m.id),['import:alt','import:robot']);
  assert.deepEqual(role,before);
});
