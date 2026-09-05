import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';

const players=['blocker','actor','target','helper'].map(id=>({id,name:id,alive:true}));
const action=(id,name,actor,target,extra={})=>({id,name,sourcePlayerId:actor,targetIds:[target],...extra});
const run=(actions,extra={})=>resolveNightDeterministically({gameId:'audit',round:1,phase:'Night',players,actions,...extra});

test('audit: GM reclassification executes a custom kill and survives replay',()=>{
  const input={players,abilities:[{id:'silas',name:'Silas – Basic hunter — Ability',engineBehavior:{effect:'CUSTOM',requiresExplicitRule:true}}],actions:[action('fox','Silas – Basic hunter — Ability','actor','target',{abilityId:'silas'})]};
  const before=resolveNightDeterministically(input);
  const corrected=recalculateNight(before,input,{actionId:'fox',actionPatch:{standardizedAbilityType:'Personal Instant Kill',resolutionCategory:'KILLS',forceResult:''}});
  for(const result of [corrected,recalculateNight(corrected,input,{})]){
    assert.equal(result.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,false);
    assert.equal(result.unresolved_interactions.length,0);
    assert.equal(result.action_results[0].ability_id,'silas');
  }
  assert.equal(input.abilities[0].engineBehavior.effect,'CUSTOM');
  const protectedInput={...input,actions:[...input.actions,action('protect','Protect','helper','target')]};
  const protectedResult=recalculateNight(before,protectedInput,{actionId:'fox',actionPatch:{standardizedAbilityType:'Personal Instant Kill',resolutionCategory:'KILLS'}});
  assert.equal(protectedResult.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,true);
  const staleAi={action_id:'fox',status:'ADJUDICATED',confidence:'HIGH',standardized_type:'Mark',resolution_category:'STATUS_EFFECTS',behavior:{requiresExplicitRule:false}};
  const reviewed=recalculateNight(corrected,{...input,aiAdjudications:[staleAi]},{});
  assert.equal(reviewed.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,false);
});

test('audit: explicit cancellation of an unclassified attempt does not reopen adjudication',()=>{
  const result=run([action('cancelled','Dylan – Corporate traitor — Ability','actor','target',{forceResult:'CANCELLED',forceReason:'Not a legal targeted action.'})]);
  assert.equal(result.action_results[0].resolution_category,'UNCLASSIFIED');
  assert.equal(result.action_results[0].result,'CANCELLED');
  assert.equal(result.unresolved_interactions.length,0);
  assert.equal(result.action_results[0].reason,'Not a legal targeted action.');
});

test('audit: captured Guarantee provider cannot enable a blocked killer',()=>{
const result=run([action('block','Roleblock','blocker','actor'),action('guarantee','Action Success Guarantee','helper','actor'),action('kill','Personal Instant Kill','actor','target')],{statuses:[{id:'capture',player_id:'helper',status_type:'CAPTURED',state:'ACTIVE',metadata:{abilitiesDisabled:true}}]});
  assert.equal(result.action_results.find(a=>a.action_id==='guarantee').result,'BLOCKED');
  assert.equal(result.action_results.find(a=>a.action_id==='kill').result,'BLOCKED');
  assert.equal(result.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,true);
});

test('audit: recalculation preserves earlier GM corrections on subsequent runs',()=>{
  const input={players,actions:[action('kill','Personal Instant Kill','actor','target')]};
  const first=resolveNightDeterministically(input);
  const corrected=recalculateNight(first,input,{actionId:'kill',actionPatch:{forceResult:'FAILURE'}});
  const again=recalculateNight(corrected,input,{});
  assert.equal(again.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,true);
  assert.equal(again.action_results[0].result,'FAILURE');
});

test('audit: Steal transfers finite uses once without changing the source snapshot',()=>{
  const grants=[{id:'grant',player_id:'target',ability_id:'kill',uses_remaining:1,version:2}];
  const result=run([action('steal','Steal','actor','target',{parameters:{targetGrantId:'grant'}}),action('second','Steal','helper','target',{parameters:{targetGrantId:'grant'}})],{grants});
  assert.equal(result.grant_effects.filter(e=>e.operation==='GRANT').length,1);
  assert.equal(result.grant_effects.find(e=>e.operation==='GRANT').player_id,'actor');
  assert.equal(result.grant_effects.find(e=>e.operation==='GRANT').uses,1);
  assert.equal(result.grant_effects.find(e=>e.operation==='SET_USES').uses,0);
  assert.equal(result.action_results.find(a=>a.action_id==='second').result,'FAILURE');
  assert.equal(grants[0].uses_remaining,1);
});

test('audit: non-stealable grants cannot be transferred',()=>{
  const result=run([action('steal','Steal','actor','target')],{grants:[{id:'grant',player_id:'target',ability_id:'kill',uses_remaining:2,stealable:false}]});
  assert.deepEqual(result.grant_effects,[]);
});

