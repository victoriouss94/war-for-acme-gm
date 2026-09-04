import test from 'node:test';
import assert from 'node:assert/strict';
import {GLOBAL_RESOLUTION_ORDER,globalAbilityDefinition} from '../js/global-abilities.js';
import {NIGHT_ENGINE_EVENTS,NIGHT_ENGINE_STATUSES,buildNightSnapshot,recalculateNight,resolveNightDeterministically} from '../js/night-engine.js';

const factions=[{id:'village',name:'Villagers'},{id:'den',name:'Den'},{id:'neutral',name:'Neutral'}];
const players=Array.from({length:12},(_,index)=>({id:`p${index+1}`,name:`Player ${index+1}`,alive:true,roleId:`r${index+1}`,currentFactionId:index===1?'den':'village',currentModeId:index===9?'mode-a':''}));
const roles=players.map((player,index)=>({id:player.roleId,name:`Role ${index+1}`,tags:[],passives:[],version:1}));
const action=(id,name,actor,target,extra={})=>({id,name,sourcePlayerId:actor,targetIds:Array.isArray(target)?target:[target].filter(Boolean),...extra});
const run=(actions,extra={})=>resolveNightDeterministically({gameId:'game',resolutionId:'resolution',round:3,phase:'Night',players,roles,factions,actions,...extra});
const result=(resolution,id)=>resolution.action_results.find(item=>item.action_id===id);
const outcome=(resolution,id)=>resolution.player_outcomes.find(item=>item.player_id===id);

test('executable encyclopedia publishes effects, tags, and the exact stage order',()=>{
  assert.deepEqual(GLOBAL_RESOLUTION_ORDER,['BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC']);
  assert.equal(globalAbilityDefinition('Personal Instant Kill').behavior.effect,'ATTEMPT_KILL');
  assert.ok(globalAbilityDefinition('Personal Instant Kill').behavior.tags.includes('PROTECTABLE'));
  assert.equal(globalAbilityDefinition('Protect').behavior.protectionTier,1);
  assert.equal(globalAbilityDefinition('Super Protect').behavior.protectionTier,2);
  assert.ok(NIGHT_ENGINE_EVENTS.includes('PLAYER_TARGETED_BY_KILL'));
  assert.ok(NIGHT_ENGINE_STATUSES.includes('RESOLUTION_ERROR'));
});

test('snapshot is a deep copy and simulation never mutates live input',()=>{
  const original=structuredClone(players),snapshot=buildNightSnapshot({gameId:'g',players});
  snapshot.players[0].alive=false;
  assert.deepEqual(players,original);
});

test('Roleblock prevents a normal Personal Instant Kill',()=>{
  const resolution=run([action('block','Roleblock','p3','p1'),action('kill','Personal Instant Kill','p1','p4')]);
  assert.equal(result(resolution,'kill').result,'BLOCKED');
  assert.equal(outcome(resolution,'p4').alive_after_resolution,true);
});

test('Guarantee restores execution after Roleblock but does not bypass Protect',()=>{
  const resolution=run([action('block','Roleblock','p3','p1'),action('guarantee','Action Success Guarantee','p5','p1'),action('protect','Protect','p6','p4'),action('kill','Personal Instant Kill','p1','p4')]);
  assert.equal(result(resolution,'kill').result,'FAILURE');
  assert.equal(result(resolution,'kill').protected,true);
  assert.equal(outcome(resolution,'p4').alive_after_resolution,true);
});

test('normal Protect stops PIK, Super Kill bypasses Protect, and Super Protect stops Super Kill',()=>{
  const normal=run([action('protect','Protect','p2','p4'),action('kill','Personal Instant Kill','p1','p4')]);
  assert.equal(result(normal,'kill').result,'FAILURE');assert.equal(outcome(normal,'p4').alive_after_resolution,true);
  const bypass=run([action('protect','Protect','p2','p4'),action('kill','Super Kill','p1','p4')]);
  assert.equal(outcome(bypass,'p4').alive_after_resolution,false);
  const superProtected=run([action('protect','Super Protect','p2','p4'),action('kill','Super Kill','p1','p4')]);
  assert.equal(outcome(superProtected,'p4').alive_after_resolution,true);
});

