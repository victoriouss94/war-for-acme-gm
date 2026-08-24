import test from 'node:test';
import assert from 'node:assert/strict';
import {abilityUsageStatistics,mechanicsReviewQueue,normalizeAbilityUnderstanding,normalizeMechanicList,normalizeRoleUnderstanding} from '../js/mechanics.js';
import {effectiveFactionAbilities,validateActionTargets} from '../js/player-abilities.js';

test('compound role text remains split into independently sourced mechanics',()=>{
  const source='Each night choose a player. You are immune to redirects. When attacked, reflect the first attack.';
  const mechanics=normalizeMechanicList([
    {type:'ACTIVE_ABILITY',originalText:'Each night choose a player.',summary:'Choose one player each night.',confidence:.97,interpretationState:'VERIFIED',origin:'SOURCE_DOCUMENT'},
    {type:'IMMUNITY',originalText:'You are immune to redirects.',summary:'Redirect effects do not affect this role.',confidence:.96,interpretationState:'VERIFIED',origin:'SOURCE_DOCUMENT'},
    {type:'PASSIVE',originalText:'When attacked, reflect the first attack.',summary:'Reflect the first incoming attack.',triggers:['When attacked'],passiveBehavior:'AUTOMATIC',triggerLimit:1,confidence:.88,interpretationState:'HIGH_CONFIDENCE',origin:'SOURCE_DOCUMENT'}
  ],{roleId:'role-1',roleName:'Mirror',sourceLocation:'Roles / Mirror'});
  assert.equal(mechanics.length,3);
  assert.deepEqual(mechanics.map(item=>item.type),['ACTIVE_ABILITY','IMMUNITY','PASSIVE']);
  assert.ok(mechanics.every(item=>source.includes(item.originalText)));
  assert.equal(mechanics[2].automatic,true);
  assert.equal(mechanics[2].triggerLimit,1);
});

test('a role with no passive does not gain one and unclear text enters review',()=>{
  const role={id:'role-2',name:'Scout',sourceText:'Inspect someone. Unless the bell rings, special handling may apply.',mechanicalStatements:[{type:'ACTIVE_ABILITY',originalText:'Inspect someone.',summary:'Inspect one player.',confidence:.95,interpretationState:'VERIFIED',origin:'SOURCE_DOCUMENT'},{type:'CUSTOM_MECHANIC',originalText:'Unless the bell rings, special handling may apply.',summary:'Conditional handling is not defined.',confidence:.25,interpretationState:'UNRESOLVED',unresolvedComponents:['Meaning of special handling'],possibleInterpretations:['Skip the action','Change the result'],origin:'AI_INTERPRETATION_PENDING'}]};
  const understanding=normalizeRoleUnderstanding(role);
  assert.equal(understanding.passives.length,0);
  const reviews=mechanicsReviewQueue({game:{id:'game-1',name:'Test'},roles:[role],abilities:[]});
  assert.equal(reviews.length,1);
  assert.match(reviews[0].originalText,/Unless the bell rings/);
  assert.deepEqual(reviews[0].unknownComponents,['Meaning of special handling']);
});

test('standard ability mapping preserves a custom role-specific identity',()=>{
  const understanding=normalizeAbilityUnderstanding({id:'ability-1',name:'Judicial Execution',mapping:'STANDARD_BASE_WITH_CUSTOM_IDENTITY',baseStandardAbilityId:'REGULAR_KILL',understanding:{baseStandardAbilityId:'REGULAR_KILL',baseStandardAbilityName:'Regular Kill',customIdentity:true,mechanics:[{type:'ACTIVE_ABILITY',originalText:'Perform a Regular Kill that ignores the first Guard.',summary:'Regular Kill base with a source-defined Guard exception.',baseStandardAbilityId:'REGULAR_KILL',customEffect:'Ignores the first Guard.',roleSpecificModifiers:['Ignore first Guard'],confidence:.94,interpretationState:'VERIFIED',origin:'SOURCE_DOCUMENT'}]}});
  assert.equal(understanding.baseStandardAbilityId,'REGULAR_KILL');
  assert.equal(understanding.customIdentity,true);
  assert.match(understanding.mechanics[0].customEffect,/Guard/);
});

test('soft effect eligibility does not reveal hidden information during selection',()=>{
  const players=[{id:'actor',factionId:'village',alive:true},{id:'target',factionId:'den',alive:true}],actor=players[0];
  const soft={targeting:{type:'ONE_PLAYER',selectionRuleType:'SOFT_EFFECT_ELIGIBILITY',factionMemberOnly:true,livingOnly:true,selfAllowed:true}};
  const hard={targeting:{...soft.targeting,selectionRuleType:'HARD_SELECTION_RESTRICTION'}};
  assert.deepEqual(validateActionTargets({actor,players,ability:soft,targetIds:['target']}),[]);
  assert.deepEqual(validateActionTargets({actor,players,ability:hard,targetIds:['target']}),['FACTION_MEMBER_TARGET_REQUIRED']);
});

