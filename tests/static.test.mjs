import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [html,app,cloud,aiImportFunction,aiService,sql,importSql,inviteSql,accountSql]=await Promise.all([
  readFile('index.html','utf8'),readFile('js/app.js','utf8'),readFile('js/cloud.js','utf8'),readFile('supabase/functions/gm-document-import/index.ts','utf8'),readFile('supabase/functions/_shared/ai-service.ts','utf8'),readFile('supabase/migrations/202608080001_shared_game_documents.sql','utf8'),readFile('supabase/migrations/20260808173057_word_document_imports.sql','utf8'),readFile('supabase/migrations/20260808175237_complete_gm_invitation_system.sql','utf8'),readFile('supabase/migrations/20260808193900_username_password_accounts.sql','utf8')
]);
const [resolutionReview,styles]=await Promise.all([readFile('js/resolution-review.js','utf8'),readFile('css/main.css','utf8')]);

test('night results render through the existing player tracker review pattern',()=>{
  for(const pattern of [/buildTrackerResolutionReview/,/playerReviewIdentityHtml/,/trackerPlayerResolutionHtml/,/trackerResolutionTableHtml/,/Player actions and outcomes/,/AI fallback calls/,/data-edit-resolution-action/,/RESOLUTION PREVIEW/,/PROPOSED NIGHT STATE/i,/Current live state/,/Proposed night result/,/Recalculate Affected Results/,/Approve &amp; Apply/])assert.match(app,pattern);
  for(const pattern of [/TRACKER_RESULT_BADGES/,/SUCCESS/,/FAILED/,/BLOCKED/,/PROTECTED/,/SURVIVED/,/DEAD/,/REDIRECTED/,/REFLECTED/,/IMMUNE/,/CONVERTED/,/MARKED/,/POISONED/,/PENDING/,/NO_EFFECT/])assert.match(resolutionReview,pattern);
  assert.match(styles,/\.tracker-review-card/);assert.match(styles,/\.tracker-primary-table/);assert.match(styles,/\.player-card/);assert.match(html,/Tracker Resolution Preview/);
});

