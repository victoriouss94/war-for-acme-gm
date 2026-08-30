import test from 'node:test';
import assert from 'node:assert/strict';
import {effectivePlayerAbilities,effectiveFactionAbilities} from '../js/player-abilities.js';
import {abilityDisablingStatuses,statusAppliesToPhase} from '../js/player-runtime.js';
import {resolveNightDeterministically} from '../js/night-engine.js';

const game={currentDay:2,currentPhase:'Night'},player={id:'p',name:'Actor',roleId:'r',alive:true,currentFactionId:'den'},role={id:'r',name:'Role',activeAbilityId:'save',abilityUses:null},ability={id:'save',name:'Save',phase:'Any'};
const counter={id:'counter',player_id:'p',ability_id:'save',source_type:'ROLE',source_reference:'r',uses_granted:2,uses_remaining:1,status:'ACTIVE',duration_type:'LIMITED_USES',metadata:{replacesRoleAbility:true}};
const inventory=(grants,extra={})=>effectivePlayerAbilities({player,role,abilities:[ability],grants,game,...extra}).abilities;
const disabled={id:'capture',player_id:'p',status_type:'ABILITIES_DISABLED',state:'ACTIVE',applied_at_cycle:2,applied_at_phase:'Night',expires_at_cycle:2,expires_at_phase:'Night'};

test('player counter replaces, rather than duplicates, unlimited role ability',()=>{
  const result=inventory([counter]);assert.equal(result.length,1);assert.equal(result[0].usesRemaining,1);assert.equal(result[0].grantId,'counter');assert.equal(result[0].usesGranted,2);
  assert.equal(role.abilityUses,null);
});
test('exhausted counter never restores unlimited role use',()=>{
  const result=inventory([{...counter,uses_remaining:0,status:'CONSUMED'}]);assert.equal(result.length,1);assert.equal(result[0].usesRemaining,0);assert.equal(result[0].available,false);
});
test('GM counter edits take effect without double subtracting historical use events',()=>{
  assert.equal(inventory([{...counter,uses_remaining:2}],{resolutionEvents:[{actor_player_id:'p',ability_id:'save',event_type:'ABILITY_CONSUMED'}]})[0].usesRemaining,2);
});
test('revoking counter restores role defaults; other-role counters cannot shadow it',()=>{
  assert.equal(inventory([{...counter,status:'REVOKED'}])[0].usesRemaining,null);
  assert.equal(inventory([{...counter,source_reference:'other'}]).find(item=>!item.grantId).usesRemaining,null);
});
test('ordinary rewards remain additive and do not shadow role abilities',()=>{
  assert.equal(inventory([{...counter,source_type:'MINIGAME_REWARD',metadata:{}}]).length,2);
});
test('capture window is only the specified night, not preceding day or future cycle',()=>{
  assert.equal(statusAppliesToPhase(disabled,game),true);
  assert.equal(statusAppliesToPhase(disabled,{currentDay:2,currentPhase:'Day'}),false);
  assert.equal(statusAppliesToPhase(disabled,{currentDay:3,currentPhase:'Night'}),false);
  assert.equal(statusAppliesToPhase({...disabled,state:'EXPIRED'},game),false);
  assert.equal(abilityDisablingStatuses([{...disabled,status_type:'SILENCED'}],'p',game).length,0);
});
test('capture blocks role and awarded active abilities in the selection UI',()=>{
  const result=inventory([{...counter,source_type:'MINIGAME_REWARD',metadata:{}}],{statuses:[disabled]});
  assert.ok(result.every(item=>!item.available&&item.reasons.includes('ABILITIES_DISABLED')));
});
test('captured player cannot perform faction action',()=>{
  const result=effectiveFactionAbilities({faction:{id:'den'},players:[player],abilities:[{id:'kill',name:'Den Regular Kill',understanding:{factionAction:true,performerRequired:true}}],statuses:[disabled],game});
  assert.equal(result[0].eligiblePerformers.length,0);
});
const simulate=(statuses,extra={})=>resolveNightDeterministically({gameId:'test',round:2,phase:'Night',players:[player,{id:'q',name:'Target',alive:true},{id:'g',name:'Guaranteer',alive:true}],roles:[role],statuses,actions:[{id:'kill',name:'Personal Instant Kill',sourcePlayerId:'p',targetIds:['q']},{id:'guarantee',name:'Action Success Guarantee',sourcePlayerId:'g',targetIds:['p']}],...extra});
test('resolver rejects already queued captured action even with Guarantee; consumes no charge',()=>{
  const result=simulate([disabled]);assert.equal(result.action_results.find(item=>item.action_id==='kill').result,'BLOCKED');assert.equal(result.action_results.find(item=>item.action_id==='kill').use_disposition,'NOT_CONSUMED');assert.deepEqual(result.deaths,[]);
});
test('expired capture no longer blocks',()=>{
  assert.equal(simulate([{...disabled,state:'EXPIRED'}]).action_results.find(item=>item.action_id==='kill').result,'SUCCESS');
});
test('persistent Roleblock blocks ordinary action and still permits standard Guarantee override',()=>{
  const status={...disabled,status_type:'ROLEBLOCK'};
  assert.equal(simulate([status],{actions:[{id:'kill',name:'Personal Instant Kill',sourcePlayerId:'p',targetIds:['q']}]}).action_results[0].result,'BLOCKED');
  assert.equal(simulate([status]).action_results.find(item=>item.action_id==='kill').result,'SUCCESS');
});
