import test from 'node:test';
import assert from 'node:assert/strict';
import {mechanicsReviewQueue,mechanicsReviewKey} from '../js/mechanics.js';
import {sourceReviewFixture,expectedSourceReviews} from './helpers/source-review-fixture.mjs';

test('source warnings follow preserved evidence and retain independent warnings',()=>{
  const f=sourceReviewFixture(),rows=mechanicsReviewQueue({game:f.game,...f.data});
  assert.deepEqual(rows.map(r=>[r.roleId,r.mechanicType]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),expectedSourceReviews);
});
test('synthetic source warnings merge across local and remote IDs by scoped warning code',()=>{
  const local={id:'local-hash',gameId:'game',roleId:'role',abilityId:'passive',code:'POSSIBLY_INVENTED_PASSIVE'},remote={...local,id:'server-id'};
  assert.equal(mechanicsReviewKey(local),mechanicsReviewKey(remote));
  assert.notEqual(mechanicsReviewKey(local),mechanicsReviewKey({...remote,gameId:'other-game'}));
  assert.notEqual(mechanicsReviewKey(local),mechanicsReviewKey({...remote,roleId:'other-role'}));
  assert.notEqual(mechanicsReviewKey(local),mechanicsReviewKey({...remote,abilityId:'other-ability'}));
});
test('different source warnings and actual stored mechanics cannot collide',()=>{
  const warning={id:'same-id',gameId:'game',roleId:'role',abilityId:'',code:'SOURCE_STRUCTURE_MISSING'};
  assert.notEqual(mechanicsReviewKey(warning),mechanicsReviewKey({...warning,code:'FACTION_SCOPE_NOT_STRUCTURED'}));
  assert.notEqual(mechanicsReviewKey(warning),mechanicsReviewKey({...warning,code:''}));
});
