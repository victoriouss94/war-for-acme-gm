import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically} from '../js/night-engine.js';

const status={id:'saved-poison',player_id:'target',status_type:'POISON',status_name:'Poison',state:'ACTIVE',applied_at_cycle:1,applied_at_phase:'Night'};
function heal(effects,phase='Night'){
  return resolveNightDeterministically({gameId:'isolated',round:2,phase,
    players:[{id:'healer',name:'Healer',alive:true},{id:'target',name:'Target',alive:true}],
    actions:[{id:'heal',name:'Heal',sourcePlayerId:'healer',targetIds:['target'],playerAbilityGrantId:'heal-grant'}],statuses:effects});
}

test('Heal does not re-remove terminal statuses or consume a use for them',()=>{
  for(const state of ['EXPIRED','RESOLVED','CONSUMED','REMOVED']){
    const ruling=heal([{...status,state}]);
    assert.equal(ruling.action_results[0].result,'INELIGIBLE_EFFECT',state);
    assert.equal(ruling.action_results[0].use_disposition,'NOT_CONSUMED',state);
    assert.deepEqual(ruling.status_effects,[],state);
  }
});

test('Heal cannot remove a status scheduled for a future cycle or phase',()=>{
  for(const [effect,phase] of [[{...status,applied_at_cycle:3},'Night'],[{...status,applied_at_cycle:2,applied_at_phase:'Night'},'Day']]){
    const ruling=heal([effect],phase);
    assert.equal(ruling.action_results[0].result,'INELIGIBLE_EFFECT');
    assert.deepEqual(ruling.status_effects,[]);
  }
});

test('Heal removes current harmful statuses including pending hanging events',()=>{
  for(const state of ['ACTIVE','PENDING']){
    const ruling=heal([{...status,status_type:state==='PENDING'?'DRUNK':'POISON',state}]);
    assert.equal(ruling.action_results[0].result,'SUCCESS');
    assert.equal(ruling.status_effects[0].operation,'REMOVE');
    assert.equal(ruling.status_effects[0].status_id,'saved-poison');
  }
});

test('Heal respects explicit end boundaries and does not mutate status history',()=>{
  for(const effect of [{...status,expires_at_cycle:1},{...status,expires_at_cycle:2,expires_at_phase:'Day'}]){
    const before=structuredClone(effect),ruling=heal([effect]);
    assert.equal(ruling.action_results[0].result,'INELIGIBLE_EFFECT');
    assert.deepEqual(ruling.status_effects,[]);
    assert.deepEqual(effect,before);
  }
  assert.equal(heal([{...status,expires_at_cycle:2,expires_at_phase:'Night'}]).action_results[0].result,'SUCCESS');
});
