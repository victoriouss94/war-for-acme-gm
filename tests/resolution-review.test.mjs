import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrackerResolutionReview,trackerActionBadges} from '../js/resolution-review.js';

const roster=[
  {id:'penny',name:'Penny',roleId:'simmons',currentFactionId:'neutral',alive:true},
  {id:'petyr',name:'Petyr',roleId:'basic-den',currentFactionId:'den',alive:true},
  {id:'nora',name:'Nora',roleId:'bumblebee',currentFactionId:'villager',alive:true,modeName:'Alt Mode'},
  {id:'cap',name:'Cap',roleId:'soundwave',currentFactionId:'den',alive:true},
  {id:'idle',name:'Hel',roleId:'skids',currentFactionId:'villager',alive:true}
];
const roles=[
  {id:'simmons',name:'Agent Simmons'},{id:'basic-den',name:'Basic Den'},{id:'bumblebee',name:'Bumblebee'},
  {id:'soundwave',name:'Soundwave'},{id:'skids',name:'Skids'}
];
const factions=[{id:'neutral',name:'Neutral',class:'NEUTRAL'},{id:'den',name:'Den',class:'DEN'},{id:'villager',name:'Villager',class:'VILLAGER'}];
const submittedActions=[
  {id:'capture',sourcePlayerId:'penny',name:'Capture',targetIds:['petyr']},
  {id:'scan',sourcePlayerId:'nora',name:'Role Scan',targetIds:['cap']},
  {id:'den-kill',sourceFactionId:'den',sourcePlayerId:'cap',sourceType:'FACTION',name:'Den Kill',targetIds:['nora']}
];
const draft={
  action_results:[
    {action_id:'capture',order:1,actor_player_id:'penny',ability_name:'Capture',original_target_ids:['petyr'],final_target_ids:['petyr'],affected_player_ids:['petyr'],resolution_category:'STATUS_EFFECTS',result:'SUCCESS',ruling:'Petyr captured.',reason:'Capture succeeded.'},
    {action_id:'scan',order:2,actor_player_id:'nora',ability_name:'Role Scan',actor_mode_name:'Alt Mode',original_target_ids:['cap'],final_target_ids:['cap'],resolution_category:'INTEL',result:'SUCCESS',ruling:'SOUNDWAVE',reason:'Role scan returned Soundwave.'},
    {action_id:'den-kill',order:3,actor_player_id:'cap',source_faction_id:'den',faction_action:true,ability_name:'Den Kill',original_target_ids:['nora'],final_target_ids:['nora'],affected_player_ids:['nora'],resolution_category:'KILLS',result:'FAILURE',protected:true,ruling:'Nora survives.',reason:'Bumblebee Alt Mode stopped the attack.'}
  ],
  player_outcomes:[
    {player_id:'penny',life_state:'UNCHANGED'},
    {player_id:'petyr',life_state:'UNCHANGED'},
    {player_id:'nora',life_state:'UNCHANGED',mode_after_resolution:'Alt Mode'},
    {player_id:'cap',life_state:'UNCHANGED'}
  ],
  status_effects:[{operation:'APPLY',player_id:'petyr',status_type:'CAPTURED',status_name:'Captured',status_category:'HARMFUL',state:'ACTIVE'}],
  grant_effects:[]
};

test('tracker review preserves the existing roster order and includes no-action players',()=>{
  const review=buildTrackerResolutionReview({draft,roster,snapshotPlayers:roster,roles,factions,submittedActions,statuses:[]});
  assert.deepEqual(review.players.map(player=>player.name),['Penny','Petyr','Nora','Cap','Hel']);
  assert.equal(review.players.find(player=>player.id==='idle').actions.length,0);
  assert.equal(review.players.find(player=>player.id==='petyr').proposedStatuses[0].status_name,'Captured');
});

test('submitted input stays separate from the final structured result and mode context',()=>{
  const review=buildTrackerResolutionReview({draft,roster,roles,factions,submittedActions});
  const capture=review.players[0].actions[0],scan=review.players[2].actions[0];
  assert.equal(capture.submittedAbility,'Capture');
  assert.deepEqual(capture.submittedTargets,['Petyr']);
  assert.equal(capture.conciseResult,'Petyr captured.');
  assert.equal(scan.intelResult,'SOUNDWAVE');
  assert.equal(review.players[2].modeName,'Alt Mode');
});

test('faction actions render separately and summaries come from structured state',()=>{
  const review=buildTrackerResolutionReview({draft,roster,roles,factions,submittedActions});
  assert.equal(review.players.find(player=>player.id==='cap').actions.length,0);
  assert.equal(review.factionActions.length,1);
  assert.deepEqual(review.summary.survived.map(player=>player.name),['Nora']);
  assert.equal(review.summary.statusChanges.length,1);
  assert.equal(review.summary.intel.length,1);
  assert.equal(review.summary.beforeAlive,5);
  assert.equal(review.summary.afterAlive,5);
});

test('result badges cover reflection, protection, failure, pending, and intel states',()=>{
  const labels=trackerActionBadges({result:'FAILURE',reflected:true,protected:true,resolution_category:'INTEL'}).map(item=>item.label);
  assert.deepEqual(labels,['REFLECTED','PROTECTED','INTEL','FAILED']);
  assert.equal(trackerActionBadges({result:'PENDING'})[0].label,'PENDING');
});

test('proposed deaths and conversions do not mutate the current roster',()=>{
  const changed=structuredClone(draft);changed.player_outcomes.push({player_id:'idle',life_state:'DEAD',faction_id:'den'});
  const review=buildTrackerResolutionReview({draft:changed,roster,roles,factions,submittedActions});
  const hel=review.players.find(player=>player.id==='idle');
  assert.equal(hel.currentAlive,true);
  assert.equal(hel.proposedAlive,false);
  assert.equal(roster.find(player=>player.id==='idle').alive,true);
  assert.equal(review.summary.deaths[0].name,'Hel');
  assert.equal(review.summary.conversions[0].name,'Hel');
});
