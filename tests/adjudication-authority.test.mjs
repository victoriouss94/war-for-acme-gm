import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolveNightDeterministically as resolve} from '../js/night-engine.js';
import {globalAbilityDefinition} from '../js/global-abilities.js';

const adjudication=(name)=>({action_id:'attempt',interaction_id:'unknown:attempt',status:'ADJUDICATED',confidence:'HIGH',standardized_type:name,resolution_category:globalAbilityDefinition(name).resolutionCategory,behavior:{...globalAbilityDefinition(name).behavior,requiresExplicitRule:false}});
const fixture=(name,source={})=>({gameId:'synthetic-authority',round:1,phase:'Night',players:[{id:'actor',name:'Actor',alive:true},{id:'target',name:'Target',alive:true}],abilities:[{id:'ability',name,...source}],actions:[{id:'attempt',name,abilityId:'ability',sourcePlayerId:'actor',targetIds:['target']}],aiAdjudications:[]});

for(const [name,replacement] of [['Basic Ask','Personal Instant Kill'],['Personal Instant Kill','Mark'],['Protect','Poison']])test('saved AI cannot replace currently executable '+name,()=>{
  const input=fixture(name),baseline=resolve(input);
  input.aiAdjudications=[adjudication(replacement)];
  const before=structuredClone(input),result=resolve(input);
  assert.deepEqual(result.deaths,baseline.deaths);
  assert.deepEqual(result.status_effects,baseline.status_effects);
  assert.equal(result.action_results[0].standardized_ability_type,name);
  assert.equal(result.action_results[0].resolution_category,baseline.action_results[0].resolution_category);
  assert.equal(result.action_results[0].reason,baseline.action_results[0].reason);
  assert.equal(result.observability.ai_fallback_call_count,0);
  assert.ok(result.engine_trace.some(item=>item.action_id==='attempt'&&item.summary.includes('adjudication ignored')));
  assert.deepEqual(input,before);
});

test('explicit executable role behavior remains above saved AI interpretation',()=>{
  const input=fixture('Personal Instant Kill',{engineBehavior:{...globalAbilityDefinition('Personal Instant Kill').behavior,killTier:2,requiresExplicitRule:false}});
  input.players.push({id:'helper',name:'Helper',alive:true});input.actions.push({id:'shield',name:'Protect',sourcePlayerId:'helper',targetIds:['target']});
  input.aiAdjudications=[adjudication('Basic Ask')];
  const result=resolve(input);
  assert.deepEqual(result.deaths,['Target']);
  assert.equal(result.observability.ai_fallback_call_count,0);
});

test('a currently unresolved custom interaction still uses isolated adjudication',()=>{
  const input=fixture('Temporal Strike'),context=resolve(input).unresolved_interactions[0];input.aiAdjudications=[{...adjudication('Personal Instant Kill'),source_context_signature:context.source_context_signature}];
  const result=resolve(input);
  assert.deepEqual(result.deaths,['Target']);assert.equal(result.observability.ai_fallback_call_count,1);
});

test('actual saved-session Resolve Night persists the source rule without another AI request',async()=>{
  const input=fixture('Basic Ask'),snapshot={...input,roles:[],factions:[],statuses:[],grants:[],modes:[],rules:[],precedents:[]};
  const session={id:'session',lock_version:7,cycle:1,phase:'Night',status:'DRAFT',pre_resolution_state:snapshot,submitted_actions:input.actions,ai_adjudications:[adjudication('Personal Instant Kill')]};
  const before=structuredClone(session),saved=[],alerts=[],source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),start=source.indexOf('function nightEngineInput('),end=source.indexOf('\nasync function recalculateSelectedNight(',start);
  const context={currentResolutionSession:()=>session,currentGame:()=>({id:input.gameId}),resolutionPending:false,resolveNightDeterministically:resolve,
    renderAll:()=>{},refreshAiGmData:async()=>{},showView:()=>{},alert:message=>alerts.push(message),selectedResolutionSessionId:null,loadedResolutionFormId:null,
    GMCloud:{saveDeterministicResolution:async(...args)=>saved.push(args),adjudicateInteraction:async()=>{assert.fail('Known rules must not invoke AI')}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.resolve=resolveSelectedNight;',context);
  await context.resolve();assert.deepEqual(alerts,[]);assert.equal(saved.length,1);
  assert.equal(saved[0][0],'session');assert.equal(saved[0][1],7);
  assert.equal(saved[0][2].resolution_status,'RESOLVED');assert.deepEqual(saved[0][2].deaths,[]);
  assert.equal(saved[0][2].action_results[0].standardized_ability_type,'Basic Ask');
  assert.equal(saved[0][2].observability.ai_fallback_call_count,0);assert.deepEqual(session,before);
});
