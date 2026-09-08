import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as mechanics from '../js/mechanics.js';
const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
function merged(cloud,local){
  const start=app.indexOf('reviewMap=new Map('),end=app.indexOf(',allReviews=',start),expression=app.slice(start+'reviewMap='.length,end);
  const context={...mechanics,aiGmData:{mechanicsReviews:cloud},localReviews:local};vm.createContext(context);
  return Array.from(vm.runInContext(expression,context).values());
}
const row={id:'shared-source-review',gameId:'game',roleId:'role-one',abilityId:'ability',originalText:'Source preserved'};
test('actual UI merge retains copied-role reviews with the same source ID',()=>{
  const result=merged([row],[{...row,roleId:'role-two'}]);assert.equal(result.length,2);
});
test('actual UI merge keeps the same review ID from separate games',()=>{
  assert.equal(merged([row],[{...row,gameId:'another-game'}]).length,2);
});
test('actual UI merge replaces only the matching remote review with local data',()=>{
  const remote={review_id:row.id,game_id:row.gameId,role_id:row.roleId,ability_id:row.abilityId,originalText:'Older'};
  const result=merged([remote],[row]);assert.equal(result.length,1);assert.equal(result[0].originalText,'Source preserved');
});
test('actual UI merge distinguishes role-owned and standalone ability mechanics',()=>{
  assert.equal(merged([row],[{...row,roleId:''}]).length,2);
});
test('local review queue retains same-ID mechanics owned by two abilities and a role',()=>{
  const mechanic={id:'shared',type:'ACTIVE_ABILITY',originalText:'Unresolved source',requiresReview:true};
  const abilities=[{id:'one',name:'One',mechanicalStatements:[mechanic]},{id:'two',name:'Two',mechanicalStatements:[mechanic]}];
  const roles=[{id:'role',name:'Role',mechanicalStatements:[{...mechanic,sourceAbilityId:'one'}]}];
  const result=mechanics.mechanicsReviewQueue({game:{id:'game'},roles,abilities});
  assert.equal(result.length,3);assert.equal(merged([],result).length,3);
  assert.ok(result.every(r=>r.id==='shared'),'stored review IDs must not be rewritten');
});
test('review identities use unambiguous field boundaries and do not mutate records',()=>{
  const a={...row,gameId:'a:b',roleId:'c'},b={...row,gameId:'a',roleId:'b:c'},before=JSON.stringify([a,b]);
  assert.equal(merged([a],[b]).length,2);assert.equal(JSON.stringify([a,b]),before);
});
