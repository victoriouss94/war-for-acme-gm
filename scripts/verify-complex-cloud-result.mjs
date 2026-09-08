// Run against the private JSON returned by complex-night-cloud-rollback.sql.
// This checks actual cloud data, not a manufactured expected resolution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildTrackerResolutionReview} from '../js/resolution-review.js';
const file=process.argv[2];if(!file)throw new Error('Pass the saved rollback verification JSON path.');
const result=JSON.parse(readFileSync(file,'utf8')),data=result.document.data;
const review=buildTrackerResolutionReview({draft:result.final_resolution,roster:data.players,snapshotPlayers:result.snapshot.players,roles:data.roles,factions:data.factions,submittedActions:result.actions});
assert.equal(result.actions.length,35);assert.equal(result.final_resolution.action_results.length,35);
assert.equal(result.final_resolution.observability.ai_fallback_call_count,0);
assert.deepEqual(review.summary.deaths.map(p=>p.id).sort(),['p12','p15','p17','p20','p26','p39','p40','p8']);
assert.deepEqual(review.summary.survived.map(p=>p.id).sort(),['p16','p22','p24','p25','p28','p30','p4']);
assert.equal(data.players.filter(p=>p.alive).length,32);
assert.equal(review.players.find(p=>p.id==='p20').proposedRoleName,'No role');
assert.equal(data.players.find(p=>p.id==='p20').currentFactionId,'den');
assert.equal(data.players.find(p=>p.id==='p28').currentModeId,'shield');
assert.equal(result.document.game.currentDay,1);assert.equal(result.document.game.currentPhase,'Day');
assert.deepEqual(result.grants.map(g=>[g.player_id,g.source_type,g.uses_remaining,g.status]).sort(),[['p31','STOLEN',1,'ACTIVE'],['p32','GM_GRANT',2,'ACTIVE'],['p32','SPECIAL_MECHANIC',2,'ACTIVE']].sort());
console.log('Actual cloud result passed: 35 actions; 8 deaths; 7 attack survivors; exact grants, conversion, mode and Day 1; zero AI.');
