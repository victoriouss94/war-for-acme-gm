export function complexNightFixture(){
  const players=Array.from({length:40},(_,index)=>({id:'p'+(index+1),name:'Audit Player '+(index+1),alive:true,roleId:'r'+(index+1),currentFactionId:[8,19,27].includes(index+1)?'den':'village'}));
  const roles=players.map(player=>({id:player.roleId,name:'Audit Role '+player.id.slice(1),tags:[],passives:[],version:1}));
  const role=id=>roles.find(r=>r.id==='r'+id);
  role(14).passives=['Reflection'];role(24).passives=['Death Immunity'];role(25).passives=['Bulletproof / Passive Immunity'];role(26).passives=['Counterattack'];
  role(28).modes=[{id:'shield',name:'Shield Form',immunities:['Death Immunity']},{id:'open',name:'Open Form',immunities:[]}];
  players[27].currentModeId='shield';
  const a=(id,name,actor,target,extra={})=>({id,name,sourcePlayerId:'p'+actor,targetIds:(Array.isArray(target)?target:[target]).map(n=>'p'+n),...extra});
  const actions=[
    a('block-striker','Roleblock',2,1),a('guarantee','Action Success Guarantee',3,1),a('protect','Protect',5,4),a('protected-pik','Personal Instant Kill',1,4),
    a('swap','Place Swap',6,[7,8]),a('ask','Basic Ask',9,7),a('swapped-kill','Personal Instant Kill',6,7),
    a('redirect','Redirect',9,10,{parameters:{fromTargetId:'p10',redirectTargetId:'p11',targetActionId:'guarded-kill'}}),a('guard','Guard',12,11),a('guarded-kill','Personal Instant Kill',6,10),
    a('reflected-mark','Mark',13,14),a('super-protect','Super Protect',15,16),a('super-kill','Super Kill',17,16),a('omega','Omega Kill',19,16),
    a('poison','Poison',17,18),a('heal','Heal',21,18),a('convert','Convert',19,20,{sourceFactionId:'den'}),a('converted-kill','Personal Instant Kill',23,20),
    a('saved-kill','Personal Instant Kill',23,22),a('save','Save',21,22),a('immune-kill','Super Kill',23,24),a('counter-kill','Personal Instant Kill',25,26),
    a('mode-kill','Den Regular Kill',27,28,{sourceFactionId:'den'}),a('control','Audit Wheel',29,30,{resolutionCategory:'CONTROL',engineBehavior:{effect:'GENERATE_ACTION',tags:['ACTIVE_ACTION','BLOCKABLE']},parameters:{controlPool:['Protect','Super Protect']}}),
    a('generated-protected-kill','Personal Instant Kill',23,30),a('steal','Steal',31,32,{parameters:{targetGrantId:'grant',uses:1}}),a('extra','Additional Uses',33,32,{parameters:{targetGrantId:'grant',uses:2}}),
    a('watch','Watch',34,4),a('track','Track',35,1),a('amplify','Ability Amplify',36,37),a('amplified-protect','Protect',38,39),a('amplified-kill','Personal Instant Kill',37,39),
    a('trigger-mark','Mark',34,40,{parameters:{conditionMet:true}}),a('block-grant','Roleblock',2,32),a('blocked-grant-kill','Personal Instant Kill',32,38,{abilityId:'kill',playerAbilityGrantId:'grant'})
  ];
  return {gameId:'complex-audit',resolutionId:'complex-night',round:3,phase:'Night',seed:'complex-audit-fixed',players,roles,actions,
    factions:[{id:'village',name:'Villagers'},{id:'den',name:'Den'}],abilities:[{id:'kill',name:'Personal Instant Kill'}],
    grants:[{id:'grant',player_id:'p32',ability_id:'kill',uses_remaining:3,version:1,stealable:true}]};
}
