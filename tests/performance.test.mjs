import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const app=await readFile('js/app.js','utf8');
const cloud=await readFile('js/cloud.js','utf8');
const html=await readFile('index.html','utf8');

test('the app renders only the active screen during authentication and live updates',()=>{
  assert.match(app,/function activeViewId\(\)/);
  assert.match(app,/function renderView\(viewId=activeViewId\(\)\)/);
  assert.match(app,/function renderAll\(\)\{renderChrome\(\);renderView\(activeViewId\(\)\)\}/);
  assert.doesNotMatch(app,/function renderAll\(\)\{[^}]*renderResolutions\(\)/);
  assert.doesNotMatch(app,/function renderAll\(\)\{[^}]*renderPlayers\(\)/);
  assert.doesNotMatch(app,/function renderAll\(\)\{[^}]*renderEncyclopedia\(\)/);
});

test('opening a navigation view renders that view on demand',()=>{
  const showView=app.slice(app.indexOf('function showView(viewId)'),app.indexOf('function resetEditorContext'));
  assert.match(showView,/document\.querySelectorAll\('\.view'\)/);
  assert.match(showView,/renderView\(viewId\)/);
  for(const pair of [
    ["'dashboardView'",'renderDashboard()'],
    ["'playersView'",'renderPlayers();renderRosterSetup()'],
    ["'resolutionsView'",'renderResolutions()'],
    ["'encyclopediaView'",'renderEncyclopedia();renderOfficialAbilities()']
  ])assert.ok(app.includes(`viewId===${pair[0]}`)&&app.includes(pair[1]),`${pair[0]} must render ${pair[1]} on demand`);
});

test('Realtime subscription does not repeat the full game bootstrap load',()=>{
  const subscription=app.slice(app.indexOf('async function subscribeToOpenGame()'),app.indexOf('async function handleCloudAuth'));
  assert.match(subscription,/status=>'|status=>\{/);
  assert.doesNotMatch(subscription,/status==='SUBSCRIBED'[^}]*refreshOpenGame\(/);
  assert.match(subscription,/status==='SUBSCRIBED'\)setConnection\('live','Live'\)/);
});

test('routine Supabase auth events do not restart the whole authenticated app',()=>{
  assert.match(cloud,/if\(event==='INITIAL_SESSION'\)return/);
  assert.match(cloud,/event==='TOKEN_REFRESHED'\|\|event==='SIGNED_IN'&&sameUser/);
  assert.match(cloud,/pendingSessionSetup&&pendingSessionToken===token/);
  const handler=app.slice(app.indexOf('async function handleCloudAuth'),app.indexOf('async function initializeCloud'));
  assert.match(handler,/sameUser&&\(event==='TOKEN_REFRESHED'\|\|event==='SIGNED_IN'\)/);
  assert.match(handler,/renderChrome\(\);return/);
});

test('Supabase auth callbacks defer profile requests until after the auth lock is released',()=>{
  const listener=cloud.slice(cloud.indexOf('authListener=client.auth.onAuthStateChange'),cloud.indexOf('return {available:true,session}'));
  assert.match(listener,/onAuthStateChange\(\(event,next\)=>\{/);
  assert.match(listener,/setTimeout\(async\(\)=>\{/);
  assert.match(listener,/\},0\)/);
  assert.doesNotMatch(listener,/queueMicrotask/);
  assert.doesNotMatch(listener,/onAuthStateChange\(async/);
});

test('login restores the profile with one request and loads the active game in the background',()=>{
  const profileLoader=cloud.slice(cloud.indexOf('async function loadProfile'),cloud.indexOf('async function setSession'));
  assert.match(profileLoader,/const request=touchLogin/);
  assert.doesNotMatch(profileLoader,/let loaded=.*profiles.*select[\s\S]*if\(touchLogin\)/);
  const handler=app.slice(app.indexOf('async function handleCloudAuth'),app.indexOf('async function initializeCloud'));
  assert.match(app,/async function bootstrapOpenGameAfterLogin\(gameId\)/);
  assert.match(handler,/setTimeout\(\(\)=>\{void bootstrapOpenGameAfterLogin\(activeGameId\)\},0\)/);
  assert.doesNotMatch(handler,/await refreshOpenGame\(\)/);
  assert.doesNotMatch(handler,/await subscribeToOpenGame\(\)/);
});

test('the public entry point cache-busts current app and style assets',()=>{
  assert.match(html,/css\/main\.css\?v=12\.2\.0/);
  assert.match(html,/js\/cloud\.js\?v=12\.2\.2/);
  assert.match(html,/js\/app\.js\?v=12\.2\.2/);
});
