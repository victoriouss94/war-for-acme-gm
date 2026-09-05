import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const activeMigrationPath=new URL('../supabase/migrations/20260905173123_stop_active_postgrest_retry_storm.sql',import.meta.url);
const containmentMigrationPath=new URL('../supabase/migrations/20260905180000_complete_postgrest_retry_storm_containment.sql',import.meta.url);
const proposalHandlerMigrationPath=new URL('../supabase/migrations/20260905181500_preserve_proposal_conflict_expiry.sql',import.meta.url);
const activeSql=await readFile(activeMigrationPath,'utf8');
const containmentSql=await readFile(containmentMigrationPath,'utf8');
const proposalHandlerSql=await readFile(proposalHandlerMigrationPath,'utf8');

test('observed retry-storm endpoints no longer emit retryable serialization failures',()=>{
  const expectedRoutines=[
    'public.create_role_assignment_preview(uuid,integer,boolean,jsonb,jsonb)',
    'public.start_game_phase(uuid,integer,text,text)',
    'public.admin_correct_phase_action(uuid,uuid,integer,text,text,jsonb,text)',
    'private.remove_queued_action(uuid,integer,text,text,uuid,integer)',
    'private.remove_queued_action_document_v11_2(uuid,integer,text,text)',
    'public.save_game_document(uuid,integer,jsonb,text,text,text)'
  ];

  for(const routine of expectedRoutines){
    const occurrences=activeSql.split(`'${routine}'::regprocedure`).length-1;
    assert.equal(occurrences,2,`${routine} must be patched and verified`);
  }

  assert.match(activeSql,/regexp_replace\([\s\S]*'errcode\\s\*=\\s\*''40001'''[\s\S]*'errcode = ''PT422'''/i);
  assert.match(activeSql,/EXPECTED_RETRYABLE_CONFLICT_NOT_FOUND/);
  assert.match(activeSql,/RETRYABLE_ACTIVE_ENDPOINT_CONFLICT_REMAINS/);
  assert.match(activeSql,/notify pgrst, 'reload schema'/i);
});

test('every remaining reachable optimistic-conflict routine is converted explicitly',()=>{
  const reachableRoutines=[
    'private.approve_and_apply_resolution_v11_5(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean)',
    'private.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text)',
    'private.finalize_resolution_with_grants_v11_2(uuid,integer,text,jsonb,text,boolean,text,text[])',
    'private.grant_player_ability(uuid,integer,text,text,text,text,text,integer,text,timestamp with time zone,integer,text,text[],jsonb,boolean,boolean,jsonb)',
    'private.manage_gm_precedent(uuid,integer,text,uuid,text,text,text)',
    'private.mutate_player_ability_grant(uuid,integer,text,text,integer)',
    'private.phase_advance_preview(uuid,uuid,integer)',
    'private.queue_player_action(uuid,integer,jsonb,text)',
    'private.queue_player_action_document_v11_2(uuid,integer,jsonb,text)',
    'private.save_deterministic_resolution(uuid,integer,jsonb)',
    'private.start_resolution_session_document_v11_2(uuid,integer)',
    'public.advance_game_phase(uuid,integer,uuid,integer,boolean,text)',
    'public.apply_role_assignment_preview(uuid,integer,boolean)',
    'public.cancel_role_assignment_preview(uuid,integer)',
    'public.create_ai_change_proposal_internal(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,integer,text,uuid)',
    'public.create_global_rule_proposal_internal(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,integer,text,uuid)',
    'public.record_resolution_ai_proposal_internal(uuid,integer,jsonb,text,uuid,text,uuid,uuid[])',
    'public.review_ai_change_proposal(uuid,integer,text,jsonb,text)',
    'public.review_game_ai_change_proposal(uuid,integer,text,jsonb,text)',
    'public.save_global_rule(uuid,uuid,text,text,text,text,jsonb,text,boolean,integer)',
    'public.set_game_phase_pause(uuid,integer,uuid,integer,boolean,text)',
    'public.shuffle_role_assignment_preview(uuid,integer)'
  ];

  for(const routine of reachableRoutines){
    const occurrences=containmentSql.split(`'${routine}'::regprocedure`).length-1;
    assert.equal(occurrences,2,`${routine} must be patched and verified`);
  }

  assert.equal(new Set(reachableRoutines).size,22);
  assert.match(containmentSql,/regexp_replace\([\s\S]*'errcode\\s\*=\\s\*''40001'''[\s\S]*'errcode = ''PT422'''/i);
  assert.match(containmentSql,/EXPECTED_RETRYABLE_CONFLICT_NOT_FOUND/);
  assert.match(containmentSql,/RETRYABLE_REACHABLE_CONFLICT_REMAINS/);
  assert.match(containmentSql,/notify pgrst, 'reload schema'/i);
});

test('proposal reviews preserve their stale-proposal expiry behavior for PT422 conflicts',()=>{
  for(const routine of [
    'public.review_ai_change_proposal(uuid,integer,text,jsonb,text)',
    'public.review_game_ai_change_proposal(uuid,integer,text,jsonb,text)'
  ]){
    const occurrences=proposalHandlerSql.split(`'${routine}'::regprocedure`).length-1;
    assert.equal(occurrences,2,`${routine} must be patched and verified`);
  }

  assert.match(proposalHandlerSql,/when\\s\+sqlstate\\s\+''40001''\\s\+then/i);
  assert.match(proposalHandlerSql,/when sqlstate ''40001'' or sqlstate ''PT422'' then/i);
  assert.match(proposalHandlerSql,/PROPOSAL_CONFLICT_HANDLER_NOT_UPDATED/);
  assert.match(proposalHandlerSql,/notify pgrst, 'reload schema'/i);
});
