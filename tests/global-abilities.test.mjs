import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOBAL_ABILITY_DEFINITIONS,GLOBAL_AUTHORITY_PRECEDENCE,GLOBAL_RESOLUTION_ORDER,
  classifyAbility,classifyAndOrderActions,createGeneratedEffect,globalAbilityDefinition,
  globalInteractionOutcome,globalStatusTiming,normalizeResolutionAction,transformAction
} from '../js/global-abilities.js';

test('global catalog has 37 unique standardized abilities and the exact order',()=>{
  assert.equal(GLOBAL_ABILITY_DEFINITIONS.length,37);
  assert.equal(new Set(GLOBAL_ABILITY_DEFINITIONS.map(item=>item.abilityId)).size,37);
  assert.ok(GLOBAL_ABILITY_DEFINITIONS.every(item=>/^[a-z0-9_]+$/.test(item.abilityId)));
  assert.equal(globalAbilityDefinition('Roleblock').abilityId,'roleblock');
  assert.deepEqual(GLOBAL_RESOLUTION_ORDER,['BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC']);
  assert.deepEqual(GLOBAL_AUTHORITY_PRECEDENCE,['CURRENT_GAME_RULE','ROLE_TEXT','CURRENT_GAME_PRECEDENT','GLOBAL_MASTER_ABILITY_ENCYCLOPEDIA','GLOBAL_PRECEDENT','GM_DECISION']);
  for(const passive of GLOBAL_ABILITY_DEFINITIONS.filter(item=>item.activePassive==='PASSIVE')){assert.equal(passive.resolutionCategory,'PASSIVES');assert.equal(passive.resolutionTiming,'EVENT_TRIGGERED');assert.equal(passive.resolutionPriority,null)}
});

test('1. Roleblock → Action Success Guarantee → Kill distinguishes execution from effect',()=>{
  const allowed=globalInteractionOutcome({action:'Personal Instant Kill',blocked:true,guaranteed:true});
  const defended=globalInteractionOutcome({action:'Personal Instant Kill',defense:'Protect',blocked:true,guaranteed:true});
  assert.equal(allowed.actionAllowed,true);assert.equal(allowed.effectSucceeded,true);
  assert.equal(defended.actionAllowed,true);assert.equal(defended.effectSucceeded,false);
});

test('2. Den Block → Den Regular Kill prevents the faction action by default',()=>{
  assert.equal(classifyAbility({name:'Den Block'}).resolutionPriority,1);
  assert.deepEqual(globalInteractionOutcome({action:'Den Regular Kill',blocked:true}),{actionAllowed:false,effectSucceeded:false,reason:'Applicable action prevention blocked execution.'});
});

test('3. Villagers Block → Villager action prevents an applicable active action',()=>{
  assert.equal(globalAbilityDefinition('Villagers Block').resolutionCategory,'BLOCKS');
  assert.equal(globalInteractionOutcome({action:'Advanced Ask',blocked:true}).actionAllowed,false);
});

test('4. Place Swap → Kill transforms the target before KILLS',()=>{
  const kill=normalizeResolutionAction({id:'kill',name:'Personal Instant Kill',targetIds:['A']});
  const swapped=transformAction(kill,{type:'PLACE_SWAP',fromTargetIds:['A'],toTargetIds:['B'],byActionId:'swap'});
  assert.deepEqual(swapped.originalTargetIds,['A']);assert.deepEqual(swapped.effectiveTargetIds,['B']);assert.equal(swapped.resolutionCategory,'KILLS');
});

test('5. Place Swap → Intel transforms an investigation target',()=>{
  const intel=transformAction({id:'ask',name:'Advanced Ask',targetIds:['B']},{type:'PLACE_SWAP',toTargetIds:['A']});
  assert.equal(intel.resolutionCategory,'INTEL');assert.deepEqual(intel.effectiveTargetIds,['A']);
});

