import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('async function submitQueuedAction()'),source.indexOf('function editQueuedAction('));
function harness({reject=false,editable=true,valid=true}={}){
  const button={disabled:false};let calls=0;
  const draft=()=>({errors:valid?[]:['Invalid attempt'],payload:valid?{}:null});
  const render=()=>{button.disabled=!editable||!valid};
  const context={actionDraft:draft,alert:()=>{},$:()=>button,currentGame:()=>({id:'isolated'}),cloudVersion:1,editingActionId:null,
    GMCloud:{queuePlayerAction:async()=>{calls++;if(reject)throw new Error('Test failure');return {}}},
    applyCloudDocument:()=>{},refreshGamePhaseContext:async()=>{},resetActionBuilder:()=>{valid=false;render()},renderAll:render,renderActionBuilder:render};
  vm.createContext(context);vm.runInContext(handler,context);
  return {button,submit:()=>context.submitQueuedAction(),calls:()=>calls};
}
test('successful queue submission keeps cleared builder disabled',async()=>{
  const h=harness();await h.submit();assert.equal(h.calls(),1);assert.equal(h.button.disabled,true);
});
test('failed queue submission restores valid retry availability',async()=>{
  const h=harness({reject:true});await h.submit();assert.equal(h.button.disabled,false);
});
test('failed queue submission does not enable a locked phase',async()=>{
  const h=harness({reject:true,editable:false});await h.submit();assert.equal(h.button.disabled,true);
});
test('invalid draft never calls persistence',async()=>{
  const h=harness({valid:false});await h.submit();assert.equal(h.calls(),0);
});
