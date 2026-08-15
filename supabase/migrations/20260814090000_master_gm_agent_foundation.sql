-- Extend the existing single AI GM with auditable tools, durable references, and
-- atomic approval records. Existing game documents, drafts, resolutions,
-- precedents, statuses, and change history remain authoritative.

alter table public.ai_conversations
  add column context jsonb not null default '{}'::jsonb
  check (jsonb_typeof(context)='object' and octet_length(context::text)<=50000);

alter table public.ai_messages
  add column intent text not null default 'assistant' check (char_length(intent) between 1 and 80),
  add column referenced_entities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(referenced_entities)='array' and octet_length(referenced_entities::text)<=50000),
  add column tool_trace jsonb not null default '[]'::jsonb
    check (jsonb_typeof(tool_trace)='array' and octet_length(tool_trace::text)<=100000);

alter table public.ai_drafts drop constraint ai_drafts_draft_type_check;
alter table public.ai_drafts add constraint ai_drafts_draft_type_check
  check (draft_type in ('ROLE','ABILITY','FACTION','RULE','GAME','STATUS','DOCUMENT_IMPORT'));

alter table public.ai_usage_events drop constraint ai_usage_events_feature_check;
alter table public.ai_usage_events add constraint ai_usage_events_feature_check check (feature in (
  'auto','assistant','live_status','explain_content','resolve_actions','explain_role','plan_session','create_role','create_ability','create_faction','create_rule','create_game','create_status','document_import','edit_content','analyze_balance','search_history','search_precedents','balance_role','knowledge_ingest'
));

create table public.ai_agent_runs (
  id uuid primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  request_id uuid not null unique,
  user_message text not null check (char_length(btrim(user_message)) between 1 and 6000),
  requested_task text not null check (char_length(requested_task) between 1 and 80),
  resolved_intent text not null check (char_length(resolved_intent) between 1 and 80),
  referenced_entities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(referenced_entities)='array' and octet_length(referenced_entities::text)<=50000),
  ambiguous_entities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(ambiguous_entities)='array' and octet_length(ambiguous_entities::text)<=50000),
  selected_tools text[] not null default '{}',
  status text not null default 'RUNNING' check (status in ('RUNNING','COMPLETED','FAILED')),
  result_summary text not null default '' check (char_length(result_summary)<=4000),
  error_code text not null default '' check (char_length(error_code)<=120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.ai_tool_calls (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.ai_agent_runs(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  tool_name text not null check (char_length(tool_name) between 1 and 100),
  required_permission text not null check (required_permission in ('OWNER','GM','MEMBER')),
  read_only boolean not null,
  approval_required boolean not null,
  game_scoped boolean not null,
  input_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(input_summary)='object' and octet_length(input_summary::text)<=20000),
  output_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(output_summary)='object' and octet_length(output_summary::text)<=30000),
  success boolean not null,
  error_code text not null default '' check (char_length(error_code)<=120),
  duration_ms integer not null default 0 check (duration_ms between 0 and 60000),
  created_at timestamptz not null default now()
);

create table public.ai_change_proposals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  run_id uuid references public.ai_agent_runs(id) on delete set null,
  request_id uuid not null,
  idempotency_key uuid not null unique,
  proposal_type text not null default 'GAME_CHANGES' check (proposal_type in ('GAME_CHANGES','LIVE_STATUS','MIXED')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text not null default '' check (char_length(summary)<=4000),
  changes jsonb not null check (jsonb_typeof(changes)='array' and jsonb_array_length(changes) between 1 and 50 and octet_length(changes::text)<=150000),
  before_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(before_snapshot)='object' and octet_length(before_snapshot::text)<=500000),
  source_game_version integer not null check (source_game_version>0),
  status text not null default 'PENDING' check (status in ('PENDING','APPLIED','REJECTED','FAILED','EXPIRED')),
  version integer not null default 1 check (version>0),
  model text not null default '' check (char_length(model)<=120),
  approval_reason text not null default '' check (char_length(approval_reason)<=4000),
  applied_result jsonb not null default '{}'::jsonb check (jsonb_typeof(applied_result)='object' and octet_length(applied_result::text)<=500000),
  failure_code text not null default '' check (char_length(failure_code)<=120),
  created_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  applied_at timestamptz
);

