-- Complete the supplied Courtroom encyclopedia and make it the only built-in
-- ability set in every existing saved game.
create temporary table courtroom_ability_seed (
  ability_id text primary key,
  display_name text not null,
  category text not null,
  sort_order integer not null,
  description text not null,
  phase text not null,
  mechanics text[] not null,
  aliases text[] not null default '{}'
) on commit drop;

insert into courtroom_ability_seed(ability_id,display_name,category,sort_order,description,phase,mechanics,aliases) values
('basic_ask','Basic Ask','Investigation',1,'Target one player and learn whether they are Villager, Den, or Neutral. Basic Ask does not bypass protections, disguises, false appearances, redirects, or other effects that interfere with the investigation.','Night',array['investigation','faction'],'{}'),
('advanced_ask','Advanced Ask','Investigation',2,'Target one player and learn their exact role. For example, if the target is the Corrupt Judge, the result reveals Corrupt Judge.','Night',array['investigation','role'],array['Role Check']),
('alignment_ask','Alignment Ask','Investigation',3,'Target one player and learn their alignment or faction.','Night',array['investigation','alignment'],'{}'),
('watch','Watch','Investigation',4,'Target one player and learn who visited that player during the cycle.','Night',array['investigation','visitor'],'{}'),
('track','Track','Investigation',5,'Target one player and learn who that player visited during the cycle.','Night',array['investigation','visitor'],'{}'),
('action_check','Action Check','Investigation',6,'Target one player and learn which abilities were used on that player during the cycle. It does not reveal who used those abilities.','Night',array['investigation','action'],array['Visitor Check']),
('gravedigger','Gravedigger','Investigation',7,'Select a dead player and learn that player''s role.','Night',array['investigation','dead player','role'],'{}'),
('map','Map','Investigation',8,'Learn which abilities are still available among all living players. Map reveals the ability names only and does not reveal which player, role, or faction possesses them. Multiple copies of the same ability do not need to be identified separately.','Night',array['investigation','ability inventory'],'{}'),
('den_regular_kill','Den Regular Kill','Harmful',9,'The Den collectively selects a target. The kill uses the same mechanics as a Personal Instant Kill and counts as a Den action rather than a personal killing ability. A random eligible living Den member performs the action, usually excluding the Den Alpha when another eligible member is available.','Night',array['kill','den action'],array['Regular Kill']),
('personal_instant_kill','Personal Instant Kill','Harmful',10,'Kill one targeted player. The kill can be stopped or manipulated by applicable normal mechanics, including Protect, Guard, Save, Redirect, Reflection, and relevant immunities.','Any',array['kill','harmful'],array['Instant Kill']),
('super_kill','Super Kill','Harmful',11,'Kill one targeted player while ignoring normal protection. Normal Protect, Guard, and Save do not stop it. Super Protect or applicable Death Immunity can prevent the death.','Any',array['kill','bypass'],'{}'),
('omega_kill','Omega Kill','Harmful',12,'Uses the same kill strength as a Super Kill. It hits the targeted player and every player visiting that target during the cycle. It does not automatically hit players whom the target visits.','Any',array['kill','visitors'],'{}'),
('poison','Poison','Harmful',13,'Apply a Poison status to a target. The poisoned player dies after 2 days unless successfully Healed before the timer expires. Poison is contagious: any player who visits a poisoned player also becomes Poisoned and begins their own 2-day timer.','Night',array['delayed','status','kill','contagious'],'{}'),
('mark','Mark','Harmful',14,'Place a Mark on a targeted player. When the Mark''s specified requirement is fulfilled, it unlocks a Personal Instant Kill against that player. The Mark itself does not immediately kill the target.','Night',array['status','delayed','kill'],'{}'),
('roleblock','Roleblock','Harmful',15,'Target a player and prevent them from performing any active ability during that cycle. Passive abilities remain active unless a role specifically states otherwise.','Night',array['block','control'],'{}'),
('drunk','Drunk','Harmful',16,'The targeted player cannot communicate using text in any form. They may communicate only through emojis, GIFs, stickers, and reactions. Drunk affects communication only unless a role states otherwise.','Any',array['communication','restriction'],'{}'),
('sober','Sober','Harmful',17,'The targeted player may communicate only through normal text. They cannot use emojis, GIFs, stickers, reactions, or other non-text communication. Sober affects communication only unless a role states otherwise.','Any',array['communication','restriction'],'{}'),
('duel_fight','Duel / Fight','Harmful',18,'Challenge a targeted player to a fight to the death. The winner survives and the loser dies. The role possessing the ability determines how the winner is decided, such as a mini-game, trivia, rock-paper-scissors, or another GM-approved challenge.','Any',array['contest','kill'],'{}'),
('convert','Convert','Harmful',19,'Target a player and attempt to change that player''s faction or alignment to the faction performing the conversion. The target keeps their role and abilities unless the role specifically states otherwise. Conversion can fail against applicable conversion immunity or other defensive effects.','Night',array['faction','conversion'],array['Conversion','Recruit']),
('steal','Steal','Harmful',20,'Target a player and steal one available use of an ability from them. The thief gains that use and the original player loses it. For an unlimited or recurring ability, the stolen version is normally treated as one stolen use unless the role states otherwise.','Night',array['ability','theft','uses'],'{}'),
('protect','Protect','Protection',21,'Target a player and protect them for that night from most normal harmful abilities directed at them. For example, a protected player survives a Personal Instant Kill. Protect does not stop abilities that explicitly bypass normal protection, such as Super Kill or Omega Kill.','Night',array['protection','kill'],'{}'),
('guard','Guard','Protection',22,'Target a player and take an applicable incoming harmful action instead of them. The harmful action is transferred to the Guard rather than simply being cancelled.','Night',array['protection','interception'],'{}'),
('save','Save','Protection',23,'A last-minute reactive ability used when a player is about to die. Save prevents that death and keeps the player alive. Unlike Protect, it is an emergency rescue rather than a protection placed in advance. It does not stop higher kill tiers when those tiers explicitly bypass normal Save.','Any',array['protection','death','reactive'],'{}'),
('heal','Heal','Protection',24,'Remove an active status effect from a targeted player. For example, Heal removes Poison and cancels that player''s Poison death timer. Heal does not protect against new harmful abilities and does not revive a player who is already dead.','Night',array['protection','cleanse'],'{}'),
('super_protect','Super Protect','Protection',25,'Target a player and protect them against Super Kills and Omega Kills. It is stronger than normal Protect.','Night',array['protection','super kill','omega kill'],'{}'),
('death_immunity','Death Immunity','Protection',26,'While Death Immunity is active, the player cannot die. The player may still be affected by non-death abilities. A specific mechanic may bypass Death Immunity only if it explicitly says so.','Passive',array['immunity','death'],'{}'),
('reflection','Reflection','Protection',27,'Acts like a mirror. When the player is targeted by an applicable ability, the incoming ability is sent back to the player who used it. For example, a reflected Personal Instant Kill hits the original attacker instead.','Passive',array['protection','redirect'],'{}'),
('counterattack','Counterattack','Protection',28,'Usually a passive ability tied to a specific immunity. When the player is targeted by an ability they are immune to, Counterattack automatically activates against the attacker. The retaliation is usually a Personal Instant Kill unless the role specifies another effect.','Passive',array['reaction','kill'],'{}'),
('bulletproof','Bulletproof / Passive Immunity','Protection',29,'Passive immunity to all abilities targeting the player, including Personal Instant Kill, Super Kill, Omega Kill, and other targeted harmful effects. Bulletproof inherently includes Super Protect-level protection unless a specific ability explicitly bypasses Bulletproof.','Passive',array['immunity','protection'],array['Bulletproof','Passive Immunity']),
('ability_amplify','Ability Amplify','Support',30,'Strengthen an ability by upgrading it to the next power level or a stronger version of its normal effect. Examples: Personal Instant Kill becomes Super Kill; Protect becomes Super Protect. Amplify increases strength, not number of uses.','Night',array['support','strength'],'{}'),
('additional_uses','Additional Uses','Support',31,'Give a player an additional use of a specific ability they already possess. Example: a player with one Personal Instant Kill gains a second Personal Instant Kill. It increases the number of uses without increasing the ability''s strength.','Any',array['support','uses'],'{}'),
('action_success_guarantee','Action Success Guarantee','Support',32,'Guarantee that the player can perform their selected action during that cycle. It bypasses Roleblock and other effects that would normally prevent the player from acting. It does not automatically increase the action''s strength or bypass the target''s defenses.','Night',array['support','success'],'{}');