test('Place Swap transforms Kill and Intel destinations while retaining original targets',()=>{
  const resolution=run([action('swap','Place Swap','p3',['p4','p5']),action('ask','Basic Ask','p6','p4'),action('kill','Personal Instant Kill','p1','p4')]);
  assert.deepEqual(result(resolution,'ask').original_target_ids,['p4']);
  assert.deepEqual(result(resolution,'ask').final_target_ids,['p5']);
  assert.deepEqual(result(resolution,'kill').final_target_ids,['p5']);
  assert.equal(outcome(resolution,'p5').alive_after_resolution,false);
});

test('Redirect and Guard preserve complete target transformation history',()=>{
  const resolution=run([action('redirect','Redirect','p3','p4',{parameters:{fromTargetId:'p4',redirectTargetId:'p5',targetActionId:'kill'}}),action('guard','Guard','p6','p5'),action('kill','Personal Instant Kill','p1','p4')]);
  assert.deepEqual(result(resolution,'kill').final_target_ids,['p6']);
  assert.deepEqual(result(resolution,'kill').transformation_history.map(item=>item.type),['REDIRECT','GUARD']);
});

test('Reflection is an automatic passive, never a submitted action',()=>{
  const passiveRoles=structuredClone(roles);passiveRoles.find(item=>item.id==='r4').passives=['Reflection'];
  const resolution=run([action('kill','Personal Instant Kill','p1','p4')],{roles:passiveRoles});
  assert.deepEqual(result(resolution,'kill').final_target_ids,['p1']);
  assert.equal(resolution.passive_results.some(item=>item.ability_name==='Reflection'&&item.triggered),true);
  assert.equal(resolution.action_results.length,1);
});

test('Ability Amplify upgrades PIK strength without adding an independent attempt',()=>{
  const resolution=run([action('amplify','Ability Amplify','p3','p1'),action('protect','Protect','p6','p4'),action('kill','Personal Instant Kill','p1','p4')]);
  assert.equal(result(resolution,'kill').standardized_ability_type,'Super Kill');
  assert.equal(outcome(resolution,'p4').alive_after_resolution,false);
  assert.equal(resolution.action_results.length,3);
});

test('Convert updates effective faction and removes old role before Kills',()=>{
  const resolution=run([action('convert','Convert','p2','p4',{sourceFactionId:'den'}),action('kill','Personal Instant Kill','p1','p4')]);
  assert.equal(outcome(resolution,'p4').faction_id,'den');
  assert.equal(outcome(resolution,'p4').role_id,'');
  assert.equal(outcome(resolution,'p4').alive_after_resolution,false);
});

test('Save handles pending death in DOC and Heal removes Poison without a blank result',()=>{
  const saved=run([action('kill','Personal Instant Kill','p1','p4'),action('save','Save','p2','p4')]);
  assert.equal(result(saved,'save').result,'SUCCESS');assert.equal(outcome(saved,'p4').alive_after_resolution,true);
  const healed=run([action('poison','Poison','p1','p4'),action('heal','Heal','p2','p4')]);
  assert.equal(result(healed,'heal').result,'SUCCESS');
  assert.deepEqual(healed.status_effects,[]);
});

