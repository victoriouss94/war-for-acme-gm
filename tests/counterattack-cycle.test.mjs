import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {buildTrackerResolutionReview} from '../js/resolution-review.js';
import {buildResolutionDraft,finalResolutionPayload} from '../js/resolution-editor.js';

const attack=(id='attack',actor='a',target='b')=>({id,name:'Personal Instant Kill',sourcePlayerId:actor,targetIds:[target]});
function fixture({mutual=true,immune=false,id='attack'}={}){
  return {gameId:'synthetic-counterattack-audit',round:1,phase:'Night',players:[
    {id:'a',name:'Alpha',alive:true,roleId:mutual?'counter':'plain'},
    {id:'b',name:'Beta',alive:true,roleId:'counter'},
    {id:'c',name:'Gamma',alive:true,roleId:'plain'}],
    roles:[{id:'counter',passives:['Counterattack',...(immune?['Death Immunity']:[])]},{id:'plain'}],
    actions:[attack(id)]};
}
const resolve=resolveNightDeterministically;
test('mutual retaliation stops at a causal cycle and requires GM review',()=>{
  const input=fixture(),before=structuredClone(input),r=resolve(input);
  assert.equal(r.resolution_status,'GM_REVIEW_REQUIRED');
  assert.equal(r.observability.generated_effect_count,2);
  assert.equal(r.unresolved_questions.length,1);assert.match(r.unresolved_questions[0],/counterattack.*cycle/i);
  assert.match(r.unresolved_questions[0],/Alpha/);assert.match(r.unresolved_questions[0],/Beta/);
  assert.equal(r.unresolved_interactions.length,0,'A detected cycle is not an unknown ability for paid AI');
  assert.equal(r.observability.ai_fallback_call_count,0);
  assert.equal(r.action_results.length,1);assert.equal(r.lethal_attempts.length,3);
  assert.deepEqual(input,before);
});
test('protected mutual retaliation cannot silently resolve a repeated passive loop',()=>{
  const r=resolve(fixture({immune:true}));
  assert.equal(r.resolution_status,'GM_REVIEW_REQUIRED');assert.deepEqual(r.deaths,[]);
  assert.equal(r.observability.generated_effect_count,2);
});
test('ordinary one-way counterattack remains automatic and keeps existing IDs',()=>{
  const r=resolve(fixture({mutual:false}));
  assert.equal(r.resolution_status,'RESOLVED');assert.equal(r.observability.generated_effect_count,1);
  assert.ok(r.lethal_attempts.some(a=>a.action_id==='attack:counter:b'));
  assert.deepEqual(new Set(r.deaths),new Set(['Alpha','Beta']));
});
test('independent submitted attacks each retain their own retaliation',()=>{
  const input=fixture({mutual:false});input.actions.push(attack('second','c','b'));
  const r=resolve(input);assert.equal(r.observability.generated_effect_count,2);
  assert.equal(r.resolution_status,'RESOLVED');assert.equal(r.action_results.length,2);
});
test('separate mutual chains are reviewed separately, not globally deduplicated',()=>{
  const input=fixture();input.actions.push(attack('second'));
  const r=resolve(input);assert.equal(r.observability.generated_effect_count,4);
  assert.equal(r.unresolved_questions.length,2);
});
test('long submitted IDs cannot collide with generated child identities',()=>{
  const r=resolve(fixture({mutual:false,id:'x'.repeat(160)}));
  const ids=r.lethal_attempts.map(a=>a.action_id);
  assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(id=>id.length<=160));
  assert.equal(r.observability.generated_effect_count,1);
});
test('generated IDs do not collide with another submitted action',()=>{
  const input=fixture({mutual:false});input.actions.push(attack('attack:counter:b','c','a'));
  const r=resolve(input),ids=r.lethal_attempts.map(a=>a.action_id);
  assert.equal(new Set(ids).size,ids.length);assert.equal(r.action_results.length,2);
});
test('cancelling the root attack removes the dependent cycle and review',()=>{
  const input=fixture(),first=resolve(input),r=recalculateNight(first,input,{actionId:'attack',actionPatch:{forceResult:'CANCELLED'}});
  assert.equal(r.resolution_status,'RESOLVED');assert.equal(r.observability.generated_effect_count,0);
  assert.deepEqual(r.unresolved_questions,[]);assert.deepEqual(r.deaths,[]);
});
test('replaying the same snapshot preserves generated identities and review',()=>{
  const input=fixture(),a=resolve(input),b=resolve(input);
  assert.deepEqual(a.lethal_attempts,b.lethal_attempts);assert.deepEqual(a.unresolved_questions,b.unresolved_questions);
});
test('cycle warning survives the editor and prevents complete tracker approval',()=>{
  const input=fixture(),r=resolve(input),payload=finalResolutionPayload(buildResolutionDraft({proposal:r,actions:input.actions,players:input.players}));
  assert.ok(payload.unresolved_questions.some(q=>/counterattack.*cycle/i.test(q)));
  assert.equal(buildTrackerResolutionReview({draft:r,roster:input.players,submittedActions:input.actions}).isComplete,false);
});
