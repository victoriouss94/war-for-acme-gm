import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const app=await readFile('js/app.js','utf8');
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

test('the public entry point cache-busts the performance release',()=>{
  assert.match(html,/css\/main\.css\?v=12\.1\.1/);
  assert.match(html,/js\/app\.js\?v=12\.1\.1/);
});
