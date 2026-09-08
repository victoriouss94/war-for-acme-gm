CREATE OR REPLACE FUNCTION public.get_mechanics_review_queue(target_game_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with authorized_documents as (
  select document_row.game_id,game.name as game_name,document_row.document
  from public.game_documents document_row join public.games game on game.id=document_row.game_id
  where (select auth.uid()) is not null and public.can_edit_game(document_row.game_id) and ($1 is null or document_row.game_id=$1)
), mechanic_owners as (
  select d.game_id,d.game_name,d.document,r.value as role,null::jsonb as owned_ability,r.value as owner
  from authorized_documents d cross join lateral jsonb_array_elements(coalesce(d.document#>'{data,roles}','[]'::jsonb)) r(value)
  union all
  select d.game_id,d.game_name,d.document,null::jsonb,a.value,a.value
  from authorized_documents d cross join lateral jsonb_array_elements(coalesce(d.document#>'{data,abilities}','[]'::jsonb)) a(value)
), mechanic_sources as (
  select o.*,m.value as mechanic,(m.ordinality-1)::integer as mechanic_index
  from mechanic_owners o
  cross join lateral (select coalesce(nullif(o.owner->'understanding','null'::jsonb),nullif(o.owner->'mechanicUnderstanding','null'::jsonb),nullif(o.owner->'mechanic_understanding','null'::jsonb),'{}'::jsonb) as value) u
  cross join lateral (select coalesce(nullif(u.value->'mechanics','null'::jsonb),nullif(o.owner->'mechanicalStatements','null'::jsonb),nullif(o.owner->'mechanical_statements','null'::jsonb),'[]'::jsonb) as value) raw
  cross join lateral jsonb_array_elements(case when jsonb_typeof(raw.value)='array' then raw.value else '[]'::jsonb end) with ordinality m(value,ordinality)
  where m.ordinality<=1000 and jsonb_typeof(m.value)='object'
), normalized_sources as (
  select s.*,coalesce(s.owned_ability,linked.value) as ability,
    left(btrim(regexp_replace(coalesce(s.mechanic->>'id',s.mechanic->>'mechanicId',s.mechanic->>'mechanic_id',''),'\s+',' ','g')),160) as explicit_id,
    regexp_replace(upper(btrim(coalesce(s.mechanic->>'type',s.mechanic->>'mechanicType',s.mechanic->>'mechanic_type',''))),'[\s-]+','_','g') as requested_type,
    regexp_replace(upper(btrim(coalesce(s.mechanic->>'interpretationState',s.mechanic->>'interpretation_state',''))),'[\s-]+','_','g') as requested_state,
    btrim(regexp_replace(replace(coalesce(s.mechanic->>'originalText',s.mechanic->>'original_text',s.mechanic->>'sourceText',s.mechanic->>'source_text',''),chr(160),' '),'\s+',' ','g')) as original_text,
    btrim(regexp_replace(replace(coalesce(s.mechanic->>'summary',s.mechanic->>'effect',s.mechanic->>'customEffect',s.mechanic->>'custom_effect',''),chr(160),' '),'\s+',' ','g')) as summary_text,
    case when coalesce(s.mechanic->>'confidence','')~'^[[:space:]]*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?[[:space:]]*$'
      and pg_catalog.pg_input_is_valid(s.mechanic->>'confidence','double precision') then greatest(0,least(1,(s.mechanic->>'confidence')::double precision))
      when s.mechanic->'confidence'='true'::jsonb then 1 else 0 end as normalized_confidence,
    coalesce(nullif(s.mechanic->'requiresReview','null'::jsonb),nullif(s.mechanic->'requires_review','null'::jsonb),'false'::jsonb) not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) as explicit_review,
    exists(select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(nullif(s.mechanic->'unresolvedComponents','null'::jsonb),s.mechanic->'unresolved_components'))='array' then coalesce(nullif(s.mechanic->'unresolvedComponents','null'::jsonb),s.mechanic->'unresolved_components') else '[]'::jsonb end) with ordinality unknown(value,ordinality)
      where unknown.ordinality<=100 and nullif(btrim(regexp_replace(coalesce(unknown.value#>>'{}',''),'\s+',' ','g')),'') is not null) as has_unknowns
  from mechanic_sources s
  left join lateral (select a.value from jsonb_array_elements(coalesce(s.document#>'{data,abilities}','[]'::jsonb)) a(value) where a.value->>'id'=btrim(coalesce(s.mechanic->>'sourceAbilityId',s.mechanic->>'source_ability_id','')) limit 1) linked on true
), typed_sources as (
  select n.*,case when n.requested_type=any(array['ACTIVE_ABILITY','PASSIVE','IMMUNITY','CONDITIONAL_IMMUNITY','TRIGGER','COUNTERATTACK','REFLECTION','REDIRECT','BLOCK','FACTION_BLOCK','STATUS_EFFECT','FACTION_EFFECT','GLOBAL_EFFECT','KILL_EFFECT','PROTECTION_EFFECT','CONVERSION_EFFECT','INVESTIGATION_EFFECT','SUPPORT_EFFECT','TARGET_RESTRICTION','EFFECT_ELIGIBILITY','PHASE_RESTRICTION','DURATION','USE_LIMIT','COOLDOWN','ABILITY_GRANT','ABILITY_MODIFIER','ADDITIONAL_USE','KILL_TIER_MODIFIER','PROTECTION_TIER_MODIFIER','DEATH_TRIGGER','REVIVAL','EXTRA_LIFE','FACTION_RULE','ROLE_RELATIONSHIP','DEPENDENCY','WIN_CONDITION','TRANSFORMATION','ESCALATION','ROLE_PROPERTY','FACTION_PROPERTY','CUSTOM_MECHANIC']) then n.requested_type else 'CUSTOM_MECHANIC' end as normalized_type,
    case when n.requested_state=any(array['VERIFIED','HIGH_CONFIDENCE','PARTIALLY_UNDERSTOOD','NEEDS_REVIEW','UNRESOLVED']) then n.requested_state else 'NEEDS_REVIEW' end as normalized_state
  from normalized_sources n
), derived as (
  select * from typed_sources n
  where (n.original_text<>'' or n.summary_text<>'' or nullif(btrim(coalesce(n.mechanic->>'name','')),'') is not null)
    and (n.explicit_review or n.normalized_state in ('PARTIALLY_UNDERSTOOD','NEEDS_REVIEW','UNRESOLVED') or n.has_unknowns or n.normalized_confidence<.75)
), review_roles as (
  select document_row.game_id,document_row.game_name,role.value as role,passive.value as passive_ability,
    left(btrim(regexp_replace(replace(coalesce(role.value->>'sourceText',''),chr(160),' '),'\s+',' ','g')),12000) as source_text,
    (case when coalesce(role.value->'activeAbilityId','null'::jsonb) not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) then 1 else 0 end
     +case when coalesce(role.value->'passiveAbilityId','null'::jsonb) not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) then 1 else 0 end
     +(select count(*) from jsonb_array_elements(case when jsonb_typeof(role.value->'tags')='array' then role.value->'tags' else '[]'::jsonb end) tag(value) where tag.value not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb))) as owned_count,
    valid.mechanics
  from authorized_documents document_row
  cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,roles}','[]'::jsonb)) role(value)
  cross join lateral (select coalesce(nullif(role.value->'understanding','null'::jsonb),nullif(role.value->'mechanicUnderstanding','null'::jsonb),nullif(role.value->'mechanic_understanding','null'::jsonb),'{}'::jsonb) as value) understanding
  cross join lateral (select coalesce(nullif(understanding.value->'mechanics','null'::jsonb),nullif(role.value->'mechanicalStatements','null'::jsonb),nullif(role.value->'mechanical_statements','null'::jsonb),'[]'::jsonb) as value) raw_mechanics
  cross join lateral (
    select coalesce(jsonb_agg(m.value),'[]'::jsonb) as mechanics
    from jsonb_array_elements(case when jsonb_typeof(raw_mechanics.value)='array' then raw_mechanics.value else '[]'::jsonb end) with ordinality m(value,ordinality)
    where m.ordinality<=1000 and (
      nullif(btrim(coalesce(m.value->>'originalText',m.value->>'original_text',m.value->>'sourceText',m.value->>'source_text','')),'') is not null
      or nullif(btrim(coalesce(m.value->>'summary',m.value->>'effect',m.value->>'customEffect',m.value->>'custom_effect','')),'') is not null
      or nullif(btrim(coalesce(m.value->>'name','')),'') is not null)
  ) valid
  left join lateral (select a.value from jsonb_array_elements(coalesce(document_row.document#>'{data,abilities}','[]'::jsonb)) a(value) where a.value->>'id'=role.value->>'passiveAbilityId' limit 1) passive on true
), suspicious as (
  select r.game_id,r.game_name,r.role,r.source_text,
    case when flag.review_type='POSSIBLY_INVENTED_PASSIVE' then r.passive_ability else null end as ability,
    flag.review_type
  from review_roles r cross join lateral (values
    ('SOURCE_STRUCTURE_MISSING',char_length(r.source_text)>300 and r.owned_count<=1 and jsonb_array_length(r.mechanics)=0 and r.source_text~* '\m(if|when|unless|only|except|all|entire|until|after|before)\M'),
    ('POSSIBLY_INVENTED_PASSIVE',nullif(r.role->>'passiveAbilityId','') is not null and char_length(r.source_text)>120 and r.source_text!~* '\m(passive|automatically|whenever|when targeted|cannot be|immune|first time|upon death|after death)\M'
      and not exists(select 1 from jsonb_array_elements(r.mechanics) m where upper(btrim(coalesce(m->>'type',m->>'mechanicType',m->>'mechanic_type','')))='PASSIVE')),
    ('FACTION_SCOPE_NOT_STRUCTURED',jsonb_array_length(r.mechanics)=0 and r.source_text~* '\m(all|entire)\M.*\m(faction|den)\M')
  ) flag(review_type,needed) where flag.needed
), combined as (
  select coalesce(nullif(explicit_id,''),'derived:'||jsonb_build_array(game_id,role->>'id',ability->>'id',mechanic_index)::text) as review_id,game_id,game_name,
    jsonb_build_object(
      'roleId',role->>'id','roleName',role->>'name','abilityId',coalesce(ability->>'id',mechanic->>'sourceAbilityId',mechanic->>'source_ability_id'),'abilityName',coalesce(ability->>'name',mechanic->>'sourceAbilityName',mechanic->>'source_ability_name'),
      'mechanicType',normalized_type,'confidence',normalized_confidence,'interpretationState',normalized_state,'originalText',original_text,'parsedUnderstanding',summary_text,
      'knownComponents',case when jsonb_typeof(mechanic->'effects')='array' then mechanic->'effects' else '[]'::jsonb end,'unknownComponents',coalesce(mechanic->'unresolvedComponents',mechanic->'unresolved_components','[]'::jsonb),'possibleInterpretations',coalesce(mechanic->'possibleInterpretations',mechanic->'possible_interpretations','[]'::jsonb),
      'source',coalesce(mechanic->>'sourceLocation',mechanic->>'source_location',owner->>'sourceLocation',''),'origin',coalesce(mechanic->>'origin','AI_INTERPRETATION_PENDING'),'current',mechanic,'proposed',null,
      'roleSourceText',role->>'sourceText','abilityDefinition',ability->>'definition','roleSourceLocation',role->>'sourceLocation','abilitySourceLocation',ability->>'sourceLocation',
      'projectionContext',jsonb_strip_nulls(jsonb_build_object('version',1,'roleId',role->>'id','roleName',role->>'name','abilityId',owned_ability->>'id','abilityName',owned_ability->>'name','sourceLocation',owner->>'sourceLocation','sourceDocumentId',role->>'sourceImportId','sourceVersion',role->>'sourceVersion','index',mechanic_index))
    ) as review from derived
  union all
  select game_id::text||':'||coalesce(role->>'id','role')||':'||lower(review_type),game_id,game_name,jsonb_build_object('code',review_type,'roleId',role->>'id','abilityId',ability->>'id','abilityName',ability->>'name','roleName',role->>'name','mechanicType',review_type,'confidence',0,'interpretationState','NEEDS_REVIEW','originalText',source_text,'parsedUnderstanding',case review_type when 'POSSIBLY_INVENTED_PASSIVE' then 'A stored passive is not supported by the preserved role source text. Preserve it until a GM reviews its origin.' when 'FACTION_SCOPE_NOT_STRUCTURED' then 'The source appears faction-wide but no structured faction/global mechanic exists.' else 'The source contains conditional or scoped language but no structured mechanical statements.' end,'knownComponents','[]'::jsonb,'unknownComponents',jsonb_build_array('Structured interpretation'),'possibleInterpretations','[]'::jsonb,'source',coalesce(role->>'sourceLocation',''),'origin','AI_INTERPRETATION_PENDING','current',coalesce(role->'understanding','{}'::jsonb),'proposed',null) from suspicious
), deduplicated as (
  select distinct on (game_id,coalesce(review->>'roleId',''),coalesce(review->>'abilityId',''),review_id) review_id,game_id,game_name,review from combined order by game_id,coalesce(review->>'roleId',''),coalesce(review->>'abilityId',''),review_id
)
select coalesce(jsonb_agg((review||jsonb_build_object('id',review_id,'gameId',game_id,'gameName',game_name)) order by game_name,coalesce(review->>'roleName',review->>'abilityName',''),review_id),'[]'::jsonb) from deduplicated
$function$
;
