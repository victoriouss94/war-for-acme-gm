import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('full role slots show an inline error without opening a blocking alert',()=>{
  const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  const handler=source.split('\n').find(line=>line.startsWith("$('addPlayerBtn').onclick="));
  const fields={addPlayerBtn:{},playerName:{value:'Second'},playerRole:{value:'role'},playerFormNotice:{}};
  let message='';
  vm.runInNewContext(handler,{$:id=>fields[id],roleById:()=>({id:'role',name:'Test Role',slotCount:1}),state:{players:[{roleId:'role'}]},setNotice:(_,value)=>{message=value},alert:()=>{throw Error('Blocking dialog opened')}});
  fields.addPlayerBtn.onclick();
  assert.match(message,/no available role slots/);
  assert.equal(fields.playerName.value,'Second');
});
