import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const app=await readFile('js/app.js','utf8');
const between=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end));

test('cloud saves use bounded exponential backoff and pause when automatic sync is unsafe',()=>{
  const saves=between("const CLOUD_SAVE_MAX_AUTO_RETRIES",'function removeById');
  for(const pattern of [
    /CLOUD_SAVE_MAX_AUTO_RETRIES=4/,
    /CLOUD_SAVE_RETRY_BASE_MS=1000/,
    /Math\.min\(CLOUD_SAVE_RETRY_MAX_MS,exponential\+jitter\)/,
    /cloudSaveRetryCount<=CLOUD_SAVE_MAX_AUTO_RETRIES/,
    /navigator\.onLine&&!document\.hidden/,
    /setCloudSavePaused\(navigator\.onLine\?'hidden':'offline'\)/,
    /setCloudSavePaused\('exhausted',true\)/,
    /setCloudSavePaused\('rejected',true\)/,
    /Not synced — click Save Game to retry/,
    /function retryCloudSaveNow\(\)/
  ])assert.match(saves,pattern);
  assert.doesNotMatch(saves,/setTimeout\(flushCloudSave,1000\)/);
  assert.match(saves,/\['exhausted','rejected'\]\.includes\(cloudSavePauseReason\)/);
  assert.match(saves,/error\.code==='40001'.*await refreshOpenGame\(true\)/s);
  assert.match(saves,/if\(!isRetryableCloudSaveError\(error\)\).*setCloudSavePaused\('rejected',true\).*else\{cloudSaveRetryCount\+=1/s);
  assert.match(app,/\$\('saveGameBtn'\)\.onclick=retryCloudSaveNow/);
  assert.match(app,/addEventListener\('online',resumePendingCloudSave\)/);
  assert.match(app,/addEventListener\('offline',pausePendingCloudSave\)/);
  assert.match(app,/addEventListener\('visibilitychange'/);
});

test('cloud saves retry only transient network, timeout, rate-limit, server, and pool-timeout failures',()=>{
  const classifier=between('function cloudSaveHttpStatus','function setCloudSavePaused');
  const retryable=new Function(`${classifier};return isRetryableCloudSaveError`)();
  for(const code of ['40001','PT422','42501','55000'])assert.equal(retryable({code}),false,code+' must require an explicit retry');
  for(const status of [400,401,403,404,409,422,499])assert.equal(retryable({status}),false,'HTTP '+status+' must not be retried');
  for(const status of [408,429,500,502,503,504])assert.equal(retryable({status}),true,'HTTP '+status+' should use bounded retry');
  assert.equal(retryable({code:'PGRST003'}),true,'PostgREST pool acquisition timeout should be retried');
  assert.equal(retryable(new TypeError('Failed to fetch')),true,'browser network failures should be retried');
  assert.equal(retryable({code:'INVALID_ROLE',message:'Role is invalid'}),false,'unknown application failures must not be retried');
  assert.equal(retryable({message:'Unexpected database response'}),false,'unknown unclassified failures must not be retried');
});

test('high-impact mutations reject duplicate invocations until their first request settles',()=>{
  const assignment=between('async function createAssignmentPreviewFromUi','async function shuffleAssignmentPreview');
  assert.match(assignment,/if\(assignmentPreviewInFlight\|\|/);
  assert.match(assignment,/assignmentPreviewInFlight=true/);
  assert.match(assignment,/finally\{assignmentPreviewInFlight=false;renderRosterSetup\(\)\}/);
  assert.match(app,/randomizeRolesBtn'\)\.disabled=assignmentPreviewInFlight/);

  const start=between('async function startAuthoritativeGame','async function toggleAuthoritativePause');
  assert.match(start,/if\(phaseMutationPending\)return/);
  assert.match(start,/phaseMutationPending=true/);
  assert.match(start,/finally\{phaseMutationPending=false;renderAll\(\)\}/);
  assert.match(app,/confirmStartGamePhaseBtn'\)\.disabled=!canMutate/);

  const correction=between('async function correctHistoricalAction','function actionPlayerAbilityState');
  const removal=between('async function removeQueuedAction','function renderQueue');
  for(const source of [correction,removal]){
    assert.match(source,/phaseActionMutations\.has\(mutationKey\)/);
    assert.match(source,/phaseActionMutations\.add\(mutationKey\)/);
    assert.match(source,/finally\{phaseActionMutations\.delete\(mutationKey\)/);
  }
});

test('Realtime phase and learning bursts share one timer and at most one trailing refresh',async()=>{
  const coordinator=between('function clearRealtimeRefreshes','async function subscribeToOpenGame');
  const timers=[];
  const fakeSetTimeout=callback=>{timers.push(callback);return timers.length};
  const factory=new Function('setTimeout','clearTimeout','console',`
    const REALTIME_REFRESH_DELAY_MS=1;
    const realtimeRefreshes=new Map();
    let cloudSession={user:{id:'gm'}};
    let activeGameId='game-1';
    const currentGame=()=>activeGameId?{id:activeGameId}:null;
    ${coordinator}
    return {scheduleRealtimeRefresh,realtimeRefreshes,setActiveGameId:value=>{activeGameId=value}};
  `);
  const runtime=factory(fakeSetTimeout,()=>{},console);
  let releases=[];
  const task=()=>new Promise(resolve=>releases.push(resolve));

  runtime.scheduleRealtimeRefresh('phase','game-1',task);
  runtime.scheduleRealtimeRefresh('phase','game-1',task);
  runtime.scheduleRealtimeRefresh('phase','game-1',task);
  assert.equal(timers.length,1,'a synchronous burst should create one timer');

  timers.shift()();
  await Promise.resolve();
  assert.equal(releases.length,1,'the burst should start one refresh');
  runtime.scheduleRealtimeRefresh('phase','game-1',task);
  runtime.scheduleRealtimeRefresh('phase','game-1',task);
  assert.equal(timers.length,0,'events during an in-flight refresh should not start another request');
  releases.shift()();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(timers.length,1,'events during the request should schedule one trailing refresh');
});

test('Realtime coordinator drops a scheduled refresh after the active game changes',async()=>{
  const coordinator=between('function clearRealtimeRefreshes','async function subscribeToOpenGame');
  const timers=[];
  const factory=new Function('setTimeout','clearTimeout','console',`
    const REALTIME_REFRESH_DELAY_MS=1;
    const realtimeRefreshes=new Map();
    let cloudSession={user:{id:'gm'}};
    let activeGameId='game-1';
    const currentGame=()=>activeGameId?{id:activeGameId}:null;
    ${coordinator}
    return {scheduleRealtimeRefresh,realtimeRefreshes,setActiveGameId:value=>{activeGameId=value}};
  `);
  const runtime=factory(callback=>{timers.push(callback);return timers.length},()=>{},console);
  let calls=0;
  runtime.scheduleRealtimeRefresh('phase','game-1',async()=>{calls+=1});
  runtime.setActiveGameId('game-2');
  timers.shift()();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,0,'a callback captured for the old game must not run');
  assert.equal(runtime.realtimeRefreshes.size,0,'the stale refresh entry should be discarded');
});

test('Realtime handlers route phase and learning changes through the scoped coordinator',()=>{
  const subscription=between('async function subscribeToOpenGame','async function bootstrapOpenGameAfterLogin');
  assert.match(subscription,/onPhase:\(\)=>scheduleRealtimeRefresh\('phase',gameId/);
  assert.match(subscription,/onLearning:\(\)=>scheduleRealtimeRefresh\('learning',gameId,refreshAiGmData\)/);
  assert.match(subscription,/onResolution:\(\)=>\{scheduleRealtimeRefresh\('learning'/);
  assert.doesNotMatch(subscription,/onPhase:async\(\)=>\{await refreshGamePhaseContext/);
  assert.doesNotMatch(subscription,/onLearning:async\(\)=>\{await refreshAiGmData/);
});

test('Realtime refresh functions reject stale responses before mutating active-game state',()=>{
  const abilities=between('async function refreshPlayerAbilityState','function currentQueuePhase');
  const phase=between('async function refreshGamePhaseContext','function phaseConsequenceNames');
  const learning=between('async function refreshAiGmData','async function startResolutionSession');
  assert.match(abilities,/await GMCloud\.playerAbilityState\(gameId\);if\(currentGame\(\)\?\.id!==gameId\)return;/);
  assert.match(phase,/if\(!gameId\|\|currentGame\(\)\?\.id!==gameId\)return;\s*if\(!canEditGame\(\)\)/);
  assert.match(phase,/const loaded=await GMCloud\.phaseContext\(gameId\);if\(currentGame\(\)\?\.id!==gameId\)return;/);
  assert.match(learning,/const loaded=await GMCloud\.resolutionContext\(gameId\);if\(currentGame\(\)\?\.id!==gameId\)return;/);
  const subscription=between('async function subscribeToOpenGame','async function bootstrapOpenGameAfterLogin');
  assert.match(subscription,/refreshPlayerAbilityState\(targetGameId\);if\(currentGame\(\)\?\.id===targetGameId\)renderAll\(\)/);
  assert.match(subscription,/refreshGamePhaseContext\(targetGameId\);if\(currentGame\(\)\?\.id===targetGameId\)renderAll\(\)/);
});
