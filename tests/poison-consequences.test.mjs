import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {poisonDueAtPhaseEnd} from '../js/player-runtime.js';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../js/resolution-editor.js';
import {buildTrackerResolutionReview} from '../js/resolution-review.js';
import {phaseNeedsResolution,normalizeAdvancePreview} from '../js/phase-controller.js';

const players=[{id:'source',name:'Source',alive:true},{id:'target',name:'Target',alive:true},{id:'healer',name:'Healer',alive:true}];
const poison={id:'saved-poison',status_type:'POISON',status_name:'Poison',state:'ACTIVE',player_id:'target',source_player_id:'source',applied_at_cycle:0,applied_at_phase:'Night',expires_at_cycle:2,expires_at_phase:'Day',remaining_duration:null};
const run=(extra={})=>resolveNightDeterministically({gameId:'fixture',round:2,phase:'Day',players,statuses:[poison],actions:[],...extra});
const action=name=>({id:name.toLowerCase(),name,sourcePlayerId:'healer',targetIds:['target']});

test('Poison deadlines count days, preserve explicit phases, and ignore terminal/future states',()=>{
  for(const [round,phase,expected] of [[0,'Night',false],[1,'Day',false],[1,'Night',false],[2,'Day',true],[2,'Night',true],[3,'Day',true]])assert.equal(poisonDueAtPhaseEnd(poison,{round,phase}),expected);
  assert.equal(poisonDueAtPhaseEnd({...poison,expires_at_phase:'Night'},{round:2,phase:'Day'}),false);
  assert.equal(poisonDueAtPhaseEnd({...poison,expires_at_cycle:null,expires_at_phase:null},{round:2,phase:'Day'}),true);
  for(const state of ['PENDING','EXPIRED','RESOLVED','CONSUMED'])assert.equal(poisonDueAtPhaseEnd({...poison,state},{round:3,phase:'Night'}),false);
  assert.equal(poisonDueAtPhaseEnd({...poison,applied_at_cycle:4},{round:3,phase:'Night'}),false);
});

test('status-only phases are resolvable and due effects remain distinct from expiration previews',()=>{
  assert.equal(phaseNeedsResolution({cycle:2,phase:'Day',actions:[]},[poison]),true);
  assert.equal(phaseNeedsResolution({cycle:1,phase:'Night',actions:[]},[poison]),false);
  assert.equal(phaseNeedsResolution({cycle:1,phase:'Night',actions:[{id:'a'}]},[]),true);
  assert.equal(phaseNeedsResolution(null,[poison]),false);
  const preview=normalizeAdvancePreview({due_status_consequences:[poison]});
  assert.equal(preview.dueStatusConsequences.length,1);
  assert.deepEqual(preview.expiringStatuses,[]);
});

test('timed-consequence review selects the current phase when history is open',()=>{
  const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  const handler=source.slice(source.indexOf('function reviewUnresolvedActions(){'),source.indexOf('async function approvePhaseAdvance(){'));
  const panel={hidden:false};let reviewPhase;
  const context={selectedQueuePhaseId:'historical',gamePhaseContext:{current:{id:'current'}},phaseAdvancePreview:{dueStatusConsequences:[poison]},$:()=>panel,startResolutionSession:()=>{reviewPhase=context.selectedQueuePhaseId}};
  vm.runInNewContext(handler+';reviewUnresolvedActions();',context);
  assert.equal(reviewPhase,'current');
  assert.equal(panel.hidden,true);
});

test('Poison application uses a two-day deadline without a two-phase countdown',()=>{
  const ruling=run({round:0,phase:'Night',statuses:[],actions:[{id:'poison',name:'Poison',sourcePlayerId:'source',targetIds:['target']}]});
  assert.equal(ruling.status_effects[0].expires_at_cycle,2);
  assert.equal(ruling.status_effects[0].expires_at_phase,'Day');
  assert.equal(ruling.status_effects[0].remaining_duration,'');
});

