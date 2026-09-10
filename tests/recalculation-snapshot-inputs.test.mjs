import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNightDeterministically,recalculateNight} from '../js/night-engine.js';

const baseRule={id:'base',description:'Original game rule.'};
const firstRule={id:'first',description:'First GM correction.'};
const secondRule={id:'second',description:'Second GM correction.'};
function fixture(nested=true){
  const source={players:[{id:'actor',name:'Actor',alive:true},{id:'target',name:'Target',alive:true}],rules:[baseRule],
    abilities:[{id:'unknown',name:'Unknown',engineBehavior:{effect:'CUSTOM',requiresExplicitRule:true,tags:['ACTIVE_ACTION']}}]};
  const actions=[{id:'attempt',abilityId:'unknown',name:'Unknown',sourcePlayerId:'actor',targetIds:['target'],resolutionCategory:'STATUS_EFFECTS'}];
  return nested?{gameId:'synthetic-replay',snapshot:source,actions}:{gameId:'synthetic-replay',...source,actions};
}

test('GM rule additions reach the nested snapshot and isolated-review context',()=>{
  const input=fixture(),result=recalculateNight(resolveNightDeterministically(input),input,{rules:[firstRule]});
  assert.deepEqual(result.starting_snapshot.rules,[baseRule,firstRule]);
  assert.deepEqual(result.unresolved_interactions[0].relevant_game_rules,[baseRule,firstRule]);
});

for(const nested of [false,true])test(`successive rule additions survive ${nested?'nested':'flat'} recalculation`,()=>{
  const input=fixture(nested),initial=resolveNightDeterministically(input);
  const first=recalculateNight(initial,input,{rules:[firstRule]});
  const second=recalculateNight(first,input,{rules:[secondRule]});
  const third=recalculateNight(second,input,{});
  assert.deepEqual(second.starting_snapshot.rules,[baseRule,firstRule,secondRule]);
  assert.deepEqual(third.starting_snapshot.rules,[baseRule,firstRule,secondRule]);
  assert.deepEqual(third.recalculation.rule_additions,[firstRule,secondRule]);
});

test('legacy saved correction rules survive the next replay',()=>{
  const input=fixture(),previous=resolveNightDeterministically(input);
  previous.recalculation={correction:{rules:[firstRule]}};
  const result=recalculateNight(previous,input,{rules:[secondRule]});
  assert.deepEqual(result.starting_snapshot.rules,[baseRule,firstRule,secondRule]);
});

test('snapshot-only actions remain present and accept GM action corrections',()=>{
  const input=fixture();input.snapshot.submitted_actions=input.actions;delete input.actions;
  const initial=resolveNightDeterministically(input);
  assert.equal(initial.action_results.length,1);
  const result=recalculateNight(initial,input,{actionId:'attempt',actionPatch:{forceResult:'CANCELLED'}});
  assert.equal(result.action_results.length,1);assert.equal(result.action_results[0].result,'CANCELLED');
});

test('an explicitly empty top-level action list still overrides snapshot actions',()=>{
  const input=fixture();input.snapshot.submitted_actions=input.actions;input.actions=[];
  assert.deepEqual(recalculateNight({},input,{}).action_results,[]);
});

test('rule replay does not mutate the input, correction, or previous proposal',()=>{
  const input=fixture(),previous=resolveNightDeterministically(input),correction={rules:[firstRule]};
  const originals=structuredClone({input,previous,correction});
  const result=recalculateNight(previous,input,correction);
  result.starting_snapshot.rules[0].description='Changed copy';
  result.recalculation.rule_additions[0].description='Changed addition copy';
  assert.deepEqual({input,previous,correction},originals);
});
