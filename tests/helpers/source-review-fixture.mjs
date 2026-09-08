export function sourceReviewFixture(){
  const flavor='A detailed description of the character and their background. '.repeat(4),conditional='If a player chooses a target, the specific interaction needs interpretation. '.repeat(6);
  const mechanic=type=>({id:'verified-'+type,type,originalText:'Verified preserved source.',interpretationState:'VERIFIED',confidence:1,requiresReview:false});
  const role=(id,extra={})=>({id,name:id,roleType:'STANDARD',factionId:'town',slotCount:1,tags:[],sourceText:flavor,...extra});
  const roles=[
    role('supported',{passiveAbilityId:'passive',sourceText:'Whenever this player is targeted, the passive applies. '+flavor}),
    role('short',{passiveAbilityId:'passive',sourceText:'Too little preserved evidence.'}),
    role('unsupported',{passiveAbilityId:'passive'}),
    role('conditional',{activeAbilityId:'active',sourceText:conditional}),
    role('faction',{sourceText:'All players in the den are affected by this rule.'}),
    role('structured-passive',{passiveAbilityId:'passive',understanding:{mechanics:[mechanic('PASSIVE')]}}),
    role('mixed',{passiveAbilityId:'passive',understanding:{mechanics:[mechanic('ACTIVE_ABILITY')]}}),
    role('multiple-owned',{tags:['Active','Passive'],sourceText:conditional}),
    role('two-warnings',{passiveAbilityId:'passive',sourceText:conditional})
  ];
  return {game:{id:'__REVIEW_GAME_UUID__',name:'Rollback source review audit',status:'SETUP',currentDay:0,currentPhase:'Night'},data:{roles,abilities:[{id:'active',name:'Active'},{id:'passive',name:'Passive'}],factions:[{id:'town',name:'Town',class:'VILLAGER'}],players:[],actions:[],rules:[],history:[]}};
}

export const expectedSourceReviews=[
  ['conditional','SOURCE_STRUCTURE_MISSING'],['faction','FACTION_SCOPE_NOT_STRUCTURED'],['mixed','POSSIBLY_INVENTED_PASSIVE'],['two-warnings','POSSIBLY_INVENTED_PASSIVE'],['two-warnings','SOURCE_STRUCTURE_MISSING'],['unsupported','POSSIBLY_INVENTED_PASSIVE']
];
