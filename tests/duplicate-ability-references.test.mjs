import test from 'node:test';
import assert from 'node:assert/strict';
import {duplicateAbilityFixture} from './helpers/duplicate-ability-fixture.mjs';
import {mechanicsReviewQueue,normalizeAbilityUnderstanding} from '../js/mechanics.js';
test('actual ability duplication remaps self references and preserves external dependencies',()=>{
  const f=duplicateAbilityFixture();f.duplicate();const copy=f.context.state.abilities[1],m=normalizeAbilityUnderstanding(copy).mechanics[0];
  assert.equal(m.sourceAbilityId,copy.id);assert.equal(m.sourceAbilityName,copy.name);assert.equal(copy.metadata.abilityId,copy.id);
  assert.equal(copy.metadata.targetAbilityId,'external-ability');assert.equal(copy.metadata.modeId,'existing-mode');assert.equal(m.sourceRoleId,'existing-role');
  assert.equal(copy.standardAbilityId,'global:ask');assert.equal(copy.sourceDocumentId,'source-document');assert.equal(m.originalText,'Original source-ability evidence');
});
test('original and duplicate both appear as independent unresolved review items',()=>{
  const f=duplicateAbilityFixture();f.duplicate();const queue=mechanicsReviewQueue({game:{id:'synthetic-game'},abilities:f.context.state.abilities});
  assert.equal(queue.length,2);assert.equal(new Set(queue.map(r=>r.id)).size,2);assert.equal(queue[1].abilityName,'Synthetic Ask Copy');
});
test('editing nested copied ability state cannot mutate the original ability',()=>{
  const f=duplicateAbilityFixture(),before=JSON.stringify(f.source);f.duplicate();const copy=f.context.state.abilities[1];
  copy.understanding.mechanics[0].targeting.targetRoleRestrictions.push('another');copy.mechanics.push('Changed');copy.metadata.targetAbilityId='changed';
  assert.equal(JSON.stringify(f.source),before);
});
test('duplicate naming reset flags and assignments remain stable',()=>{
  const f=duplicateAbilityFixture(),roles=JSON.stringify(f.context.state.roles),players=JSON.stringify(f.context.state.players);f.duplicate();f.duplicate();
  const [,one,two]=f.context.state.abilities;assert.equal(one.name,'Synthetic Ask Copy');assert.equal(two.name,'Synthetic Ask Copy 2');assert.notEqual(one.id,two.id);
  assert.equal(one.builtIn,false);assert.equal(one.defaultName,undefined);assert.equal(one.revisions.length,0);assert.equal(f.saves.length,2);
  assert.equal(JSON.stringify(f.context.state.roles),roles);assert.equal(JSON.stringify(f.context.state.players),players);
});
test('legacy mechanic aliases receive copied ownership and independent review IDs',()=>{
  const f=duplicateAbilityFixture({legacy:true});f.duplicate();const copy=f.context.state.abilities[1],m=normalizeAbilityUnderstanding(copy).mechanics[0];
  assert.equal(m.sourceAbilityId,copy.id);assert.notEqual(m.id,normalizeAbilityUnderstanding(f.source).mechanics[0].id);
  assert.equal(copy.mechanical_statements[0].id,m.id);
});
test('read-only users cannot mutate local state through ability duplication',()=>{
  const f=duplicateAbilityFixture({authorized:false});f.duplicate();assert.equal(f.context.state.abilities.length,1);assert.equal(f.saves.length,0);
});

test('external mechanic ownership names remain external and id-less statements receive unique IDs',()=>{
  const f=duplicateAbilityFixture();delete f.source.understanding;
  f.source.mechanicalStatements=[{type:'ABILITY_MODIFIER',sourceAbilityId:'external-ability',sourceAbilityName:'External Ability',originalText:'First external modifier'},{type:'ACTIVE_ABILITY',originalText:'Second mechanic'}];
  f.duplicate();const copy=f.context.state.abilities[1],mechanics=normalizeAbilityUnderstanding(copy).mechanics;
  assert.equal(mechanics.length,2);assert.notEqual(mechanics[0].id,mechanics[1].id);
  assert.equal(mechanics[0].sourceAbilityId,'external-ability');assert.equal(mechanics[0].sourceAbilityName,'External Ability');
  assert.equal(mechanics[1].sourceAbilityId,copy.id);assert.equal(mechanics[1].sourceAbilityName,copy.name);
});
test('missing ability selection does not save or create a copy',()=>{
  const f=duplicateAbilityFixture();f.context.duplicateAbility('missing');assert.equal(f.saves.length,0);assert.equal(f.context.state.abilities.length,1);
});
