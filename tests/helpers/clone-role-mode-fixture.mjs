import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as roleModes from '../../js/role-modes.js';
import {source,abilities} from './role-editor-fixture.mjs';

const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
export async function cloneFixture(){
  const sourceData={roles:[structuredClone(source)],abilities:structuredClone(abilities),factions:[{id:'village',name:'Village'}],settings:{labels:{}},rules:[]},original=structuredClone(sourceData);
  let payload,sequence=0;
  const context={...roleModes,gameIndex:{games:[{id:'source-game',name:'Source',startingDay:0}]},loadGameData:()=>sourceData,id:()=>`new-${++sequence}`,now:()=>new Date().toISOString(),normalizeMeta:g=>g,normalizeRule:r=>r,baseGameData:()=>({}),GMCloud:{createGame:async data=>{payload=data;return [{}]}},localStorage:{setItem(){}},gameDataKey:()=>'',saveIndex(){},renderGames(){},alert:message=>{throw new Error(message)}};
  vm.createContext(context);vm.runInContext(app.slice(app.indexOf('async function cloneSetup('),app.indexOf('function recordStoredGameEvent(')),context);
  await context.cloneSetup('source-game');
  return {payload,sourceData,original};
}
