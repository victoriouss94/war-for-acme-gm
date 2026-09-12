import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically as resolve} from '../js/night-engine.js';
import {parseRoleModeAssignments} from '../js/role-modes.js';
import {buildResolutionDraft,finalResolutionPayload,validateResolutionDraft} from '../js/resolution-editor.js';

const fixture=()=>({gameId:'defense-review',round:1,phase:'Night',players:[{id:'attacker',name:'Attacker',alive:true},{id:'owner',name:'Owner',alive:true,roleId:'role',currentModeId:'mode'}],roles:[{id:'role',name:'Role',modes:[{id:'mode',name:'Guarded'},{id:'inactive',name:'Inactive'}]}],abilities:[],actions:[{id:'attack',name:'Personal Instant Kill',sourcePlayerId:'attacker',targetIds:['owner']}]});
for(const [name,add] of [
  ['player immunity',input=>{input.players[1].immunities=['Moon Ward']}],
  ['role immunity',input=>{input.roles[0].immunities=['Moon Ward']}],
  ['role protection',input=>{input.roles[0].protections=['Moon Ward']}],
  ['mode immunity',input=>{input.roles[0].modes[0].immunities=['Moon Ward']}],
  ['mode protection',input=>{input.roles[0].modes[0].protections=['Moon Ward']}],
  ['named structured immunity',input=>{input.roles[0].immunities=[{name:'Moon Ward'}]}],
  ['temporary mode defense',input=>{input.roles[0].modes[1].protections=['Moon Ward'];input.temporaryModeAccess=[{playerId:'owner',roleId:'role',modeId:'inactive'}]}],
])test('unimplemented '+name+' cannot silently certify a lethal ruling',()=>{
  const input=fixture();add(input);const before=structuredClone(input),proposal=resolve(input);
  assert.equal(proposal.resolution_status,'GM_REVIEW_REQUIRED');assert.ok(proposal.unresolved_questions.some(q=>q.includes('Owner')&&q.includes('Moon Ward')));
  assert.equal(proposal.unresolved_interactions.length,0);assert.equal(proposal.observability.ai_fallback_call_count,0);assert.deepEqual(input,before);
  const draft=buildResolutionDraft({proposal,actions:input.actions,players:input.players});assert.equal(finalResolutionPayload(draft).resolution_status,'GM_REVIEW_REQUIRED');draft.resolution_status='RESOLVED';assert.ok(validateResolutionDraft(draft,input).errors.some(error=>error.includes('unresolved questions')));
});
test('actual mode editor parsed defense reaches saved resolution review',()=>{
  const input=fixture(),parsed=parseRoleModeAssignments('[Guarded]\nimmunities: Moon Ward\nprotections: Lunar Barrier',[],[]);assert.deepEqual(parsed.errors,[]);
  input.roles[0].modes=parsed.modes;input.players[1].currentModeId=parsed.modes[0].id;const proposal=resolve(input);assert.equal(proposal.resolution_status,'GM_REVIEW_REQUIRED');assert.match(proposal.unresolved_questions.join(' '),/Moon Ward/);assert.match(proposal.unresolved_questions.join(' '),/Lunar Barrier/);
});
for(const defense of ['Death Immunity','Protect'])test('implemented mode '+defense+' remains automatic',()=>{const input=fixture();input.roles[0].modes[0][defense==='Protect'?'protections':'immunities']=[defense];const result=resolve(input);assert.equal(result.resolution_status,'RESOLVED');assert.deepEqual(result.deaths,[])});
test('inactive defense and dead-owner defense do not create review noise',()=>{const input=fixture();input.roles[0].modes[1].protections=['Moon Ward'];assert.equal(resolve(input).resolution_status,'RESOLVED');input.players[1].alive=false;input.roles[0].modes[0].immunities=['Moon Ward'];input.actions=[];assert.equal(resolve(input).resolution_status,'RESOLVED')});
