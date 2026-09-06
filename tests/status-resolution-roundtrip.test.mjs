import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStatusEffect,buildResolutionDraft,validateResolutionDraft} from '../js/resolution-editor.js';
import {statusResolutionFixture} from './helpers/status-resolution-fixture.mjs';

test('Drunk and Sober retain event-based duration without inventing a database phase',()=>{
  const {proposal,ruling}=statusResolutionFixture();
  assert.equal(proposal.observability.ai_fallback_call_count,0);
  for(const result of [proposal,ruling]){
    assert.equal(result.status_effects.length,2);
    for(const effect of result.status_effects){
      assert.equal(effect.state,'PENDING');
      assert.equal(effect.duration,'Until Hanging');
      assert.equal(effect.expires_at_phase,'');
      assert.equal(effect.expires_at_cycle,'');
      assert.equal(effect.remaining_duration,'');
    }
  }
});

test('status normalization preserves unspecified timers and explicit zero across repeated edits',()=>{
  for(const empty of [undefined,null,'']){
    let status={expires_at_cycle:empty,remaining_duration:empty};
    for(let i=0;i<3;i++){
      status=normalizeStatusEffect(status);
      assert.equal(status.expires_at_cycle,'');
      assert.equal(status.remaining_duration,'');
    }
  }
  assert.equal(normalizeStatusEffect({expires_at_cycle:0}).expires_at_cycle,0);
  assert.equal(normalizeStatusEffect({remaining_duration:0}).remaining_duration,0);
});

test('legacy Drunk/Sober hanging labels remain pending events, while explicit game deadlines survive',()=>{
  for(const status_type of ['DRUNK','SOBER']){
    const legacy=normalizeStatusEffect({status_type,state:'PENDING',expires_at_phase:'Hanging'});
    assert.equal(legacy.expires_at_phase,'');
    assert.equal(legacy.duration,'Until Hanging');
    assert.equal(legacy.state,'PENDING');
    const explicit=normalizeStatusEffect({status_type,state:'PENDING',duration:'GM deadline',expires_at_phase:'Night',expires_at_cycle:3});
    assert.equal(explicit.duration,'GM deadline');
    assert.equal(explicit.expires_at_phase,'Night');
    assert.equal(explicit.expires_at_cycle,3);
  }
});

test('unsupported event labels are rejected before submitting a status expiry phase',()=>{
  for(const phase of ['Hanging','Day','Night','Any','']){
    const players=[{id:'target',name:'Target'}];
    const draft=buildResolutionDraft({players,proposal:{final_ruling:'Apply marker.',status_effects:[{player_id:'target',status_type:'MARK',status_name:'Marked',expires_at_phase:phase}]}});
    const result=validateResolutionDraft(draft,{players});
    assert.equal(result.errors.some(error=>error.includes('expiry phase')),phase==='Hanging');
  }
});
