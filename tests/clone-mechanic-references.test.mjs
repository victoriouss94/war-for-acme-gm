import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneFixture} from './helpers/clone-role-mode-fixture.mjs';
import {effectiveFactionAbilities,validateActionTargets,abilityTargeting} from '../js/player-abilities.js';

import {withLinkedMechanics} from './helpers/clone-linked-mechanics-fixture.mjs';
import {remapSetupReferences} from '../js/mechanics.js';

test('actual cloned game retains its faction actions under the copied faction',async()=>{
  const {payload,sourceData}=await cloneFixture(withLinkedMechanics);
  assert.equal(effectiveFactionAbilities({faction:sourceData.factions[0],abilities:sourceData.abilities}).length,1);
  const available=effectiveFactionAbilities({faction:payload.data.factions[0],abilities:payload.data.abilities});
  assert.equal(available.length,1);assert.equal(available[0].name,'Ask');
});
test('actual cloned ability accepts its copied role/faction and still rejects unrelated targets',async()=>{
  const {payload}=await cloneFixture(withLinkedMechanics),data=payload.data,role=data.roles[0],faction=data.factions[0],ability=data.abilities.find(a=>a.name==='Ask');
  const player={id:'target',alive:true,roleId:role.id,currentFactionId:faction.id},actor={id:'actor'};
  const validate=target=>validateActionTargets({actor,ability:{...ability,targeting:abilityTargeting(ability)},players:[target],targetIds:['target'],roles:data.roles,factions:data.factions});
  assert.deepEqual(validate(player),[]);
  const denied=validate({...player,roleId:'unrelated',currentFactionId:'unrelated'});
  assert.ok(denied.includes('TARGET_FACTION_RESTRICTED'));assert.ok(denied.includes('TARGET_ROLE_RESTRICTED'));
});
test('cloned nested mechanics and rules use copied entity references but preserve source evidence',async()=>{
  const {payload,sourceData,original}=await cloneFixture(withLinkedMechanics),data=payload.data,role=data.roles[0],ability=data.abilities.find(a=>a.name==='Ask'),mechanic=ability.understanding.mechanics[0];
  assert.equal(mechanic.sourceRoleId,role.id);assert.equal(mechanic.sourceAbilityId,ability.id);
  assert.equal(mechanic.sourceDocumentId,'source-document');assert.equal(mechanic.baseStandardAbilityId,'global:ask');
  assert.equal(mechanic.originalText,'ask village audit-role');
  assert.equal(role.mechanicalStatements[0].source_role_id,role.id);assert.equal(role.mechanicalStatements[0].source_ability_id,ability.id);
  assert.deepEqual(Array.from(data.rules[0].metadata.modeIds),[role.modes[1].id]);assert.equal(data.rules[0].description,'audit-role village import:alt');
  assert.deepEqual(sourceData,original);
});
test('same mode IDs on different source roles retain role-local nested references',async()=>{
  const {payload}=await cloneFixture(data=>{
    data.roles[0].metadata={modeId:'import:alt'};
    data.roles.push({...structuredClone(data.roles[0]),id:'second-role',name:'Second Role'});
  });
  for(const role of payload.data.roles)assert.equal(role.metadata.modeId,role.modes[1].id);
});
test('ambiguous cross-role mode references stop a clone instead of choosing another role silently',async()=>{
  await assert.rejects(()=>cloneFixture(data=>{
    data.roles.push({...structuredClone(data.roles[0]),id:'second-role',name:'Second Role'});
    data.rules.push({id:'ambiguous-rule',metadata:{modeId:'import:alt'}});
  }),/ambiguous.*mode/i);
});
test('reference remapping preserves global standard IDs, document provenance and ordinary text even on exact ID matches',()=>{
  const input={sourceAbilityId:'ask',baseStandardAbilityId:'ask',standardAbilityId:'ask',sourceDocumentId:'ask',id:'ask',originalText:'ask',conditions:['ask'],nested:{source_role_id:'r'}};
  const copied=remapSetupReferences(input,{abilities:new Map([['ask','new-ask']]),roles:new Map([['r','new-r']])});
  assert.equal(copied.sourceAbilityId,'new-ask');assert.equal(copied.nested.source_role_id,'new-r');
  for(const field of ['baseStandardAbilityId','standardAbilityId','sourceDocumentId','id','originalText'])assert.equal(copied[field],'ask');
  assert.deepEqual(copied.conditions,['ask']);assert.equal(input.sourceAbilityId,'ask');
});
test('typed scalar/list aliases and ability/mode keyed counters are mapped without changing values',()=>{
  const input={target_faction_restrictions:['f','Named Faction'],source_role_id:'r',ability_uses:{a:2,shared:3},mode_cooldowns:{m:{untilCycle:4}},other:{name:'r'}};
  const copied=remapSetupReferences(input,{factions:new Map([['f','new-f']]),roles:new Map([['r','new-r']]),abilities:new Map([['a','new-a']]),modes:new Map([['m','new-m']])});
  assert.deepEqual(copied,{target_faction_restrictions:['new-f','Named Faction'],source_role_id:'new-r',ability_uses:{'new-a':2,shared:3},mode_cooldowns:{'new-m':{untilCycle:4}},other:{name:'r'}});
});