test('Den Block prevents Den Regular Kill; Guarantee can restore execution',()=>{
  const blocked=run([action('block','Den Block','p3',null,{parameters:{targetFactionId:'den'}}),action('kill','Den Regular Kill','p2','p4',{sourceFactionId:'den'})]);
  assert.equal(result(blocked,'kill').result,'BLOCKED');
  const guaranteed=run([action('block','Den Block','p3',null,{parameters:{targetFactionId:'den'}}),action('guarantee','Action Success Guarantee','p5','p2'),action('kill','Den Regular Kill','p2','p4',{sourceFactionId:'den'})]);
  assert.equal(result(guaranteed,'kill').result,'SUCCESS');assert.equal(outcome(guaranteed,'p4').alive_after_resolution,false);
});

test('Counterattack generates a child kill and Bulletproof prevents lethal effect',()=>{
  const passiveRoles=structuredClone(roles);passiveRoles.find(item=>item.id==='r4').passives=['Counterattack'];passiveRoles.find(item=>item.id==='r1').passives=['Bulletproof / Passive Immunity'];
  const resolution=run([action('kill','Personal Instant Kill','p1','p4')],{roles:passiveRoles});
  assert.equal(resolution.passive_results.some(item=>item.ability_name==='Counterattack'),true);
  assert.ok(resolution.observability.generated_effect_count>=1);
  assert.equal(outcome(resolution,'p1').alive_after_resolution,true);
});

test('mode-specific immunity is active only in the current or temporarily accessible mode',()=>{
  const passives=[{playerId:'p10',modeId:'mode-a',name:'Death Immunity'}];
  const current=run([action('kill','Super Kill','p1','p10')],{passives});assert.equal(outcome(current,'p10').alive_after_resolution,true);
  const changed=structuredClone(players);changed.find(item=>item.id==='p10').currentModeId='mode-b';
  const inactive=resolveNightDeterministically({gameId:'g',resolutionId:'m2',players:changed,roles,factions,passives,actions:[action('kill','Super Kill','p1','p10')]});assert.equal(outcome(inactive,'p10').alive_after_resolution,false);
  const temporary=resolveNightDeterministically({gameId:'g',resolutionId:'m3',players:changed,roles,factions,passives,temporaryModeAccess:[{playerId:'p10',modeId:'mode-a'}],actions:[action('kill','Super Kill','p1','p10')]});assert.equal(outcome(temporary,'p10').alive_after_resolution,true);
});

test('runtime mode state activates mechanics stored on the role configuration',()=>{
  const configuredRoles=structuredClone(roles);configuredRoles.find(item=>item.id==='r10').modes=[{id:'mode-a',name:'Shield Form',immunities:['Death Immunity']},{id:'mode-b',name:'Open Form',immunities:[]}];
  const resolution=run([action('kill','Super Kill','p1','p10')],{roles:configuredRoles,modes:[{player_id:'p10',current_mode_id:'mode-a'}]});
  assert.equal(outcome(resolution,'p10').alive_after_resolution,true);
});

test('Control generates an action once and deterministic replay preserves the random result',()=>{
  const control=action('control','Wheel','p3','p4',{resolutionCategory:'CONTROL',engineBehavior:{effect:'GENERATE_ACTION',tags:['ACTIVE_ACTION','BLOCKABLE']},parameters:{controlPool:['Protect','Super Kill']}}),input={gameId:'g',resolutionId:'random',players,roles,factions,seed:'fixed',actions:[control]};
  const first=resolveNightDeterministically(input),second=resolveNightDeterministically({...input,randomOutcomes:first.random_outcomes});
  assert.deepEqual(second.random_outcomes,first.random_outcomes);
  assert.equal(first.observability.generated_effect_count,1);
  assert.equal(first.action_results.length,1);
});

test('unknown custom interactions are isolated while deterministic actions still resolve',()=>{
  const resolution=run([action('custom','Temporal Collapse','p3','p5'),action('kill','Personal Instant Kill','p1','p4')]);
  assert.equal(resolution.resolution_status,'GM_REVIEW_REQUIRED');
  assert.equal(resolution.unresolved_interactions.length,1);
  assert.equal(result(resolution,'custom').result,'INELIGIBLE_EFFECT');
  assert.equal(result(resolution,'kill').result,'SUCCESS');
  assert.equal(outcome(resolution,'p4').alive_after_resolution,false);
});

