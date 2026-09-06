import {resolveNightDeterministically} from '../../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../../js/resolution-editor.js';

export function statusResolutionFixture(gameId='__AUDIT_GAME_UUID__'){
  const players=['actor','target'].map(id=>({id:`audit-${id}`,gameId,name:`Audit ${id}`,alive:true,roleId:'audit-role',currentFactionId:'audit-town'}));
  const roles=[{id:'audit-role',gameId,name:'Audit Status Role',roleType:'STANDARD',factionId:'audit-town',tags:['Drunk','Sober'],enabled:true}];
  const abilities=['Drunk','Sober'].map(name=>({id:`audit-${name.toLowerCase()}`,gameId,name,phase:'Night',definition:`Apply ${name} until the hanging.`,enabled:true}));
  const factions=[{id:'audit-town',gameId,name:'Audit Town',class:'VILLAGER'}];
  const actions=abilities.map((ability,index)=>({id:`audit-action-${index}`,gameId,name:ability.name,sourceType:'PLAYER',sourcePlayerId:players[index].id,abilityId:ability.id,targetIds:[players[1-index].id],targetType:'PLAYER',status:'QUEUED'}));
  const proposal=resolveNightDeterministically({gameId,round:0,phase:'Night',players,roles,abilities,factions,actions});
  const ruling=finalResolutionPayload(buildResolutionDraft({proposal,actions,players}));
  return {document:{game:{id:gameId,name:'Rollback status ruling audit',status:'SETUP',currentDay:0,currentPhase:'Night'},data:{gameId,players,roles,abilities,factions,actions:[],rules:[],history:[]}},actions,ruling,proposal};
}
