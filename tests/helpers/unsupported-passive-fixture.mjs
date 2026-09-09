import {statusResolutionFixture} from './status-resolution-fixture.mjs';
import {resolveNightDeterministically} from '../../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../../js/resolution-editor.js';

export function unsupportedPassiveFixture(){
  const fixture=statusResolutionFixture(),data=fixture.document.data;
  fixture.document.game.name='Rollback unsupported passive review audit';
  data.roles.push({...data.roles[0],id:'audit-passive-role',name:'Custom Passive Role',roleWidePassiveAbilityIds:['audit-last-gift']});
  data.players[1].roleId='audit-passive-role';
  data.abilities.push({id:'audit-last-gift',gameId:data.gameId,name:'Last Gift',activePassive:'PASSIVE',definition:'When this player dies, award one use to the bound player.',enabled:true});
  fixture.proposal=resolveNightDeterministically({...data,round:0,phase:'Night',actions:fixture.actions});
  fixture.ruling=finalResolutionPayload(buildResolutionDraft({proposal:fixture.proposal,actions:fixture.actions,players:data.players}));
  return fixture;
}
