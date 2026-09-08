import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {lethalResolutionFixture} from './helpers/lethal-resolution-fixture.mjs';
const migration=readFileSync(new URL('../supabase/migrations/20260908181612_route_legacy_resolution_approvals_through_canonical_transaction.sql',import.meta.url),'utf8');
test('legacy public approval signatures delegate to the existing canonical transaction',()=>{
  assert.match(migration,/return public\.approve_and_apply_resolution\(/);
  assert.match(migration,/select public\.finalize_resolution_with_grants\(/);
  assert.doesNotMatch(migration,/create or replace function private\.|drop function|drop table|truncate/i);
  assert.match(migration,/decision<>'REJECT' and item->>'use_disposition'='CONSUMED'/);
});
test('legacy wrappers are invoker-only and the internal finalizer is not client executable',()=>{
  assert.equal((migration.match(/security invoker/g)||[]).length,2);
  assert.doesNotMatch(migration,/security definer/i);
  assert.match(migration,/revoke all on function private\.finalize_resolution_session\([^;]+from public,anon,authenticated/);
  assert.match(migration,/false,decision='REJECT'/);
});
test('finite-use legacy fixture comes from the real engine final payload',()=>{
  const fixture=lethalResolutionFixture({grantId:'audit-grant'});
  assert.equal(fixture.ruling.action_results[0].player_ability_grant_id,'audit-grant');
  assert.equal(fixture.ruling.action_results[0].use_disposition,'CONSUMED');
  assert.equal(fixture.ruling.player_outcomes.find(p=>p.player_id==='audit-target').life_state,'DEAD');
});
test('every cloud method referenced by the current frontend is actually exported',()=>{
  const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),cloud=readFileSync(new URL('../js/cloud.js',import.meta.url),'utf8'),context={window:{}};
  vm.runInNewContext(cloud,context);
  const names=[...new Set([...app.matchAll(/\bGMCloud(?:\?\.|\.)(\w+)/g)].map(match=>match[1]))];
  assert.ok(names.length>40);
  for(const name of names)assert.equal(typeof context.window.GMCloud[name],'function',name);
  assert.match(cloud,/rpc\('approve_and_apply_resolution'/);
  assert.doesNotMatch(cloud,/rpc\('finalize_resolution_(?:session|with_grants)'/);
});
