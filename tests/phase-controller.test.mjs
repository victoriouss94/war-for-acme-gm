import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedPhaseActors,nextPhase,normalizeAdvancePreview,normalizePhaseContext,phaseTitle,queuePhaseSummary,resolutionResultsForPhase} from '../js/phase-controller.js';

test('phase sequence advances Night to the next Day and Day to the same-cycle Night',()=>{
  assert.deepEqual(nextPhase({phase:'Night',cycle:0}),{phase:'Day',cycle:1});
  assert.deepEqual(nextPhase({phase:'Day',cycle:4}),{phase:'Night',cycle:4});
});

test('phase context selects the single current phase and normalizes its queue',()=>{
  const context=normalizePhaseContext({game_status:'ACTIVE',current_phase_id:'current',phases:[{id:'old',phase:'Night',cycle:0,phase_sequence:1,status:'COMPLETED',action_queue:[{id:'a'}]},{id:'current',phase:'Day',cycle:1,phase_sequence:2,status:'CURRENT',queue_version:3,action_queue:[]}]});
  assert.equal(phaseTitle(context.current),'Day 1');
  assert.equal(context.current.queueVersion,3);
  assert.deepEqual(context.phases.map(phase=>phase.id),['current','old']);
});

test('expected actors exclude dead players, passive-only roles, and unavailable abilities',()=>{
  const players=[{id:'active',alive:true},{id:'passive',alive:true},{id:'blocked',alive:true},{id:'dead',alive:false}];
  const abilities={active:[{phase:'Night',available:true}],passive:[{phase:'Passive',passive:true,available:true}],blocked:[{phase:'Night',available:false}],dead:[{phase:'Night',available:true}]};
  assert.deepEqual(expectedPhaseActors(players,player=>abilities[player.id],'Night').map(player=>player.id),['active']);
  const summary=queuePhaseSummary({players,actions:[{sourcePlayerId:'active'}],effectiveAbilities:player=>abilities[player.id],phase:'Night'});
  assert.equal(summary.expectedCount,1);
  assert.equal(summary.submittedCount,1);
  assert.deepEqual(summary.missing,[]);
});

test('resolution results remain tied to action and phase identifiers',()=>{
  const results=resolutionResultsForPhase({id:'phase-1'},[{id:'session-1',phase_id:'phase-1',status:'FINALIZED',submitted_actions:[{id:'action-1'}],final_resolution:{summary:'Resolved safely.'}},{id:'other',phase_id:'phase-2',status:'FINALIZED',submitted_actions:[{id:'action-1'}],final_resolution:{summary:'Wrong phase.'}}]);
  assert.equal(results.get('action-1').summary,'Resolved safely.');
  assert.equal(results.get('action-1').sessionId,'session-1');
});

test('advance preview normalizes resolution counts and every consequence collection',()=>{
  const preview=normalizeAdvancePreview({current_phase_id:'p1',current_phase_version:4,next_phase:{phase:'Night',cycle:2},resolved_count:2,unresolved_count:1,unresolved_action_ids:['a3'],expiring_statuses:[{id:'s'}],expiring_grants:[{id:'g'}],ability_refreshes:[{ability_id:'ability-1'}]});
  assert.equal(preview.currentPhaseVersion,4);
  assert.deepEqual(preview.next,{phase:'Night',cycle:2});
  assert.equal(preview.unresolvedCount,1);
  assert.equal(preview.resolvedCount,2);
  assert.deepEqual(preview.unresolvedActionIds,['a3']);
  assert.equal(preview.expiringStatuses.length,1);
  assert.equal(preview.abilityRefreshes.length,1);
  assert.deepEqual(preview.pendingEffects,[]);
});
