export function derivedReviewFixture({malformed=false}={}){
  const roles=[
    {id:'r-idless',name:'Idless role',sourceLocation:'page 2',understanding:{mechanics:[{type:'ACTIVE_ABILITY',originalText:'First unresolved action',sourceAbilityId:'a'},{type:'PASSIVE',originalText:'Unicode \u{1f6e1}\ufe0f defense',summary:'  Needs\nreview  '}]}},
    {id:'r-legacy',name:'Legacy role',mechanic_understanding:{mechanics:[{mechanic_id:'legacy-role-id',mechanic_type:'active ability',original_text:'Legacy action',source_ability_id:'a',requires_review:true,interpretation_state:'VERIFIED',confidence:1}]}},
    {id:'r-empty',name:'Empty entries',understanding:{mechanics:[null,{}, {name:'Named mechanic',interpretationState:'UNRESOLVED',confidence:1}]}}
  ].map(r=>({roleType:'STANDARD',slotCount:1,factionId:'town',tags:[],...r}));
  const abilities=[
    {id:'a',name:'Ability A',sourceLocation:'page 3',mechanicalStatements:[{original_text:'Idless ability source',effect:'Review this effect'}]},
    {id:'a-legacy',name:'Legacy ability',mechanical_statements:[{mechanicId:'legacy-ability-id',mechanicType:'status effect',originalText:'Legacy ability source',requires_review:true,interpretationState:'HIGH_CONFIDENCE',confidence:1}]},
    {id:'a-state',name:'Unknown state',understanding:{mechanics:[{id:'unknown-state-id',originalText:'Unknown state source',interpretationState:'NOT_A_STATE',confidence:1}]}},
    {id:'a-blank-components',name:'No unknowns',understanding:{mechanics:[{id:'no-review',originalText:'Known source',interpretationState:'VERIFIED',confidence:1,unresolvedComponents:['',' ']}]}}
  ];
  if(malformed)for(const [index,confidence] of ['not-a-number','1e999999999','1e-999999999','Infinity','NaN'].entries())abilities.push({id:`a-malformed-${index}`,name:'Invalid confidence',mechanicalStatements:[{id:`bad-confidence-${index}`,originalText:'Confidence needs review',confidence,interpretationState:'VERIFIED'}]});
  return {game:{id:'__DERIVED_GAME_UUID__',name:'Rollback derived reviews',status:'SETUP',currentDay:0,currentPhase:'Night'},data:{roles,abilities,factions:[{id:'town',name:'Town',class:'VILLAGER'}],players:[],actions:[],rules:[],history:[]}};
}
