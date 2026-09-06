import {statusResolutionFixture} from './status-resolution-fixture.mjs';
import {resolveNightDeterministically} from '../../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../../js/resolution-editor.js';

export function healResolutionFixture(){
  const {document}=statusResolutionFixture();
  document.data.roles[0].tags=['Heal'];
  document.data.abilities=[{id:'audit-heal',name:'Heal',phase:'Any',enabled:true,definition:'Remove an applicable harmful status.'}];
  const actions=[{id:'audit-heal-action',sourceType:'PLAYER',sourcePlayerId:'audit-actor',abilityId:'audit-heal',targetIds:['audit-target'],playerAbilityGrantId:'__AUDIT_GRANT_UUID__',grantVersion:1,abilitySource:'GM_GRANTED',status:'QUEUED'}];
  const statuses=[{id:'__AUDIT_STATUS_UUID__',player_id:'audit-target',status_type:'POISON',status_name:'Future poison',state:'ACTIVE',applied_at_cycle:1,applied_at_phase:'Night'}];
  const proposal=resolveNightDeterministically({...document.data,gameId:'__AUDIT_GAME_UUID__',round:0,phase:'Night',actions,statuses});
  const ruling=finalResolutionPayload(buildResolutionDraft({proposal,actions,players:document.data.players}));
  return {document,actions,ruling};
}