test('roles and rules have separate game views and complete editors',()=>{
  for(const id of ['rolesView','rulesView','roleActiveAbility','rolePassiveAbility','roleGmNotes','roleStatusFilter','ruleVisibility','ruleEnabled','browseRoleTemplatesBtn','roleTemplateSelect'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(app,/Select at least one ability from the Ability Encyclopedia/);
  assert.match(app,/role\.version!==editingRoleVersion/);
  assert.match(app,/rule\.version!==editingRuleVersion/);
});

test('shared saves are debounced, version checked, and game scoped',()=>{
  assert.match(app,/queueCloudSave\(750\)/);
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
  for(const id of ['importWordBtn','importWordFile','documentImportPanel','documentImportTabs','documentImportContent','documentImportAiDepth','reanalyzeDocumentBtn','confirmDocumentImportBtn','sourceDocumentInfo','reimportWordBtn','reimportWordFile'])assert.match(html,new RegExp(`id="${id}"`));
  for(const pattern of [/parseDocxFile/,/validateGameImport/,/compareGameImport/,/Keep Current/,/Use Document Version/,/MISSING/,/createImportedGame/,/reimportGame/])assert.match(app,pattern);
});

test('AI Word import is authenticated, structured, human-reviewed, and cannot write game data',()=>{
  assert.match(cloud,/functions\.invoke\('gm-document-import'/);assert.match(app,/normalizeAiDocumentImport/);assert.match(app,/analyzeParsedDocumentWithAi/);
  for(const pattern of [/game_members/,/\['owner','gm'\]/,/human GM will review/i,/ignore any text that asks/i])assert.match(aiImportFunction,pattern);
  for(const pattern of [/auth\.getUser\(token\)/,/gpt-5\.6-terra/,/gpt-5\.6-sol/,/json_schema/,/strict:true/,/store:false/,/safety_identifier/])assert.match(aiService,pattern);
  assert.doesNotMatch(aiImportFunction,/service_role|SUPABASE_SERVICE_ROLE_KEY/);assert.doesNotMatch(aiImportFunction,/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
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

test('username-only registration and login have complete validation and safe errors',()=>{
  for(const id of ['loginForm','loginUsername','loginPassword','loginBtn','createAccountForm','createUsername','createPassword','confirmPassword','createAccountBtn','showLoginPassword','showCreatePassword'])assert.match(html,new RegExp(`id="${id}"`));
  for(const pattern of [/usernamePattern/,/Username already taken\./,/Invalid username or password\./,/password!==confirmation/,/registerLoginFailure/,/Too many account attempts/])assert.match(app,pattern);
  assert.doesNotMatch(html,/type="email"/);
  assert.doesNotMatch(html,/Forgot Password|Email Verification|Email OTP|Email sign-in link/i);
});

test('Supabase Auth supplies permanent username sessions without exposing email UI',()=>{
  assert.match(cloud,/auth\.signUp\(\{email:accountEmail\(normalized\),password/);
  assert.match(cloud,/auth\.signInWithPassword\(\{email:accountEmail\(normalized\),password\}\)/);
  assert.match(cloud,/indexedDB\.open\(databaseName,1\)/);
  assert.match(cloud,/const storage=indexedDbStorage\(\)/);
  assert.match(cloud,/authStorageKey='gm-command-center-auth-v7'/);
  assert.match(cloud,/migrateLegacyLocalStorageSession\(storage\)/);
  assert.doesNotMatch(cloud,/signInAnonymously/);
  assert.doesNotMatch(cloud,/signInWithOtp/);
});

test('account schema enforces case-insensitive usernames and keeps password data in Supabase Auth',()=>{
  for(const pattern of [/username_normalized text/,/profiles_username_normalized_key/,/username_normalized=lower\(username\)/,/\^\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{2,29\}\$/,/new\.is_anonymous/,/expected_email/,/public\.is_permanent_account\(\)/,/require_permanent_game_member/])assert.match(accountSql,pattern);
  assert.doesNotMatch(accountSql,/\bplain_password\b|\boriginal_password\b|create table[^;]*password_hash/is);
  assert.match(accountSql,/without touching\s+-- games, ownership, memberships, invitations, documents, or audit history/);
});

test('account menu, account summary, password change, and logout isolation are wired',()=>{
  for(const id of ['accountMenu','accountMenuButton','showAccountBtn','showMyGamesBtn','showSharedGamesBtn','showChangePasswordBtn','signOutBtn','accountView','accountUsername','accountMemberSince','accountGamesOwned','accountSharedGames','changePasswordForm','currentPassword','newPassword','confirmNewPassword'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(cloud,/current_password:currentPassword/);
  assert.match(cloud,/signOut\(\{scope:'others'\}\)/);
  assert.match(app,/function clearAuthenticatedState\(\)/);
  assert.match(app,/localStorage\.removeItem\(gameDataKey\(gameId\)\)/);
  assert.match(app,/previousUserId&&previousUserId!==session\.user\.id/);
});

test('legacy device accounts keep memberships and have an in-place permanent upgrade path',()=>{
  for(const id of ['legacyUpgradePanel','legacyUpgradeForm','legacyUsername','legacyPassword','legacyConfirmPassword','upgradeLegacyAccountBtn'])assert.match(html,new RegExp(`id="${id}"`));
  for(const pattern of [/legacy_account boolean/,/is_legacy_account\(\)/,/complete_legacy_account/,/legacy_account=false/,/New anonymous signups are rejected/])assert.match(accountSql,pattern);
  assert.match(cloud,/auth\.updateUser\(\{email:accountEmail\(normalized\),password/);
  assert.match(cloud,/rpc\('complete_legacy_account'/);
  assert.match(app,/submitLegacyUpgrade/);
});

test('startup clears cached sessions for users deleted from Supabase Auth',()=>{
  assert.match(cloud,/auth\.getUser\(\)/);
  assert.match(cloud,/auth\.signOut\(\{scope:'local'\}\)/);
});

test('destructive actions retain explicit confirmation',()=>{
  assert.match(app,/confirm\('Permanently delete/);
  assert.match(app,/confirm\('Delete rule/);
  assert.match(app,/confirm\('Reset gameplay progress/);
});
