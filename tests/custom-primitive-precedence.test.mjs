import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {globalAbilityDefinition} from '../js/global-abilities.js';
import {buildResolutionDraft,finalResolutionPayload} from '../js/resolution-editor.js';

function fixture(name='Personal Instant Kill',field='engineBehavior'){
  const behavior={effect:'CUSTOM',requiresExplicitRule:true,tags:[...globalAbilityDefinition(name).behavior.tags]};
  return {gameId:'custom-primitive-audit',round:1,phase:'Night',
    players:[{id:'actor',name:'Actor',factionId:'den',alive:true},{id:'target',name:'Target',factionId:'town',alive:true},{id:'helper',name:'Helper',factionId:'town',alive:true}],
    factions:[{id:'den',name:'Den'},{id:'town',name:'Town'}],
    abilities:[{id:'custom',name,definition:'Source rule: only works after an unresolved condition.',[field]:behavior}],
    actions:[{id:'custom-action',abilityId:'custom',sourcePlayerId:'actor',targetIds:['target'],playerAbilityGrantId:'synthetic-grant'}]};
}
const row=r=>r.action_results.find(a=>a.action_id==='custom-action');

for(const name of ['Personal Instant Kill','Protect','Convert','Basic Ask','Roleblock'])test('explicit CUSTOM primitive overrides the '+name+' standard-name fallback',()=>{
  const input=fixture(name),before=structuredClone(input),r=resolveNightDeterministically(input);
  assert.equal(row(r).result,'INELIGIBLE_EFFECT');assert.equal(r.resolution_status,'GM_REVIEW_REQUIRED');
  assert.equal(row(r).use_disposition,'NOT_CONSUMED');assert.equal(r.unresolved_interactions.length,1);
  assert.match(r.unresolved_interactions[0].ability.original_text,/unresolved condition/);
  assert.equal(r.observability.ai_fallback_call_count,0);assert.deepEqual(r.deaths,[]);assert.deepEqual(r.status_effects,[]);
  assert.equal(r.player_outcomes.find(p=>p.player_id==='target').faction_id,'town');assert.deepEqual(input,before);
});

test('snake-case ability behavior also prevents execution of the standard fallback',()=>{
  assert.equal(row(resolveNightDeterministically(fixture('Personal Instant Kill','engine_behavior'))).result,'INELIGIBLE_EFFECT');
});

test('action-level CUSTOM behavior overrides an otherwise ordinary ability',()=>{
  const input=fixture();input.actions[0].engineBehavior=input.abilities[0].engineBehavior;delete input.abilities[0].engineBehavior;
  assert.equal(row(resolveNightDeterministically(input)).result,'INELIGIBLE_EFFECT');
});

test('understanding-level CUSTOM behavior remains authoritative',()=>{
  const input=fixture();input.abilities[0].understanding={engine_behavior:input.abilities[0].engineBehavior};delete input.abilities[0].engineBehavior;
  assert.equal(row(resolveNightDeterministically(input)).result,'INELIGIBLE_EFFECT');
});

test('unsupported custom protection cannot protect a player from a known attack',()=>{
  const input=fixture('Protect');input.actions.push({id:'kill',name:'Personal Instant Kill',sourcePlayerId:'helper',targetIds:['target']});
  const r=resolveNightDeterministically(input);assert.equal(row(r).result,'INELIGIBLE_EFFECT');
  assert.equal(r.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,false);
  const payload=finalResolutionPayload(buildResolutionDraft({proposal:r,actions:input.actions,players:input.players}));
  assert.equal(row(payload).result,'INELIGIBLE_EFFECT');assert.equal(payload.action_results.length,2);
});

test('an ordinary explicit standard primitive still executes deterministically',()=>{
  const input=fixture();input.abilities[0].engineBehavior={...globalAbilityDefinition('Personal Instant Kill').behavior};
  const r=resolveNightDeterministically(input);assert.equal(row(r).result,'SUCCESS');assert.equal(r.unresolved_interactions.length,0);
});

test('GM cancellation and reclassification resolve the explicit custom primitive without changing its source',()=>{
  const input=fixture(),first=resolveNightDeterministically(input);
  const cancelled=recalculateNight(first,input,{actionId:'custom-action',actionPatch:{forceResult:'CANCELLED'}});
  assert.equal(row(cancelled).result,'CANCELLED');assert.equal(cancelled.unresolved_interactions.length,0);
  const reviewed=recalculateNight(first,input,{actionId:'custom-action',actionPatch:{standardizedAbilityType:'Personal Instant Kill',resolutionCategory:'KILLS'}});
  assert.equal(row(reviewed).result,'SUCCESS');assert.equal(reviewed.unresolved_interactions.length,0);
  assert.equal(input.abilities[0].engineBehavior.effect,'CUSTOM');
});

