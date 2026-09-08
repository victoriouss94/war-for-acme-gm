import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {complexCloudFixture} from './helpers/complex-cloud-fixture.mjs';
import {resolveNightDeterministically} from '../js/night-engine.js';
import {buildResolutionDraft,finalResolutionPayload} from '../js/resolution-editor.js';

test('complex cloud fixture gives every queued action a source-owned encyclopedia ability',()=>{
  const {document,actions}=complexCloudFixture(),data=document.data;
  assert.equal(data.players.length,40);assert.equal(actions.length,35);
  for(const action of actions){
    const ability=data.abilities.find(a=>a.id===action.abilityId);
    assert.equal(ability.name,action.name);
    const player=data.players.find(p=>p.id===action.sourcePlayerId),role=data.roles.find(r=>r.id===player.roleId);
    assert.ok(action.playerAbilityGrantId||role.tags.includes(ability.name));
    assert.equal(action.overrideReason,undefined);
  }
});
test('actual app input adapter and encyclopedia-based fixture resolve the same complex night',()=>{
  const {document,actions,seed}=complexCloudFixture(),data=document.data;
  const session={id:'complex-session',cycle:0,phase:'Night',submitted_actions:actions,pre_resolution_state:{...data,statuses:[],modes:[],precedents:[],grants:[{id:'__AUDIT_GRANT_UUID__',player_id:'p32',ability_id:'kill',uses_remaining:3,version:1,stealable:true}]}};
  const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),start=source.indexOf('function nightEngineInput('),end=source.indexOf('\nfunction persistableNightProposal',start);
  assert.ok(start>=0&&end>start);
  const input=vm.runInNewContext(source.slice(start,end)+'\nnightEngineInput(session)',{session,currentGame:()=>document.game});
  const proposal=resolveNightDeterministically({...input,seed});
  assert.equal(proposal.resolution_status,'RESOLVED');assert.equal(proposal.observability.ai_fallback_call_count,0);
  assert.deepEqual(proposal.player_outcomes.filter(p=>!p.alive_after_resolution).map(p=>p.player_id).sort(),['p12','p15','p17','p20','p26','p39','p40','p8']);
  assert.ok(proposal.passive_results.every(p=>p.ability_id));
  const final=finalResolutionPayload(buildResolutionDraft({proposal,actions,players:data.players}));
  assert.equal(final.action_results.length,35);assert.equal(final.lethal_attempts.length,16);
});