-- Store a complete immutable source version for the supplied Word document.
update public.official_document_versions v
set status='SUPERSEDED'
from public.official_documents d
where d.id=v.document_id
  and d.document_key='courtroom_master_ability_encyclopedia'
  and v.version_number<2
  and v.status='ACTIVE';

insert into public.official_document_versions(
  document_id,version_number,status,requested_status,source_file_name,content_type,file_size,
  source_sha256,extracted_text,summary,completed_at
)
select d.id,2,'ACTIVE','ACTIVE','Courtroom_Master_Ability_Encyclopedia.docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',40225,
  'd0bf9d20bfd8d07b6001cb77a02a7af10663f01c7e013390c15c812b21369d3f',
  string_agg(s.sort_order||'. '||s.display_name||' â€” '||s.description,e'\n' order by s.sort_order),
  'Complete 32-ability Courtroom source supplied by the GM.',now()
from public.official_documents d cross join courtroom_ability_seed s
where d.document_key='courtroom_master_ability_encyclopedia'
  and not exists(
    select 1 from public.official_document_versions existing
    where existing.document_id=d.id and existing.version_number=2
  )
group by d.id;

update public.official_document_versions v
set status='ACTIVE',requested_status='ACTIVE',ingestion_error='',completed_at=coalesce(v.completed_at,now())
from public.official_documents d
where d.id=v.document_id and d.document_key='courtroom_master_ability_encyclopedia' and v.version_number=2;

