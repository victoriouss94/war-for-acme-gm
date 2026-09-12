import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeAbilityUnderstanding,normalizeTargeting} from '../js/mechanics.js';
import {normalizeAiDocumentImport} from '../js/document-import.js';
import {classifyAbility,globalAbilityDefinition} from '../js/global-abilities.js';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';

const raw=()=>({game:{name:'Custom rule fixture'},factions:[{name:'Town',class_name:'VILLAGER'}],
  abilities:[{name:'Conditional Beam',standard_ability_id:'personal_instant_kill',base_standard_ability_id:'personal_instant_kill',custom_identity:true,definition:'Only kill if the custom trial has been completed.',mechanical_statements:[{type:'EFFECT_ELIGIBILITY',originalText:'Only kill if the custom trial has been completed.',conditions:['Custom trial completed'],confidence:1,interpretationState:'VERIFIED'}]}],
  roles:[{name:'Trial Keeper',faction_name:'Town',ability_names:['Conditional Beam']}],rules:[]});
function materialize(imported){
  const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),start=source.indexOf('function materializeAbility('),end=source.indexOf('\nfunction importedRoleModeModel(',start),abilities=[],byName=new Map();
  const context={normalizeAbilityUnderstanding,normalizeTargeting,classifyAbility,normalized:v=>String(v).toLowerCase(),id:()=> 'local-custom',catalogAbilityFor:()=>({name:'Personal Instant Kill',stableId:'personal_instant_kill'}),importDraft:null};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.materialize=materializeAbility;',context);
  return context.materialize(imported,'local-game',abilities,byName);
}
function input(ability){return {gameId:'local-game',round:1,phase:'Night',abilities:[ability],players:[{id:'actor',name:'Actor',alive:true},{id:'target',name:'Target',alive:true}],actions:[{id:'shot',abilityId:ability.id,sourcePlayerId:'actor',targetIds:['target']}]};}

for(const field of ['customIdentity','custom_identity'])test('normalizer retains top-level '+field,()=>{
  assert.equal(normalizeAbilityUnderstanding({name:'Conditional Beam',standardAbilityId:'personal_instant_kill',[field]:true}).customIdentity,true);
});
test('explicit nested identity remains authoritative and explicit false is preserved',()=>{
  assert.equal(normalizeAbilityUnderstanding({name:'Beam',customIdentity:false,understanding:{customIdentity:true}}).customIdentity,true);
  assert.equal(normalizeAbilityUnderstanding({name:'Beam',customIdentity:false,mapping:'CUSTOM',baseStandardAbilityId:'personal_instant_kill'}).customIdentity,false);
});
test('standard-base custom mapping retains its declared custom identity',()=>{
  assert.equal(normalizeAbilityUnderstanding({name:'Beam',mapping:'STANDARD_BASE_WITH_CUSTOM_IDENTITY',baseStandardAbilityId:'personal_instant_kill'}).customIdentity,true);
});
test('AI import normalization preserves custom_identity and conditional source text',()=>{
  const model=normalizeAiDocumentImport(raw(),{fileName:'synthetic.docx'}),ability=model.abilities[0];
  assert.equal(ability.understanding.customIdentity,true);assert.equal(ability.baseStandardAbilityId,'personal_instant_kill');
  assert.match(ability.understanding.mechanics[0].originalText,/custom trial/);
});
test('actual import materialization and engine do not replace a custom identity with its base kill',()=>{
  const model=normalizeAiDocumentImport(raw(),{fileName:'synthetic.docx'}),ability=materialize(model.abilities[0]),r=resolveNightDeterministically(input(ability));
  assert.equal(ability.understanding.customIdentity,true);assert.equal(ability.name,'Conditional Beam');
  assert.equal(r.action_results[0].result,'INELIGIBLE_EFFECT');assert.equal(r.resolution_status,'GM_REVIEW_REQUIRED');assert.deepEqual(r.deaths,[]);
  assert.match(r.unresolved_interactions[0].ability.original_text,/custom trial/);
});
test('a stored custom identity without executable review cannot use the base standard',()=>{
  const r=resolveNightDeterministically(input({id:'beam',name:'Beam',standardAbilityId:'personal_instant_kill',understanding:{customIdentity:true}}));
  assert.equal(r.action_results[0].result,'INELIGIBLE_EFFECT');assert.deepEqual(r.deaths,[]);
});
test('an inferred default engine behavior does not erase custom identity',()=>{
  const r=resolveNightDeterministically(input({id:'beam',name:'Beam',standardAbilityId:'personal_instant_kill',understanding:{customIdentity:true},engineBehavior:{...globalAbilityDefinition('Personal Instant Kill').behavior}}));
  assert.equal(r.action_results[0].result,'INELIGIBLE_EFFECT');
});
test('explicit reviewed supported behavior can execute a custom identity',()=>{
  const r=resolveNightDeterministically(input({id:'beam',name:'Beam',standardAbilityId:'personal_instant_kill',understanding:{customIdentity:true},engineBehavior:{...globalAbilityDefinition('Personal Instant Kill').behavior,requiresExplicitRule:false}}));
  assert.equal(r.action_results[0].result,'SUCCESS');assert.equal(r.unresolved_interactions.length,0);
});
test('plain renamed standard abilities still execute without AI or review',()=>{
  const r=resolveNightDeterministically(input({id:'beam',name:'Beam',standardAbilityId:'personal_instant_kill',understanding:{customIdentity:false}}));
  assert.equal(r.action_results[0].result,'SUCCESS');assert.equal(r.observability.ai_fallback_call_count,0);
});
test('GM reclassification resolves the imported custom identity without changing source',()=>{
  const ability=materialize(normalizeAiDocumentImport(raw(),{fileName:'synthetic.docx'}).abilities[0]),data=input(ability),first=resolveNightDeterministically(data);
  const corrected=recalculateNight(first,data,{actionId:'shot',actionPatch:{standardizedAbilityType:'Personal Instant Kill',resolutionCategory:'KILLS'}});
  assert.equal(corrected.action_results[0].result,'SUCCESS');assert.equal(ability.understanding.customIdentity,true);
});

