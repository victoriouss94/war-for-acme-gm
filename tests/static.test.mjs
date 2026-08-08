import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [html,app,cloud,sql]=await Promise.all([
  readFile('index.html','utf8'),readFile('js/app.js','utf8'),readFile('js/cloud.js','utf8'),readFile('supabase/migrations/202608080001_shared_game_documents.sql','utf8')
]);

test('roles and rules have separate game views and complete editors',()=>{
  for(const id of ['rolesView','rulesView','roleActiveAbility','rolePassiveAbility','roleGmNotes','roleStatusFilter','ruleVisibility','ruleEnabled','browseRoleTemplatesBtn','roleTemplateSelect'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(app,/Select at least one ability from the Ability Encyclopedia/);
  assert.match(app,/role\.version!==editingRoleVersion/);
  assert.match(app,/rule\.version!==editingRuleVersion/);
});

test('shared saves are debounced, version checked, and game scoped',()=>{
  assert.match(app,/setTimeout\(flushCloudSave,750\)/);
  assert.match(cloud,/expected_version:version/);
  assert.match(cloud,/filter:'game_id=eq\.'\+gameId/);
  assert.match(cloud,/channel\('game:'\+gameId/);
  assert.match(app,/VERSION_CONFLICT/);
});

test('legacy device saves require an explicit, confirmed upload',()=>{
  assert.match(html,/id="uploadDeviceGamesBtn"/);
  assert.match(app,/Upload .*saved game\(s\) from this device/);
  assert.match(app,/GMCloud\.createGame/);
});

test('database enforces membership, validation, audit, and realtime publication',()=>{
  for(const pattern of [/enable row level security/,/validate_game_document/,/can_edit_game/,/change_history/,/supabase_realtime add table public\.game_documents/,/Archive referenced roles instead of deleting them/])assert.match(sql,pattern);
});

test('destructive actions retain explicit confirmation',()=>{
  assert.match(app,/confirm\('Permanently delete/);
  assert.match(app,/confirm\('Delete rule/);
  assert.match(app,/confirm\('Reset gameplay progress/);
});
