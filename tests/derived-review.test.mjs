import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as mechanics from '../js/mechanics.js';
import {derivedReviewFixture} from './helpers/derived-review-fixture.mjs';

const row={id:'transport-id',gameId:'game',gameName:'Game',roleId:'role',roleName:'Role',abilityId:'ability',abilityName:'Ability',projectionContext:{version:1,roleId:'role',roleName:'Role',sourceLocation:'page 2',index:3},current:{mechanic_id:'stored-alias-id',mechanic_type:'active ability',original_text:'Unresolved action',requires_review:true,interpretation_state:'VERIFIED',confidence:1}};
test('cloud review projection reuses the canonical mechanic normalizer and stored ID aliases',()=>{
  const result=mechanics.normalizeCloudMechanicsReviews([row]);assert.equal(result.length,1);assert.equal(result[0].id,'stored-alias-id');assert.equal(result[0].mechanicType,'ACTIVE_ABILITY');assert.equal(result[0].current.requiresReview,true);
});
test('idless transport IDs normalize to the same local ID without depending on other games',()=>{
  const input={...row,current:{original_text:' Idless\nsource ',effect:'Unknown effect'}},local=mechanics.normalizeMechanic(input.current,input.projectionContext);
  const [a,b]=mechanics.normalizeCloudMechanicsReviews([input,{...input,id:'different-query-scope'}]);assert.equal(a.id,local.id);assert.equal(b.id,local.id);
});
test('empty entries and verified empty unknown-component lists do not become cloud warnings',()=>{
  const rows=[null,{}, {id:'verified',originalText:'Known source',confidence:1,interpretationState:'VERIFIED',unresolvedComponents:['',' ']}].map(current=>({...row,current}));assert.deepEqual(mechanics.normalizeCloudMechanicsReviews(rows),[]);
});
test('malformed confidence and unknown interpretation states remain reviewable',()=>{
  const rows=[{confidence:'not-a-number',interpretationState:'VERIFIED'},{confidence:1,interpretationState:'NOT_A_STATE'}].map(fields=>({...row,current:{originalText:'Preserved source',...fields}}));assert.equal(mechanics.normalizeCloudMechanicsReviews(rows).length,2);
});
test('source warnings and old backend rows remain compatible and inputs are not mutated',()=>{
  const legacy={id:'legacy',gameId:'game'},warning={id:'warning',code:'SOURCE_STRUCTURE_MISSING'},before=structuredClone(row);assert.deepEqual(mechanics.normalizeCloudMechanicsReviews([legacy,warning]),[legacy,warning]);mechanics.normalizeCloudMechanicsReviews([row]);assert.deepEqual(row,before);
});

// Observed from authenticated public RPC calls inside a rolled-back synthetic game.
const cloud=JSON.parse(readFileSync(new URL('./fixtures/derived-review-cloud.json',import.meta.url),'utf8'));
const document=derivedReviewFixture({malformed:true});document.game.id=cloud.fixture_id;
const local=mechanics.mechanicsReviewQueue({game:document.game,...document.data});
test('actual cloud review rows have identical canonical IDs and details to the local queue',()=>{
  const projected=mechanics.normalizeCloudMechanicsReviews(cloud.reviews),keys=Object.keys(local[0]);
  const canonical=rows=>rows.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]]))).sort((a,b)=>mechanics.mechanicsReviewKey(a).localeCompare(mechanics.mechanicsReviewKey(b)));
  assert.equal(local.length,12);assert.deepEqual(canonical(projected),canonical(local));
});
test('actual application merge does not duplicate idless cloud reviews or discard another game',()=>{
  const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),start=app.indexOf('reviewMap=new Map('),end=app.indexOf(',allReviews=',start),expression=app.slice(start+'reviewMap='.length,end);
  const context={...mechanics,aiGmData:{mechanicsReviews:[...cloud.reviews,...cloud.reviews.map(row=>({...row,gameId:'second-game'}))]},localReviews:local};vm.createContext(context);
  const result=Array.from(vm.runInContext(expression,context).values());assert.equal(result.length,24);assert.equal(result.filter(row=>row.gameId===cloud.fixture_id).length,12);assert.equal(result.filter(row=>row.gameId==='second-game').length,12);
});
