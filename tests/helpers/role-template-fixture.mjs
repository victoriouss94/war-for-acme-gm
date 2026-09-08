import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as modes from '../../js/role-modes.js';
import {normalizeRoleSetup,ROLE_TYPES,ABILITY_DATA_STATUSES} from '../../js/player-setup.js';
import {normalizeRoleUnderstanding,remapSetupReferences} from '../../js/mechanics.js';
import {source,abilities} from './role-editor-fixture.mjs';
const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
export function templateFixture({basic=false,missing=false,ambiguous=false,authorized=true}={}){
  const sourceRole=structuredClone(source);sourceRole.slotCount=4;
  if(basic)Object.assign(sourceRole,{roleType:'BASIC',tags:[],modes:[],activeAbilityId:'',passiveAbilityId:'',roleWideAbilityIds:[],roleWidePassiveAbilityIds:[]});
  const template={key:'source-template',role:sourceRole,abilities:structuredClone(abilities),factions:[{id:'village',name:'Village',class:'VILLAGER'}],sourceGameId:'source-game',sourceGameName:'Source'};
  const destination=abilities.filter(a=>!missing||a.id!=='guard').map(a=>({...a,id:'dest-'+a.id}));
  if(ambiguous)destination.push({...destination[0],id:'ambiguous-ask'});
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,hidden:false,focus(){},classList:{toggle(){}},closest(){return {classList:{toggle(){}}}}});return elements.get(id)};
  const game={id:'destination-game'},calls=[],context={...modes,normalizeRoleSetup,normalizeRoleUnderstanding,remapSetupReferences,ROLE_TYPES,ABILITY_DATA_STATUSES,
    state:{roles:[],abilities:destination,factions:[{id:'destination-faction',name:'Village',class:'VILLAGER'}]},editingRoleId:null,editingRoleVersion:null,selectedRoleAbilityIds:new Set(),roleTemplateDraft:null,
    currentGame:()=>game,availableRoleTemplates:[template],$:get,canEditRoles:()=>authorized,id:()=> 'new-template-role',now:()=> '2026-09-08T14:07:00Z',normalized:v=>String(v??'').trim().toLowerCase(),
    roleById:id=>context.state.roles.find(role=>role.id===id),factionById:id=>context.state.factions.find(faction=>faction.id===id),
    renderRoleAbilityPicker(){},renderRoleEditorAccess(){},renderRoleModifierEditor(){},formatDateTime:()=>'',save:(...args)=>calls.push(args),GMCloud:{user:()=>({id:'audit-owner'}),track(){}},
    showRoleError:message=>{context.error=message}};
  vm.createContext(context);
  for(const [start,end] of [['function normalizeRole(','function normalizePlayer('],['function roleFormValues(','function renderRoleEditorAccess('],['function clearRoleForm(','function duplicateRole('],['function addSelectedRoleTemplate(','function renderDashboard('],['function resetEditorContext(','async function openGame(']])vm.runInContext(app.slice(app.indexOf(start),app.indexOf(end)),context);
  const saveLine=app.split(/\r?\n/).find(line=>line.startsWith("$('addRoleBtn').onclick="));
  vm.runInContext(saveLine,context);context.clearRoleForm();get('roleTemplateSelect').value=template.key;
  return {context,game,get,calls,template,load:()=>context.addSelectedRoleTemplate(),fields:()=>context.roleFormValues(),save:()=>get('addRoleBtn').onclick()};
}
