import {statusResolutionFixture} from './status-resolution-fixture.mjs';

export function modeRoleReassignmentFixture(){
  const {document}=statusResolutionFixture();
  document.game.name='Rollback role reassignment mode audit';
  document.data.abilities=[{id:'audit-ask',name:'Basic Ask',phase:'Night',definition:'Inspect the target faction.',enabled:true}];
  document.data.roles=['old','new'].map(prefix=>({id:`audit-${prefix}`,name:`Audit ${prefix}`,roleType:'STANDARD',factionId:'audit-town',tags:['Basic Ask'],enabled:true,startingModeId:`${prefix}-calm`,modeSelectionPolicy:'CURRENT_ONLY',modes:[
    {id:`${prefix}-calm`,name:`${prefix} calm`,abilityIds:[],switchRules:{}},
    {id:'shared-mode',name:`${prefix} active`,abilityIds:['audit-ask'],immunities:['Personal Instant Kill'],switchRules:{}}
  ]}));
  document.data.players[0].roleId='audit-old';document.data.players[1].roleId='audit-new';
  return {document,action:{id:'audit-mode-action',sourceType:'PLAYER',sourcePlayerId:'audit-actor',abilityId:'audit-ask',modeId:'shared-mode',targetIds:['audit-target'],targetType:'PLAYER',status:'QUEUED'}};
}
