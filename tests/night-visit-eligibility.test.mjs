import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically} from '../js/night-engine.js';
const players=['blocker','visitor','target','watcher','tracker','killer','guarantor'].map(id=>({id,name:id,alive:true}));
const a=(id,name,actor,target,extra={})=>({id,name,sourcePlayerId:actor,targetIds:[target],...extra});
const run=actions=>resolveNightDeterministically({gameId:'visit-audit',round:1,phase:'Night',players,actions});

test('completed Protect still counts as a visit after its actor is captured',()=>{
  const r=run([a('protect','Protect','visitor','target'),a('capture','Capture','blocker','visitor'),a('omega','Omega Kill','killer','target')]);
  assert.equal(r.action_results.find(a=>a.action_id==='protect').result,'SUCCESS');
  assert.equal(r.player_outcomes.find(p=>p.player_id==='visitor').alive_after_resolution,false);
});
test('pending blocked kills are excluded from Intel before the KILLS stage',()=>{
  const r=run([a('block','Roleblock','blocker','visitor'),a('kill','Personal Instant Kill','visitor','target'),a('watch','Watch','watcher','target')]);
  assert.equal(r.action_results.find(a=>a.action_id==='watch').reason,'Watch result: No visitors.');
});
test('target defense failure does not erase an actual visit',()=>{
  const r=run([a('protect','Super Protect','blocker','target'),a('kill','Personal Instant Kill','visitor','target'),a('omega','Omega Kill','killer','target')]);
  assert.equal(r.action_results.find(a=>a.action_id==='kill').result,'FAILURE');
  assert.equal(r.player_outcomes.find(p=>p.player_id==='visitor').alive_after_resolution,false);
});
test('blocked actions do not appear in Watch or Track results',()=>{
  const r=run([a('block','Roleblock','blocker','visitor'),a('visit','Basic Ask','visitor','target'),a('watch','Watch','watcher','target'),a('track','Track','tracker','visitor')]);
  assert.equal(r.action_results.find(a=>a.action_id==='watch').reason,'Watch result: No visitors.');
  assert.equal(r.action_results.find(a=>a.action_id==='track').reason,'Track result: No visit.');
});
test('blocked visitor is not collateral damage from Omega Kill',()=>{
  const r=run([a('block','Roleblock','blocker','visitor'),a('visit','Basic Ask','visitor','target'),a('omega','Omega Kill','killer','target')]);
  assert.equal(r.player_outcomes.find(p=>p.player_id==='visitor').alive_after_resolution,true);
  assert.equal(r.player_outcomes.find(p=>p.player_id==='target').alive_after_resolution,false);
});
test('Guarantee restores visits and corresponding Omega exposure',()=>{
  const r=run([a('block','Roleblock','blocker','visitor'),a('guarantee','Action Success Guarantee','guarantor','visitor'),a('visit','Basic Ask','visitor','target'),a('omega','Omega Kill','killer','target')]);
  assert.equal(r.player_outcomes.find(p=>p.player_id==='visitor').alive_after_resolution,false);
});
test('cancelled and inaccessible-mode attempts create no visit exposure',()=>{
  for(const extra of [{forceResult:'CANCELLED'},{modeId:'inaccessible'}]){
    const r=run([a('visit','Basic Ask','visitor','target',extra),a('omega','Omega Kill','killer','target')]);
    assert.equal(r.player_outcomes.find(p=>p.player_id==='visitor').alive_after_resolution,true);
  }
});
