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
), derived as (
  select document_row.game_id,document_row.game_name,role.value as role,ability.value as ability,mechanic.value as mechanic
  from authorized_documents document_row
  cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,roles}','[]'::jsonb)) role(value)
  cross join lateral jsonb_array_elements(coalesce(role.value#>'{understanding,mechanics}',role.value->'mechanicalStatements','[]'::jsonb)) mechanic(value)
  left join lateral (select candidate.value from jsonb_array_elements(coalesce(document_row.document#>'{data,abilities}','[]'::jsonb)) candidate(value) where candidate.value->>'id'=mechanic.value->>'sourceAbilityId' limit 1) ability on true
  where coalesce(nullif(mechanic.value->>'requiresReview','')::boolean,false) or upper(coalesce(mechanic.value->>'interpretationState',mechanic.value->>'interpretation_state','NEEDS_REVIEW')) in ('PARTIALLY_UNDERSTOOD','NEEDS_REVIEW','UNRESOLVED') or jsonb_array_length(coalesce(mechanic.value->'unresolvedComponents',mechanic.value->'unresolved_components','[]'::jsonb))>0 or coalesce(nullif(mechanic.value->>'confidence','')::numeric,0)<.75
  union all
  select document_row.game_id,document_row.game_name,null::jsonb,ability.value,mechanic.value
  from authorized_documents document_row
  cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,abilities}','[]'::jsonb)) ability(value)
  cross join lateral jsonb_array_elements(coalesce(ability.value#>'{understanding,mechanics}',ability.value->'mechanicalStatements','[]'::jsonb)) mechanic(value)
  where coalesce(nullif(mechanic.value->>'requiresReview','')::boolean,false) or upper(coalesce(mechanic.value->>'interpretationState',mechanic.value->>'interpretation_state','NEEDS_REVIEW')) in ('PARTIALLY_UNDERSTOOD','NEEDS_REVIEW','UNRESOLVED') or jsonb_array_length(coalesce(mechanic.value->'unresolvedComponents',mechanic.value->'unresolved_components','[]'::jsonb))>0 or coalesce(nullif(mechanic.value->>'confidence','')::numeric,0)<.75
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
  select coalesce(mechanic->>'id',game_id::text||':derived:'||row_number() over()) as review_id,game_id,game_name,jsonb_build_object('id',mechanic->>'id','roleId',role->>'id','roleName',role->>'name','abilityId',coalesce(ability->>'id',mechanic->>'sourceAbilityId'),'abilityName',coalesce(ability->>'name',mechanic->>'sourceAbilityName'),'mechanicType',coalesce(mechanic->>'type','CUSTOM_MECHANIC'),'confidence',coalesce(nullif(mechanic->>'confidence','')::numeric,0),'interpretationState',coalesce(mechanic->>'interpretationState',mechanic->>'interpretation_state','NEEDS_REVIEW'),'originalText',coalesce(mechanic->>'originalText',mechanic->>'original_text',role->>'sourceText',ability->>'sourceText',''),'parsedUnderstanding',coalesce(mechanic->>'summary',mechanic->>'effect',''),'knownComponents',coalesce(mechanic->'effects','[]'::jsonb),'unknownComponents',coalesce(mechanic->'unresolvedComponents',mechanic->'unresolved_components','[]'::jsonb),'possibleInterpretations',coalesce(mechanic->'possibleInterpretations',mechanic->'possible_interpretations','[]'::jsonb),'source',coalesce(mechanic->>'sourceLocation',mechanic->>'source_location',role->>'sourceLocation',ability->>'sourceLocation',''),'origin',coalesce(mechanic->>'origin','AI_INTERPRETATION_PENDING'),'current',mechanic,'proposed',null) as review from derived
  union all
  select game_id::text||':'||coalesce(role->>'id','role')||':'||lower(review_type),game_id,game_name,jsonb_build_object('code',review_type,'roleId',role->>'id','abilityId',ability->>'id','abilityName',ability->>'name','roleName',role->>'name','mechanicType',review_type,'confidence',0,'interpretationState','NEEDS_REVIEW','originalText',source_text,'parsedUnderstanding',case review_type when 'POSSIBLY_INVENTED_PASSIVE' then 'A stored passive is not supported by the preserved role source text. Preserve it until a GM reviews its origin.' when 'FACTION_SCOPE_NOT_STRUCTURED' then 'The source appears faction-wide but no structured faction/global mechanic exists.' else 'The source contains conditional or scoped language but no structured mechanical statements.' end,'knownComponents','[]'::jsonb,'unknownComponents',jsonb_build_array('Structured interpretation'),'possibleInterpretations','[]'::jsonb,'source',coalesce(role->>'sourceLocation',''),'origin','AI_INTERPRETATION_PENDING','current',coalesce(role->'understanding','{}'::jsonb),'proposed',null) from suspicious
), deduplicated as (
  select distinct on (game_id,coalesce(review->>'roleId',''),coalesce(review->>'abilityId',''),review_id) review_id,game_id,game_name,review from combined order by game_id,coalesce(review->>'roleId',''),coalesce(review->>'abilityId',''),review_id
)
select coalesce(jsonb_agg((review||jsonb_build_object('id',review_id,'gameId',game_id,'gameName',game_name)) order by game_name,coalesce(review->>'roleName',review->>'abilityName',''),review_id),'[]'::jsonb) from deduplicated
$function$
;
