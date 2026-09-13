import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildResolutionDraft,validateResolutionDraft,finalResolutionPayload,resolutionDifferences} from '../js/resolution-editor.js';

const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function harness(){
  const proposal={resolution_status:'GM_REVIEW_REQUIRED',unresolved_questions:['Owner: decide the on-death reward.'],final_ruling:'GM must review the source.',action_results:[]},session={id:'session',status:'DRAFT',engine_proposal:proposal,pre_resolution_state:{players:[]},submitted_actions:[]},elements=new Map(),tracker={disabled:true},$=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,disabled:true});return elements.get(id)};
  const context={$,document:{querySelectorAll:selector=>selector==='[data-resolution-workflow="approve"]'?[tracker]:[]},loadedResolutionFormId:null,resolutionEditorDraft:null,buildResolutionDraft,validateResolutionDraft,normalizeResolution:()=>({}),setNotice:()=>{},renderResolutionEditor:()=>{},currentResolutionSession:()=>session,canEditGame:()=>true,resolutionPending:false,state:{players:[],roles:[],abilities:[],factions:[]}};
  vm.createContext(context);for(const [startName,endName] of [['function captureResolutionEditor(','function renderResolutionEditor('],['function fillResolutionForm(','function bindTrackerResolutionReview(']]){const start=source.indexOf(startName),end=source.indexOf(endName,start);vm.runInContext(source.slice(start,end),context)}
  vm.runInContext('fillResolutionForm(currentResolutionSession())',context);return {context,$,tracker,session,proposal};
}
test('manual GM review controls are present, load existing questions and save explicit decisions',()=>{
  assert.match(html,/id="resolutionFinalStatus"/);assert.match(html,/id="resolutionUnresolvedQuestions"/);const h=harness();
  assert.equal(h.$('resolutionFinalStatus').value,'GM_REVIEW_REQUIRED');assert.match(h.$('resolutionUnresolvedQuestions').value,/on-death reward/);
  h.$('resolutionFinalStatus').value='RESOLVED';let draft=vm.runInContext('captureResolutionEditor()',h.context);assert.ok(validateResolutionDraft(draft).errors.some(e=>e.includes('unresolved questions')));
  h.$('resolutionUnresolvedQuestions').value='';h.$('resolutionFinalRuling').value='No reward applies; source conditions were not met.';draft=vm.runInContext('captureResolutionEditor()',h.context);
  assert.deepEqual(validateResolutionDraft(draft).errors,[]);const payload=finalResolutionPayload(draft);assert.equal(payload.resolution_status,'RESOLVED');assert.deepEqual(payload.unresolved_questions,[]);
  const changes=resolutionDifferences(buildResolutionDraft({proposal:h.proposal}),draft);assert.ok(changes.some(c=>c.path==='resolution_status'));assert.ok(changes.some(c=>c.path==='unresolved_questions'));assert.equal(h.session.engine_proposal.resolution_status,'GM_REVIEW_REQUIRED');
});
test('editing review controls refreshes approval availability without rerendering or applying',()=>{
  const h=harness(),start=source.indexOf('function refreshResolutionApprovalState('),end=source.indexOf('\nfunction ',start+1);assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),h.context);
  assert.match(source,/manualResolutionForm'\)\.oninput=refreshResolutionApprovalState/);assert.match(source,/manualResolutionForm'\)\.onchange=refreshResolutionApprovalState/);
  vm.runInContext('refreshResolutionApprovalState()',h.context);assert.equal(h.$('finalizeResolutionBtn').disabled,true);
  h.$('resolutionFinalStatus').value='RESOLVED';h.$('resolutionUnresolvedQuestions').value='';vm.runInContext('refreshResolutionApprovalState()',h.context);assert.equal(h.$('finalizeResolutionBtn').disabled,false);assert.equal(h.tracker.disabled,false);
  h.context.canEditGame=()=>false;vm.runInContext('refreshResolutionApprovalState()',h.context);assert.equal(h.$('finalizeResolutionBtn').disabled,true);assert.equal(h.tracker.disabled,true);
  h.context.canEditGame=()=>true;h.session.status='FINALIZED';vm.runInContext('refreshResolutionApprovalState()',h.context);assert.equal(h.$('finalizeResolutionBtn').disabled,true);assert.equal(h.tracker.disabled,true);
});
