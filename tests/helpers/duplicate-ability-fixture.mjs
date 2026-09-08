import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {remapSetupReferences,normalizeAbilityUnderstanding} from '../../js/mechanics.js';
const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
export function duplicateAbilityFixture({authorized=true,legacy=false}={}){
  const source={id:'source-ability',name:'Synthetic Ask',defaultName:'Ask',builtIn:true,gameId:'synthetic-game',category:'Investigation',phase:'Night',mechanics:['Ask'],definition:'Synthetic investigation',
    revisions:[{definition:'Older definition'}],standardAbilityId:'global:ask',sourceDocumentId:'source-document',
    mechanicalStatements:[{id:'original-mechanic',type:'ACTIVE_ABILITY',sourceAbilityId:'source-ability',sourceAbilityName:'Synthetic Ask',sourceRoleId:'existing-role',originalText:'Original source-ability evidence',targeting:{targetRoleRestrictions:['existing-role']},dependencies:['external ability']}],
    metadata:{abilityId:'source-ability',targetAbilityId:'external-ability',modeId:'existing-mode'}};
  source.understanding=normalizeAbilityUnderstanding(source);
  if(legacy){source.mechanical_statements=source.mechanicalStatements;delete source.mechanicalStatements;source.mechanic_understanding=source.understanding;delete source.understanding;}
  let sequence=0;const saves=[],context={state:{abilities:[source],roles:[{id:'existing-role',activeAbilityId:source.id}],players:[{id:'player',roleId:'existing-role'}]},
    canEditGame:()=>authorized,remapSetupReferences,currentGame:()=>({id:'synthetic-game'}),id:()=> 'copy-'+(++sequence),normalized:v=>String(v??'').trim().toLowerCase(),save:(...args)=>saves.push(args)};
  vm.createContext(context);vm.runInContext(app.slice(app.indexOf('function duplicateAbility('),app.indexOf('function resetBuiltInAbility(')),context);
  return {context,source,saves,duplicate:()=>context.duplicateAbility(source.id)};
}
