import {statusResolutionFixture} from './status-resolution-fixture.mjs';
import {resolveNightDeterministically} from '../../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../../js/resolution-editor.js';

export function modeIntelFixture({invisible=false}={}){
  const {document}=statusResolutionFixture();document.game.name='Rollback current mode Intel audit';
  document.data.roles=[
    {id:'audit-scout',name:'Audit Scout',roleType:'STANDARD',factionId:'audit-town',tags:['Basic Ask','Advanced Ask','Alignment Ask'],enabled:true},
    {id:'audit-hidden',name:'Actual Hidden Role',roleType:'STANDARD',factionId:'audit-town',tags:[],enabled:true,startingModeId:'audit-cover',modes:[{id:'audit-cover',name:'Cover',abilityIds:[],investigationAppearance:{basicAsk:'Apparent alignment',advancedAsk:'Apparent role',factionAppearance:'Apparent faction',invisible}}]}
  ];
  document.data.players[0].roleId='audit-scout';
  Object.assign(document.data.players[1],{roleId:'audit-hidden',currentModeId:'audit-cover'});
  document.data.abilities=['Basic Ask','Advanced Ask','Alignment Ask'].map((name,index)=>({id:`audit-intel-${index}`,name,phase:'Night',activePassive:'ACTIVE',enabled:true,definition:'Investigate the chosen player.'}));
  const actions=document.data.abilities.map((ability,index)=>({id:`audit-intel-action-${index}`,name:ability.name,sourceType:'PLAYER',sourcePlayerId:'audit-actor',abilityId:ability.id,targetIds:['audit-target'],targetType:'PLAYER',status:'QUEUED'}));
  const proposal=resolveNightDeterministically({...document.data,gameId:'__AUDIT_GAME_UUID__',round:0,phase:'Night',actions});
  const ruling=finalResolutionPayload(buildResolutionDraft({proposal,actions,players:document.data.players}));
  return {document,actions,proposal,ruling,expected:actions.map((action,index)=>({actionId:action.id,reason:`${action.name} result: ${invisible?'No result':['Apparent alignment','Apparent role','Apparent faction'][index]}.`}))};
}
