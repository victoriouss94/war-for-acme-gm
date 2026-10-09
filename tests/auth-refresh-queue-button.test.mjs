import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const chrome=source.slice(source.indexOf('function renderChrome(){'),source.indexOf('function renderAccount(){'));
const start=source.indexOf('async function handleCloudAuth(');
// Exercise the existing same-user branch only; unexpected fallthrough fails.
const auth=source.slice(start,source.indexOf('  cloudChannelGameId=null;',start))+"throw new Error('Unexpected auth fallthrough');}";
for(const event of ['TOKEN_REFRESHED','SIGNED_IN'])for(const disabled of [true,false])for(const editable of [true,false]){
  test(`${event} preserves queue disabled=${disabled} with editable=${editable}`,async()=>{
    const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{disabled:id==='addActionBtn'?disabled:false,value:'unsaved draft',append:()=>{}});return elements.get(id)};
    const session={user:{id:'isolated-user'}};
    const context={$:get,currentGame:()=>({id:'isolated',name:'Isolated',memberRole:editable?'owner':'viewer'}),state:{},cloudSession:session,
      canEditGame:()=>editable,formatDateTime:()=>'',GMCloud:{user:()=>({username:'test'})},deviceGameSnapshot:[],gameIndex:{games:[]},option:()=>({}),
      document:{body:{classList:{remove:()=>{},toggle:()=>{}}},querySelectorAll:()=>[]}};
    vm.createContext(context);vm.runInContext(chrome+auth,context);
    await context.handleCloudAuth(session,event);
    assert.equal(get('addActionBtn').disabled,disabled||!editable);
    assert.equal(get('actionName').value,'unsaved draft');
  });
}
