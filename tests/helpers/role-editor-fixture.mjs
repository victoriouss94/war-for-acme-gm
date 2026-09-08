import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {formatRoleModeAssignments,parseRoleModeAssignments,normalizeRoleModes,roleModeContext} from '../../js/role-modes.js';

export const abilities=[{id:'ask',name:'Ask'},{id:'guard',name:'Guard'},{id:'passive',name:'Reflection'},{id:'passive2',name:'Armor'}];
export const source={id:'audit-role',name:'Synthetic Role',factionId:'village',roleType:'STANDARD',slotCount:1,
  tags:abilities.map(a=>a.name),activeAbilityId:'ask',passiveAbilityId:'passive',roleWideAbilityIds:[],
  roleWidePassiveAbilityIds:['passive','passive2'],startingModeId:'import:alt',modeSelectionPolicy:'CHOOSE_BEFORE_ACTION',
  modes:[{id:'import:robot',name:'Robot',abilityIds:['ask']},
    {id:'import:alt',name:'Alt',abilityIds:['guard'],restrictions:['No faction kill'],
    statusBehavior:['Ignore Mark'],investigationAppearance:{basicAsk:'Neutral',invisible:true,rules:['Hidden unless revealed']},
    abilityUses:{guard:2},resourcePools:{energy:3},switchRules:{type:'ABILITY_TRIGGERED',cost:'1 energy',cooldownCycles:2,uses:3,targetModeIds:['import:robot'],automatic:true},
    sourceText:'Original source',sourceLocation:'page 2',reviewRequired:true,reviewWarnings:['Check custom timing']}]
};
const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
export function formFixture(role=structuredClone(source)){
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,hidden:false,focus(){}});return elements.get(id)};
  const context={state:{roles:[role],abilities},editingRoleId:null,editingRoleVersion:null,selectedRoleAbilityIds:new Set(),
    $:get,canEditRoles:()=>true,roleById:id=>id===role.id?role:null,factionById:id=>id==='village'?{id}:null,
    normalized:v=>String(v??'').trim().toLowerCase(),formatRoleModeAssignments,parseRoleModeAssignments,
    ROLE_TYPES:{STANDARD:'STANDARD',BASIC:'BASIC'},ABILITY_DATA_STATUSES:{COMPLETE:'COMPLETE',INTENTIONALLY_NONE:'INTENTIONALLY_NONE'},
    formatDateTime:()=>'',renderRoleAbilityPicker(){},syncRoleTypeEditor(){},renderRoleModifierEditor(){},
    showRoleError:message=>{context.error=message}};
  for(const field of ['alignment','description','cooldowns','winCondition','notes','gmNotes'])role[field]??='';
  for(const field of ['immunities','restrictions','labels'])role[field]??=[];
  role.version=1;role.enabled=true;
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function roleFormValues('),app.indexOf('function syncRoleTypeEditor(')),context);
  vm.runInContext(app.slice(app.indexOf('function beginRoleEdit('),app.indexOf('function duplicateRole(')),context);
  context.beginRoleEdit(role.id);
  return {context,get,role,save:()=>context.roleFormValues()};
}