test('explicit faction and role lists are enforced only as hard restrictions',()=>{
  const players=[{id:'actor',factionId:'village',roleId:'seer',alive:true},{id:'target',factionId:'den',roleId:'wolf',alive:true}],factions=[{id:'village',name:'Village'},{id:'den',name:'Den'}],roles=[{id:'seer',name:'Seer'},{id:'wolf',name:'Wolf'}],restricted={targeting:{type:'ONE_PLAYER',selectionRuleType:'HARD_SELECTION_RESTRICTION',targetFactionRestrictions:['Village'],targetRoleRestrictions:['Seer']}};
  assert.deepEqual(validateActionTargets({actor:players[0],players,factions,roles,ability:restricted,targetIds:['target']}),['TARGET_FACTION_RESTRICTED','TARGET_ROLE_RESTRICTED']);
  restricted.targeting.selectionRuleType='SOFT_EFFECT_ELIGIBILITY';
  assert.deepEqual(validateActionTargets({actor:players[0],players,factions,roles,ability:restricted,targetIds:['target']}),[]);
});

test('source-defined faction actions require an eligible performer without disabling passives',()=>{
  const faction={id:'den',name:'Den'},ability={id:'den-kill',name:'Den Kill',definition:'The Den selects one living player.',phase:'Night',category:'Harmful',understanding:{factionAction:true,performerRequired:true,sourceFactionIds:['den'],targeting:{type:'ONE_PLAYER',selectionRuleType:'HARD_SELECTION_RESTRICTION'},mechanics:[{type:'FACTION_EFFECT',originalText:'The Den selects one living player.',summary:'One faction-wide kill attempt.',factionAction:true,confidence:1,interpretationState:'VERIFIED',origin:'SOURCE_DOCUMENT'}]}},players=[{id:'d1',factionId:'den',alive:true}],blocked=[{playerId:'d1',state:'ACTIVE',statusType:'DEN_BLOCKED'}];
  assert.equal(effectiveFactionAbilities({faction,players,abilities:[ability],statuses:[]})[0].available,true);
  const unavailable=effectiveFactionAbilities({faction,players,abilities:[ability],statuses:blocked})[0];
  assert.equal(unavailable.available,false);
  assert.deepEqual(unavailable.reasons,['NO_ELIGIBLE_FACTION_PERFORMER']);
  const denBlock=normalizeMechanicList([{type:'FACTION_BLOCK',originalText:'Block the entire Den from its faction action.',summary:'Apply DEN_BLOCKED to eligible Den performers.',targeting:{type:'FACTION'},blocksFactionActions:true,disablesPassives:false,confidence:1,interpretationState:'VERIFIED',origin:'SOURCE_DOCUMENT'}])[0];
  assert.equal(denBlock.targeting.type,'FACTION');
  assert.equal(denBlock.blocksFactionActions,true);
  assert.equal(denBlock.disablesPassives,false);
});

test('usage statistics deduplicate attempts and count passive triggers separately',()=>{
  const actions=[{id:'action-1',abilityId:'a',sourcePlayerId:'p'},{id:'action-1',abilityId:'a',sourcePlayerId:'p'},{id:'action-2',abilityId:'a',sourcePlayerId:'p'}],events=[
    {actionId:'action-1',abilityId:'a',actorPlayerId:'p',eventType:'REDIRECT',affectedPlayerIds:['x']},
    {actionId:'action-1',abilityId:'a',actorPlayerId:'p',eventType:'SUCCESS',affectedPlayerIds:['y']},
    {actionId:'action-2',abilityId:'a',actorPlayerId:'p',eventType:'BLOCK'},
    {actionId:'action-2',abilityId:'a',actorPlayerId:'p',eventType:'ABILITY_CONSUMED'},
    {actionId:'action-2',abilityId:'a',actorPlayerId:'p',eventType:'USE_REFUNDED'},
    {abilityId:'a',actorPlayerId:'p',eventType:'PASSIVE_TRIGGER',result:'SUCCESS',affectedPlayerIds:['y']},
    {abilityId:'a',actorPlayerId:'p',eventType:'PASSIVE_PREVENTED'}
  ];
  const stats=abilityUsageStatistics({actions,events,abilityId:'a',playerId:'p'});
  assert.equal(stats.attempts,2);
  assert.equal(stats.redirected,1);
  assert.equal(stats.successful,1);
  assert.equal(stats.blocked,1);
  assert.equal(stats.usesConsumed,1);
  assert.equal(stats.usesRefunded,1);
  assert.equal(stats.passiveTriggers,1);
  assert.equal(stats.passivePrevented,1);
  assert.equal(stats.affectedPlayers,2);
});
