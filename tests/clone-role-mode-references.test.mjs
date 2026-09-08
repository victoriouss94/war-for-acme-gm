import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneFixture} from './helpers/clone-role-mode-fixture.mjs';

test('actual setup duplication remaps all mode and role-wide ability references to copied abilities',async()=>{
  const {payload}=await cloneFixture(),role=payload.data.roles[0],ids=new Set(payload.data.abilities.map(a=>a.id));
  for(const id of [...role.roleWideAbilityIds,...role.roleWidePassiveAbilityIds,...role.modes.flatMap(m=>[...m.abilityIds,...(m.passiveAbilityIds||[])])])assert.ok(ids.has(id),'orphan copied reference '+id);
  assert.ok(ids.has(role.activeAbilityId));assert.ok(ids.has(role.passiveAbilityId));
});
test('actual setup duplication remaps starting modes and switch target IDs while retaining mechanics',async()=>{
  const {payload}=await cloneFixture(),role=payload.data.roles[0],alt=role.modes.find(m=>m.name==='Alt'),robot=role.modes.find(m=>m.name==='Robot');
  assert.ok(alt.id.startsWith(role.id+':mode:'));assert.equal(role.startingModeId,alt.id);
  assert.deepEqual(Array.from(alt.switchRules.targetModeIds),[robot.id]);
  const guard=payload.data.abilities.find(a=>a.name==='Guard').id;
  assert.deepEqual(alt.abilityUses,{[guard]:2});
  assert.deepEqual(alt.resourcePools,{energy:3});assert.equal(alt.switchRules.cost,'1 energy');
  assert.equal(alt.investigationAppearance.basicAsk,'Neutral');assert.equal(alt.sourceText,'Original source');
});
test('setup duplication leaves source game and player progress untouched',async()=>{
  const {payload,sourceData,original}=await cloneFixture();
  assert.deepEqual(sourceData,original);assert.equal(payload.data.players.length,0);assert.equal(payload.data.actions.length,0);
  assert.equal(payload.game.status,'SETUP');
});
