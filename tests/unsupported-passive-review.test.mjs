import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically} from '../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload,validateResolutionDraft} from '../js/resolution-editor.js';

function fixture(){return {gameId:'passive-review',round:0,phase:'Night',players:[{id:'actor',name:'Attacker',alive:true,roleId:'attacker',factionId:'town'},{id:'owner',name:'Passive Owner',alive:true,roleId:'owner-role',factionId:'town'}],roles:[{id:'attacker',name:'Attacker',tags:['Personal Instant Kill']},{id:'owner-role',name:'Owner Role',roleWidePassiveAbilityIds:['custom-passive']}],abilities:[{id:'kill',name:'Personal Instant Kill'},{id:'custom-passive',name:'Last Gift',activePassive:'PASSIVE',definition:'When this player dies, award one use to the bound player.'}],factions:[{id:'town',name:'Town'}],actions:[{id:'kill-action',sourcePlayerId:'actor',abilityId:'kill',targetIds:['owner']}]};}
function reviewed(result){assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');assert.ok(result.unresolved_questions.some(q=>q.includes('Passive Owner')&&q.includes('Last Gift')));}
test('linked custom passive cannot silently produce a fully resolved night',()=>{
  const input=fixture(),before=structuredClone(input),result=resolveNightDeterministically(input);reviewed(result);
  assert.equal(result.action_results.length,1);assert.equal(result.action_results[0].action_id,'kill-action');
  assert.equal(result.observability.ai_fallback_call_count,0);assert.equal(result.observability.gm_review_count,1);
  assert.equal(result.unresolved_interactions.length,0);assert.equal(result.passive_results.length,0);assert.deepEqual(input,before);
});
test('named custom passives remain explicit when no actions were queued',()=>{
  const input=fixture();input.actions=[];input.roles[1].roleWidePassiveAbilityIds=[];input.roles[1].passives=['Last Gift'];
  const result=resolveNightDeterministically(input);reviewed(result);assert.equal(result.action_results.length,0);
});
test('unsupported passive review survives existing editor payload normalization',()=>{
  const input=fixture(),proposal=resolveNightDeterministically(input),draft=buildResolutionDraft({proposal,actions:input.actions,players:input.players});
  reviewed(finalResolutionPayload(draft));
  draft.resolution_status='RESOLVED';assert.ok(validateResolutionDraft(draft,input).errors.some(e=>e.includes('unresolved questions')));
});
test('accessible custom mode passives are reviewed once despite repeated references',()=>{
  const input=fixture();input.roles[1].modes=[{id:'mode',name:'Mode',passiveAbilityIds:['custom-passive']}];input.players[1].currentModeId='mode';
  const result=resolveNightDeterministically(input);reviewed(result);assert.equal(result.unresolved_questions.length,1);
});
test('inactive mode and unowned encyclopedia entries do not create review noise',()=>{
  const input=fixture();input.roles[1].roleWidePassiveAbilityIds=[];input.roles[1].modes=[{id:'normal',name:'Normal'},{id:'other',name:'Other',passiveAbilityIds:['custom-passive']}];input.players[1].currentModeId='normal';
  const result=resolveNightDeterministically(input);assert.equal(result.resolution_status,'RESOLVED');assert.deepEqual(result.unresolved_questions,[]);
});
test('temporary access includes that mode custom passive in review',()=>{
  const input=fixture();input.roles[1].roleWidePassiveAbilityIds=[];input.roles[1].modes=[{id:'normal',name:'Normal'},{id:'other',name:'Other',passiveAbilityIds:['custom-passive']}];input.players[1].currentModeId='normal';input.temporaryModeAccess=[{playerId:'owner',roleId:'owner-role',modeId:'other'}];reviewed(resolveNightDeterministically(input));
});
test('starting dead passive owners do not acquire a new ability review',()=>{
  const input=fixture();input.players[1].alive=false;input.actions=[];assert.equal(resolveNightDeterministically(input).resolution_status,'RESOLVED');
});
test('known mapped passive retains automatic resolution without review',()=>{
  const input=fixture();input.abilities[1].standardAbilityId='bulletproof';
  const result=resolveNightDeterministically(input);assert.equal(result.resolution_status,'RESOLVED');assert.equal(result.player_outcomes[1].alive_after_resolution,true);assert.equal(result.passive_results.length,1);
});
test('a missing linked passive is explicit rather than silently dropped',()=>{
  const input=fixture();input.abilities.pop();const result=resolveNightDeterministically(input);assert.equal(result.resolution_status,'GM_REVIEW_REQUIRED');assert.match(result.unresolved_questions.join(' '),/missing linked passive/i);
});
test('reference-only snapshot passive is named but not assumed executable',()=>{
  const input=fixture();input.roles[1].roleWidePassiveAbilityIds=[];input.passives=[{playerId:'owner',abilityId:'custom-passive'}];reviewed(resolveNightDeterministically(input));
});
test('unnamed structured passive requires review instead of disappearing',()=>{
  const input=fixture();input.roles[1].roleWidePassiveAbilityIds=[];input.passives=[{playerId:'owner',trigger:'PLAYER_DIED',effect:'award a use'}];
  assert.match(resolveNightDeterministically(input).unresolved_questions.join(' '),/Unnamed custom passive/);
});
test('known name in an unsupported source field is not falsely declared implemented',()=>{
  const input=fixture();input.roles[1].roleWidePassiveAbilityIds=[];input.roles[1].passiveAbilityNames=['Death Immunity'];
  assert.equal(resolveNightDeterministically(input).resolution_status,'GM_REVIEW_REQUIRED');
});
