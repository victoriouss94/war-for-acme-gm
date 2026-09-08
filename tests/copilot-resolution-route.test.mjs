import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {normalizeCopilotRequest,normalizeCopilotResponse} from '../js/copilot.js';

const source=await readFile(new URL('../js/app.js',import.meta.url),'utf8');
const ask=source.slice(source.indexOf('async function askCopilot('),source.indexOf('function deterministicPhaseResult('));
const phase=source.slice(source.indexOf('function deterministicPhaseResult('),source.indexOf('function deterministicAbilityResult('));
async function askThroughApp(message,task='auto'){
  const thread=[],views=[],calls=[],elements={copilotPrompt:{value:message},copilotTask:{value:task},copilotDepth:{value:'standard'}};
  const context={copilotPending:false,canEditGame:()=>true,$:id=>elements[id]??={},currentCopilotThread:()=>thread,selectedKnowledgeFile:null,
    normalizeCopilotRequest,normalizeCopilotResponse,phaseOne:{conversationId:''},setCopilotStatus:()=>{},renderCopilot:()=>{},now:()=>new Date().toISOString(),cloudVersion:1,
    normalized:value=>String(value).toLowerCase(),refreshGamePhaseContext:async()=>{},gamePhaseContext:{current:{id:'phase',phase:'Night',cycle:0,actions:[{id:'action'}]},phases:[]},phaseAdvancePreview:{},
    phaseHasResolutionWork:()=>true,phaseTitle:()=> 'Night 0',showView:value=>views.push(value),state:{players:[]},effectiveAbilitiesForPlayer:()=>[],
    queuePhaseSummary:()=>({submittedCount:1,expectedCount:1,missing:[]}),nextPhase:()=>({phase:'Day',cycle:1}),
    deterministicRosterCommand:async()=>null,deterministicAbilityCommand:async()=>null,currentGame:()=>({id:'game'}),
    GMCloud:{askCopilot:async(_game,request)=>{calls.push(request);return {result:{answer:'Ordinary explanation'}}}},friendlyCopilotError:error=>error.message};
  vm.createContext(context);vm.runInContext(ask+phase+'\nglobalThis.ask=askCopilot;',context);
  await context.ask();return {thread,views,calls,context};
}

for(const [message,task] of [['process all actions','auto'],['analyze tonight','assistant'],['please do it','resolve_actions']]){
  test('chat routes '+message+' to the existing deterministic queue without AI',async()=>{
    const result=await askThroughApp(message,task);
    assert.equal(result.calls.length,0);assert.deepEqual(result.views,['queueView']);
    assert.match(result.thread[1].result.answer,/Resolve Night/);
    assert.equal(result.thread[1].model,'deterministic');assert.equal(result.context.copilotPending,false);
  });
}

test('ordinary explanations keep the existing assistant path',async()=>{
  const result=await askThroughApp('Explain the Mirror ability','explain_role');
  assert.equal(result.calls.length,1);assert.equal(result.thread[1].content,'Ordinary explanation');
});
