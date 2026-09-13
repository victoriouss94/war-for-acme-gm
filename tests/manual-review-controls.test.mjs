import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildResolutionDraft,validateResolutionDraft,finalResolutionPayload,resolutionDifferences} from '../js/resolution-editor.js';

const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function harness(){
  const proposal={resolution_status:'GM_REVIEW_REQUIRED',unresolved_questions:['Owner: decide the on-death reward.'],final_ruling:'GM must review the source.',action_results:[]},session={id:'session',lock_version:4,status:'DRAFT',engine_proposal:proposal,pre_resolution_state:{players:[]},submitted_actions:[]},elements=new Map(),tracker={disabled:true},$=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,disabled:true});return elements.get(id)};
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
function finalizationHarness(){
  const h=harness(),saved=[],notices=[];h.$('resolutionFinalStatus').value='RESOLVED';h.$('resolutionUnresolvedQuestions').value='';
  Object.assign(h.context,{phaseOne:{modifiers:[]},roleById:()=>null,resolutionDifferences,finalResolutionPayload,
    manualResolutionPayload:()=>({}),validateManualResolution:()=>[],crypto:{randomUUID:()=> 'synthetic-idempotency-key'},
    confirm:()=>true,renderResolutions:()=>{},renderAll:()=>{},refreshOpenGame:async()=>{},refreshAiGmData:async()=>{},refreshPlayerAbilityState:async()=>{},refreshGamePhaseContext:async()=>{},
    setNotice:(element,message)=>{if(message)notices.push(message)},GMCloud:{finalizeResolutionSession:async(...args)=>saved.push(args)}});
  const start=source.indexOf('async function finalizeSelectedResolution('),end=source.indexOf('\nfunction currentCopilotThread(',start);
  vm.runInContext(source.slice(start,end),h.context);
  return {...h,saved,notices,submit:()=>vm.runInContext('finalizeSelectedResolution({preventDefault(){}})',h.context)};
}
for(const decision of ['MODIFY','REJECT'])test('same-session remote revision cannot authorize a stale editor: '+decision,async()=>{
  const h=finalizationHarness();h.$('resolutionDecision').value=decision;h.$('resolutionFinalRuling').value='Local unsaved ruling.';
  h.session.lock_version=5;h.session.engine_proposal={...h.proposal,final_ruling:'New remote ruling.'};
  vm.runInContext('fillResolutionForm(currentResolutionSession())',h.context);
  await h.submit();assert.equal(h.saved.length,0);assert.match(h.notices.join(' '),/changed.*session|session.*changed/i);
  assert.equal(h.$('resolutionFinalRuling').value,'Local unsaved ruling.');
});
test('current editor submits the revision that was actually reviewed',async()=>{
  const h=finalizationHarness();await h.submit();assert.deepEqual(h.notices,[]);assert.equal(h.saved.length,1);assert.equal(h.saved[0][1],4);
});
test('session changes during confirmation cannot upgrade the submitted expected revision',async()=>{
  const h=finalizationHarness();h.context.confirm=()=>{h.session.lock_version=5;return true};
  await h.submit();assert.equal(h.saved.length,1);assert.equal(h.saved[0][1],4);
});
test('explicitly reopening a newer session loads its revision and permits review',async()=>{
  const h=finalizationHarness();h.session.lock_version=5;h.context.loadedResolutionFormId=null;
  vm.runInContext('fillResolutionForm(currentResolutionSession())',h.context);
  h.$('resolutionFinalStatus').value='RESOLVED';h.$('resolutionUnresolvedQuestions').value='';
  await h.submit();assert.deepEqual(h.notices,[]);assert.equal(h.saved.length,1);assert.equal(h.saved[0][1],5);
});
test('stale editor approval controls remain disabled after input changes',()=>{
  const h=finalizationHarness(),start=source.indexOf('function refreshResolutionApprovalState('),end=source.indexOf('\nfunction ',start+1);
  vm.runInContext(source.slice(start,end),h.context);h.session.lock_version=5;
  vm.runInContext('refreshResolutionApprovalState()',h.context);
  assert.equal(h.$('finalizeResolutionBtn').disabled,true);assert.equal(h.tracker.disabled,true);
});
for(const version of [null,undefined,0,NaN])test('unverified reviewed revision is rejected: '+String(version),async()=>{
  const h=finalizationHarness();h.context.loadedResolutionFormVersion=version;await h.submit();
  assert.equal(h.saved.length,0);assert.match(h.notices.join(' '),/reviewed version/);
});
