import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {complexNightFixture} from './helpers/complex-night-fixture.mjs';
import {resolveNightDeterministically} from '../js/night-engine.js';
import {buildResolutionDraft} from '../js/resolution-editor.js';
import {buildTrackerResolutionReview} from '../js/resolution-review.js';
function fixture(){
  const input=complexNightFixture(),proposal=resolveNightDeterministically(input);
  const roster=proposal.proposed_state.players.map(p=>({...p,currentFactionId:p.factionId}));
  return {input,roster,draft:buildResolutionDraft({proposal,actions:input.actions,players:input.players})};
}
function review(f){return buildTrackerResolutionReview({draft:f.draft,roster:f.roster,snapshotPlayers:f.input.players,roles:f.input.roles,factions:f.input.factions,submittedActions:f.input.actions});}
test('approved resolution retains its original deaths, conversion and alive counts',()=>{
  const r=review(fixture());
  assert.equal(r.summary.beforeAlive,40);assert.equal(r.summary.afterAlive,32);
  assert.equal(r.summary.deaths.length,8);assert.equal(r.summary.conversions.length,1);
});
test('later live deaths do not rewrite earlier surviving attack outcomes',()=>{
  const f=fixture();f.roster.find(p=>p.id==='p25').alive=false;
  const r=review(f);assert.ok(r.summary.survived.some(p=>p.id==='p25'));assert.equal(r.summary.afterAlive,32);
});
test('historical roster includes removed original players and excludes later additions',()=>{
  const f=fixture();f.roster=f.roster.filter(p=>p.id!=='p26');f.roster.push({id:'later',name:'Later player',alive:true});
  const r=review(f);assert.equal(r.players.length,40);assert.ok(r.summary.deaths.some(p=>p.id==='p26'));assert.ok(!r.players.some(p=>p.id==='later'));
});
test('actual historical renderer uses snapshot statuses instead of duplicating applied live effects',()=>{
  const f=fixture(),status={id:'saved-mark',player_id:'p13',status_type:'MARK',state:'ACTIVE'};
  const session={status:'FINALIZED',pre_resolution_state:{players:f.input.players,roles:f.input.roles,factions:f.input.factions,statuses:[]},submitted_actions:f.input.actions};
  const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),start=source.indexOf('function trackerResolutionOutputHtml('),end=source.indexOf('\nfunction resolutionOutputHtml(',start);
  let captured;
  vm.runInNewContext(source.slice(start,end)+'\ntrackerResolutionOutputHtml(draft,session)',{
    draft:f.draft,session,state:{players:f.roster,roles:[],factions:[]},liveStatuses:[status],
    currentResolutionDisplayLookup:()=>({}),buildTrackerResolutionReview:args=>(captured=buildTrackerResolutionReview(args)),
    resolutionEntityName:(_lookup,id)=>id,trackerResultBadgesHtml:()=>'',trackerActionBadges:()=>[],readableResolutionText:x=>x,esc:String,trackerResolutionTableHtml:()=>'',trackerDiagnosticsHtml:()=>'',trackerPlayerResolutionHtml:()=>'',trackerResolutionSummaryHtml:()=>''
  });
  const player=captured.players.find(p=>p.id==='p13');
  assert.equal(player.currentStatuses.length,0);assert.equal(player.proposedStatuses.length,1);
  assert.equal(player.currentRoleName,'Audit Role 13');assert.equal(player.currentFactionName,'Villagers');
});
