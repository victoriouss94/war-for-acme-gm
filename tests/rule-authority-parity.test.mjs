import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {GLOBAL_AUTHORITY_PRECEDENCE,globalResolutionProfile} from '../js/global-abilities.js';
import {resolveNightDeterministically} from '../js/night-engine.js';

const expected=['CURRENT_GAME_RULE','ROLE_TEXT','GLOBAL_MASTER_ABILITY_ENCYCLOPEDIA','CURRENT_GAME_PRECEDENT','GLOBAL_PRECEDENT','GM_DECISION'];
const serverSource=await readFile(new URL('../supabase/functions/_shared/global-resolution.ts',import.meta.url),'utf8');
// This pure profile/classification module performs no network or database work.
const server=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(serverSource)).toString('base64'));

test('browser authority metadata follows the requested hierarchy',()=>{
  assert.deepEqual(GLOBAL_AUTHORITY_PRECEDENCE,expected);
  assert.deepEqual(globalResolutionProfile().authorityPrecedence,expected);
  assert.ok(Object.isFrozen(GLOBAL_AUTHORITY_PRECEDENCE));
});
test('browser and server authority profiles cannot silently drift apart',()=>{
  assert.deepEqual(server.GLOBAL_RESOLUTION_PROFILE.authority_precedence,GLOBAL_AUTHORITY_PRECEDENCE);
});
test('deterministic result metadata reports the same hierarchy without changing outcomes',()=>{
  const input={gameId:'synthetic-authority',round:1,phase:'Night',players:[{id:'actor',name:'Actor',alive:true},{id:'target',name:'Target',alive:true}],actions:[{id:'attempt',name:'Personal Instant Kill',sourcePlayerId:'actor',targetIds:['target']}]};
  const before=structuredClone(input),result=resolveNightDeterministically(input);
  assert.equal(result.resolution_status,'RESOLVED');
  assert.deepEqual(result.relevant_rules,expected);
  assert.deepEqual(result.deaths,['Target']);
  assert.equal(result.observability.ai_fallback_call_count,0);
  assert.deepEqual(input,before);
});
