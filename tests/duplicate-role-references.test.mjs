import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {templateFixture} from './helpers/role-template-fixture.mjs';
function fixture(authorized=true){
  const f=templateFixture({authorized}),app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  f.context.state.abilities=structuredClone(f.template.abilities);
  const role=f.template.role;role.mechanicalStatements=[{type:'ACTIVE_ABILITY',sourceRoleId:role.id,sourceAbilityId:'ask',originalText:'Source audit-role',sourceDocumentId:'source-document',targeting:{targetRoleRestrictions:['other-role']}}];
  role.metadata={modeId:role.modes[1].id};
  f.context.state.roles=[f.context.normalizeRole(role,f.game.id)];f.context.state.players=[{id:'player',roleId:role.id,currentModeId:role.modes[0].id}];
  vm.runInContext(app.slice(app.indexOf('function duplicateRole('),app.indexOf('async function browseRoleTemplates(')),f.context);
  return f;
}
test('actual same-game role duplicate owns its nested mechanics and unique modes',()=>{
  const f=fixture();f.context.duplicateRole('audit-role');const [source,copy]=f.context.state.roles,m=copy.understanding.mechanics[0];
  assert.equal(m.sourceRoleId,copy.id);assert.notEqual(copy.modes[0].id,source.modes[0].id);
  assert.equal(copy.startingModeId,copy.modes[1].id);assert.equal(copy.metadata.modeId,copy.modes[1].id);
  assert.equal(copy.modes[1].switchRules.targetModeIds[0],copy.modes[0].id);
});
test('same-game duplicate retains existing abilities external dependencies and provenance',()=>{
  const f=fixture();f.context.duplicateRole('audit-role');const copy=f.context.state.roles[1],m=copy.understanding.mechanics[0];
  assert.equal(m.sourceAbilityId,'ask');assert.equal(m.targeting.targetRoleRestrictions[0],'other-role');
  assert.equal(m.sourceDocumentId,'source-document');assert.equal(m.originalText,'Source audit-role');
  assert.equal(copy.modes[1].abilityUses.guard,2);assert.equal(copy.modes[1].resourcePools.energy,3);
  assert.deepEqual(Array.from(copy.roleWidePassiveAbilityIds),['passive','passive2']);
});
test('same-game duplicate leaves original role and player mode state unchanged',()=>{
  const f=fixture(),original=JSON.stringify(f.context.state);f.context.duplicateRole('audit-role');
  const before=JSON.parse(original);assert.equal(JSON.stringify(f.context.state.roles[0]),JSON.stringify(before.roles[0]));
  assert.equal(JSON.stringify(f.context.state.players),JSON.stringify(before.players));assert.equal(f.calls.length,1);
});
test('same-game role duplication denies read-only users',()=>{
  const f=fixture(false);f.context.duplicateRole('audit-role');assert.equal(f.context.state.roles.length,1);assert.equal(f.calls.length,0);
});
