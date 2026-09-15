-- Approved sharing: only explicitly approved GLOBAL rulings cross game boundaries.
-- The private helper exposes a boolean, never source-game rows. The public
-- search remains SECURITY INVOKER and games_read_member is unchanged.
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.can_read_global_origin(origin_id uuid, target_id uuid default null)
returns boolean
language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null
    and (public.is_permanent_account() or public.is_legacy_account())
    and exists (
      select 1
      from public.games origin
      join public.games accessible on accessible.owner_id=origin.owner_id
      join public.game_members member on member.game_id=accessible.id
      where origin.id=origin_id
        and (target_id is null or accessible.id=target_id)
        and member.user_id=auth.uid()
        and member.member_role in ('owner','gm')
    )
$$;
revoke all on function private.can_read_global_origin(uuid,uuid) from public,anon;
grant execute on function private.can_read_global_origin(uuid,uuid) to authenticated;

drop policy gm_precedents_read_gm on public.gm_precedents;
create policy gm_precedents_read_gm on public.gm_precedents
for select to authenticated using (
  (select public.can_edit_game(game_id))
  or (scope='GLOBAL' and approved_for_global_use
      and private.can_read_global_origin(game_id))
);

create or replace function public.search_gm_precedents(target_game_id uuid,target_signature_tokens text[],target_query text default '',match_count integer default 8)
returns table(
  id uuid,precedent_number bigint,title text,summary text,interaction_signature text,signature_tokens text[],conditions jsonb,
  final_outcome jsonb,gm_reasoning text,scope text,status text,authority text,ability_ids text[],role_ids text[],status_types text[],
  rule_versions jsonb,global_concept_ids text[],compatibility_metadata jsonb,version integer,created_at timestamptz,
  origin_game_id uuid,origin_game_name text,authority_layer text,applicability text,compatibility_reasons jsonb,
  similarity_score numeric,similarity text
)
language plpgsql stable security invoker set search_path=''
as $$
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  return query
  with requested as (
    select
      coalesce(array(select distinct lower(btrim(token)) from unnest(coalesce(target_signature_tokens,'{}')) token where btrim(token)<>''),'{}') tokens,
      coalesce(array(select regexp_replace(lower(token),'^ability:','') from unnest(coalesce(target_signature_tokens,'{}')) token where lower(token) like 'ability:%'),'{}') ability_tokens,
      coalesce(array(select regexp_replace(lower(token),'^role:','') from unnest(coalesce(target_signature_tokens,'{}')) token where lower(token) like 'role:%'),'{}') role_tokens,
      coalesce(array(select regexp_replace(lower(token),'^status:','') from unnest(coalesce(target_signature_tokens,'{}')) token where lower(token) like 'status:%'),'{}') status_tokens
  ), eligible as (
    select precedent.*,origin.name origin_name,
      case when precedent.game_id=target_game_id and precedent.scope<>'GLOBAL' then 'CURRENT_GAME_APPROVED_PRECEDENT'
           when precedent.authority='GLOBAL_OFFICIAL_RULE' then 'GLOBAL_OFFICIAL_GM_RULE'
           else 'GLOBAL_APPROVED_GM_PRECEDENT' end layer,
      case when cardinality(requested.tokens)=0 then 0::numeric else
        (select count(*)::numeric from unnest(precedent.signature_tokens) token where lower(token)=any(requested.tokens))
        /greatest(cardinality(requested.tokens),cardinality(precedent.signature_tokens)) end token_score,
      requested.tokens requested_tokens,requested.status_tokens,requested.ability_tokens,requested.role_tokens
    from public.gm_precedents precedent
    left join public.games origin on origin.id=precedent.game_id
    cross join requested
    where precedent.status in ('ACTIVE','CONFLICTING') and precedent.scope<>'ONE_TIME'
      and (precedent.game_id=target_game_id or (precedent.scope='GLOBAL' and precedent.approved_for_global_use and private.can_read_global_origin(precedent.game_id,target_game_id)))
      and (precedent.scope<>'ROLE_SPECIFIC' or (cardinality(precedent.role_ids)>0 and exists(select 1 from unnest(precedent.role_ids) role_id where regexp_replace(lower(role_id),'[^a-z0-9]+','_','g')=any(requested.role_tokens))))
      and (precedent.scope<>'ABILITY_SPECIFIC' or (cardinality(precedent.ability_ids)>0 and exists(select 1 from unnest(precedent.ability_ids) ability_id where regexp_replace(lower(ability_id),'[^a-z0-9]+','_','g')=any(requested.ability_tokens))))
      and (cardinality(requested.tokens)=0 or precedent.signature_tokens&&requested.tokens or precedent.global_concept_ids&&requested.tokens or (btrim(coalesce(target_query,''))<>'' and (lower(precedent.interaction_signature) like '%'||lower(btrim(target_query))||'%' or lower(precedent.gm_reasoning) like '%'||lower(btrim(target_query))||'%')))
  ), scored as (
    select eligible.*,
      greatest(0,least(1,eligible.token_score
        +case when eligible.game_id=target_game_id and eligible.scope<>'GLOBAL' then .15 else 0 end
        +case when eligible.authority='GLOBAL_OFFICIAL_RULE' then .10 else 0 end
        +case when eligible.global_concept_ids&&eligible.requested_tokens then .65 else 0 end
        -case when cardinality(eligible.status_types)>0 and not exists(select 1 from unnest(eligible.status_types) status_type where regexp_replace(lower(status_type),'[^a-z0-9]+','_','g')=any(eligible.status_tokens)) then .25 else 0 end
      ))::numeric compatibility_score
    from eligible
  )
  select scored.id,scored.precedent_number,scored.title,scored.summary,scored.interaction_signature,scored.signature_tokens,scored.conditions,
    scored.final_outcome,scored.gm_reasoning,scored.scope,scored.status,scored.authority,scored.ability_ids,scored.role_ids,scored.status_types,
    scored.rule_versions,scored.global_concept_ids,scored.compatibility_metadata,scored.version,scored.created_at,
    scored.game_id,coalesce(nullif(scored.origin_game_name_snapshot,''),scored.origin_name),scored.layer,
    case when scored.compatibility_score>=.95 then 'EXACT' when scored.compatibility_score>=.6 then 'STRONG' else 'PARTIAL' end,
    jsonb_strip_nulls(jsonb_build_object(
      'currentGame',scored.game_id=target_game_id,
      'statusContextMismatch',case when cardinality(scored.status_types)>0 and not exists(select 1 from unnest(scored.status_types) status_type where regexp_replace(lower(status_type),'[^a-z0-9]+','_','g')=any(scored.status_tokens)) then true else null end,
      'versionCheckRequired',scored.scope='GLOBAL',
      'roleSpecific',cardinality(scored.role_ids)>0
    )),scored.compatibility_score,
    case when scored.compatibility_score>=.95 then 'EXACT' when scored.compatibility_score>=.6 then 'STRONG' else 'PARTIAL' end
  from scored
  order by case scored.layer when 'CURRENT_GAME_APPROVED_PRECEDENT' then 1 when 'GLOBAL_OFFICIAL_GM_RULE' then 2 else 3 end,
    scored.compatibility_score desc,scored.created_at desc
  limit least(greatest(match_count,1),50);
end $$;