test('one compact AI adjudication can map an unknown action without taking over the night',()=>{
  const custom=action('custom','Temporal Strike','p3','p4'),adjudication={interaction_id:'unknown:custom',action_id:'custom',status:'ADJUDICATED',standardized_type:'Personal Instant Kill',resolution_category:'KILLS',behavior:{effect:'ATTEMPT_KILL',killTier:1,tags:['ACTIVE_ACTION','BLOCKABLE','REDIRECTABLE','REFLECTABLE','PROTECTABLE'],requiresExplicitRule:false},confidence:'HIGH'};
  const resolution=run([custom],{aiAdjudications:[adjudication]});
  assert.equal(resolution.resolution_status,'RESOLVED_WITH_AI_ASSISTANCE');
  assert.equal(result(resolution,'custom').result,'SUCCESS');
  assert.equal(outcome(resolution,'p4').alive_after_resolution,false);
  assert.equal(resolution.observability.ai_adjudication_count,1);
});

test('GM correction recalculation reuses random outcomes and records earliest affected stage',()=>{
  const input={gameId:'g',resolutionId:'recalc',players,roles,factions,seed:'fixed',actions:[action('control','Wheel','p3','p4',{resolutionCategory:'CONTROL',engineBehavior:{effect:'GENERATE_ACTION',tags:['ACTIVE_ACTION']},parameters:{controlPool:['Protect','Super Kill']}})]},first=resolveNightDeterministically(input),next=recalculateNight(first,input,{earliestStage:'CONTROL',rules:[{name:'GM correction'}]});
  assert.deepEqual(next.random_outcomes,first.random_outcomes);
  assert.equal(next.recalculation.earliest_affected_stage,'CONTROL');
  assert.equal(next.recalculation.random_outcomes_reused,true);
});

test('GM action correction recalculates downstream death state',()=>{
  const input={gameId:'g',resolutionId:'death-recalc',players,roles,factions,actions:[action('kill','Personal Instant Kill','p1','p4')]},first=resolveNightDeterministically(input),next=recalculateNight(first,input,{earliestStage:'KILLS',actionId:'kill',actionPatch:{forceResult:'FAILURE',forceReason:'Custom role rule prevents this attack.'}});
  assert.equal(outcome(first,'p4').alive_after_resolution,false);
  assert.equal(result(next,'kill').result,'FAILURE');
  assert.equal(outcome(next,'p4').alive_after_resolution,true);
  assert.equal(next.recalculation.earliest_affected_stage,'KILLS');
});

test('Villagers Block prevents Villager actions',()=>{
  const resolution=run([action('block','Villagers Block','p2',null,{parameters:{targetFactionId:'village'}}),action('ask','Basic Ask','p3','p4',{sourceFactionId:'village'})]);
  assert.equal(result(resolution,'ask').result,'BLOCKED');
});

test('Omega Kill includes players visiting the effective target',()=>{
  const resolution=run([action('visit','Basic Ask','p5','p4'),action('omega','Omega Kill','p1','p4')]);
  assert.equal(outcome(resolution,'p4').alive_after_resolution,false);
  assert.equal(outcome(resolution,'p5').alive_after_resolution,false);
});

test('mode-specific actions require current or temporary mode access',()=>{
  const inaccessible=run([action('kill','Personal Instant Kill','p10','p4',{modeId:'mode-b'})]);
  assert.equal(result(inaccessible,'kill').result,'INELIGIBLE_EFFECT');
  const temporary=run([action('kill','Personal Instant Kill','p10','p4',{modeId:'mode-b'})],{temporaryModeAccess:[{playerId:'p10',modeId:'mode-b'}]});
  assert.equal(result(temporary,'kill').result,'SUCCESS');
});