test('6. Redirect → Kill changes the target without resolving the Kill early',()=>{
  const kill=transformAction({id:'kill',name:'Super Kill',targetIds:['B']},{type:'REDIRECT',toTargetIds:['C'],byActionId:'redirect'});
  assert.equal(kill.resolutionPriority,9);assert.deepEqual(kill.effectiveTargetIds,['C']);
});

test('7. Redirect → Protect changes the protection destination',()=>{
  const protect=transformAction({id:'protect',name:'Protect',targetIds:['B']},{type:'REDIRECT',toTargetIds:['C']});
  assert.equal(protect.resolutionCategory,'STATUS_EFFECTS');assert.deepEqual(protect.originalTargetIds,['B']);assert.deepEqual(protect.effectiveTargetIds,['C']);
});

test('8. Guard → Personal Instant Kill transfers the hit rather than cancelling',()=>{
  const guarded=transformAction({id:'kill',name:'Personal Instant Kill',targetIds:['protected']},{type:'GUARD',toTargetIds:['guard']});
  assert.deepEqual(guarded.effectiveTargetIds,['guard']);assert.equal(guarded.status,'QUEUED');
});

test('9. Reflection → Personal Instant Kill sends the action to its original user',()=>{
  const reflected=transformAction({id:'kill',name:'Personal Instant Kill',sourcePlayerId:'attacker',targetIds:['mirror']},{type:'REFLECTION',toTargetIds:['attacker']});
  assert.deepEqual(reflected.originalTargetIds,['mirror']);assert.deepEqual(reflected.effectiveTargetIds,['attacker']);
});

test('10. Protect → Personal Instant Kill stops a normal kill',()=>{
  assert.equal(globalInteractionOutcome({action:'Personal Instant Kill',defense:'Protect'}).effectSucceeded,false);
});

test('11. Protect → Super Kill does not stop the higher tier',()=>{
  assert.equal(globalInteractionOutcome({action:'Super Kill',defense:'Protect'}).effectSucceeded,true);
});

test('12. Super Protect → Super Kill stops the higher tier',()=>{
  assert.equal(globalInteractionOutcome({action:'Super Kill',defense:'Super Protect'}).effectSucceeded,false);
});

test('13. Super Protect → Omega Kill stops the target effect',()=>{
  assert.equal(globalInteractionOutcome({action:'Omega Kill',defense:'Super Protect'}).effectSucceeded,false);
});

test('14. Poison → Heal removes the status and cancels its pending consequence',()=>{
  const poison=globalStatusTiming('Poison'),heal=globalStatusTiming('Heal');
  assert.equal(poison.healCancelsConsequence,true);assert.equal(heal.resolutionTiming,'ANY_TIME');
});

test('15. Poison timer without Heal has the global two-day delay',()=>{
  assert.equal(globalStatusTiming('Poison').delayedDeathAfterDays,2);
});

test('16. Drunk timing is after Night resolution until Hanging',()=>{
  assert.deepEqual(globalStatusTiming('Drunk'),{resolutionCategory:'STATUS_EFFECTS',activates:'AFTER_NIGHT_RESOLUTION',expires:'AFTER_HANGING'});
});

test('17. Sober timing is after Night resolution until Hanging',()=>{
  assert.deepEqual(globalStatusTiming('Sober'),{resolutionCategory:'STATUS_EFFECTS',activates:'AFTER_NIGHT_RESOLUTION',expires:'AFTER_HANGING'});
});

test('18. Convert → Kill in the same cycle is category ordered',()=>{
  const result=classifyAndOrderActions([{id:'kill',name:'Personal Instant Kill'},{id:'convert',name:'Convert'}]);
  assert.deepEqual(result.ordered.map(item=>item.id),['convert','kill']);
  assert.match(globalAbilityDefinition('Convert').definition,/loses the old role and its abilities/i);
});

test('19. Bulletproof → Kill prevents applicable targeted kills',()=>{
  assert.equal(globalInteractionOutcome({action:'Omega Kill',defense:'Bulletproof / Passive Immunity'}).effectSucceeded,false);
});