test('a CUSTOM primitive is not executable merely because its review flag is false',()=>{
  const input=fixture();input.abilities[0].engineBehavior.requiresExplicitRule=false;
  assert.equal(row(resolveNightDeterministically(input)).result,'INELIGIBLE_EFFECT');
});

test('blocked custom action retains its use and needs no effect adjudication',()=>{
  const input=fixture();input.actions.push({id:'block',name:'Roleblock',sourcePlayerId:'helper',targetIds:['actor']});
  const r=resolveNightDeterministically(input);assert.equal(row(r).result,'BLOCKED');
  assert.equal(row(r).use_disposition,'NOT_CONSUMED');assert.equal(r.unresolved_interactions.length,0);
});

test('an unsupported custom attempt does not create an automatic Reflection trigger',()=>{
  const input=fixture();input.players[1].roleId='mirror';input.roles=[{id:'mirror',name:'Mirror',passives:['Reflection']}];
  const r=resolveNightDeterministically(input);assert.equal(row(r).result,'INELIGIBLE_EFFECT');
  assert.equal(r.passive_results.length,0);assert.deepEqual(row(r).transformation_history,[]);assert.deepEqual(r.deaths,[]);
});

test('pending CUSTOM attempts are not guessed visits for Omega collateral',()=>{
  const input=fixture();input.actions.unshift({id:'omega',name:'Omega Kill',sourcePlayerId:'helper',targetIds:['target']});
  const r=resolveNightDeterministically(input);assert.equal(r.player_outcomes.find(p=>p.player_id==='actor').alive_after_resolution,true);
  assert.equal(r.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,false);
});

test('unsupported CUSTOM attempts do not appear as completed visits in Watch',()=>{
  const input=fixture();input.actions.push({id:'watch',name:'Watch',sourcePlayerId:'helper',targetIds:['target']});
  assert.equal(resolveNightDeterministically(input).action_results.find(a=>a.action_id==='watch').reason,'Watch result: No visitors.');
});

test('a supported isolated adjudication can replace the CUSTOM primitive without rewriting source',()=>{
  const input=fixture();input.aiAdjudications=[{action_id:'custom-action',status:'ADJUDICATED',confidence:'HIGH',standardized_type:'Personal Instant Kill',resolution_category:'KILLS',behavior:{...globalAbilityDefinition('Personal Instant Kill').behavior,requiresExplicitRule:false}}];
  const r=resolveNightDeterministically(input);
  assert.equal(row(r).result,'SUCCESS');assert.equal(r.unresolved_interactions.length,0);
  assert.equal(r.observability.ai_adjudication_count,1);assert.equal(input.abilities[0].engineBehavior.effect,'CUSTOM');
});

test('actual frontend isolates the custom interaction and saves review when adjudication is unresolved',async()=>{
  const input=fixture(),snapshot={...input,roles:[],statuses:[],grants:[],modes:[],rules:[],precedents:[]},
    session={id:'custom-session',lock_version:3,cycle:1,phase:'Night',status:'DRAFT',pre_resolution_state:snapshot,submitted_actions:input.actions},
    saved=[],interactions=[],alerts=[],source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),start=source.indexOf('function nightEngineInput('),end=source.indexOf('\nasync function recalculateSelectedNight(',start);
  const context={currentResolutionSession:()=>session,currentGame:()=>({id:input.gameId}),resolutionPending:false,resolveNightDeterministically,
    renderAll:()=>{},refreshAiGmData:async()=>{},showView:()=>{},alert:m=>alerts.push(m),selectedResolutionSessionId:null,loadedResolutionFormId:null,
    GMCloud:{saveDeterministicResolution:async(...args)=>saved.push(args),adjudicateInteraction:async(...args)=>{interactions.push(args);return {status:'GM_REVIEW_REQUIRED'}}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.resolve=resolveSelectedNight;',context);
  await context.resolve();assert.deepEqual(alerts,[]);assert.equal(interactions.length,1);assert.equal(saved.length,1);
  assert.equal(interactions[0][2].action_id,'custom-action');assert.match(interactions[0][2].ability.original_text,/unresolved condition/);
  assert.equal(row(saved[0][2]).result,'INELIGIBLE_EFFECT');assert.equal(saved[0][2].resolution_status,'GM_REVIEW_REQUIRED');
  assert.deepEqual(saved[0][2].deaths,[]);
});