test('audit: Additional Uses creates a player-specific usable grant',()=>{
  const result=run([action('extra','Additional Uses','helper','target',{parameters:{targetGrantId:'grant',uses:2}})],{abilities:[{id:'kill',name:'Personal Instant Kill'}],grants:[{id:'grant',player_id:'target',ability_id:'kill',uses_remaining:0}]});
  assert.equal(result.action_results[0].result,'SUCCESS');
  assert.equal(result.grant_effects[0].operation,'GRANT');
  assert.equal(result.grant_effects[0].player_id,'target');
  assert.equal(result.grant_effects[0].ability_id,'kill');
  assert.equal(result.grant_effects[0].uses,2);
  assert.deepEqual(result.status_effects,[]);
});

test('audit: Additional Uses without an identified ability requires review',()=>{
  const result=run([action('extra','Additional Uses','helper','target')]);
  assert.equal(result.engine_status,'GM_REVIEW_REQUIRED');
  assert.deepEqual(result.grant_effects,[]);
});

test('audit: a blocked Save cannot change a lethal outcome',()=>{
  const result=run([action('block','Roleblock','blocker','helper'),action('kill','Personal Instant Kill','actor','target'),action('save','Save','helper','target')]);
  assert.equal(result.action_results.find(a=>a.action_id==='save').result,'BLOCKED');
  assert.equal(result.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,false);
});

test('audit: blocked kills are not attacks survived',()=>{
  const result=run([action('block','Roleblock','blocker','actor'),action('kill','Personal Instant Kill','actor','target')]);
  assert.deepEqual(result.morning_summary.attacked_but_survived,[]);
});

test('audit: a snapshot retains submitted actions for replay',()=>{
  const result=resolveNightDeterministically({snapshot:{game_id:'audit',round:1,phase:'Night',players,submitted_actions:[action('kill','Personal Instant Kill','actor','target')]}});
  assert.equal(result.action_results.length,1);
  assert.equal(result.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,false);
});

test('audit: a missing actor with a mode does not abort unrelated actions',()=>{
  const result=run([action('invalid','Protect','missing','target',{modeId:'missing-mode'}),action('kill','Personal Instant Kill','actor','target')]);
  assert.notEqual(result.engine_status,'RESOLUTION_ERROR');
  assert.equal(result.action_results.find(a=>a.action_id==='invalid').result,'INELIGIBLE_EFFECT');
  assert.equal(result.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,false);
});

test('audit: Reflection preserves other targets and emits one redirect',()=>{
  const result=run([action('mark','Mark','actor','target',{targetIds:['target','helper']})],{players:players.map(p=>p.id==='target'?{...p,immunities:['Reflection']}:p)});
  assert.deepEqual(result.action_results[0].final_target_ids,['actor','helper']);
  assert.equal(result.events.filter(e=>e.event_type==='REDIRECT').length,1);
});

test('audit: passive ability IDs are resolved through the existing encyclopedia',()=>{
  const result=run([action('kill','Personal Instant Kill','actor','target')],{players:players.map(p=>p.id==='target'?{...p,roleId:'immune'}:p),roles:[{id:'immune',passiveAbilityIds:['immunity']}],abilities:[{id:'immunity',name:'Death Immunity'}]});
  assert.equal(result.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,true);
});

test('audit: a mode Protect defense stops a standard lethal attempt',()=>{
  const result=run([action('kill','Personal Instant Kill','actor','target')],{players:players.map(p=>p.id==='target'?{...p,roleId:'mode-role',currentModeId:'shield'}:p),roles:[{id:'mode-role',modes:[{id:'shield',name:'Shield Form',protections:['Protect']}]}]});
  assert.equal(result.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,true);
});

test('audit: role-wide passive links use the stored role editor field',()=>{
  const result=run([action('kill','Personal Instant Kill','actor','target')],{players:players.map(p=>p.id==='target'?{...p,roleId:'immune'}:p),roles:[{id:'immune',roleWidePassiveAbilityIds:['immunity']}],abilities:[{id:'immunity',name:'Death Immunity'}]});
  assert.equal(result.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,true);
});

test('audit: a blocked Steal cannot remove uses',()=>{
  const result=run([action('block','Roleblock','blocker','actor'),action('steal','Steal','actor','target',{parameters:{targetGrantId:'grant'}})],{grants:[{id:'grant',player_id:'target',ability_id:'kill',uses_remaining:2}]});
  assert.equal(result.action_results.find(a=>a.action_id==='steal').result,'BLOCKED');
  assert.deepEqual(result.grant_effects,[]);
});

test('audit: generated effects whose stage has passed require review, not silent success',()=>{
  const result=run([action('wheel','Wheel','actor','target',{resolutionCategory:'CONTROL',engineBehavior:{effect:'GENERATE_ACTION',tags:['ACTIVE_ACTION','BLOCKABLE']},parameters:{controlPool:[{name:'Roleblock'}]}})]);
  assert.equal(result.observability.generated_effect_count,1);
  assert.equal(result.engine_status,'GM_REVIEW_REQUIRED');
  assert.ok(result.unresolved_interactions.length>0);
});
