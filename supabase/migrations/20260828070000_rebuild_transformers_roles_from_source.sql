-- Rebuild every source-defined Transformers mode role from the exact uploaded
-- document (SHA-256 below). Preserve role/player IDs and every legacy record;
-- only replace incorrect mode-placeholder role tags with real encyclopedia
-- ability relationships.

do $$
declare
  source_hash constant text := '81427a283aa7914b0b5bf3b0eb846b1544d12944fdf76263d2b39a838443aa04';
  role_map constant jsonb := $map$
  [
    {"name":"Alpha – Megatron","tags":["Personal Instant Kill","Convert","Bulletproof / Passive Immunity"],"primary":"Personal Instant Kill","passive":"Bulletproof / Passive Immunity","modes":[{"name":"Robot Mode","abilities":["Personal Instant Kill","Convert"]},{"name":"Alt Mode","abilities":["Bulletproof / Passive Immunity"]}]},
    {"name":"Dark Seer – Soundwave","tags":["Advanced Ask","Steal","Personal Instant Kill","Watch","Track"],"primary":"Advanced Ask","passive":"","modes":[{"name":"Robot Mode","abilities":["Advanced Ask","Steal","Personal Instant Kill"]},{"name":"Alt Mode","abilities":["Advanced Ask","Watch","Track"]}]},
    {"name":"Blocker – Starscream","tags":["Roleblock","Bulletproof / Passive Immunity"],"primary":"Roleblock","passive":"Bulletproof / Passive Immunity","modes":[{"name":"Robot Mode","abilities":["Roleblock"]},{"name":"Alt Mode","abilities":["Bulletproof / Passive Immunity"]}]},
    {"name":"Mark/Soul Bound – Bombshell","tags":["Mark","Death Immunity"],"primary":"Mark","passive":"Death Immunity","modes":[{"name":"Robot Mode","abilities":["Mark"]},{"name":"Alt Mode","abilities":["Death Immunity"]}]},
    {"name":"Omega – Fallen","tags":["Omega Kill"],"primary":"Omega Kill","passive":"","modes":[{"name":"Robot Mode","abilities":[]},{"name":"Alt Mode","abilities":["Omega Kill"]}]},
    {"name":"Gravedigger/Insta – Shockwave","tags":["Gravedigger","Steal","Personal Instant Kill"],"primary":"Gravedigger","passive":"","modes":[{"name":"Robot Mode","abilities":["Gravedigger","Steal"]},{"name":"Alt Mode","abilities":["Personal Instant Kill"]}]},
    {"name":"Doc – Ratchet","tags":["Save","Heal","Protect"],"primary":"Save","passive":"","modes":[{"name":"Robot Mode","abilities":["Save","Heal"]},{"name":"Alt Mode","abilities":["Protect"]}]},
    {"name":"Seer – Nightbeat","tags":["Basic Ask","Advanced Ask","Track","Bulletproof / Passive Immunity"],"primary":"Basic Ask","passive":"Bulletproof / Passive Immunity","modes":[{"name":"Robot Mode","abilities":["Basic Ask","Advanced Ask"]},{"name":"Alt Mode","abilities":["Track","Bulletproof / Passive Immunity"]}]},
    {"name":"Omega Supreme – 2 nd in command","aliases":["Omega Supreme – 2nd in command"],"tags":["Super Kill"],"primary":"Super Kill","passive":"","modes":[{"name":"Robot Mode","abilities":[]},{"name":"Alt Mode","abilities":["Super Kill"]}]},
    {"name":"Milf – Elita","tags":["Watch","Action Success Guarantee","Roleblock","Action Check"],"primary":"Watch","passive":"","modes":[{"name":"Robot Mode","abilities":["Watch","Action Check"]},{"name":"Alt Mode","abilities":["Action Success Guarantee","Roleblock","Action Check"]}]},
    {"name":"Den Blocker – Ironhide","tags":["Guard","Reflection","Bulletproof / Passive Immunity","Den Block"],"primary":"Guard","passive":"Bulletproof / Passive Immunity","modes":[{"name":"Robot Mode","abilities":["Guard","Reflection","Bulletproof / Passive Immunity"]},{"name":"Alt Mode","abilities":["Den Block"]}]},
    {"name":"Protector – Trailbreaker","tags":["Protect"],"primary":"Protect","passive":"","modes":[{"name":"Robot Mode","abilities":["Protect"]},{"name":"Alt Mode","abilities":["Protect"]}]},
    {"name":"Sting – Cosmos","tags":["Basic Ask","Advanced Ask","Watch"],"primary":"Basic Ask","passive":"","modes":[{"name":"Robot Mode","abilities":["Basic Ask","Watch"]},{"name":"Alt Mode","abilities":["Advanced Ask"]}]},
    {"name":"Martyr – Skids","tags":["Guard","Watch","Advanced Ask","Action Success Guarantee"],"primary":"Guard","passive":"","modes":[{"name":"Robot Mode","abilities":["Guard","Advanced Ask"]},{"name":"Alt Mode","abilities":["Watch","Action Success Guarantee"]}]},
    {"name":"Lawyer – Bluestreak","tags":["Save","Bulletproof / Passive Immunity"],"primary":"Save","passive":"Bulletproof / Passive Immunity","modes":[{"name":"Robot Mode","abilities":["Save","Bulletproof / Passive Immunity"]},{"name":"Alt Mode","abilities":["Bulletproof / Passive Immunity"]}]},
    {"name":"Drunk – Kup","tags":["Drunk","Sober","Place Swap"],"primary":"Drunk","passive":"","modes":[{"name":"Robot Mode","abilities":["Drunk","Sober"]},{"name":"Alt Mode","abilities":["Drunk","Place Swap"]}]},
    {"name":"Map – Teletron","tags":["Basic Ask","Map"],"primary":"Basic Ask","passive":"","modes":[{"name":"Robot Mode","abilities":["Basic Ask"]},{"name":"Alt Mode","abilities":["Map"]}]},
    {"name":"Gravedigger – Rung","tags":["Gravedigger","Advanced Ask","Bulletproof / Passive Immunity"],"primary":"Gravedigger","passive":"Bulletproof / Passive Immunity","modes":[{"name":"Robot Mode","abilities":["Bulletproof / Passive Immunity"]},{"name":"Alt Mode","abilities":["Gravedigger","Advanced Ask"]}]},
    {"name":"Instakill – Grimlock","tags":["Reflection","Super Kill","Personal Instant Kill"],"primary":"Super Kill","passive":"Reflection","modes":[{"name":"Robot Mode","abilities":["Reflection"]},{"name":"Alt Mode","abilities":["Super Kill","Personal Instant Kill"]}]},
    {"name":"Sherriff – Prowl","tags":["Counterattack","Personal Instant Kill"],"primary":"Personal Instant Kill","passive":"Counterattack","modes":[{"name":"Robot Mode","abilities":["Counterattack"]},{"name":"Alt Mode","abilities":["Personal Instant Kill"]}]},
    {"name":"Tracker – Bumblee Bee","tags":["Track","Bulletproof / Passive Immunity"],"primary":"Track","passive":"Bulletproof / Passive Immunity","modes":[{"name":"Robot Mode","abilities":["Track"]},{"name":"Alt Mode","abilities":["Bulletproof / Passive Immunity"]}]},
    {"name":"Poison/Protect – Red alert","tags":["Protect","Poison","Personal Instant Kill","Super Kill","Super Protect"],"primary":"Protect","passive":"","modes":[{"name":"Robot Mode","abilities":["Protect","Poison","Personal Instant Kill"]},{"name":"Alt Mode","abilities":["Super Kill","Super Protect"]}]},
    {"name":"Gambler – Wheeljack","tags":["Personal Instant Kill","Roleblock","Action Success Guarantee"],"primary":"Personal Instant Kill","passive":"","modes":[{"name":"Robot Mode","abilities":["Personal Instant Kill","Roleblock"]},{"name":"Alt Mode","abilities":["Action Success Guarantee"]}]},
    {"name":"Ultimate – Optimus","tags":["Basic Ask","Protect","Roleblock","Save","Death Immunity","Personal Instant Kill","Super Kill"],"primary":"Basic Ask","passive":"Death Immunity","modes":[{"name":"Robot Mode","abilities":["Basic Ask","Protect","Roleblock","Save","Death Immunity"]},{"name":"Alt Mode","abilities":["Personal Instant Kill","Super Kill"]}]},
    {"name":"Evesdropper – Jazz","tags":["Action Check","Advanced Ask"],"primary":"Action Check","passive":"","modes":[{"name":"Robot Mode","abilities":["Action Check"]},{"name":"Alt Mode","abilities":["Advanced Ask"]}]},
    {"name":"Power boost – Jetfire","tags":["Action Success Guarantee","Ability Amplify"],"primary":"Action Success Guarantee","passive":"","modes":[{"name":"Robot Mode","abilities":["Action Success Guarantee"]},{"name":"Alt Mode","abilities":["Ability Amplify"]}]},
    {"name":"Jammers/Traps – Smoke Screen","tags":["Protect","Watch"],"primary":"Protect","passive":"","modes":[{"name":"Robot Mode","abilities":["Protect"]},{"name":"Alt Mode","abilities":["Protect","Watch"]}]}
  ]
  $map$::jsonb;
  target_count integer;
  stored public.game_documents%rowtype;
  doc jsonb;
  roles jsonb;
  abilities jsonb;
  players jsonb;
  next_roles jsonb := '[]'::jsonb;
  next_players jsonb := '[]'::jsonb;
  role_item jsonb;
  player_item jsonb;
  mapping jsonb;
  mode_mapping jsonb;
  next_role jsonb;
  next_player jsonb;
  role_record jsonb;
  modes jsonb;
  active_ids jsonb;
  passive_ids jsonb;
  legacy_ids jsonb;
  labels jsonb;
  primary_id text;
  passive_id text;
  role_id text;
  role_name text;
  mode_name text;
  source_text text;
  source_location text;
  missing_abilities text;
  matched_roles integer;
  rebuilt_roles integer;
