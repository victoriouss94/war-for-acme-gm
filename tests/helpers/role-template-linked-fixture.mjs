import {templateFixture} from './role-template-fixture.mjs';
export function linkedTemplate(){
  const f=templateFixture();
  f.template.roles=[f.template.role,{id:'source-other-role',name:'Other Role'}];
  f.template.role.mechanicalStatements=[{type:'ACTIVE_ABILITY',sourceRoleId:f.template.role.id,sourceAbilityId:'ask',
    originalText:'Synthetic Ask source-document audit-role',sourceDocumentId:'source-document',baseStandardAbilityId:'global:ask',
    targeting:{type:'ONE_PLAYER',selectionRuleType:'HARD_SELECTION_RESTRICTION',targetRoleRestrictions:['source-other-role'],targetFactionRestrictions:['village']}}];
  f.template.role.metadata={modeId:'import:alt'};
  return f;
}
