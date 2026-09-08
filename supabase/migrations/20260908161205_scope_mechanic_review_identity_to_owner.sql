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
), suspicious as (
  select document_row.game_id,document_row.game_name,role.value as role,
    case
      when nullif(role.value->>'passiveAbilityId','') is not null and coalesce(role.value->>'sourceText','')!~* '\m(passive|automatically|whenever|when targeted|cannot be|immune|first time|upon death|after death)\M' then 'POSSIBLY_INVENTED_PASSIVE'
      when coalesce(role.value->>'sourceText','')~* '\m(all|entire)\M.*\m(faction|den)\M' then 'FACTION_SCOPE_NOT_STRUCTURED'
      else 'SOURCE_STRUCTURE_MISSING' end as review_type
  from authorized_documents document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,roles}','[]'::jsonb)) role(value)
  where jsonb_array_length(coalesce(role.value#>'{understanding,mechanics}',role.value->'mechanicalStatements','[]'::jsonb))=0 and (
    (char_length(coalesce(role.value->>'sourceText',''))>300 and coalesce(role.value->>'sourceText','')~* '\m(if|when|unless|only|except|all|entire|until|after|before)\M')
    or nullif(role.value->>'passiveAbilityId','') is not null
    or coalesce(role.value->>'sourceText','')~* '\m(all|entire)\M.*\m(faction|den)\M'
  )
), combined as (
  select coalesce(mechanic->>'id',game_id::text||':derived:'||row_number() over()) as review_id,game_id,game_name,jsonb_build_object('id',mechanic->>'id','roleId',role->>'id','roleName',role->>'name','abilityId',coalesce(ability->>'id',mechanic->>'sourceAbilityId'),'abilityName',coalesce(ability->>'name',mechanic->>'sourceAbilityName'),'mechanicType',coalesce(mechanic->>'type','CUSTOM_MECHANIC'),'confidence',coalesce(nullif(mechanic->>'confidence','')::numeric,0),'interpretationState',coalesce(mechanic->>'interpretationState',mechanic->>'interpretation_state','NEEDS_REVIEW'),'originalText',coalesce(mechanic->>'originalText',mechanic->>'original_text',role->>'sourceText',ability->>'sourceText',''),'parsedUnderstanding',coalesce(mechanic->>'summary',mechanic->>'effect',''),'knownComponents',coalesce(mechanic->'effects','[]'::jsonb),'unknownComponents',coalesce(mechanic->'unresolvedComponents',mechanic->'unresolved_components','[]'::jsonb),'possibleInterpretations',coalesce(mechanic->'possibleInterpretations',mechanic->'possible_interpretations','[]'::jsonb),'source',coalesce(mechanic->>'sourceLocation',mechanic->>'source_location',role->>'sourceLocation',ability->>'sourceLocation',''),'origin',coalesce(mechanic->>'origin','AI_INTERPRETATION_PENDING'),'current',mechanic,'proposed',null) as review from derived
  union all
  select game_id::text||':'||coalesce(role->>'id','role')||':'||lower(review_type),game_id,game_name,jsonb_build_object('roleId',role->>'id','roleName',role->>'name','mechanicType',review_type,'confidence',0,'interpretationState','NEEDS_REVIEW','originalText',coalesce(role->>'sourceText',''),'parsedUnderstanding',case review_type when 'POSSIBLY_INVENTED_PASSIVE' then 'A stored passive is not supported by the preserved source text. Preserve it until a GM reviews its origin.' when 'FACTION_SCOPE_NOT_STRUCTURED' then 'The source appears faction-wide but no structured faction/global mechanic exists.' else 'Conditional or scoped source text has no structured mechanical statements.' end,'knownComponents','[]'::jsonb,'unknownComponents',jsonb_build_array('Structured interpretation'),'possibleInterpretations','[]'::jsonb,'source',coalesce(role->>'sourceLocation',''),'origin','AI_INTERPRETATION_PENDING','current',coalesce(role->'understanding','{}'::jsonb),'proposed',null) from suspicious
), deduplicated as (
  select distinct on (game_id,coalesce(review->>'roleId',''),coalesce(review->>'abilityId',''),review_id) review_id,game_id,game_name,review from combined order by game_id,coalesce(review->>'roleId',''),coalesce(review->>'abilityId',''),review_id
)
select coalesce(jsonb_agg((review||jsonb_build_object('id',review_id,'gameId',game_id,'gameName',game_name)) order by game_name,coalesce(review->>'roleName',review->>'abilityName',''),review_id),'[]'::jsonb) from deduplicated
$function$
;