update public.official_documents
set title='Courtroom â€” Master Ability Encyclopedia',updated_at=now()
where document_key='courtroom_master_ability_encyclopedia';

update public.standard_ability_datasets ds
set name='Courtroom â€” Master Ability Encyclopedia',
    description='The complete official 32-ability Courtroom dataset supplied by the GM.',
    source_document_version_id=v.id
from public.official_document_versions v
join public.official_documents d on d.id=v.document_id
where ds.id='courtroom-master-ability-encyclopedia'
  and d.document_key='courtroom_master_ability_encyclopedia'
  and v.version_number=2;

update public.standard_abilities a
set display_name=s.display_name,category=s.category,sort_order=s.sort_order,aliases=s.aliases
from courtroom_ability_seed s
where a.id=s.ability_id and a.dataset_id='courtroom-master-ability-encyclopedia';

update public.standard_ability_versions
set status='SUPERSEDED'
where ability_id in (select ability_id from courtroom_ability_seed)
  and game_id is null and version_number<2 and status='ACTIVE';

insert into public.standard_ability_versions(
  ability_id,version_number,status,definition_status,official_description,structured_data,
  source_document_version_id,change_note
)
select s.ability_id,2,'ACTIVE','DEFINED',s.description,
  jsonb_build_object('phase',s.phase,'mechanics',to_jsonb(s.mechanics)),v.id,
  'Completed from Courtroom_Master_Ability_Encyclopedia.docx.'
from courtroom_ability_seed s
join public.official_documents d on d.document_key='courtroom_master_ability_encyclopedia'
join public.official_document_versions v on v.document_id=d.id and v.version_number=2
where not exists(
  select 1 from public.standard_ability_versions existing
  where existing.ability_id=s.ability_id and existing.game_id is null and existing.version_number=2
);

update public.standard_ability_versions v
set status='ACTIVE',definition_status='DEFINED',official_description=s.description,
    structured_data=jsonb_build_object('phase',s.phase,'mechanics',to_jsonb(s.mechanics)),
    source_document_version_id=dv.id
from courtroom_ability_seed s
join public.official_documents d on d.document_key='courtroom_master_ability_encyclopedia'
join public.official_document_versions dv on dv.document_id=d.id and dv.version_number=2
where v.ability_id=s.ability_id and v.game_id is null and v.version_number=2;

insert into public.official_document_chunks(document_version_id,game_id,chunk_index,heading,source_locator,content,token_estimate)
select v.id,null,0,'Courtroom standardized abilities','Complete Word source â€” version 2',v.extracted_text,
  greatest(1,char_length(v.extracted_text)/4)
