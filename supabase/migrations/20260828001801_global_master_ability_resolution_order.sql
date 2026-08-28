-- GM Command Center v11.6: one global Master Ability Encyclopedia and a
-- deterministic, category-first resolution profile shared by every game.

create table public.global_resolution_profiles (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{2,119}$'),
  version_number integer not null check (version_number > 0),
  status text not null check (status in ('ACTIVE','SUPERSEDED')),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  resolution_order text[] not null,
  passive_policy text not null check (passive_policy='EVENT_TRIGGERED'),
  heal_timing text not null check (heal_timing='ANY_TIME'),
  authority_precedence text[] not null,
  structured_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(structured_data)='object' and octet_length(structured_data::text)<=100000),
  created_at timestamptz not null default now(),
  check (resolution_order=array['BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC']::text[]),
  check (authority_precedence=array['CURRENT_GAME_RULE','ROLE_TEXT','CURRENT_GAME_PRECEDENT','GLOBAL_MASTER_ABILITY_ENCYCLOPEDIA','GLOBAL_PRECEDENT','GM_DECISION']::text[])
);
create unique index global_resolution_profiles_active_idx on public.global_resolution_profiles(status) where status='ACTIVE';
alter table public.global_resolution_profiles enable row level security;
create policy global_resolution_profiles_read on public.global_resolution_profiles for select to authenticated using (true);
revoke all on table public.global_resolution_profiles from public,anon;
grant select on table public.global_resolution_profiles to authenticated;

insert into public.global_resolution_profiles(id,version_number,status,name,resolution_order,passive_policy,heal_timing,authority_precedence,structured_data)
values('global-master-ability-resolution-v1',1,'ACTIVE','Global Master Ability Resolution',
  array['BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC'],
  'EVENT_TRIGGERED','ANY_TIME',
  array['CURRENT_GAME_RULE','ROLE_TEXT','CURRENT_GAME_PRECEDENT','GLOBAL_MASTER_ABILITY_ENCYCLOPEDIA','GLOBAL_PRECEDENT','GM_DECISION'],
  jsonb_build_object('passiveNote','PASSIVES — EVENT/TRIGGER BASED','healNote','HEAL — DOC ABILITY / ANY-TIME RESOLUTION','submissionOrderForbidden',true,'generatedEffectsWaitForNaturalStage',true,'preserveTransformationHistory',true)
);

create temporary table global_master_ability_seed (
  ability_id text primary key,
  display_name text not null,
  category text not null,
  sort_order integer not null,
  description text not null,
  phase text not null,
  mechanics text[] not null,
  aliases text[] not null default '{}',
  resolution_category text not null,
  resolution_priority integer,
  resolution_timing text not null,
  active_passive text not null,
  targeting jsonb not null default '{}'::jsonb
) on commit drop;

