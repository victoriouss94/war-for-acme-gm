import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [html,app,cloud,sql,importSql,inviteSql]=await Promise.all([
  readFile('index.html','utf8'),readFile('js/app.js','utf8'),readFile('js/cloud.js','utf8'),readFile('supabase/migrations/202608080001_shared_game_documents.sql','utf8'),readFile('supabase/migrations/20260808173057_word_document_imports.sql','utf8'),readFile('supabase/migrations/20260808175237_complete_gm_invitation_system.sql','utf8')
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

test('Word imports have a staged review UI, editable source metadata, and re-import controls',()=>{
  for(const id of ['importWordBtn','importWordFile','documentImportPanel','documentImportTabs','documentImportContent','confirmDocumentImportBtn','sourceDocumentInfo','reimportWordBtn','reimportWordFile'])assert.match(html,new RegExp(`id="${id}"`));
  for(const pattern of [/parseDocxFile/,/validateGameImport/,/compareGameImport/,/Keep Current/,/Use Document Version/,/MISSING/,/createImportedGame/,/reimportGame/])assert.match(app,pattern);
});

test('Word source storage and import RPCs are private, authorized, and transactional',()=>{
  for(const pattern of [/create table public\.game_imports/,/enable row level security/,/game_imports_read_member/,/game-import-documents/,/word_import_upload_own_prefix/,/word_import_read_game_member/,/create_game_from_import/,/save_game_reimport/,/public\.create_game\(/,/public\.save_game_document\(/,/grant execute .* authenticated/])assert.match(importSql,pattern);
  assert.match(cloud,/storage\.from\(importBucket\)\.upload/);assert.match(cloud,/removeImportSource/);assert.match(cloud,/source_content_type/);
});

test('GM invitations are persisted, owner managed, secure, and atomically redeemed',()=>{
  for(const pattern of [/create table public\.game_invites/,/code text not null unique/,/gen_random_bytes\(12\)/,/public\.is_game_owner\(target_game_id\)/,/for update of invite/,/use_count=invite\.use_count\+1/,/INVITE_REVOKED/,/INVITE_EXPIRED/,/INVITE_MAX_USES/,/ALREADY_JOINED/,/game_members_one_owner_idx/,/remove_game_member/,/replica identity full/,/supabase_realtime add table public\.game_members/])assert.match(inviteSql,pattern);
  assert.doesNotMatch(inviteSql,/Math\.random/);
  for(const pattern of [/rpc\('generate_game_invite'/,/rpc\('redeem_game_invite'/,/rpc\('revoke_game_invite'/,/rpc\('remove_game_member'/,/table:'game_members'/,/table:'game_invites'/])assert.match(cloud,pattern);
});

test('GM Access and Join Game expose the complete reviewed collaboration flow',()=>{
  for(const id of ['showJoinGameBtn','joinGamePanel','joinGameCode','joinGameError','joinGameSuccess','openJoinedGameBtn','gmAccessPanel','showInviteFormBtn','invitePermission','inviteExpiration','inviteUses','generateInviteBtn','inviteResult','ownerMemberList','gmMemberList','viewerMemberList','activeInviteList','myGamesList','sharedGamesList'])assert.match(html,new RegExp(`id="${id}"`));
  for(const text of ['Invalid Invite Code','Invite Expired','Invite Already Used','Already Joined','Access Denied','Shared With Me'])assert.match(app+html,new RegExp(text));
});

test('destructive actions retain explicit confirmation',()=>{
  assert.match(app,/confirm\('Permanently delete/);
  assert.match(app,/confirm\('Delete rule/);
  assert.match(app,/confirm\('Reset gameplay progress/);
});