test('a due Poison creates a reviewable death without fake queued actions or AI calls',()=>{
  const ruling=run(),target=ruling.player_outcomes.find(player=>player.player_id==='target');
  assert.equal(target.life_state,'DEAD');
  assert.match(target.summary,/Poison/);
  assert.equal(ruling.action_results.length,0);
  assert.equal(ruling.observability.ai_fallback_call_count,0);
  assert.equal(ruling.status_effects[0].operation,'REMOVE');
  assert.equal(ruling.status_effects[0].status_id,'saved-poison');
  assert.deepEqual(players.map(player=>player.alive),[true,true,true]);
  assert.equal(poison.state,'ACTIVE');
  const payload=finalResolutionPayload(buildResolutionDraft({proposal:ruling,actions:[],players}));
  assert.deepEqual(payload.deaths,['target']);
  assert.match(payload.events.find(event=>event.event_type==='DEATH').summary,/Poison/);
  const review=buildTrackerResolutionReview({draft:payload,roster:players});
  assert.ok(review.tableRows.some(row=>row.playerId==='target'&&/Poison/.test(row.resultLabel)));
});

test('Heal at the deadline cancels Poison; a blocked Heal does not',()=>{
  const healed=run({actions:[action('Heal')]});
  assert.equal(healed.player_outcomes.find(player=>player.player_id==='target').alive_after_resolution,true);
  assert.equal(healed.status_effects.filter(effect=>effect.operation==='REMOVE').length,1);
  const blocked=run({actions:[{id:'block',name:'Roleblock',sourcePlayerId:'source',targetIds:['healer']},action('Heal')]});
  assert.equal(blocked.player_outcomes.find(player=>player.player_id==='target').alive_after_resolution,false);
});

test('a player with a submitted action also sees the separate Poison consequence',()=>{
  const actions=[{id:'ask',name:'Ask',sourcePlayerId:'target',targetIds:['source']}],ruling=run({actions});
  const payload=finalResolutionPayload(buildResolutionDraft({proposal:ruling,actions,players}));
  const review=buildTrackerResolutionReview({draft:payload,roster:players,submittedActions:actions});
  const rows=review.tableRows.filter(row=>row.playerId==='target');
  assert.equal(rows.length,2);
  assert.ok(rows.some(row=>row.actionLabel==='Timed status consequence'&&/Poison/.test(row.resultLabel)));
});

test('Death Immunity and Save can prevent the pending death, while normal Protect cannot cleanse Poison',()=>{
  const immune=run({players:players.map(player=>player.id==='target'?{...player,immunities:['Death Immunity']}:player)});
  assert.equal(immune.player_outcomes.find(player=>player.player_id==='target').alive_after_resolution,true);
  assert.match(immune.other_effects[0].summary,/Death Immunity/);
  assert.equal(run({actions:[action('Save')]}).player_outcomes.find(player=>player.player_id==='target').alive_after_resolution,true);
  assert.equal(run({actions:[action('Protect')]}).player_outcomes.find(player=>player.player_id==='target').alive_after_resolution,false);
});

test('future, removed, and already resolved Poison does not kill; replay and duplicate statuses do not duplicate deaths',()=>{
  assert.equal(run({round:1}).player_outcomes.find(player=>player.player_id==='target').alive_after_resolution,true);
  for(const state of ['EXPIRED','RESOLVED'])assert.equal(run({statuses:[{...poison,state}]}).player_outcomes.find(player=>player.player_id==='target').alive_after_resolution,true);
  const ruling=run({statuses:[poison,{...poison,id:'second-poison'}]});
  assert.equal(ruling.deaths.length,1);
  const replay=recalculateNight(ruling,{gameId:'fixture',round:2,phase:'Day',players,statuses:[poison],actions:[]},{});
  assert.deepEqual(replay.deaths,['Target']);
  const alreadyDead=run({players:players.map(player=>player.id==='target'?{...player,alive:false}:player)});
  assert.deepEqual(alreadyDead.deaths,[]);
  assert.equal(alreadyDead.status_effects[0].operation,'REMOVE');
});
