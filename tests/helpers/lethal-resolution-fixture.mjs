import {statusResolutionFixture} from './status-resolution-fixture.mjs';
import {resolveNightDeterministically} from '../../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../../js/resolution-editor.js';

export function lethalResolutionFixture(){
  const {document}=statusResolutionFixture();
  document.game.name='Rollback generated lethal attempt audit';
  document.data.roles=[
    {id:'audit-attacker',name:'Audit Attacker',roleType:'STANDARD',factionId:'audit-town',tags:['Personal Instant Kill'],passives:['Bulletproof / Passive Immunity'],enabled:true},
    {id:'audit-counter',name:'Audit Counter',roleType:'STANDARD',factionId:'audit-town',tags:[],passives:['Counterattack'],enabled:true}
  ];
  document.data.players[0].roleId='audit-attacker';document.data.players[1].roleId='audit-counter';
  document.data.abilities=[
    {id:'audit-kill',name:'Personal Instant Kill',phase:'Night',enabled:true,definition:'Kill the chosen target.'},
    {id:'audit-counterattack',name:'Counterattack',activePassive:'PASSIVE',enabled:true},
    {id:'audit-bulletproof',name:'Bulletproof / Passive Immunity',activePassive:'PASSIVE',enabled:true}
  ];
  const actions=[{id:'audit-lethal-action',sourceType:'PLAYER',sourcePlayerId:'audit-actor',abilityId:'audit-kill',targetIds:['audit-target'],targetType:'PLAYER',status:'QUEUED'}];
  const proposal=resolveNightDeterministically({...document.data,gameId:'__AUDIT_GAME_UUID__',round:0,phase:'Night',actions});
  const ruling=finalResolutionPayload(buildResolutionDraft({proposal,actions,players:document.data.players}));
  return {document,actions,proposal,ruling};
}
