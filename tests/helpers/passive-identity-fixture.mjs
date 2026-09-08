import {lethalResolutionFixture} from './lethal-resolution-fixture.mjs';
import {resolveNightDeterministically} from '../../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../../js/resolution-editor.js';

export function passiveIdentityFixture({swapRoles=false}={}){
  const {document,actions}=lethalResolutionFixture();
  document.game.name='Rollback passive source identity audit';
  document.data.roles[0].roleWidePassiveAbilityIds=['audit-bulletproof'];
  document.data.roles[0].version=4;
  document.data.roles[1].roleWidePassiveAbilityIds=['audit-counterattack'];
  document.data.roles[1].version=7;
  document.data.abilities.unshift(
    {id:'unrelated-counterattack',name:'Archive Counterattack',activePassive:'PASSIVE',enabled:true},
    {id:'unrelated-bulletproof',name:'Archive Bulletproof',activePassive:'PASSIVE',enabled:true}
  );
  if(swapRoles){
    document.data.players.push({...document.data.players[0],id:'audit-swapper',name:'Audit swapper',roleId:'audit-swap-role'});
    document.data.roles.push({id:'audit-swap-role',name:'Audit swap role',roleType:'STANDARD',factionId:'audit-town',tags:['Role Swap'],enabled:true});
    document.data.abilities.push({id:'audit-role-swap',name:'Role Swap',phase:'Night',enabled:true,targeting:{type:'MULTIPLE_PLAYERS',minTargets:2,maxTargets:2}});
    actions.unshift({id:'audit-swap-action',sourceType:'PLAYER',sourcePlayerId:'audit-swapper',abilityId:'audit-role-swap',targetIds:['audit-actor','audit-target'],targetType:'MULTIPLE_PLAYERS',status:'QUEUED'});
  }
  const proposal=resolveNightDeterministically({...document.data,gameId:'__AUDIT_GAME_UUID__',round:0,phase:'Night',actions});
  const ruling=finalResolutionPayload(buildResolutionDraft({proposal,actions,players:document.data.players}));
  return {document,actions,proposal,ruling,expectedAlive:swapRoles?['audit-actor','audit-target','audit-swapper']:['audit-actor'],expectedPassives:swapRoles?[
    {playerId:'audit-target',abilityId:'audit-bulletproof',roleId:'audit-attacker',roleVersion:4}
  ]:[
    {playerId:'audit-actor',abilityId:'audit-bulletproof',roleId:'audit-attacker',roleVersion:4},
    {playerId:'audit-target',abilityId:'audit-counterattack',roleId:'audit-counter',roleVersion:7}
  ]};
}