from public.official_document_versions v
join public.official_documents d on d.id=v.document_id
where d.document_key='courtroom_master_ability_encyclopedia' and v.version_number=2
  and not exists(select 1 from public.official_document_chunks c where c.document_version_id=v.id);

-- Replace the encyclopedia only in setup saves that have no roles yet. This is
-- the verified state of the affected live saves and cannot orphan role links.
do $$
declare
  saved record;
  seed courtroom_ability_seed%rowtype;
  existing_id text;
  new_abilities jsonb;
  new_document jsonb;
  stamp timestamptz := now();
begin
  for saved in
    select gd.game_id,gd.document,gd.version,g.owner_id
    from public.game_documents gd join public.games g on g.id=gd.game_id
    where jsonb_array_length(coalesce(gd.document#>'{data,roles}','[]'::jsonb))=0
    for update of gd
  loop
    new_abilities := '[]'::jsonb;
    for seed in select * from courtroom_ability_seed order by sort_order loop
      existing_id := null;
      select ability->>'id' into existing_id
      from jsonb_array_elements(coalesce(saved.document#>'{data,abilities}','[]'::jsonb)) ability
      where lower(regexp_replace(ability->>'name','[^a-z0-9]+','','g')) = lower(regexp_replace(seed.display_name,'[^a-z0-9]+','','g'))
         or lower(regexp_replace(ability->>'name','[^a-z0-9]+','','g')) = any(
              select lower(regexp_replace(alias_name,'[^a-z0-9]+','','g')) from unnest(seed.aliases) alias_name
            )
      order by case when lower(ability->>'name')=lower(seed.display_name) then 0 else 1 end
      limit 1;
      new_abilities := new_abilities || jsonb_build_array(jsonb_build_object(
        'id',coalesce(existing_id,gen_random_uuid()::text),'gameId',saved.game_id::text,
        'name',seed.display_name,'defaultName',seed.display_name,'category',seed.category,
        'definition',seed.description,'phase',seed.phase,'mechanics',to_jsonb(seed.mechanics),
        'builtIn',true,'revisions','[]'::jsonb
      ));
    end loop;

    new_document := jsonb_set(saved.document,'{data,abilities}',new_abilities,true);
    new_document := jsonb_set(new_document,'{data,lastSavedAt}',to_jsonb(stamp::text),true);
    new_document := jsonb_set(new_document,'{game,updatedAt}',to_jsonb(stamp::text),true);
    new_document := jsonb_set(new_document,'{data,history}',
      coalesce(saved.document#>'{data,history}','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id',gen_random_uuid()::text,'gameId',saved.game_id::text,'type','ABILITY',
        'message','Courtroom Master Ability Encyclopedia installed with exactly 32 abilities.',
        'day',coalesce((saved.document#>>'{game,currentDay}')::integer,0),
        'phase',coalesce(saved.document#>>'{game,currentPhase}','Day'),'timestamp',stamp::text
      )),true);

    update public.game_documents
    set document=new_document,version=saved.version+1,updated_at=stamp
    where game_id=saved.game_id;
    update public.games set updated_at=stamp where id=saved.game_id;
    insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
    values(saved.game_id,null,'ability','courtroom-master-ability-encyclopedia','Installed 32-ability Courtroom encyclopedia',jsonb_build_object('ability_count',32));
    insert into public.game_ability_datasets(game_id,dataset_id,activated_by)
    values(saved.game_id,'courtroom-master-ability-encyclopedia',saved.owner_id)
    on conflict(game_id,dataset_id) do nothing;
  end loop;
end $$;

do $$
begin
  if (select count(*) from courtroom_ability_seed) <> 32 then
    raise exception 'COURTROOM_ABILITY_COUNT_MISMATCH';
  end if;
  if exists(
    select 1 from public.standard_ability_versions v
    join courtroom_ability_seed s on s.ability_id=v.ability_id
    where v.game_id is null and v.status='ACTIVE'
      and (v.definition_status<>'DEFINED' or v.official_description is null)
  ) then
    raise exception 'COURTROOM_ABILITY_DEFINITION_INCOMPLETE';
  end if;
end $$;