create index ai_agent_runs_game_created_idx on public.ai_agent_runs(game_id,created_at desc);
create index ai_agent_runs_conversation_idx on public.ai_agent_runs(conversation_id,created_at desc);
create index ai_tool_calls_run_idx on public.ai_tool_calls(run_id,id);
create index ai_tool_calls_game_created_idx on public.ai_tool_calls(game_id,created_at desc);
create index ai_change_proposals_game_status_idx on public.ai_change_proposals(game_id,status,created_at desc);
create index ai_change_proposals_conversation_idx on public.ai_change_proposals(conversation_id,created_at desc);

alter table public.ai_agent_runs enable row level security;
alter table public.ai_tool_calls enable row level security;
alter table public.ai_change_proposals enable row level security;

-- AI conversations can contain GM-only roles, actions, statuses, and reasoning.
drop policy ai_conversations_read on public.ai_conversations;
drop policy ai_messages_read on public.ai_messages;
create policy ai_conversations_read on public.ai_conversations for select to authenticated
  using ((select public.can_edit_game(game_id)));
create policy ai_messages_read on public.ai_messages for select to authenticated
  using ((select public.can_edit_game(game_id)));
create policy ai_agent_runs_read_gm on public.ai_agent_runs for select to authenticated
  using ((select public.can_edit_game(game_id)));
create policy ai_tool_calls_read_gm on public.ai_tool_calls for select to authenticated
  using ((select public.can_edit_game(game_id)));
create policy ai_change_proposals_read_gm on public.ai_change_proposals for select to authenticated
  using ((select public.can_edit_game(game_id)));

grant select on public.ai_agent_runs,public.ai_tool_calls,public.ai_change_proposals to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.ai_agent_runs,public.ai_tool_calls,public.ai_change_proposals from anon,authenticated;