test('recognized standard names do not erase an explicit imported custom identity',()=>{
  const source=raw();source.abilities[0].name='Personal Instant Kill';source.roles[0].ability_names=['Personal Instant Kill'];
  const ability=normalizeAiDocumentImport(source,{fileName:'synthetic.docx'}).abilities[0];
  assert.equal(ability.mapping,'STANDARDIZED');assert.equal(ability.understanding.customIdentity,true);
  assert.equal(resolveNightDeterministically(input(materialize(ability))).action_results[0].result,'INELIGIBLE_EFFECT');
});

test('stored top-level snake-case custom identity also requires review',()=>{
  const r=resolveNightDeterministically(input({id:'beam',name:'Beam',standardAbilityId:'personal_instant_kill',custom_identity:true}));
  assert.equal(r.action_results[0].result,'INELIGIBLE_EFFECT');
});

test('blocking a custom identity prevents execution without effect adjudication',()=>{
  const data=input({id:'beam',name:'Beam',standardAbilityId:'personal_instant_kill',understanding:{customIdentity:true}});
  data.actions.unshift({id:'block',name:'Roleblock',sourcePlayerId:'target',targetIds:['actor']});
  const r=resolveNightDeterministically(data);
  assert.equal(r.action_results.find(a=>a.action_id==='shot').result,'BLOCKED');assert.equal(r.unresolved_interactions.length,0);assert.deepEqual(r.deaths,[]);
});

test('isolated supported adjudication resolves custom identity without altering its source',()=>{
  const ability={id:'beam',name:'Beam',standardAbilityId:'personal_instant_kill',understanding:{customIdentity:true}},data=input(ability);
  data.aiAdjudications=[{action_id:'shot',status:'ADJUDICATED',confidence:'HIGH',standardized_type:'Personal Instant Kill',resolution_category:'KILLS',behavior:{...globalAbilityDefinition('Personal Instant Kill').behavior,requiresExplicitRule:false}}];
  const context=resolveNightDeterministically({...data,aiAdjudications:[]}).unresolved_interactions[0];Object.assign(data.aiAdjudications[0],{interaction_id:context.interaction_id,source_context_signature:context.source_context_signature});
  const r=resolveNightDeterministically(data);assert.equal(r.action_results[0].result,'SUCCESS');
  assert.equal(r.unresolved_interactions.length,0);assert.equal(ability.understanding.customIdentity,true);
});
