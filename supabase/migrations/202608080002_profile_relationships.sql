alter table public.game_members add constraint game_members_profile_fkey foreign key(user_id) references public.profiles(id) on delete cascade;
alter table public.change_history add constraint change_history_profile_fkey foreign key(user_id) references public.profiles(id) on delete set null;
