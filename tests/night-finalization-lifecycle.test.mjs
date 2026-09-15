import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {phaseIsFinalized,phaseNeedsResolution,nextPhase} from '../js/phase-controller.js';
import {resolveNightDeterministically} from '../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload,validateResolutionDraft} from '../js/resolution-editor.js';
import {validateManualResolution} from '../js/resolution.js';

test('empty night uses the normal engine, structured validator and legacy finalization adapter',()=>{
 const input={gameId:'empty',round:2,phase:'Night',players:[],actions:[]};
 const before=JSON.stringify(input),proposal=resolveNightDeterministically(input);
 const draft=buildResolutionDraft({proposal,actions:[],players:[]}),payload=finalResolutionPayload(draft);
 assert.equal(JSON.stringify(input),before);
 assert.deepEqual(validateResolutionDraft(draft,{forApproval:true}).errors,[]);
 assert.deepEqual(validateManualResolution('MODIFY',payload),[]);
 assert.deepEqual(payload.action_results,[]);
 assert.ok(payload.expected_results.length);
});
test('empty night can resolve; finalized night cannot accept ordinary actions or resolve again',()=>{
 const night={id:'n',phase:'Night',cycle:2,actions:[],resolutionSummary:{}};
 assert.equal(phaseNeedsResolution(night),true);assert.equal(phaseIsFinalized(night),false);
 night.resolutionSummary={status:'FINALIZED',official:true};
 assert.equal(phaseIsFinalized(night),true);assert.equal(phaseNeedsResolution(night),false);
 assert.deepEqual(nextPhase(night),{phase:'Day',cycle:3});
 assert.equal(phaseIsFinalized({...night,resolutionSummary:{status:'REJECTED'}}),false);
});
test('override preserves questions, requires reason, and never permits missing action outcomes',()=>{
 const draft=buildResolutionDraft({proposal:{final_ruling:'GM manually handled the communication.',resolution_status:'GM_REVIEW_REQUIRED',unresolved_questions:['Custom communication handled outside app.']}});
 assert.ok(validateResolutionDraft(draft,{forApproval:true}).errors.length);
 assert.ok(validateResolutionDraft(draft,{forApproval:true,allowWarnings:true}).errors.some(e=>e.includes('reason')));
 draft.why='Handled manually by the GM; communication outcome is known.';
 assert.deepEqual(validateResolutionDraft(draft,{forApproval:true,allowWarnings:true}).errors,[]);
 assert.deepEqual(finalResolutionPayload(draft).unresolved_questions,draft.unresolved_questions);
 assert.ok(validateResolutionDraft(draft,{forApproval:true,allowWarnings:true,actions:[{id:'missing'}]}).errors.length);
});
test('review has finalization and post-finalization advancement controls, with optional AI off',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/id="finalizeResolutionBtn"[^>]*>Finalize Night/);
 assert.match(html,/id="advanceFinalizedNightBtn"/);assert.match(html,/id="nightFinalizationNotice"/);
 assert.match(html,/id="allowResolutionAi" type="checkbox">/);
});

test('actual review controls explain blockers and switch to advancement after finalization',()=>{
 const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
 const start=source.indexOf('function renderNightFinalizationControls('),end=source.indexOf('\nfunction syncResolutionLearningControls(',start);
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false});return elements.get(id)};
 const draft=buildResolutionDraft({proposal:{final_ruling:'Manual review',resolution_status:'GM_REVIEW_REQUIRED',unresolved_questions:['Kup → Ailith: Drunk outcome needs a ruling.']}});
 const session={id:'s',phase_id:'p',status:'DRAFT',submitted_actions:[]},buttons=[{}],advanceButtons=[{}];
 const context={$,currentResolutionSession:()=>session,resolutionEditorDraft:draft,validateResolutionDraft,state:{players:[],roles:[],abilities:[],factions:[]},resolutionPending:false,phaseMutationPending:false,canEditGame:()=>true,gamePhaseContext:{current:{id:'p'}},document:{querySelectorAll:s=>s.includes('"advance"')?advanceButtons:buttons}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 vm.runInContext('renderNightFinalizationControls()',context);
 assert.match($('trackerFinalizationNotice').textContent,/Kup → Ailith/);
 assert.equal($('finalizeResolutionBtn').hidden,false);
 session.status='FINALIZED';vm.runInContext('renderNightFinalizationControls()',context);
 assert.equal($('finalizeResolutionBtn').hidden,true);assert.equal($('manualResolutionForm').hidden,true);
 assert.equal($('advanceFinalizedNightBtn').hidden,false);assert.equal(advanceButtons[0].disabled,false);
});