test('a satisfied Mark generates a kill without adding a submitted attempt',()=>{
  const resolution=run([action('mark','Mark','p3','p4',{parameters:{conditionMet:true}})]);
  assert.equal(resolution.action_results.length,1);
  assert.equal(resolution.observability.generated_effect_count,1);
  assert.equal(outcome(resolution,'p4').alive_after_resolution,false);
});

test('a prevented kill does not inherit a previous attack success',()=>{
  const resolution=run([action('first','Personal Instant Kill','p1','p4'),action('shield','Protect','p2','p5'),action('second','Personal Instant Kill','p3','p5')]);
  assert.equal(result(resolution,'first').result,'SUCCESS');
  assert.equal(result(resolution,'second').result,'FAILURE');
  assert.equal(outcome(resolution,'p5').alive_after_resolution,true);
});

test('same-night Heal cancels a proposed Poison without inventing a persisted status ID',()=>{
  const resolution=run([action('poison','Poison','p1','p4'),action('heal','Heal','p2','p4')]);
  assert.equal(result(resolution,'heal').result,'SUCCESS');
  assert.deepEqual(resolution.status_effects,[]);
});

test('faction blocks report affected players rather than a faction ID',()=>{
  const resolution=run([action('block','Den Block','p3',null,{parameters:{targetFactionId:'den'}})]);
  assert.ok(result(resolution,'block').affected_player_ids.every(id=>players.some(player=>player.id===id)));
});

test('Save cannot remove a Super Kill even when a standard death is also pending',()=>{
  const resolution=run([action('first','Personal Instant Kill','p1','p4'),action('second','Super Kill','p3','p4'),action('save','Save','p2','p4')]);
  assert.equal(outcome(resolution,'p4').alive_after_resolution,false);
});

test('AI-mapped kills retain normal blocking and protection behavior',()=>{
  const adjudication={interaction_id:'unknown:custom',action_id:'custom',status:'ADJUDICATED',standardized_type:'Personal Instant Kill',resolution_category:'KILLS',behavior:{effect:'ATTEMPT_KILL',killTier:1,tags:['ACTIVE_ACTION','BLOCKABLE','PROTECTABLE'],requiresExplicitRule:false},confidence:'HIGH'};
  const resolution=run([action('block','Roleblock','p2','p3'),action('custom','Temporal Strike','p3','p4')],{aiAdjudications:[adjudication]});
  assert.equal(result(resolution,'custom').result,'BLOCKED');
  assert.equal(outcome(resolution,'p4').alive_after_resolution,true);
});

test('unknown AI mappings stay reviewable rather than returning PENDING',()=>{
  const resolution=run([action('custom','Temporal Strike','p3','p4')],{aiAdjudications:[{action_id:'custom',status:'ADJUDICATED',standardized_type:'Temporal Strike',resolution_category:'SWAPS',behavior:{effect:'CUSTOM',requiresExplicitRule:false},confidence:'HIGH'}]});
  assert.equal(resolution.resolution_status,'GM_REVIEW_REQUIRED');
  assert.equal(result(resolution,'custom').result,'INELIGIBLE_EFFECT');
});

test('conversion removes old configuration immunity and uses the actor faction by default',()=>{
  const configuredRoles=structuredClone(roles);configuredRoles.find(item=>item.id==='r4').modes=[{id:'shield',name:'Shield',immunities:['Death Immunity']}];
  const resolution=run([action('convert','Convert','p2','p4'),action('kill','Personal Instant Kill','p1','p4')],{roles:configuredRoles,modes:[{player_id:'p4',current_mode_id:'shield'}]});
  assert.equal(outcome(resolution,'p4').role_id,'');
  assert.equal(outcome(resolution,'p4').mode_after_resolution,'');
  assert.equal(outcome(resolution,'p4').alive_after_resolution,false);
});