test('20. Death Immunity → Kill prevents death but is not general non-lethal immunity',()=>{
  assert.equal(globalInteractionOutcome({action:'Super Kill',defense:'Death Immunity'}).effectSucceeded,false);
  assert.equal(globalInteractionOutcome({action:'Advanced Ask',defense:'Death Immunity'}).effectSucceeded,true);
});

test('21. Counterattack passive trigger creates a child effect, not an attempt',()=>{
  const passive=globalAbilityDefinition('Counterattack'),child=createGeneratedEffect({id:'incoming',name:'Personal Instant Kill'},{id:'counter',name:'Personal Instant Kill',targetIds:['attacker']});
  assert.equal(passive.activePassive,'PASSIVE');assert.equal(child.generated,true);assert.equal(child.submittedAttempt,false);assert.equal(child.parentActionId,'incoming');
});

test('22. Control generates an Intel ability that waits for INTEL',()=>{
  const wheel=normalizeResolutionAction({id:'wheel',name:'Wheel Spin',resolutionCategory:'CONTROL'}),child=createGeneratedEffect(wheel,{id:'ask',name:'Advanced Ask',targetIds:['target']});
  assert.equal(wheel.resolutionPriority,3);assert.equal(child.resolutionPriority,7);assert.equal(child.submittedAttempt,false);
});

test('23. Control generates a Kill ability that waits for KILLS',()=>{
  const child=createGeneratedEffect({id:'wheel',name:'Wheel Spin',resolutionCategory:'CONTROL'},{id:'kill',name:'Super Kill',targetIds:['target']});
  assert.equal(child.resolutionCategory,'KILLS');assert.equal(child.resolutionPriority,9);
});

test('24. Mark generates or unlocks a later Kill with parent lineage',()=>{
  const mark=normalizeResolutionAction({id:'mark',name:'Mark',targetIds:['target']}),child=createGeneratedEffect(mark,{id:'mark-kill',name:'Personal Instant Kill',targetIds:['target']});
  assert.equal(mark.resolutionCategory,'STATUS_EFFECTS');assert.equal(child.resolutionCategory,'KILLS');assert.equal(child.parentActionId,'mark');
});

test('25. Heal can resolve outside the normal DOC stage',()=>{
  const result=classifyAndOrderActions([{id:'kill',name:'Personal Instant Kill'},{id:'heal',name:'Heal',triggerPriority:6},{id:'ask',name:'Basic Ask'}]);
  assert.deepEqual(result.ordered.map(item=>item.id),['heal','ask','kill']);assert.equal(result.ordered[0].resolutionCategory,'DOC');assert.equal(result.ordered[0].resolutionTiming,'ANY_TIME');
});

test('26. Multiple transformations preserve original/effective target history',()=>{
  let action=normalizeResolutionAction({id:'kill',name:'Personal Instant Kill',sourcePlayerId:'AJ',targetIds:['Riz']});
  action=transformAction(action,{type:'PLACE_SWAP',toTargetIds:['Sky'],byActionId:'swap'});
  action=transformAction(action,{type:'REDIRECT',toTargetIds:['Grace'],byActionId:'redirect'});
  action=transformAction(action,{type:'REFLECTION',toTargetIds:['AJ'],byActionId:'reflection'});
  assert.deepEqual(action.originalTargetIds,['Riz']);assert.deepEqual(action.effectiveTargetIds,['AJ']);assert.deepEqual(action.transformationHistory.map(item=>item.type),['PLACE_SWAP','REDIRECT','REFLECTION']);
  assert.deepEqual(action.transformationHistory.map(item=>item.sequence),[1,2,3]);
});

test('semantic wording maps to Roleblock while custom ambiguity remains reviewable',()=>{
  assert.equal(globalAbilityDefinition({name:'Stop a player from acting tonight'})?.name,'Roleblock');
  assert.equal(classifyAbility({name:'Mystery Verdict',definition:'Resolve the strange verdict.'}).requiresGmClassification,true);
});
