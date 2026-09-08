import {complexNightFixture} from './complex-night-fixture.mjs';

// Give the existing synthetic interaction matrix real encyclopedia ownership
// and targeting metadata so it can traverse the public action queue.
export function complexCloudFixture(){
  const input=complexNightFixture(),gameId='__AUDIT_GAME_UUID__';
  const names=[...new Set([...input.actions.map(a=>a.name),'Reflection','Death Immunity','Counterattack','Bulletproof / Passive Immunity'])];
  const abilities=names.map((name,index)=>({id:name==='Personal Instant Kill'?'kill':'audit-ability-'+index,name,phase:['Reflection','Death Immunity','Counterattack','Bulletproof / Passive Immunity'].includes(name)?'Passive':'Night',enabled:true,targeting:{type:name==='Place Swap'?'MULTIPLE_PLAYERS':'ONE_PLAYER',minTargets:1,maxTargets:2}}));
  const control=abilities.find(a=>a.name==='Audit Wheel');control.resolutionCategory='CONTROL';control.engineBehavior={effect:'GENERATE_ACTION',tags:['ACTIVE_ACTION','BLOCKABLE']};
  const roles=input.roles.map(role=>({...role,roleType:'STANDARD',enabled:true,factionId:input.players.find(p=>p.roleId===role.id).currentFactionId,tags:[...new Set(input.actions.filter(a=>input.players.find(p=>p.id===a.sourcePlayerId)?.roleId===role.id).map(a=>a.name))]}));
  const actions=input.actions.map(action=>({...action,sourceType:'PLAYER',abilityId:abilities.find(a=>a.name===action.name).id,targetType:action.targetIds.length>1?'MULTIPLE_PLAYERS':'ONE_PLAYER',...(action.playerAbilityGrantId?{playerAbilityGrantId:'__AUDIT_GRANT_UUID__'}:{}),...(action.parameters?.targetGrantId?{parameters:{...action.parameters,targetGrantId:'__AUDIT_GRANT_UUID__'}}:{})}));
  return {document:{game:{id:gameId,name:'Rollback complex night audit',status:'SETUP',currentDay:0,currentPhase:'Night'},data:{gameId,players:input.players,roles,abilities,factions:input.factions,actions:[],rules:[],history:[]}},actions,seed:input.seed};
}