test('Capture is a deterministic current-night status and blocks later active actions without AI',()=>{
  const resolution=run([action('capture','Capture','p1','p3'),action('ask','Basic Ask','p3','p4')]);
  assert.equal(result(resolution,'capture').result,'SUCCESS');
  assert.equal(result(resolution,'ask').result,'BLOCKED');
  const status=resolution.status_effects.find(item=>item.player_id==='p3'&&item.status_type==='ABILITIES_DISABLED');
  assert.equal(status.status_name,'Captured');
  assert.deepEqual(status.metadata,{abilitiesDisabled:true,disabledCycle:3,disabledPhase:'Night'});
  assert.equal(resolution.observability.ai_fallback_call_count,0);
  assert.equal(resolution.unresolved_interactions.length,0);
});

test('Role Swap exchanges temporary role context for passives but never persists role or faction changes',()=>{
  const swappedRoles=structuredClone(roles);swappedRoles.find(item=>item.id==='r4').passives=['Death Immunity'];
  const resolution=run([action('swap','Role Swap','p3',['p4','p5']),action('kill','Super Kill','p1','p5')],{roles:swappedRoles});
  assert.equal(result(resolution,'swap').result,'SUCCESS');
  assert.equal(result(resolution,'kill').result,'FAILURE');
  assert.equal(outcome(resolution,'p5').alive_after_resolution,true);
  assert.equal(outcome(resolution,'p4').role_id,'r4');
  assert.equal(outcome(resolution,'p5').role_id,'r5');
  assert.equal(resolution.observability.ai_fallback_call_count,0);
});

test('Steal updates a structured finite-use grant and Duel uses a declared or persisted winner',()=>{
  const grant={id:'grant-1',playerId:'p4',abilityId:'ability-1',sourceType:'ROLE',sourceReference:'r4',usesRemaining:3,version:2,stealable:true};
  const stolen=run([action('steal','Steal','p3','p4',{parameters:{targetGrantId:'grant-1',uses:1}})],{grants:[grant]});
  assert.equal(result(stolen,'steal').result,'SUCCESS');
  assert.equal(stolen.grant_effects[0].operation,'SET_USES');
  assert.equal(stolen.grant_effects[0].uses,2);
  const duel=run([action('duel','Duel / Fight','p1','p4',{parameters:{winnerId:'p1'}})]);
  assert.equal(result(duel,'duel').result,'SUCCESS');
  assert.equal(outcome(duel,'p4').alive_after_resolution,false);
  assert.equal(duel.observability.ai_fallback_call_count,0);
});

test('diagnostics count only AI adjudications actually used by the canonical resolver',()=>{
  const resolution=run([action('ask','Basic Ask','p1','p2')],{aiAdjudications:[{action_id:'not-present',status:'ADJUDICATED',resolution_category:'INTEL',behavior:{requiresExplicitRule:false},confidence:'HIGH'}]});
  assert.equal(resolution.observability.ai_fallback_call_count,0);
  assert.equal(resolution.resolution_status,'RESOLVED');
});