insert into global_master_ability_seed values
('roleblock','Roleblock','Harmful',1,'Targets one player and prevents applicable active abilities during the current cycle. Passives remain active unless an explicit role or game rule says otherwise.','Night',array['block','player','active ability'],array['Role Block','Stop a player from acting'],'BLOCKS',1,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('den_block','Den Block','Harmful',2,'Targets the entire Den faction and prevents applicable active abilities by Den members during the current cycle, including applicable faction-level Den actions. Passives remain active unless explicitly disabled.','Night',array['block','faction','den'],array['Block the Den'],'BLOCKS',1,'ORDERED_STAGE','ACTIVE','{"type":"FACTION","selectionRuleType":"HARD_SELECTION_RESTRICTION"}'),
('villagers_block','Villagers Block','Harmful',3,'Targets the entire Villager faction and prevents applicable active abilities by Villager-aligned players during the current cycle. Passives remain active unless explicitly disabled.','Night',array['block','faction','villager'],array['Village Block','Villager Block'],'BLOCKS',1,'ORDERED_STAGE','ACTIVE','{"type":"FACTION","selectionRuleType":"HARD_SELECTION_RESTRICTION"}'),
('action_success_guarantee','Action Success Guarantee','Support',4,'Allows a selected action to execute despite an applicable block or other action-prevention effect. It does not guarantee that the effect defeats the target''s defenses.','Night',array['guarantee','action prevention','execute'],array['Success Guarantee'],'GUARANTEE',2,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('place_swap','Place Swap','Support',5,'Swaps two players for applicable action-targeting purposes. Actions aimed at either player land on the other; users, roles, factions, abilities, and ownership do not change.','Night',array['swap','target','position'],array['Position Swap','Swap Places'],'SWAPS',4,'ORDERED_STAGE','ACTIVE','{"type":"MULTIPLE_PLAYERS","selectionRuleType":"HARD_SELECTION_RESTRICTION","minTargets":2,"maxTargets":2}'),
('role_swap','Role Swap','Support',6,'Causes two players to act as each other''s roles for the applicable resolution period. It is not a permanent role replacement, faction conversion, or permanent ability transfer. Undefined unusual interactions require GM review.','Night',array['swap','role','temporary'],array['Swap Roles'],'SWAPS',4,'ORDERED_STAGE','ACTIVE','{"type":"MULTIPLE_PLAYERS","selectionRuleType":"HARD_SELECTION_RESTRICTION","minTargets":2,"maxTargets":2}'),
('redirect','Redirect','Support',7,'Changes the destination of an applicable targeted action without resolving the underlying ability. The transformed action waits for its natural category.','Night',array['redirect','target','transformation'],'{}','REDIRECTS',5,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('guard','Guard','Protection',8,'Takes an applicable incoming action or hit instead of the guarded player. Guard transfers the action; it does not cancel it.','Night',array['guard','redirect','interception'],array['Bodyguard','Take the Hit'],'REDIRECTS',5,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('drunk','Drunk','Harmful',9,'Applies after the entire Night resolves and lasts until the Hanging. Communication is limited to emojis, GIFs, stickers, and reactions. It does not disable active abilities by default.','Night',array['status','communication','delayed activation'],'{}','STATUS_EFFECTS',6,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY","activates":"AFTER_NIGHT_RESOLUTION","expires":"AFTER_HANGING"}'),
('sober','Sober','Harmful',10,'Applies after the entire Night resolves and lasts until the Hanging. Communication is limited to normal text only.','Night',array['status','communication','delayed activation'],'{}','STATUS_EFFECTS',6,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY","activates":"AFTER_NIGHT_RESOLUTION","expires":"AFTER_HANGING"}'),
('steal','Steal','Harmful',11,'Steals one available ability use. The original player loses that use and the thief gains it. Recurring or unlimited abilities transfer one usable instance by default, not permanent ownership.','Night',array['status','ability','theft','uses'],array['Steal Ability'],'STATUS_EFFECTS',6,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('poison','Poison','Harmful',12,'Applies Poison. By global default it causes delayed death after two days unless Healed and may spread through applicable visits. The application is a status effect, not a Kill submission.','Night',array['poison','status','delayed death','contagious'],'{}','STATUS_EFFECTS',6,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY","delayedDeathAfterDays":2,"healCancelsConsequence":true}'),
('mark','Mark','Harmful',13,'Applies a Mark. It does not kill immediately; when its specified condition is met it may generate a later effect such as Personal Instant Kill, which waits for KILLS.','Night',array['mark','status','generated effect'],'{}','STATUS_EFFECTS',6,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('ability_amplify','Ability Amplify','Support',14,'Increases an ability''s strength or effectiveness, such as Personal Instant Kill to Super Kill. Amplify changes strength, not use quantity.','Night',array['status','strength','amplify'],'{}','STATUS_EFFECTS',6,'ORDERED_STAGE','ACTIVE','{"type":"ABILITY","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('additional_uses','Additional Uses','Support',15,'Adds one or more uses of an ability. Additional Uses changes quantity, not strength, and added uses are tracked separately.','Any',array['status','uses','quantity'],array['Extra Uses'],'STATUS_EFFECTS',6,'ORDERED_STAGE','ACTIVE','{"type":"ABILITY","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('protect','Protect','Protection',16,'Applies normal protection against applicable normal harmful actions such as Personal Instant Kill. It does not stop Super Kill or Omega Kill unless explicitly modified.','Night',array['protection','normal kill'],'{}','STATUS_EFFECTS',6,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('super_protect','Super Protect','Protection',17,'Applies enhanced protection against applicable normal kills, Super Kills, and Omega Kills unless an effect explicitly bypasses Super Protect.','Night',array['protection','super kill','omega kill'],array['Super Protection'],'STATUS_EFFECTS',6,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('basic_ask','Basic Ask','Investigation',18,'Learns the target''s broad alignment category: Villager, Den, or Neutral, subject to explicit disguises, false results, immunities, or game rules.','Night',array['investigation','broad alignment'],'{}','INTEL',7,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('advanced_ask','Advanced Ask','Investigation',19,'Learns the target''s exact role, subject to applicable false-result mechanics, disguises, immunities, or game rules.','Night',array['investigation','exact role'],array['Role Check'],'INTEL',7,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('alignment_ask','Alignment Ask','Investigation',20,'Learns the target''s actual alignment or faction where appropriate. It can be more specific than Basic Ask.','Night',array['investigation','faction','alignment'],'{}','INTEL',7,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('watch','Watch','Investigation',21,'Learns who visited the target during the applicable cycle. Watch means who came to the target.','Night',array['investigation','visitors','incoming'],'{}','INTEL',7,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('track','Track','Investigation',22,'Learns whom the target visited during the applicable cycle. Track means where the target went and is not a synonym for Watch.','Night',array['investigation','visits','outgoing'],'{}','INTEL',7,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('action_check','Action Check','Investigation',23,'Learns which abilities or actions were used on the target during the cycle. By default reveal the actions, not their users.','Night',array['investigation','actions received'],array['Visitor Check'],'INTEL',7,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('gravedigger','Gravedigger','Investigation',24,'Targets a dead player and learns that player''s role.','Night',array['investigation','dead player','role'],array['Grave Digger'],'INTEL',7,'ORDERED_STAGE','ACTIVE','{"type":"DEAD_PLAYER","selectionRuleType":"HARD_SELECTION_RESTRICTION","deadOnly":true}'),
('map','Map','Investigation',25,'Reveals ability information or names still available among living players without revealing which player owns each ability unless explicitly stated.','Night',array['investigation','global','ability inventory'],'{}','INTEL',7,'ORDERED_STAGE','ACTIVE','{"type":"GLOBAL","selectionRuleType":"HARD_SELECTION_RESTRICTION"}'),
('convert','Convert','Harmful',26,'Moves a target to the converting faction before Kills. By default the target leaves the old faction and loses the old role and its abilities. Do not invent a replacement role or new abilities.','Night',array['conversion','faction','role loss'],array['Conversion','Recruit'],'CONVERTS',8,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY","defaultRetainOldRole":false,"defaultRetainOldAbilities":false}'),
('den_regular_kill','Den Regular Kill','Harmful',27,'The standard collective Den faction action at Personal Instant Kill strength. Use game performer rules when defined; Den Block may prevent it unless Guarantee or an explicit exception applies.','Night',array['kill','faction','den'],array['Den Kill','Regular Kill'],'KILLS',9,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY","factionAction":true,"performerRequired":true,"killTier":"NORMAL"}'),
('personal_instant_kill','Personal Instant Kill','Harmful',28,'A standard targeted kill that can be stopped or transformed by applicable Protect, Guard, Redirect, Reflection, Death Immunity, Bulletproof, or another relevant defense.','Any',array['kill','normal strength'],array['Instant Kill','Personal Kill'],'KILLS',9,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY","killTier":"NORMAL"}'),
('super_kill','Super Kill','Harmful',29,'A stronger targeted kill that bypasses normal Protect but may be stopped by Super Protect, Death Immunity, Bulletproof, or another valid high-level defense.','Any',array['kill','super strength'],'{}','KILLS',9,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY","killTier":"SUPER","bypasses":["PROTECT"]}'),
('omega_kill','Omega Kill','Harmful',30,'A Super Kill-strength action that affects the target and applicable visitors. Evaluate each affected player''s defenses and immunities individually.','Any',array['kill','omega','visitors'],'{}','KILLS',9,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY","killTier":"OMEGA","affectsApplicableVisitors":true}'),
('duel_fight','Duel / Fight','Harmful',31,'Challenges a player to a fight to the death. Use the contest defined by role text, game rules, or GM-approved mechanics; do not invent a replacement contest.','Any',array['kill','contest','duel'],array['Duel','Fight'],'KILLS',9,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY","contestRequiresDefinition":true}'),
('save','Save','Protection',32,'Reacts to an applicable impending lethal result and prevents that death. Preserve lethal outcomes as pending through KILLS until relevant Save interactions are evaluated in DOC.','Any',array['rescue','pending death','reactive'],array['Rescue'],'DOC',10,'ORDERED_STAGE','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY","reactsTo":"PENDING_DEATH"}'),
('heal','Heal','Protection',33,'Removes an applicable harmful status and cancels its pending consequence where appropriate, such as Poison and its death timer. Heal does not revive, protect against future attacks, or grant Protect.','Any',array['cleanse','status','any time'],array['Cleanse'],'DOC',10,'ANY_TIME','ACTIVE','{"type":"ONE_PLAYER","selectionRuleType":"SOFT_EFFECT_ELIGIBILITY"}'),
('reflection','Reflection','Protection',34,'Mirrors an applicable targeted action back to its original user. When automatic it is one passive trigger and is never duplicated as an active submission.','Passive',array['reflection','redirect','passive'],array['Reflect','Mirror'],'PASSIVES',null,'EVENT_TRIGGERED','PASSIVE','{"type":"NO_TARGET","selectionRuleType":"HARD_SELECTION_RESTRICTION"}'),
('death_immunity','Death Immunity','Protection',35,'Automatically prevents death while applicable without preventing non-lethal effects. Only an explicit bypass defeats it.','Passive',array['passive','immunity','death'],array['Death Immune'],'PASSIVES',null,'EVENT_TRIGGERED','PASSIVE','{"type":"NO_TARGET","selectionRuleType":"HARD_SELECTION_RESTRICTION"}'),
('counterattack','Counterattack','Protection',36,'Automatically retaliates when its defined trigger occurs. If no other retaliation is defined, the default is Personal Instant Kill. It is a passive child effect, not a submitted attempt.','Passive',array['passive','retaliation','generated effect'],array['Counter Attack','Retaliate'],'PASSIVES',null,'EVENT_TRIGGERED','PASSIVE','{"type":"NO_TARGET","selectionRuleType":"HARD_SELECTION_RESTRICTION","defaultGeneratedEffect":"PERSONAL_INSTANT_KILL"}'),
('bulletproof','Bulletproof / Passive Immunity','Protection',37,'Provides automatic strong immunity against applicable targeted abilities, including Personal Instant Kill, Super Kill, and Omega Kill, unless an explicit mechanic bypasses it.','Passive',array['passive','immunity','bulletproof'],array['Bulletproof','Passive Immunity'],'PASSIVES',null,'EVENT_TRIGGERED','PASSIVE','{"type":"NO_TARGET","selectionRuleType":"HARD_SELECTION_RESTRICTION"}');

update public.standard_ability_datasets
set name='Global — Master Ability Encyclopedia',game_key='global-master-abilities',description='Versioned global default semantics and resolution metadata shared by every game.'
where id='courtroom-master-ability-encyclopedia';
update public.official_documents set title='Global — Master Ability Encyclopedia',updated_at=now() where document_key='courtroom_master_ability_encyclopedia';

update public.standard_abilities set sort_order=sort_order+1000 where dataset_id='courtroom-master-ability-encyclopedia';
insert into public.standard_abilities(id,dataset_id,display_name,category,sort_order,aliases)
select ability_id,'courtroom-master-ability-encyclopedia',display_name,category,sort_order,aliases from global_master_ability_seed
on conflict(id) do update set display_name=excluded.display_name,category=excluded.category,sort_order=excluded.sort_order,aliases=excluded.aliases;

insert into public.standard_ability_versions(ability_id,version_number,status,definition_status,official_description,structured_data,change_note)
select ability_id,3,'SUPERSEDED','DEFINED',description,
  jsonb_build_object('schemaVersion',1,'phase',phase,'mechanics',to_jsonb(mechanics),'standardizedAbilityType',display_name,'resolutionCategory',resolution_category,'resolutionPriority',resolution_priority,'resolutionTiming',resolution_timing,'activePassive',active_passive,'targeting',targeting,'globalDefault',true),
  'Global Master Ability Encyclopedia v1 resolution standard.'
from global_master_ability_seed
where not exists(select 1 from public.standard_ability_versions existing where existing.ability_id=global_master_ability_seed.ability_id and existing.game_id is null and existing.version_number=3);

update public.standard_ability_versions version_row set status='SUPERSEDED'
where version_row.game_id is null and version_row.ability_id in (select ability_id from global_master_ability_seed);
update public.standard_ability_versions version_row set status='ACTIVE',definition_status='DEFINED',official_description=seed.description,
  structured_data=jsonb_build_object('schemaVersion',1,'phase',seed.phase,'mechanics',to_jsonb(seed.mechanics),'standardizedAbilityType',seed.display_name,'resolutionCategory',seed.resolution_category,'resolutionPriority',seed.resolution_priority,'resolutionTiming',seed.resolution_timing,'activePassive',seed.active_passive,'targeting',seed.targeting,'globalDefault',true),change_note='Global Master Ability Encyclopedia v1 resolution standard.'
from global_master_ability_seed seed where version_row.ability_id=seed.ability_id and version_row.game_id is null and version_row.version_number=3;

insert into public.game_ability_datasets(game_id,dataset_id,activated_by)
select game.id,'courtroom-master-ability-encyclopedia',game.owner_id from public.games game
on conflict(game_id,dataset_id) do nothing;

create function private.activate_global_master_ability_dataset() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.game_ability_datasets(game_id,dataset_id,activated_by) values(new.id,'courtroom-master-ability-encyclopedia',new.owner_id) on conflict do nothing;
  return new;
end$$;
revoke all on function private.activate_global_master_ability_dataset() from public,anon,authenticated;
create trigger games_activate_global_master_abilities after insert on public.games for each row execute function private.activate_global_master_ability_dataset();

create or replace function public.list_standard_abilities(target_game_id uuid)
returns table(dataset_id text,dataset_name text,dataset_active boolean,ability_id text,display_name text,category text,sort_order integer,
  version_id uuid,version_number integer,version_scope text,definition_status text,official_description text,structured_data jsonb,source_title text,source_version integer,created_at timestamptz)
language plpgsql security invoker set search_path='' stable as $$
begin
  if not public.is_game_member(target_game_id) then raise exception using errcode='42501',message='GAME_ACCESS_REQUIRED'; end if;
  return query
  select dataset.id,dataset.name,dataset.id='courtroom-master-ability-encyclopedia' or exists(select 1 from public.game_ability_datasets active where active.game_id=target_game_id and active.dataset_id=dataset.id),
    ability.id,ability.display_name,ability.category,ability.sort_order,version_row.id,version_row.version_number,case when version_row.game_id is null then 'GLOBAL' else 'GAME' end,
    version_row.definition_status,version_row.official_description,version_row.structured_data,document.title,document_version.version_number,version_row.created_at
  from public.standard_ability_datasets dataset join public.standard_abilities ability on ability.dataset_id=dataset.id
  join lateral (
    select candidate.* from public.standard_ability_versions candidate
    where candidate.ability_id=ability.id and candidate.status='ACTIVE' and (candidate.game_id=target_game_id or candidate.game_id is null)
    order by (candidate.game_id is not null) desc,candidate.version_number desc limit 1
  ) version_row on true
  left join public.official_document_versions document_version on document_version.id=version_row.source_document_version_id
  left join public.official_documents document on document.id=document_version.document_id
  order by dataset.name,ability.sort_order;
end$$;

create or replace function public.get_effective_ruleset(target_game_id uuid)
returns jsonb language plpgsql security invoker set search_path='' stable as $$
declare target_owner uuid;stored jsonb;result jsonb;profile jsonb;
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select game.owner_id,document.document into target_owner,stored from public.games game join public.game_documents document on document.game_id=game.id where game.id=target_game_id;
  if stored is null then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  select to_jsonb(active_profile) into profile from public.global_resolution_profiles active_profile where active_profile.status='ACTIVE' limit 1;
  with game_rules as (
    select rule,lower(regexp_replace(coalesce(nullif(rule->>'globalRuleKey',''),rule->>'title'),'[^A-Za-z0-9]+','_','g')) effective_key
    from jsonb_array_elements(coalesce(stored#>'{data,rules}','[]'::jsonb)) rule where coalesce((rule->>'enabled')::boolean,true)
  ),global_values as (
    select rule.id,rule.rule_key,rule.name,rule.category,version.id version_id,version.version_number,version.description,version.structured_data,version.notes
    from public.global_rules rule join public.global_rule_versions version on version.global_rule_id=rule.id and version.status='ACTIVE'
    where rule.owner_id=target_owner and rule.active
  ),ability_values as (
    select ability.id ability_id,ability.display_name,ability.category,ability.sort_order,version.id version_id,version.version_number,
      case when version.game_id is null then 'GLOBAL' else 'GAME' end version_scope,version.official_description,version.structured_data
    from public.standard_abilities ability
    join lateral(select candidate.* from public.standard_ability_versions candidate where candidate.ability_id=ability.id and candidate.status='ACTIVE' and (candidate.game_id=target_game_id or candidate.game_id is null) order by (candidate.game_id is not null) desc,candidate.version_number desc limit 1) version on true
    where ability.dataset_id='courtroom-master-ability-encyclopedia' or exists(select 1 from public.game_ability_datasets active where active.game_id=target_game_id and active.dataset_id=ability.dataset_id)
  )
  select jsonb_build_object('gameId',target_game_id,'generatedAt',now(),'globalResolutionProfile',profile,
    'authorityPrecedence',array['CURRENT_GAME_RULE','ROLE_TEXT','CURRENT_GAME_PRECEDENT','GLOBAL_MASTER_ABILITY_ENCYCLOPEDIA','GLOBAL_PRECEDENT','GM_DECISION'],
    'gameRules',coalesce((select jsonb_agg(jsonb_build_object('ruleKey',effective_key,'source','CURRENT_GAME','authority','GAME_RULE','rule',rule)) from game_rules),'[]'::jsonb),
    'gameOverrides',coalesce((select jsonb_agg(jsonb_build_object('ruleKey',game.effective_key,'gameRule',game.rule,'overridesGlobalVersion',global.version_number,'reason','Current-game rule overrides the matching global fallback.')) from game_rules game join global_values global on lower(global.rule_key)=game.effective_key),'[]'::jsonb),
    'globalFallbacks',coalesce((select jsonb_agg(jsonb_build_object('id',global.id,'ruleKey',global.rule_key,'name',global.name,'category',global.category,'source','GLOBAL_FALLBACK','authority','GLOBAL_SETTING','versionId',global.version_id,'version',global.version_number,'description',global.description,'structuredData',global.structured_data,'notes',global.notes)) from global_values global where not exists(select 1 from game_rules game where game.effective_key=lower(global.rule_key))),'[]'::jsonb),
    'standardAbilities',coalesce((select jsonb_agg(to_jsonb(ability_values) order by sort_order) from ability_values),'[]'::jsonb),
    'roleModifiers',coalesce((select jsonb_agg(jsonb_build_object('id',modifier.id,'roleId',modifier.role_id,'abilityId',modifier.ability_id,'version',modifier.version_number,'modifier',modifier.modifier_text,'source','ROLE_TEXT')) from public.role_ability_modifiers modifier where modifier.game_id=target_game_id and modifier.status='ACTIVE'),'[]'::jsonb),
    'unresolved','[]'::jsonb) into result;
  return result;
end$$;

alter table public.resolution_session_events
  add column standardized_ability_type text check (standardized_ability_type is null or char_length(standardized_ability_type) between 1 and 200),
  add column resolution_category text check (resolution_category is null or resolution_category in ('BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC','PASSIVES')),
  add column resolution_priority integer check (resolution_priority is null or resolution_priority between 1 and 10),
  add column resolution_timing text check (resolution_timing is null or resolution_timing in ('ORDERED_STAGE','ANY_TIME','EVENT_TRIGGERED')),
  add column source_game_rule text check (source_game_rule is null or char_length(source_game_rule)<=500),
  add column global_rule_used text check (global_rule_used is null or char_length(global_rule_used)<=500),
  add column gm_override jsonb check (gm_override is null or jsonb_typeof(gm_override) in ('object','string')),
  add column effective_target_ids text[] not null default '{}',
  add column transformation_history jsonb not null default '[]'::jsonb check (jsonb_typeof(transformation_history)='array' and octet_length(transformation_history::text)<=100000),
  add column generated boolean not null default false,
  add column parent_action_id text check (parent_action_id is null or char_length(parent_action_id) between 1 and 160),
  add column submitted_attempt boolean not null default true;
create index resolution_session_events_game_category_idx on public.resolution_session_events(game_id,resolution_priority,event_order) where resolution_priority is not null;
create index resolution_session_events_parent_action_idx on public.resolution_session_events(game_id,parent_action_id) where parent_action_id is not null;

create function private.populate_resolution_event_global_fields() returns trigger language plpgsql set search_path='' as $$
begin
  new.standardized_ability_type:=coalesce(new.standardized_ability_type,nullif(new.outcome->>'standardized_ability_type',''));
  new.resolution_category:=coalesce(new.resolution_category,nullif(new.outcome->>'resolution_category',''));
  new.resolution_priority:=coalesce(new.resolution_priority,case when coalesce(new.outcome->>'resolution_priority','')~'^[1-9][0-9]*$' then (new.outcome->>'resolution_priority')::integer end);
  new.resolution_timing:=coalesce(new.resolution_timing,nullif(new.outcome->>'resolution_timing',''));
  new.source_game_rule:=coalesce(new.source_game_rule,nullif(new.outcome->>'source_game_rule',''));
  new.global_rule_used:=coalesce(new.global_rule_used,nullif(new.outcome->>'global_rule_used',''));
  new.gm_override:=coalesce(new.gm_override,new.outcome->'gm_override');
  if jsonb_typeof(new.outcome->'effective_target_ids')='array' then new.effective_target_ids:=coalesce(array(select jsonb_array_elements_text(new.outcome->'effective_target_ids')),'{}');
  elsif jsonb_typeof(new.outcome->'final_target_ids')='array' then new.effective_target_ids:=coalesce(array(select jsonb_array_elements_text(new.outcome->'final_target_ids')),'{}');
  else new.effective_target_ids:=coalesce(new.final_target_ids,'{}'); end if;
  if jsonb_typeof(new.outcome->'transformation_history')='array' then new.transformation_history:=new.outcome->'transformation_history'; end if;
  new.generated:=coalesce((new.outcome->>'generated')::boolean,new.generated,false);
  new.parent_action_id:=coalesce(new.parent_action_id,nullif(new.outcome->>'parent_action_id',''));
  new.submitted_attempt:=coalesce((new.outcome->>'submitted_attempt')::boolean,new.submitted_attempt,true);
  return new;
end$$;
revoke all on function private.populate_resolution_event_global_fields() from public,anon,authenticated;
create trigger resolution_events_global_fields before insert or update of outcome on public.resolution_session_events for each row execute function private.populate_resolution_event_global_fields();

update public.resolution_session_events set outcome=outcome;

alter function private.start_resolution_session(uuid,integer) rename to start_resolution_session_v11_5;
create or replace function private.start_resolution_session(target_game_id uuid,expected_game_version integer)
returns public.resolution_sessions language plpgsql security definer set search_path='' as $$
declare result public.resolution_sessions%rowtype;enriched jsonb;profile jsonb;
begin
  result:=private.start_resolution_session_v11_5(target_game_id,expected_game_version);
  if result.status in ('FINALIZED','REJECTED') then return result; end if;
  select to_jsonb(value) into profile from public.global_resolution_profiles value where value.status='ACTIVE' limit 1;
  select coalesce(jsonb_agg(action.value||jsonb_build_object(
    'standardizedAbilityType',coalesce(nullif(action.value->>'standardizedAbilityType',''),standard_ability.display_name,action.value->>'abilityNameSnapshot',action.value->>'name',''),
    'resolutionCategory',coalesce(nullif(action.value->>'resolutionCategory',''),standard_version.structured_data->>'resolutionCategory','UNCLASSIFIED'),
    'resolutionPriority',coalesce(action.value->'resolutionPriority',standard_version.structured_data->'resolutionPriority','null'::jsonb),
    'resolutionTiming',coalesce(nullif(action.value->>'resolutionTiming',''),standard_version.structured_data->>'resolutionTiming','ORDERED_STAGE'),
    'activePassive',coalesce(nullif(action.value->>'activePassive',''),standard_version.structured_data->>'activePassive','ACTIVE'),
    'originalTargetIds',coalesce(action.value->'originalTargetIds',action.value->'targetIds','[]'::jsonb),
    'effectiveTargetIds',coalesce(action.value->'effectiveTargetIds',action.value->'targetIds','[]'::jsonb),
    'transformationHistory',coalesce(action.value->'transformationHistory','[]'::jsonb),
    'generated',coalesce(action.value->'generated','false'::jsonb),
    'parentActionId',coalesce(action.value->>'parentActionId',''),
    'submittedAttempt',coalesce(action.value->'submittedAttempt',case when coalesce((action.value->>'generated')::boolean,false) then 'false'::jsonb else 'true'::jsonb end),
    'sourceRoleId',coalesce(action.value->>'sourceRoleId',action.value->>'roleId',''),
    'sourceGameRule',coalesce(action.value->>'sourceGameRule',''),
    'globalRuleUsed',coalesce(action.value->>'globalRuleUsed',standard_ability.id,'')
  ) order by action.ordinality),'[]'::jsonb) into enriched
  from jsonb_array_elements(result.submitted_actions) with ordinality action(value,ordinality)
  left join lateral(select candidate.* from public.standard_abilities candidate where lower(regexp_replace(candidate.display_name,'[^a-z0-9]+','','g'))=lower(regexp_replace(coalesce(action.value->>'standardizedAbilityType',action.value->>'abilityNameSnapshot',action.value->>'name',''),'[^a-z0-9]+','','g')) order by candidate.dataset_id='courtroom-master-ability-encyclopedia' desc limit 1) standard_ability on true
  left join lateral(select candidate.* from public.standard_ability_versions candidate where candidate.ability_id=standard_ability.id and candidate.status='ACTIVE' and (candidate.game_id=target_game_id or candidate.game_id is null) order by (candidate.game_id is not null) desc,candidate.version_number desc limit 1) standard_version on true;
  update public.resolution_sessions session_row set submitted_actions=enriched,source_versions=source_versions||jsonb_build_object('globalResolutionProfile',profile) where session_row.id=result.id returning * into result;
  return result;
end$$;

create or replace function public.start_resolution_session(target_game_id uuid,expected_game_version integer)
returns public.resolution_sessions language sql security definer set search_path='' as $$
  select private.start_resolution_session(target_game_id,expected_game_version)
$$;

revoke all on function private.start_resolution_session(uuid,integer) from public,anon,authenticated,service_role;

alter function private.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean) rename to approve_and_apply_resolution_v11_5;
create or replace function private.approve_and_apply_resolution(target_session_id uuid,expected_lock_version integer,target_final_resolution jsonb,target_gm_explanation text,target_teach_ai boolean,target_teach_scope text,target_consumed_action_ids text[],target_idempotency_key uuid,target_override_warnings boolean,target_reject boolean)
returns public.resolution_sessions language plpgsql security definer set search_path='' as $$
declare item jsonb;queued jsonb;last_priority integer:=0;item_priority integer;canonical jsonb;result public.resolution_sessions%rowtype;
begin
  if not coalesce(target_reject,false) then
    if jsonb_typeof(target_final_resolution->'action_results') is distinct from 'array' then raise exception using errcode='22023',message='INVALID_STRUCTURED_FINAL_RULING'; end if;
    for item in select value from jsonb_array_elements(target_final_resolution->'action_results') order by coalesce(nullif(value->>'order','')::integer,999999) loop
      if coalesce(item->>'resolution_category','') not in ('BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC','PASSIVES') then raise exception using errcode='22023',message='ABILITY_CLASSIFICATION_REQUIRED'; end if;
      if item->>'resolution_category' not in ('PASSIVES') and coalesce(item->>'resolution_timing','ORDERED_STAGE')<>'ANY_TIME' then
        item_priority:=array_position(array['BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC'],item->>'resolution_category');
        if item_priority<last_priority then raise exception using errcode='22023',message='INVALID_GLOBAL_RESOLUTION_ORDER'; end if;last_priority:=item_priority;
      end if;
      if coalesce((item->>'generated')::boolean,false) and (coalesce((item->>'submitted_attempt')::boolean,false) or coalesce(item->>'parent_action_id','')='') then raise exception using errcode='22023',message='INVALID_GENERATED_EFFECT_LINEAGE'; end if;
      if jsonb_typeof(coalesce(item->'transformation_history','[]'::jsonb))<>'array' then raise exception using errcode='22023',message='INVALID_TRANSFORMATION_HISTORY'; end if;
      select value into queued from public.resolution_sessions session_row cross join lateral jsonb_array_elements(session_row.submitted_actions) action(value) where session_row.id=target_session_id and action.value->>'id'=item->>'action_id' limit 1;
      if queued is not null and coalesce(item->'original_target_ids','[]'::jsonb) is distinct from coalesce(queued->'originalTargetIds',queued->'targetIds','[]'::jsonb) then raise exception using errcode='22023',message='ORIGINAL_TARGETS_IMMUTABLE'; end if;
    end loop;
    canonical:=jsonb_set(target_final_resolution,'{resolution_order}',to_jsonb(array['BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS EFFECTS','INTEL','CONVERTS','KILLS','DOC']),true);
  else canonical:=target_final_resolution; end if;
  result:=private.approve_and_apply_resolution_v11_5(target_session_id,expected_lock_version,canonical,target_gm_explanation,target_teach_ai,target_teach_scope,target_consumed_action_ids,target_idempotency_key,target_override_warnings,target_reject);
  if not coalesce(target_reject,false) and result.status='FINALIZED' then
    with action_metadata as (
      select value from jsonb_array_elements(coalesce(result.final_resolution->'action_results','[]'::jsonb)) value
    )
    update public.resolution_session_events event_row set outcome=event_row.outcome||jsonb_build_object(
      'standardized_ability_type',metadata.value->>'standardized_ability_type','resolution_category',metadata.value->>'resolution_category',
      'resolution_priority',metadata.value->'resolution_priority','resolution_timing',metadata.value->>'resolution_timing',
      'source_game_rule',metadata.value->>'source_game_rule','global_rule_used',metadata.value->>'global_rule_used','gm_override',metadata.value->'gm_override',
      'original_target_ids',coalesce(metadata.value->'original_target_ids','[]'::jsonb),'final_target_ids',coalesce(metadata.value->'final_target_ids','[]'::jsonb),
      'effective_target_ids',coalesce(metadata.value->'final_target_ids','[]'::jsonb),'transformation_history',coalesce(metadata.value->'transformation_history','[]'::jsonb),
      'generated',coalesce(metadata.value->'generated','false'::jsonb),'parent_action_id',coalesce(metadata.value->>'parent_action_id',''),
      'submitted_attempt',coalesce(metadata.value->'submitted_attempt','true'::jsonb)
    ) from action_metadata metadata
    where event_row.session_id=result.id and event_row.action_id=metadata.value->>'action_id';

    with passive_metadata as (
      select value from jsonb_array_elements(coalesce(result.final_resolution->'passive_results','[]'::jsonb)) value where coalesce((value->>'triggered')::boolean,false)
    )
    update public.resolution_session_events event_row set outcome=event_row.outcome||jsonb_build_object(
      'standardized_ability_type',coalesce(metadata.value->>'ability_name',metadata.value->>'ability_id','Passive'),
      'resolution_category','PASSIVES','resolution_priority','null'::jsonb,'resolution_timing','EVENT_TRIGGERED',
      'effective_target_ids',coalesce(metadata.value->'target_ids',metadata.value->'affected_player_ids','[]'::jsonb),
      'transformation_history','[]'::jsonb,'generated',false,'parent_action_id',coalesce(metadata.value->>'source_action_id',''),'submitted_attempt',false
    ) from passive_metadata metadata
    where event_row.session_id=result.id and event_row.event_type in ('PASSIVE_TRIGGER','PASSIVE_PREVENTED')
      and coalesce(event_row.action_id,'')=coalesce(metadata.value->>'source_action_id','')
      and coalesce(event_row.ability_id,'')=coalesce(metadata.value->>'ability_id','')
      and coalesce(event_row.actor_player_id,'')=coalesce(metadata.value->>'player_id','');
  end if;
  return result;
end$$;

create or replace function public.approve_and_apply_resolution(
  target_session_id uuid,expected_lock_version integer,target_final_resolution jsonb,target_gm_explanation text,
  target_teach_ai boolean,target_teach_scope text default 'GLOBAL',target_consumed_action_ids text[] default '{}',
  target_idempotency_key uuid default gen_random_uuid(),target_override_warnings boolean default false,target_reject boolean default false
) returns public.resolution_sessions language sql security definer set search_path='' as $$
  select private.approve_and_apply_resolution(target_session_id,expected_lock_version,target_final_resolution,target_gm_explanation,target_teach_ai,target_teach_scope,target_consumed_action_ids,target_idempotency_key,target_override_warnings,target_reject)
$$;

revoke all on function private.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean) from public,anon,authenticated,service_role;

revoke all on function public.list_standard_abilities(uuid),public.get_effective_ruleset(uuid),public.start_resolution_session(uuid,integer),public.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean) from public,anon;
grant execute on function public.list_standard_abilities(uuid),public.get_effective_ruleset(uuid),public.start_resolution_session(uuid,integer),public.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean) to authenticated;

comment on table public.global_resolution_profiles is 'Versioned system-global category order, passive policy, Heal timing, and authority precedence.';
comment on column public.resolution_session_events.original_target_ids is 'Immutable submitted targets before swaps, redirects, guards, or reflections.';
comment on column public.resolution_session_events.effective_target_ids is 'Final action targets after every ordered transformation.';
comment on column public.resolution_session_events.transformation_history is 'Ordered target/action transformations; original targets remain immutable.';
comment on column public.resolution_session_events.generated is 'True for child effects that must not count as independently submitted attempts.';

do $$
begin
  if (select count(*) from global_master_ability_seed)<>37 then raise exception 'GLOBAL_MASTER_ABILITY_COUNT_MISMATCH'; end if;
  if exists(select 1 from global_master_ability_seed where resolution_category<>'PASSIVES' and resolution_priority is distinct from array_position(array['BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC'],resolution_category)) then raise exception 'GLOBAL_RESOLUTION_PRIORITY_MISMATCH'; end if;
  if not exists(select 1 from global_master_ability_seed where ability_id='heal' and resolution_category='DOC' and resolution_timing='ANY_TIME') then raise exception 'HEAL_TIMING_MISMATCH'; end if;
  if exists(select 1 from global_master_ability_seed where active_passive='PASSIVE' and resolution_category<>'PASSIVES') then raise exception 'PASSIVE_CATEGORY_MISMATCH'; end if;
end$$;
