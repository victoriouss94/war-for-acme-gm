import {statusResolutionFixture} from './status-resolution-fixture.mjs';
import {resolveNightDeterministically} from '../../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../../js/resolution-editor.js';
export function nightLifecycleFixture(empty=false){
 const {document,actions}=statusResolutionFixture();
 document.game.name='Rollback night lifecycle audit';
 document.data.players.push({...document.data.players[0],id:'audit-killer',name:'Audit Killer'});
 document.data.factions.push({id:'audit-den',name:'Audit Den',class:'DEN'});
 document.data.roles[0].tags.push('Personal Instant Kill');
 document.data.abilities.push({id:'audit-kill',name:'Personal Instant Kill',phase:'Night',enabled:true,definition:'Kill one player.'});
 actions.push({id:'audit-kill-action',name:'Personal Instant Kill',sourceType:'PLAYER',sourcePlayerId:'audit-killer',abilityId:'audit-kill',targetIds:['audit-target'],targetType:'PLAYER',status:'QUEUED'});
 const submitted=empty?[]:actions;
 const proposal=resolveNightDeterministically({...document.data,gameId:'__AUDIT_GAME_UUID__',round:0,phase:'Night',actions:submitted});
 const draft=buildResolutionDraft({proposal,actions:submitted,players:document.data.players});
 if(!empty){
  const actor=draft.player_outcomes.find(p=>p.player_id==='audit-actor');
  actor.faction_id='audit-den';actor.summary='Explicit GM-reviewed conversion.';
  draft.why='GM reviewed all three outcomes and added an explicit conversion.';
 }
 return {document,actions:submitted,proposal,ruling:finalResolutionPayload(draft),empty};
}