create or replace function private.master_gm_is_authorized(target_game_id uuid,actor_user_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.game_members where game_id=target_game_id and user_id=actor_user_id and member_role in ('owner','gm'))$$;
revoke all on function private.master_gm_is_authorized(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.create_master_gm_run_internal(
  target_run_id uuid,target_game_id uuid,target_conversation_id uuid,target_request_id uuid,
  target_user_message text,target_requested_task text,target_resolved_intent text,
  target_referenced_entities jsonb,target_ambiguous_entities jsonb,target_selected_tools text[],actor_user_id uuid
) returns public.ai_agent_runs language plpgsql security definer set search_path=''
as $$
declare result public.ai_agent_runs%rowtype;
begin
  if (select auth.role())<>'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  if not private.master_gm_is_authorized(target_game_id,actor_user_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if target_conversation_id is not null and not exists(select 1 from public.ai_conversations where id=target_conversation_id and game_id=target_game_id)
  then raise exception using errcode='23503',message='CONVERSATION_NOT_FOUND'; end if;
  insert into public.ai_agent_runs(id,game_id,conversation_id,request_id,user_message,requested_task,resolved_intent,referenced_entities,ambiguous_entities,selected_tools,created_by)
  values(target_run_id,target_game_id,target_conversation_id,target_request_id,left(target_user_message,6000),left(target_requested_task,80),left(target_resolved_intent,80),coalesce(target_referenced_entities,'[]'),coalesce(target_ambiguous_entities,'[]'),coalesce(target_selected_tools,'{}'),actor_user_id)
  returning * into result;
  return result;
end $$;

create or replace function public.record_master_gm_tool_call_internal(
  target_run_id uuid,target_tool_name text,target_required_permission text,target_read_only boolean,
  target_approval_required boolean,target_game_scoped boolean,target_input_summary jsonb,
  target_output_summary jsonb,target_success boolean,target_error_code text,target_duration_ms integer
) returns bigint language plpgsql security definer set search_path=''
as $$
declare target_game_id uuid; result bigint;
begin
  if (select auth.role())<>'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  select game_id into target_game_id from public.ai_agent_runs where id=target_run_id;
  if target_game_id is null then raise exception using errcode='P0002',message='AGENT_RUN_NOT_FOUND'; end if;
  insert into public.ai_tool_calls(run_id,game_id,tool_name,required_permission,read_only,approval_required,game_scoped,input_summary,output_summary,success,error_code,duration_ms)
  values(target_run_id,target_game_id,left(target_tool_name,100),target_required_permission,target_read_only,target_approval_required,target_game_scoped,coalesce(target_input_summary,'{}'),coalesce(target_output_summary,'{}'),target_success,left(coalesce(target_error_code,''),120),least(greatest(coalesce(target_duration_ms,0),0),60000))
  returning id into result;
  return result;
end $$;

create or replace function public.complete_master_gm_run_internal(target_run_id uuid,target_status text,target_result_summary text,target_error_code text)
returns public.ai_agent_runs language plpgsql security definer set search_path=''
as $$
declare result public.ai_agent_runs%rowtype; next_status text:=upper(coalesce(target_status,''));
begin
  if (select auth.role())<>'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  if next_status not in ('COMPLETED','FAILED') then raise exception using errcode='22023',message='INVALID_AGENT_RUN_STATUS'; end if;
  update public.ai_agent_runs set status=next_status,result_summary=left(coalesce(target_result_summary,''),4000),error_code=left(coalesce(target_error_code,''),120),completed_at=now()
  where id=target_run_id and status='RUNNING' returning * into result;
  if result.id is null then select * into result from public.ai_agent_runs where id=target_run_id; end if;
  return result;
end $$;

create or replace function public.create_ai_change_proposal_internal(
  target_game_id uuid,target_conversation_id uuid,target_run_id uuid,target_request_id uuid,target_idempotency_key uuid,
  target_title text,target_summary text,target_changes jsonb,target_source_game_version integer,target_model text,actor_user_id uuid
) returns public.ai_change_proposals language plpgsql security definer set search_path=''
as $$
declare result public.ai_change_proposals%rowtype; change jsonb; kind text; section_name text; target_record jsonb; has_status boolean:=false; has_document boolean:=false; entity_snapshot jsonb:='{}'::jsonb; snapshot jsonb:='{}'::jsonb; current_document jsonb;
begin
  if (select auth.role())<>'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  if not private.master_gm_is_authorized(target_game_id,actor_user_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if jsonb_typeof(target_changes)<>'array' or jsonb_array_length(target_changes) not between 1 and 50 or octet_length(target_changes::text)>150000
  then raise exception using errcode='22023',message='INVALID_AI_PROPOSAL'; end if;
  select document into current_document from public.game_documents where game_id=target_game_id and version=target_source_game_version;
  if current_document is null then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  for change in select value from jsonb_array_elements(target_changes) loop
    kind:=change->>'kind';
    if kind not in ('remove_action','set_player_alive','set_player_role','set_player_faction','apply_status','resolve_status','add_history','set_game_phase','set_game_day','update_role','update_ability','update_faction','update_rule','update_game')
    then raise exception using errcode='22023',message='UNSUPPORTED_AI_CHANGE'; end if;
    if char_length(coalesce(change->>'target_id',''))>100 or char_length(coalesce(change->>'value',''))>20000 or char_length(coalesce(change->>'reason',''))>2000
    then raise exception using errcode='22023',message='INVALID_AI_CHANGE'; end if;
    has_status:=has_status or kind in ('apply_status','resolve_status');
    has_document:=has_document or kind not in ('apply_status','resolve_status');
    target_record:=null;
    if kind in ('remove_action') then section_name:='actions';
    elsif kind in ('set_player_alive','set_player_role','set_player_faction','apply_status') then section_name:='players';
    elsif kind='update_role' then section_name:='roles';
    elsif kind='update_ability' then section_name:='abilities';
    elsif kind='update_faction' then section_name:='factions';
    elsif kind='update_rule' then section_name:='rules';
    else section_name:=null; end if;
    if section_name is not null then select value into target_record from jsonb_array_elements(current_document#>array['data',section_name]) where value->>'id'=change->>'target_id' limit 1; end if;
    if kind='resolve_status' then select to_jsonb(effect) into target_record from public.player_status_effects effect where effect.game_id=target_game_id and effect.id=(change->>'target_id')::uuid; end if;
    if kind='update_game' then target_record:=current_document->'game'; end if;
    if target_record is not null then entity_snapshot:=entity_snapshot||jsonb_build_object(kind||':'||coalesce(change->>'target_id','game'),target_record); end if;
  end loop;
  snapshot:=jsonb_build_object('gameVersion',target_source_game_version,'game',current_document->'game','entities',entity_snapshot,'changes',target_changes);
  insert into public.ai_change_proposals(game_id,conversation_id,run_id,request_id,idempotency_key,proposal_type,title,summary,changes,before_snapshot,source_game_version,model,created_by)
  values(target_game_id,target_conversation_id,target_run_id,target_request_id,target_idempotency_key,case when has_status and has_document then 'MIXED' when has_status then 'LIVE_STATUS' else 'GAME_CHANGES' end,left(target_title,200),left(coalesce(target_summary,''),4000),target_changes,snapshot,target_source_game_version,left(coalesce(target_model,''),120),actor_user_id)
  on conflict(idempotency_key) do nothing returning * into result;
  if result.id is null then select * into result from public.ai_change_proposals where idempotency_key=target_idempotency_key; else
    insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
    values(target_game_id,actor_user_id,'ai_proposal',result.id::text,'AI change proposal created',jsonb_build_object('title',result.title,'types',result.proposal_type,'changeCount',jsonb_array_length(result.changes),'runId',target_run_id));
  end if;
  return result;
end $$;

create or replace function public.record_master_gm_exchange_internal(
  target_game_id uuid,target_conversation_id uuid,target_user_content text,target_assistant_content text,
  target_result jsonb,target_model text,target_game_version integer,target_request_id uuid,target_intent text,
  target_referenced_entities jsonb,target_tool_trace jsonb,target_context jsonb,actor_user_id uuid
) returns void language plpgsql security definer set search_path=''
as $$
begin
  if (select auth.role())<>'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  if not private.master_gm_is_authorized(target_game_id,actor_user_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if not exists(select 1 from public.ai_conversations where id=target_conversation_id and game_id=target_game_id and active)
  then raise exception using errcode='23503',message='CONVERSATION_NOT_FOUND'; end if;
  insert into public.ai_messages(conversation_id,game_id,role,content,model,game_version,request_id,intent,referenced_entities,tool_trace,created_by)
  values(target_conversation_id,target_game_id,'user',left(target_user_content,12000),'',target_game_version,target_request_id,left(target_intent,80),coalesce(target_referenced_entities,'[]'),coalesce(target_tool_trace,'[]'),actor_user_id);
  insert into public.ai_messages(conversation_id,game_id,role,content,structured_result,model,game_version,request_id,intent,referenced_entities,tool_trace,created_by)
  values(target_conversation_id,target_game_id,'assistant',left(target_assistant_content,12000),target_result,left(target_model,120),target_game_version,target_request_id,left(target_intent,80),coalesce(target_referenced_entities,'[]'),coalesce(target_tool_trace,'[]'),actor_user_id);
  update public.ai_conversations set context=coalesce(target_context,'{}') where id=target_conversation_id;
end $$;

create or replace function private.master_gm_patch_entity(candidate jsonb,section_name text,target_id text,patch jsonb,actor uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare allowed_keys text[]; current_item jsonb; next_items jsonb; sanitized jsonb; did_find boolean:=false;
begin
  if section_name='roles' then allowed_keys:=array['name','factionId','alignment','description','activeAbilityId','passiveAbilityId','tags','abilityUses','cooldowns','immunities','restrictions','winCondition','notes','gmNotes','labels','enabled','archivedAt'];
  elsif section_name='abilities' then allowed_keys:=array['name','category','definition','phase','mechanics'];
  elsif section_name='factions' then allowed_keys:=array['name','class','alignment','description','winCondition','notes','alias','teamNumber'];
  elsif section_name='rules' then allowed_keys:=array['title','description','category','visibility','notes','enabled','sortOrder'];
  else raise exception using errcode='22023',message='INVALID_PATCH_SECTION'; end if;
  if jsonb_typeof(patch)<>'object' or exists(select 1 from jsonb_object_keys(patch) key where key<>all(allowed_keys))
  then raise exception using errcode='22023',message='INVALID_PATCH_FIELDS'; end if;
  select value into current_item from jsonb_array_elements(candidate#>array['data',section_name]) where value->>'id'=target_id limit 1;
  if current_item is null then raise exception using errcode='P0002',message='PATCH_TARGET_NOT_FOUND'; end if;
  if section_name='roles' then
    if char_length(coalesce(patch->>'name',current_item->>'name','')) not between 1 and 120 or char_length(coalesce(patch->>'description',current_item->>'description',''))>8000
    then raise exception using errcode='22023',message='INVALID_ROLE_PATCH'; end if;
    if nullif(patch->>'factionId','') is not null and not exists(select 1 from jsonb_array_elements(candidate#>'{data,factions}') item where item->>'id'=patch->>'factionId') then raise exception using errcode='23503',message='FACTION_NOT_FOUND'; end if;
    if nullif(patch->>'activeAbilityId','') is not null and not exists(select 1 from jsonb_array_elements(candidate#>'{data,abilities}') item where item->>'id'=patch->>'activeAbilityId') then raise exception using errcode='23503',message='ABILITY_NOT_FOUND'; end if;
    if nullif(patch->>'passiveAbilityId','') is not null and not exists(select 1 from jsonb_array_elements(candidate#>'{data,abilities}') item where item->>'id'=patch->>'passiveAbilityId') then raise exception using errcode='23503',message='ABILITY_NOT_FOUND'; end if;
    if patch?'tags' then
      if jsonb_typeof(patch->'tags')<>'array' or jsonb_array_length(patch->'tags')>100 or exists(select 1 from jsonb_array_elements_text(patch->'tags') requested where not exists(select 1 from jsonb_array_elements(candidate#>'{data,abilities}') ability where lower(ability->>'name')=lower(requested)))
      then raise exception using errcode='22023',message='INVALID_ROLE_ABILITIES'; end if;
    end if;
  elsif section_name='abilities' then
    if char_length(coalesce(patch->>'name',current_item->>'name','')) not between 1 and 120 or char_length(coalesce(patch->>'definition',current_item->>'definition','')) not between 1 and 8000
      or coalesce(patch->>'category',current_item->>'category','Other') not in ('Investigation','Harmful','Protection','Support','Control','Communication','Passive','Other')
      or coalesce(patch->>'phase',current_item->>'phase','Any') not in ('Night','Day','Any','Passive')
    then raise exception using errcode='22023',message='INVALID_ABILITY_PATCH'; end if;
    if patch?'mechanics' and (jsonb_typeof(patch->'mechanics')<>'array' or jsonb_array_length(patch->'mechanics')>100) then raise exception using errcode='22023',message='INVALID_ABILITY_MECHANICS'; end if;
  elsif section_name='factions' then
    if char_length(coalesce(patch->>'name',current_item->>'name','')) not between 1 and 120 or coalesce(patch->>'class',current_item->>'class','NEUTRAL') not in ('VILLAGER','DEN','NEUTRAL')
    then raise exception using errcode='22023',message='INVALID_FACTION_PATCH'; end if;
  elsif section_name='rules' then
    if char_length(coalesce(patch->>'title',current_item->>'title','')) not between 1 and 200 or char_length(coalesce(patch->>'description',current_item->>'description','')) not between 1 and 8000 or coalesce(patch->>'visibility',current_item->>'visibility','public') not in ('public','gm')
    then raise exception using errcode='22023',message='INVALID_RULE_PATCH'; end if;
  end if;
  if coalesce(patch->>'name',patch->>'title','')<>'' and exists(select 1 from jsonb_array_elements(candidate#>array['data',section_name]) item where item->>'id'<>target_id and lower(coalesce(item->>'name',item->>'title'))=lower(coalesce(patch->>'name',patch->>'title')))
  then raise exception using errcode='23505',message='DUPLICATE_ENTITY_NAME'; end if;
  sanitized:=patch-'id'-'gameId'-'createdAt'-'createdBy'-'updatedAt'-'updatedBy'-'version'-'revisions';
  if section_name='abilities' then sanitized:=sanitized||jsonb_build_object('revisions',coalesce(current_item->'revisions','[]'::jsonb)||jsonb_build_array(current_item-'revisions')); end if;
  sanitized:=sanitized||jsonb_build_object('version',coalesce((current_item->>'version')::integer,0)+1,'updatedAt',now(),'updatedBy',actor);
  select jsonb_agg(case when value->>'id'=target_id then value||sanitized else value end order by ordinality),bool_or(value->>'id'=target_id)
  into next_items,did_find from jsonb_array_elements(candidate#>array['data',section_name]) with ordinality;
  if not did_find then raise exception using errcode='P0002',message='PATCH_TARGET_NOT_FOUND'; end if;
  return jsonb_set(candidate,array['data',section_name],next_items,false);
end $$;
revoke all on function private.master_gm_patch_entity(jsonb,text,text,jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function public.review_ai_change_proposal(target_proposal_id uuid,expected_version integer,target_decision text,target_edited_changes jsonb default null,target_reason text default '')
returns public.ai_change_proposals language plpgsql security definer set search_path=''
as $$
declare proposal public.ai_change_proposals%rowtype; document_row public.game_documents%rowtype; decision text:=upper(btrim(coalesce(target_decision,''))); changes jsonb; change jsonb; kind text; target text; value_text text; patch jsonb; candidate jsonb; next_array jsonb; status_changes jsonb:='[]'::jsonb; has_document boolean:=false; saved_result jsonb:='{}'::jsonb; status_result jsonb:='[]'::jsonb; actor uuid:=(select auth.uid());
begin
  if actor is null then raise exception using errcode='28000',message='AUTHENTICATION_REQUIRED'; end if;
  select * into proposal from public.ai_change_proposals where id=target_proposal_id for update;
  if proposal.id is null then raise exception using errcode='P0002',message='AI_PROPOSAL_NOT_FOUND'; end if;
  if not public.can_edit_game(proposal.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if proposal.status in ('APPLIED','REJECTED','FAILED','EXPIRED') then return proposal; end if;
  if proposal.version<>expected_version then raise exception using errcode='40001',message='AI_PROPOSAL_VERSION_CONFLICT'; end if;
  if decision='REJECT' then
    update public.ai_change_proposals set status='REJECTED',version=version+1,approval_reason=left(coalesce(target_reason,''),4000),reviewed_by=actor,reviewed_at=now(),updated_at=now()
    where id=proposal.id returning * into proposal;
    insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(proposal.game_id,actor,'ai_proposal',proposal.id::text,'AI change proposal rejected',jsonb_build_object('status','PENDING'),jsonb_build_object('status','REJECTED','reason',proposal.approval_reason));
    return proposal;
  end if;
  if decision<>'APPROVE' then raise exception using errcode='22023',message='INVALID_AI_PROPOSAL_DECISION'; end if;
  changes:=coalesce(target_edited_changes,proposal.changes);
  if jsonb_typeof(changes)<>'array' or jsonb_array_length(changes) not between 1 and 50 or octet_length(changes::text)>150000 then raise exception using errcode='22023',message='INVALID_AI_PROPOSAL'; end if;
  select * into document_row from public.game_documents where game_id=proposal.game_id for update;
  if document_row.version<>proposal.source_game_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  candidate:=document_row.document;
  for change in select value from jsonb_array_elements(changes) loop
    kind:=change->>'kind';target:=change->>'target_id';value_text:=coalesce(change->>'value','');
    if kind in ('apply_status','resolve_status') then status_changes:=status_changes||jsonb_build_array(change);continue; end if;
    has_document:=true;
    if kind='remove_action' then
      if not exists(select 1 from jsonb_array_elements(candidate#>'{data,actions}') item where item->>'id'=target) then raise exception using errcode='P0002',message='ACTION_NOT_FOUND'; end if;
      select coalesce(jsonb_agg(item),'[]'::jsonb) into next_array from jsonb_array_elements(candidate#>'{data,actions}') item where item->>'id'<>target;
      candidate:=jsonb_set(candidate,'{data,actions}',next_array,false);
    elsif kind='set_player_alive' then
      if value_text not in ('true','false') then raise exception using errcode='22023',message='INVALID_ALIVE_VALUE'; end if;
      select jsonb_agg(case when item->>'id'=target then jsonb_set(item,'{alive}',to_jsonb(value_text::boolean),true) else item end order by item_order) into next_array from jsonb_array_elements(candidate#>'{data,players}') with ordinality as entries(item,item_order);
      if not exists(select 1 from jsonb_array_elements(candidate#>'{data,players}') item where item->>'id'=target) then raise exception using errcode='P0002',message='PLAYER_NOT_FOUND'; end if;
      candidate:=jsonb_set(candidate,'{data,players}',next_array,false);
    elsif kind in ('set_player_role','set_player_faction') then
      if kind='set_player_role' and not exists(select 1 from jsonb_array_elements(candidate#>'{data,roles}') item where item->>'id'=value_text) then raise exception using errcode='23503',message='ROLE_NOT_FOUND'; end if;
      if kind='set_player_faction' and not exists(select 1 from jsonb_array_elements(candidate#>'{data,factions}') item where item->>'id'=value_text) then raise exception using errcode='23503',message='FACTION_NOT_FOUND'; end if;
      if not exists(select 1 from jsonb_array_elements(candidate#>'{data,players}') item where item->>'id'=target) then raise exception using errcode='P0002',message='PLAYER_NOT_FOUND'; end if;
      select jsonb_agg(case when item->>'id'=target then jsonb_set(item,array[case when kind='set_player_role' then 'roleId' else 'currentFactionId' end],to_jsonb(value_text),true) else item end order by item_order) into next_array from jsonb_array_elements(candidate#>'{data,players}') with ordinality as entries(item,item_order);
      candidate:=jsonb_set(candidate,'{data,players}',next_array,false);
    elsif kind='add_history' then
      if btrim(value_text)='' then raise exception using errcode='22023',message='EMPTY_HISTORY_NOTE'; end if;
      candidate:=jsonb_set(candidate,'{data,history}',candidate#>'{data,history}'||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'gameId',proposal.game_id,'type','AI_RULING','message',left(value_text,4000),'day',coalesce((candidate#>>'{game,currentDay}')::integer,0),'phase',coalesce(candidate#>>'{game,currentPhase}','Day'),'timestamp',now())),false);
    elsif kind='set_game_phase' then
      if value_text not in ('Day','Night') then raise exception using errcode='22023',message='INVALID_GAME_PHASE'; end if;
      candidate:=jsonb_set(candidate,'{game,currentPhase}',to_jsonb(value_text),true);
    elsif kind='set_game_day' then
      if value_text!~'^\d{1,3}$' or value_text::integer>999 then raise exception using errcode='22023',message='INVALID_GAME_DAY'; end if;
      candidate:=jsonb_set(candidate,'{game,currentDay}',to_jsonb(value_text::integer),true);
    elsif kind in ('update_role','update_ability','update_faction','update_rule') then
      begin patch:=value_text::jsonb; exception when others then raise exception using errcode='22023',message='INVALID_PATCH_JSON'; end;
      candidate:=private.master_gm_patch_entity(candidate,case kind when 'update_role' then 'roles' when 'update_ability' then 'abilities' when 'update_faction' then 'factions' else 'rules' end,target,patch,actor);
    elsif kind='update_game' then
      begin patch:=value_text::jsonb; exception when others then raise exception using errcode='22023',message='INVALID_PATCH_JSON'; end;
      if jsonb_typeof(patch)<>'object' or exists(select 1 from jsonb_object_keys(patch) key where key<>all(array['name','theme','description','status','currentDay','currentPhase','notes'])) then raise exception using errcode='22023',message='INVALID_GAME_PATCH'; end if;
      candidate:=jsonb_set(candidate,'{game}',candidate->'game'||patch||jsonb_build_object('updatedAt',now()),false);
    else raise exception using errcode='22023',message='UNSUPPORTED_AI_CHANGE'; end if;
  end loop;
  if has_document then select jsonb_build_object('version',saved.version,'updatedAt',saved.updated_at,'updatedBy',saved.updated_by) into saved_result from public.save_game_document(proposal.game_id,document_row.version,candidate,'AI proposal approved and applied','ai_proposal',proposal.id::text) saved limit 1; end if;
  if jsonb_array_length(status_changes)>0 then status_result:=public.apply_player_status_changes(proposal.game_id,status_changes); end if;
  update public.ai_change_proposals set changes=changes,status='APPLIED',version=version+1,approval_reason=left(coalesce(target_reason,''),4000),applied_result=jsonb_build_object('gameSave',saved_result,'statuses',status_result,'changeCount',jsonb_array_length(changes)),reviewed_by=actor,reviewed_at=now(),applied_at=now(),updated_at=now()
  where id=proposal.id returning * into proposal;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(proposal.game_id,actor,'ai_proposal',proposal.id::text,'AI change proposal applied',proposal.before_snapshot,jsonb_build_object('status','APPLIED','changes',changes,'result',proposal.applied_result,'reason',proposal.approval_reason));
  return proposal;
exception
  when sqlstate '40001' then
    if proposal.id is null or actor is null or not public.can_edit_game(proposal.game_id) then raise; end if;
    update public.ai_change_proposals set status='EXPIRED',version=version+1,failure_code='VERSION_CONFLICT',reviewed_by=actor,reviewed_at=now(),updated_at=now() where id=proposal.id and status='PENDING' returning * into proposal;
    if proposal.id is not null then insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(proposal.game_id,actor,'ai_proposal',proposal.id::text,'AI change proposal expired',jsonb_build_object('sourceGameVersion',proposal.source_game_version),jsonb_build_object('status','EXPIRED','failureCode','VERSION_CONFLICT'));return proposal; end if;
    raise;
  when others then
    if proposal.id is null or actor is null or not public.can_edit_game(proposal.game_id) then raise; end if;
    update public.ai_change_proposals set status='FAILED',version=version+1,failure_code=left(sqlstate||':'||sqlerrm,120),reviewed_by=actor,reviewed_at=now(),updated_at=now() where id=proposal.id and status='PENDING' returning * into proposal;
    if proposal.id is not null then insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(proposal.game_id,actor,'ai_proposal',proposal.id::text,'AI change proposal failed',proposal.before_snapshot,jsonb_build_object('status','FAILED','failureCode',proposal.failure_code));return proposal; end if;
    raise;
end $$;

create or replace function public.create_ai_draft_internal(target_game_id uuid,target_draft_type text,target_title text,target_request_text text,target_payload jsonb,target_possible_duplicate boolean,target_duplicate_notes text,target_model text,target_request_id uuid,target_source_versions jsonb,actor_user_id uuid)
returns public.ai_drafts language plpgsql security definer set search_path=''
as $$
declare result public.ai_drafts%rowtype; normalized_type text:=upper(btrim(coalesce(target_draft_type,'')));
begin
  if (select auth.role())<>'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  if not private.master_gm_is_authorized(target_game_id,actor_user_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if normalized_type not in ('ROLE','ABILITY','FACTION','RULE','GAME','STATUS','DOCUMENT_IMPORT') then raise exception using errcode='22023',message='INVALID_DRAFT_TYPE'; end if;
  if jsonb_typeof(target_payload)<>'object' or octet_length(target_payload::text)>100000 then raise exception using errcode='22023',message='INVALID_DRAFT_PAYLOAD'; end if;
  insert into public.ai_drafts(game_id,draft_type,title,request_text,payload,possible_duplicate,duplicate_notes,model,request_id,source_versions,created_by)
  values(target_game_id,normalized_type,left(target_title,200),left(coalesce(target_request_text,''),6000),target_payload,coalesce(target_possible_duplicate,false),left(coalesce(target_duplicate_notes,''),4000),left(target_model,120),target_request_id,coalesce(target_source_versions,'{}'),actor_user_id) returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(target_game_id,actor_user_id,lower(normalized_type)||'_draft',result.id::text,initcap(lower(normalized_type))||' draft created',jsonb_build_object('title',result.title,'model',target_model));
  return result;
end $$;

revoke all on function public.create_master_gm_run_internal(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text[],uuid) from public,anon,authenticated;
revoke all on function public.record_master_gm_tool_call_internal(uuid,text,text,boolean,boolean,boolean,jsonb,jsonb,boolean,text,integer) from public,anon,authenticated;
revoke all on function public.complete_master_gm_run_internal(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.create_ai_change_proposal_internal(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,integer,text,uuid) from public,anon,authenticated;
revoke all on function public.record_master_gm_exchange_internal(uuid,uuid,text,text,jsonb,text,integer,uuid,text,jsonb,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.create_ai_draft_internal(uuid,text,text,text,jsonb,boolean,text,text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_master_gm_run_internal(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text[],uuid) to service_role;
grant execute on function public.record_master_gm_tool_call_internal(uuid,text,text,boolean,boolean,boolean,jsonb,jsonb,boolean,text,integer) to service_role;
grant execute on function public.complete_master_gm_run_internal(uuid,text,text,text) to service_role;
grant execute on function public.create_ai_change_proposal_internal(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,integer,text,uuid) to service_role;
grant execute on function public.record_master_gm_exchange_internal(uuid,uuid,text,text,jsonb,text,integer,uuid,text,jsonb,jsonb,jsonb,uuid) to service_role;
grant execute on function public.create_ai_draft_internal(uuid,text,text,text,jsonb,boolean,text,text,uuid,jsonb,uuid) to service_role;
revoke all on function public.review_ai_change_proposal(uuid,integer,text,jsonb,text) from public,anon;
grant execute on function public.review_ai_change_proposal(uuid,integer,text,jsonb,text) to authenticated;

do $$ begin alter publication supabase_realtime add table public.ai_change_proposals; exception when duplicate_object then null; end $$;