test('known-mechanics acceptance night resolves through one engine with zero AI calls',()=>{
  const acceptancePlayers=structuredClone(players),acceptanceRoles=structuredClone(roles);
  acceptanceRoles.find(item=>item.id==='r9').passives=['Counterattack'];
  acceptanceRoles.find(item=>item.id==='r6').passives=['Reflection'];
  acceptanceRoles.find(item=>item.id==='r10').modes=[{id:'mode-a',name:'Defensive Form',immunities:['Death Immunity']}];
  const acceptanceActions=[
    action('block','Roleblock','p4','p1'),
    action('guarantee','Action Success Guarantee','p5','p1'),
    action('swap','Place Swap','p3',['p4','p11']),
    action('guard','Guard','p6','p4'),
    action('capture','Capture','p1','p3'),
    action('mark','Mark','p2','p4',{parameters:{conditionMet:true}}),
    action('watch','Watch','p7','p4'),
    action('ask','Basic Ask','p8','p2'),
    action('mode-ask','Basic Ask','p10','p2',{modeId:'mode-a',modeName:'Defensive Form'}),
    action('protect','Protect','p4','p6'),
    action('convert','Convert','p2','p11',{sourceFactionId:'den'}),
    action('pik','Personal Instant Kill','p1','p9'),
    action('den','Den Regular Kill','p2','p10',{sourceFactionId:'den'}),
    action('save','Save','p8','p9'),
    action('heal','Heal','p12','p4')
  ],resolution=resolveNightDeterministically({gameId:'g',resolutionId:'acceptance',round:3,phase:'Night',players:acceptancePlayers,roles:acceptanceRoles,factions,actions:acceptanceActions,seed:'acceptance',modes:[{player_id:'p10',current_mode_id:'mode-a'}]});
  assert.equal(resolution.observability.canonical_resolver,'resolveNightDeterministically');
  assert.equal(resolution.observability.ai_fallback_call_count,0);
  assert.equal(resolution.observability.submitted_action_count,acceptanceActions.length);
  assert.equal(resolution.unresolved_interactions.length,0);
  assert.ok(resolution.observability.generated_effect_count>=2);
  assert.equal(result(resolution,'capture').result,'SUCCESS');
  assert.equal(result(resolution,'watch').result,'SUCCESS');
  assert.equal(result(resolution,'ask').result,'SUCCESS');
  assert.equal(result(resolution,'den').result,'FAILURE');
  assert.equal(outcome(resolution,'p10').alive_after_resolution,true);
  assert.equal(outcome(resolution,'p4').faction_id,'den');
  assert.ok(resolution.passive_results.some(item=>item.ability_name==='Counterattack'));
  assert.ok(resolution.passive_results.some(item=>item.ability_name==='Reflection'));
  assert.ok(resolution.morning_summary);
});

test('end-to-end eight-player night resolves every stage without mutating input',()=>{
  const e2ePlayers=structuredClone(players.slice(0,9)),before=structuredClone(e2ePlayers),e2eActions=[
    action('block','Roleblock','p3','p1'),
    action('guarantee','Action Success Guarantee','p5','p1'),
    action('control','Wheel','p7','p4',{resolutionCategory:'CONTROL',engineBehavior:{effect:'GENERATE_ACTION',tags:['ACTIVE_ACTION']},parameters:{controlPool:['Personal Instant Kill']}}),
    action('swap','Place Swap','p8',['p4','p6']),
    action('redirect','Redirect','p9','p6',{parameters:{fromTargetId:'p6',redirectTargetId:'p4',targetActionId:'kill'}}),
    action('protect','Protect','p6','p4'),
    action('intel','Basic Ask','p7','p4'),
    action('convert','Convert','p2','p8',{sourceFactionId:'den'}),
    action('kill','Personal Instant Kill','p1','p4'),
    action('save','Save','p5','p4')
  ],resolution=resolveNightDeterministically({gameId:'g',resolutionId:'e2e',round:4,phase:'Night',players:e2ePlayers,roles,factions,actions:e2eActions,seed:'e2e'}),stageStarts=resolution.engine_trace.filter(item=>item.summary.endsWith('stage started.')).map(item=>item.stage);
  assert.deepEqual(e2ePlayers,before);
  assert.equal(resolution.action_results.length,e2eActions.length);
  assert.deepEqual(stageStarts,GLOBAL_RESOLUTION_ORDER);
  assert.ok(resolution.engine_trace.length>GLOBAL_RESOLUTION_ORDER.length*2);
  assert.ok(resolution.observability.generated_effect_count>=1);
  assert.ok(resolution.final_ruling);
  assert.ok(resolution.proposed_state);
  assert.ok(resolution.starting_snapshot_hash);
  assert.equal(resolution.resolution_status,'RESOLVED');
});
