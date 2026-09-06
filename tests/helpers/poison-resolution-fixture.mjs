import {statusResolutionFixture} from './status-resolution-fixture.mjs';
import {resolveNightDeterministically} from '../../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../../js/resolution-editor.js';

export function poisonResolutionFixture(){
  const {document}=statusResolutionFixture();
  document.data.roles[0].tags=['Poison'];
  document.data.abilities=[{id:'audit-poison',name:'Poison',phase:'Night',enabled:true,definition:'Apply Poison with the global two-day delay; Heal cancels it.'}];
  const actions=[{id:'audit-poison-action',sourceType:'PLAYER',sourcePlayerId:'audit-actor',abilityId:'audit-poison',targetIds:['audit-target'],targetType:'PLAYER',status:'QUEUED'}];
  const input={...document.data,gameId:'__AUDIT_GAME_UUID__',round:0,phase:'Night',actions};
  const application=resolveNightDeterministically(input);
  const ruling=finalResolutionPayload(buildResolutionDraft({proposal:application,actions,players:document.data.players}));
  const statuses=application.status_effects.map(effect=>{const {operation,...saved}=effect;return {...saved,id:'__AUDIT_STATUS_UUID__',applied_at_cycle:0,applied_at_phase:'Night'}});
  const consequence=resolveNightDeterministically({...input,round:2,phase:'Day',statuses,actions:[]});
  const dueRuling=finalResolutionPayload(buildResolutionDraft({proposal:consequence,actions:[],players:document.data.players}));
  return {document,actions,ruling,dueRuling,proposal:application,dueProposal:consequence};
}
