import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../js/resolution-editor.js';
import {buildTrackerResolutionReview} from '../js/resolution-review.js';
import {complexNightFixture} from './helpers/complex-night-fixture.mjs';
import {lethalResolutionFixture} from './helpers/lethal-resolution-fixture.mjs';
function projection(input,proposal=resolveNightDeterministically(input)){
  const draft=buildResolutionDraft({proposal,actions:input.actions,players:input.players});
  const review=buildTrackerResolutionReview({draft,roster:input.players,roles:input.roles,factions:input.factions,submittedActions:input.actions});
  return {proposal,draft,review};
}
test('complex engine editor tracker agrees on generated and original lethal-attempt survivors',()=>{
  const {review}=projection(complexNightFixture());
  assert.deepEqual(review.summary.survived.map(p=>p.id).sort(),['p4','p16','p22','p24','p25','p28','p30'].sort());
});
test('generated lethal attempts retain child parent root and exact target identity',()=>{
  const {proposal}=projection(complexNightFixture());assert.ok(Array.isArray(proposal.lethal_attempts));
  const retaliation=proposal.lethal_attempts.find(a=>a.action_id==='counter-kill:counter:p26');
  assert.ok(retaliation);assert.equal(retaliation.parent_action_id,'counter-kill');assert.equal(retaliation.root_action_id,'counter-kill');assert.equal(retaliation.target_player_id,'p25');assert.equal(retaliation.actor_player_id,'p26');assert.equal(retaliation.generated,true);
  assert.ok(!proposal.lethal_attempts.some(a=>a.action_id==='blocked-grant-kill'));
});
test('GM recalculation removes cancelled upstream generated lethal attempts',()=>{
  const input=complexNightFixture(),first=resolveNightDeterministically(input);
  const corrected=recalculateNight(first,input,{actionId:'counter-kill',actionPatch:{forceResult:'CANCELLED',forceReason:'Audit cancellation'}});
  const {review}=projection(input,corrected);
  assert.ok(Array.isArray(corrected.lethal_attempts));assert.ok(!corrected.lethal_attempts.some(a=>a.root_action_id==='counter-kill'));
  assert.ok(!review.summary.survived.some(p=>p.id==='p25'));
});
test('lethal attempt ledger survives editor final payload and JSON readback',()=>{
  const input=complexNightFixture(),{proposal,draft}=projection(input),payload=JSON.parse(JSON.stringify(finalResolutionPayload(draft,proposal)));
  assert.deepEqual(payload.lethal_attempts,proposal.lethal_attempts);
  assert.equal(projection(input,payload).review.summary.survived.length,7);
});
test('explicit empty attempt ledger overrides legacy inferred attack destinations',()=>{
  const input=complexNightFixture(),proposal=resolveNightDeterministically(input);proposal.lethal_attempts=[];
  assert.equal(projection(input,proposal).review.summary.survived.length,0);
});
test('survivor projection is ID-based when player names collide',()=>{
  const input=complexNightFixture();input.players.forEach(p=>p.name='Same display name');
  assert.equal(projection(input).review.summary.survived.length,7);
});

test('legacy saved rulings without a lethal ledger retain original target fallback',()=>{
  const input=complexNightFixture(),proposal=resolveNightDeterministically(input);delete proposal.lethal_attempts;
  assert.equal(projection(input,proposal).review.summary.survived.length,6);
});
test('authenticated rollback fixture uses actual engine and final payload for retaliation',()=>{
  const fixture=lethalResolutionFixture();
  assert.equal(fixture.proposal.lethal_attempts.length,2);
  assert.deepEqual(fixture.ruling.lethal_attempts,fixture.proposal.lethal_attempts);
  const review=buildTrackerResolutionReview({draft:fixture.ruling,roster:fixture.document.data.players,roles:fixture.document.data.roles,submittedActions:fixture.actions});
  assert.deepEqual(review.summary.survived.map(p=>p.id),['audit-actor']);
  assert.deepEqual(review.summary.deaths.map(p=>p.id),['audit-target']);
});
