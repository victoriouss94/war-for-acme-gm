import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildTrackerResolutionReview} from '../js/resolution-review.js';

const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const renderer=source.slice(source.indexOf('function trackerResolutionOutputHtml('),source.indexOf('function resolutionAccountingWarningHtml('));
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function render(draft,session={}){return vm.runInNewContext(renderer+'\ntrackerResolutionOutputHtml(draft,session)',{
  draft,session,state:{players:[]},liveStatuses:[],currentResolutionDisplayLookup:()=>({}),buildTrackerResolutionReview,
  readableResolutionText:value=>String(value??''),esc,trackerResolutionTableHtml:()=>'',trackerDiagnosticsHtml:()=>'',trackerPlayerResolutionHtml:()=>'',trackerResolutionSummaryHtml:()=>''
});}
const proposal=()=>({resolution_status:'GM_REVIEW_REQUIRED',unresolved_questions:['Passive Owner — Last Gift: review the on-death reward.'],action_results:[{action_id:'kill',actor_player_id:'actor',result:'SUCCESS'}]});

test('successful submitted actions do not hide outstanding passive review',()=>{
  const review=buildTrackerResolutionReview({draft:proposal()});
  assert.equal(review.isComplete,false);assert.equal(review.requiresReview,true);assert.equal(review.reviewQuestions.length,1);
});
test('actual tracker renderer displays passive review and disables approval',()=>{
  const html=render(proposal());assert.match(html,/GM Review Required/);assert.match(html,/Passive Owner — Last Gift/);assert.match(html,/data-resolution-workflow="approve" disabled/);
});
test('zero-action nights still display required review',()=>{
  const draft=proposal();draft.action_results=[];assert.match(render(draft),/Last Gift/);assert.equal(buildTrackerResolutionReview({draft}).isComplete,false);
});
test('manual completion must clear questions and review status',()=>{
  const draft=proposal();draft.unresolved_questions=[];assert.equal(buildTrackerResolutionReview({draft}).isComplete,false);
  draft.resolution_status='RESOLVED';assert.equal(buildTrackerResolutionReview({draft}).isComplete,true);assert.doesNotMatch(render(draft),/data-resolution-workflow="approve" disabled/);
});
test('questions block approval even when resolution status incorrectly says resolved',()=>{
  const draft=proposal();draft.resolution_status='RESOLVED';assert.equal(buildTrackerResolutionReview({draft}).isComplete,false);
});
test('review renderer escapes source text and does not expose approval on finalized results',()=>{
  const draft=proposal();draft.unresolved_questions=['<script>bad</script> & Last Gift'];const html=render(draft,{status:'FINALIZED'});
  assert.doesNotMatch(html,/<script>|data-resolution-workflow="approve"/);assert.match(html,/&lt;script&gt;bad&lt;\/script&gt; &amp; Last Gift/);
});
test('error status cannot be treated as a complete empty resolution',()=>{
  const draft={resolution_status:'RESOLUTION_ERROR'};assert.equal(buildTrackerResolutionReview({draft}).isComplete,false);assert.match(render(draft),/still requires review/);
});
