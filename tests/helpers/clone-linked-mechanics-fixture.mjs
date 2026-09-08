export function withLinkedMechanics(data){
  const ask=data.abilities.find(a=>a.id==='ask');
  ask.definition='Synthetic faction ability';ask.phase='Night';
  ask.understanding={factionAction:true,sourceFactionIds:['village'],baseStandardAbilityId:'global:ask',
    targeting:{type:'ONE_PLAYER',selectionRuleType:'HARD_SELECTION_RESTRICTION',minTargets:1,maxTargets:1,selfAllowed:true,targetFactionRestrictions:['village'],targetRoleRestrictions:['audit-role']},
    mechanics:[{id:'source-mechanic',sourceAbilityId:'ask',sourceRoleId:'audit-role',sourceDocumentId:'source-document',baseStandardAbilityId:'global:ask',originalText:'ask village audit-role',summary:'Ask',type:'ACTIVE_ABILITY'}]};
  data.roles[0].mechanicalStatements=[{source_role_id:'audit-role',source_ability_id:'ask',targeting:{target_faction_restrictions:['village']},originalText:'audit-role'}];
  data.rules.push({id:'rule',title:'Link test',metadata:{sourceRoleId:'audit-role',sourceFactionIds:['village'],modeIds:['import:alt']},description:'audit-role village import:alt'});
}