begin
  select count(*) into target_count
  from public.game_documents gd
  where exists (
    select 1 from jsonb_array_elements(coalesce(gd.document#>'{data,imports}','[]'::jsonb)) import_item
    where lower(coalesce(import_item->>'sha256',''))=source_hash
  );
  if target_count<>1 then raise exception 'Expected exactly one game document for Transformers source %, found %',source_hash,target_count; end if;

  select gd.* into stored
  from public.game_documents gd
  where exists (
    select 1 from jsonb_array_elements(coalesce(gd.document#>'{data,imports}','[]'::jsonb)) import_item
    where lower(coalesce(import_item->>'sha256',''))=source_hash
  )
  for update;

  if exists (
    select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,imports}','[]'::jsonb)) import_item
    where import_item->>'kind'='source-role-mode-rebuild-v11.7.1'
  ) then return; end if;

  doc:=stored.document;
  roles:=coalesce(doc#>'{data,roles}','[]'::jsonb);
  abilities:=coalesce(doc#>'{data,abilities}','[]'::jsonb);
  players:=coalesce(doc#>'{data,players}','[]'::jsonb);

  select count(*) into matched_roles
  from jsonb_array_elements(roles) role_source
  where exists (
    select 1 from jsonb_array_elements(role_map) map_source
    where lower(map_source->>'name')=lower(role_source->>'name')
       or exists (select 1 from jsonb_array_elements_text(coalesce(map_source->'aliases','[]'::jsonb)) alias_source where lower(alias_source.value)=lower(role_source->>'name'))
  );
  if matched_roles<>27 then raise exception 'Transformers source-role match failed: expected 27 mode roles, found %',matched_roles; end if;

  select string_agg(distinct requested.name,', ' order by requested.name) into missing_abilities
  from jsonb_array_elements(role_map) map_source
  cross join lateral jsonb_array_elements(map_source->'modes') mode_source
  cross join lateral jsonb_array_elements_text(mode_source->'abilities') requested(name)
  where (select count(*) from jsonb_array_elements(abilities) ability_source where lower(ability_source->>'name')=lower(requested.name))<>1;
  if missing_abilities is not null then raise exception 'Missing or duplicate encyclopedia abilities: %',missing_abilities; end if;

  for role_item in select value from jsonb_array_elements(roles) loop
    mapping:=null;
    role_name:=coalesce(role_item->>'name','');
    role_id:=coalesce(role_item->>'id','');
    select map_source.value into mapping
    from jsonb_array_elements(role_map) map_source(value)
    where lower(map_source.value->>'name')=lower(role_name)
       or exists (select 1 from jsonb_array_elements_text(coalesce(map_source.value->'aliases','[]'::jsonb)) alias_source where lower(alias_source.value)=lower(role_name))
    limit 1;
    if mapping is null then
      next_roles:=next_roles||jsonb_build_array(role_item);
      continue;
    end if;

    select ability_source->>'id' into primary_id from jsonb_array_elements(abilities) ability_source where lower(ability_source->>'name')=lower(mapping->>'primary') limit 1;
    select ability_source->>'id' into passive_id from jsonb_array_elements(abilities) ability_source where lower(ability_source->>'name')=lower(mapping->>'passive') limit 1;
    select coalesce(jsonb_agg(ability_source->>'id' order by ability_source->>'id'),'[]'::jsonb) into legacy_ids
    from jsonb_array_elements(abilities) ability_source
    where ability_source->>'name' in (select tag_source.value from jsonb_array_elements_text(coalesce(role_item->'tags','[]'::jsonb)) tag_source(value))
      and (coalesce((ability_source->>'modeContextOnly')::boolean,false) or upper(coalesce(ability_source->>'recordType',''))='MODE_CONTEXT');

    modes:='[]'::jsonb;
    for mode_mapping in select value from jsonb_array_elements(mapping->'modes') loop
      mode_name:=mode_mapping->>'name';
      select coalesce(jsonb_agg(ability_source.value->>'id' order by requested.ordinality),'[]'::jsonb) into active_ids
      from jsonb_array_elements_text(mode_mapping->'abilities') with ordinality requested(name,ordinality)
      join lateral (select value from jsonb_array_elements(abilities) where lower(value->>'name')=lower(requested.name) limit 1) ability_source on true
      where lower(coalesce(ability_source.value->>'phase',''))<>'passive';
      select coalesce(jsonb_agg(ability_source.value->>'id' order by requested.ordinality),'[]'::jsonb) into passive_ids
      from jsonb_array_elements_text(mode_mapping->'abilities') with ordinality requested(name,ordinality)
      join lateral (select value from jsonb_array_elements(abilities) where lower(value->>'name')=lower(requested.name) limit 1) ability_source on true
      where lower(coalesce(ability_source.value->>'phase',''))='passive';
      select coalesce(ability_source->>'sourceText',ability_source->>'definition',role_item->>'description'),coalesce(ability_source->>'sourceLocation','Transformers — '||role_name||' — '||mode_name)
      into source_text,source_location
      from jsonb_array_elements(abilities) ability_source
      where ability_source->>'name' in (select tag_source.value from jsonb_array_elements_text(coalesce(role_item->'tags','[]'::jsonb)) tag_source(value))
        and lower(ability_source->>'name') like lower(role_name)||'%'
        and lower(ability_source->>'name') like '%'||lower(replace(mode_name,' Mode',''))||'%mode%'
      limit 1;
      source_text:=coalesce(source_text,role_item->>'description','');
      source_location:=coalesce(source_location,'Transformers — '||role_name||' — '||mode_name);
      modes:=modes||jsonb_build_array(jsonb_build_object(
        'id',role_id||':mode:'||lower(replace(mode_name,' ','-')),
        'name',mode_name,
        'abilityIds',active_ids,
        'passiveAbilityIds',passive_ids,
        'sourceText',source_text,
        'sourceLocation',source_location
      ));
    end loop;

    labels:=private.jsonb_text_union_excluding(role_item->'labels',array['source:transformers.docx','source-role-mode-rebuild-v11.7.1'],null);
    next_role:=role_item||jsonb_build_object(
      'tags',mapping->'tags',
      'activeAbilityId',coalesce(primary_id,''),
      'passiveAbilityId',coalesce(passive_id,''),
      'modes',modes,
      'roleWideAbilityIds','[]'::jsonb,
      'modeSelectionPolicy','CHOOSE_BEFORE_ACTION',
      'legacyModeAbilityIds',legacy_ids,
      'labels',labels,
      'sourceDocumentSha256',source_hash,
      'sourceRoleRebuiltAt',now()
    );
    next_roles:=next_roles||jsonb_build_array(next_role);
  end loop;

  select count(*) into rebuilt_roles from jsonb_array_elements(next_roles) role_source where jsonb_array_length(coalesce(role_source->'modes','[]'::jsonb))=2;
  if rebuilt_roles<>27 then raise exception 'Expected 27 rebuilt mode roles, found %',rebuilt_roles; end if;
  if exists (
    select 1
    from jsonb_array_elements(next_roles) role_source
    cross join lateral jsonb_array_elements(coalesce(role_source->'modes','[]'::jsonb)) mode_source
    cross join lateral jsonb_array_elements_text(coalesce(mode_source->'abilityIds','[]'::jsonb)||coalesce(mode_source->'passiveAbilityIds','[]'::jsonb)) assigned(ability_id)
    left join lateral (select value from jsonb_array_elements(abilities) where value->>'id'=assigned.ability_id limit 1) ability_source on true
    where ability_source.value is null or coalesce((ability_source.value->>'modeContextOnly')::boolean,false) or coalesce((ability_source.value->>'selectableAsAction')::boolean,true)=false
  ) then raise exception 'A rebuilt mode references a missing or non-action ability'; end if;

  for player_item in select value from jsonb_array_elements(players) loop
    next_player:=player_item;
    select value into role_record from jsonb_array_elements(next_roles) where value->>'id'=player_item->>'roleId' limit 1;
    if jsonb_array_length(coalesce(role_record->'modes','[]'::jsonb))>0 then
      if not exists (select 1 from jsonb_array_elements(role_record->'modes') mode_source where mode_source->>'id'=coalesce(player_item->>'currentModeId','')) then
        next_player:=player_item||jsonb_build_object('currentModeId',role_record#>>'{modes,0,id}');
      end if;
    else
      next_player:=player_item-'currentModeId';
    end if;
    next_players:=next_players||jsonb_build_array(next_player);
  end loop;

  doc:=jsonb_set(jsonb_set(doc,'{data,roles}',next_roles,false),'{data,players}',next_players,false);
  doc:=jsonb_set(doc,'{data,history}',coalesce(doc#>'{data,history}','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid()::text,'gameId',stored.game_id::text,'type','DOCUMENT_ROLE_REBUILD','entityId','transformers-source-'||source_hash,
    'message','Rebuilt all 27 source-defined Robot/Alt role mode relationships from the uploaded Transformers document. Preserved 39 roles, 50 players, 101 ability records, and all legacy mode records.',
    'timestamp',now()
  )),true);
  doc:=jsonb_set(doc,'{data,imports}',coalesce(doc#>'{data,imports}','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid()::text,'kind','source-role-mode-rebuild-v11.7.1','sha256',source_hash,'fileName','transformers.docx','importedAt',now(),
    'summary',jsonb_build_object('sourceRoles',37,'modeRoles',27,'basicRolesPreserved',2,'playersPreserved',jsonb_array_length(players),'abilitiesPreserved',jsonb_array_length(abilities))
  )),true);

  update public.game_documents set document=doc,version=version+1,updated_at=now() where game_id=stored.game_id;
end$$;
