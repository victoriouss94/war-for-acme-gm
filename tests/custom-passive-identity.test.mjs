import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolveNightDeterministically as resolve} from '../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../js/resolution-editor.js';
import {buildTrackerResolutionReview} from '../js/resolution-review.js';

function fixture(standard='death_immunity',extra={}){
  return {gameId:'custom-passive-identity-audit',round:1,phase:'Night',players:[{id:'a',name:'Attacker',alive:true},{id:'b',name:'Defender',alive:true,roleId:'r'}],roles:[{id:'r',passiveAbilityId:'p'}],abilities:[{id:'p',name:'Conditional Plating',standardAbilityId:standard,activePassive:'PASSIVE',definition:'Applies only while the bound partner is alive.',customIdentity:true,...extra}],actions:[{id:'attack',name:'Personal Instant Kill',sourcePlayerId:'a',targetIds:['b']}]};
}
function assertReview(input){
  const before=structuredClone(input),r=resolve(input);
  assert.equal(r.resolution_status,'GM_REVIEW_REQUIRED');
  assert.ok(r.unresolved_questions.some(q=>q.includes('Defender')&&q.includes(input.abilities[0].name)));
  assert.equal(r.passive_results.length,0);assert.equal(r.observability.generated_effect_count,0);
  assert.equal(r.unresolved_interactions.length,0);assert.equal(r.observability.ai_fallback_call_count,0);
  assert.deepEqual(r.action_results[0].final_target_ids,['b']);
  assert.deepEqual(input,before);return r;
}
for(const standard of ['death_immunity','bulletproof','reflection','counterattack'])test('custom '+standard+' cannot execute its unconditional base passive',()=>assertReview(fixture(standard)));
test('nested snake-case custom identity is honored',()=>assertReview(fixture('death_immunity',{customIdentity:false,understanding:{custom_identity:true}})));
test('top-level snake-case custom identity is honored',()=>{
  const input=fixture();delete input.abilities[0].customIdentity;input.abilities[0].custom_identity=true;assertReview(input);
});
test('an explicit CUSTOM primitive cannot execute under a standard passive name',()=>assertReview(fixture('death_immunity',{name:'Death Immunity',customIdentity:false,engineBehavior:{effect:'CUSTOM',requiresExplicitRule:false}})));
test('an explicit unresolved passive rule remains review-only',()=>assertReview(fixture('death_immunity',{customIdentity:false,engine_behavior:{effect:'PREVENT_DEATH',requiresExplicitRule:true}})));
test('custom identity is not implemented just by attaching a standard primitive',()=>assertReview(fixture('death_immunity',{engineBehavior:{effect:'PREVENT_DEATH',requiresExplicitRule:false}})));
test('nested explicit false preserves a plain renamed standard passive',()=>{
  const r=resolve(fixture('death_immunity',{understanding:{customIdentity:false}}));
  assert.equal(r.resolution_status,'RESOLVED');assert.equal(r.passive_results.length,1);assert.deepEqual(r.deaths,[]);
});
test('legacy name duplicates cannot bypass linked custom metadata',()=>{
  const input=fixture('death_immunity',{name:'Death Immunity'});
  Object.assign(input.roles[0],{passiveAbilityName:'Death Immunity',passives:['Death Immunity'],immunities:['Death Immunity']});
  const r=assertReview(input);assert.equal(r.unresolved_questions.length,1);
});
test('explicit player passive references preserve the linked custom identity',()=>{
  const input=fixture('death_immunity',{name:'Death Immunity'});input.roles[0].passiveAbilityId='';
  input.passives=[{playerId:'b',abilityId:'p',name:'Death Immunity'}];assertReview(input);
});
for(const field of ['sourceAbilityId','source_ability_id'])test('explicit player passive '+field+' resolves custom source metadata',()=>{
  const input=fixture('death_immunity',{name:'Death Immunity'});input.roles[0].passiveAbilityId='';
  input.passives=[{playerId:'b',[field]:'p',name:'Death Immunity'}];assertReview(input);
});
test('inactive custom mode creates no review noise, temporary access does',()=>{
  const input=fixture();input.roles[0].passiveAbilityId='';input.roles[0].modes=[{id:'normal',name:'Normal'},{id:'custom',name:'Custom',passiveAbilityIds:['p']}];input.players[1].currentModeId='normal';
  assert.equal(resolve(input).resolution_status,'RESOLVED');
  input.temporaryModeAccess=[{playerId:'b',roleId:'r',modeId:'custom'}];assertReview(input);
});
test('a separate implemented immunity retains its own source identity',()=>{
  const input=fixture('death_immunity',{name:'Death Immunity'});input.abilities.push({id:'known',name:'Death Immunity',standardAbilityId:'death_immunity',activePassive:'PASSIVE',customIdentity:false});input.roles[0].passiveAbilityIds=['p','known'];
  const r=resolve(input);assert.equal(r.resolution_status,'GM_REVIEW_REQUIRED');
  assert.equal(r.passive_results.length,1);assert.equal(r.passive_results[0].ability_id,'known');assert.deepEqual(r.deaths,[]);
});
test('custom-passive warning survives editing and blocks tracker approval',()=>{
  const input=fixture(),r=assertReview(input),payload=finalResolutionPayload(buildResolutionDraft({proposal:r,actions:input.actions,players:input.players}));
  assert.ok(payload.unresolved_questions.some(q=>q.includes('Conditional Plating')));
  assert.equal(buildTrackerResolutionReview({draft:r,roster:input.players,submittedActions:input.actions}).isComplete,false);
});
for(const owner of ['player','mode'])test('structured custom immunity on '+owner+' is not silently dropped',()=>{
  const input=fixture('death_immunity',{name:'Death Immunity'});input.roles[0].passiveAbilityId='';
  if(owner==='player')input.players[1].immunities=[input.abilities[0]];
  else{input.roles[0].modes=[{id:'custom',name:'Custom',immunities:[input.abilities[0]]}];input.players[1].currentModeId='custom';}
  assertReview(input);
});
test('actual Resolve Night handler saves the custom-passive review without calling AI',async()=>{
  const input=fixture(),snapshot={...input,factions:[],statuses:[],grants:[],modes:[],rules:[],precedents:[]},session={id:'custom-passive-session',lock_version:1,cycle:1,phase:'Night',status:'DRAFT',pre_resolution_state:snapshot,submitted_actions:input.actions};
  const saved=[],alerts=[],source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),start=source.indexOf('function nightEngineInput('),end=source.indexOf('\nasync function recalculateSelectedNight(',start);
  const context={currentResolutionSession:()=>session,currentGame:()=>({id:input.gameId}),resolutionPending:false,resolveNightDeterministically:resolve,renderAll:()=>{},refreshAiGmData:async()=>{},showView:()=>{},alert:m=>alerts.push(m),selectedResolutionSessionId:null,loadedResolutionFormId:null,GMCloud:{saveDeterministicResolution:async(...args)=>saved.push(args),adjudicateInteraction:()=>assert.fail('Custom passive review must not invoke active-action AI adjudication')}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.resolve=resolveSelectedNight;',context);
  await context.resolve();assert.deepEqual(alerts,[]);assert.equal(saved.length,1);
  assert.equal(saved[0][2].resolution_status,'GM_REVIEW_REQUIRED');assert.equal(saved[0][2].passive_results.length,0);
});
