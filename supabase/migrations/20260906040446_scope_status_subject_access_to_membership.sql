-- Removing membership also removes subject-specific visibility. Authorized GMs
-- retain all status views; current viewers retain public and own-subject views.
alter policy player_status_effects_read_visible on public.player_status_effects
  to authenticated using (
    (select public.can_edit_game(game_id))
    or ((select public.is_game_member(game_id)) and (
      visibility='PUBLIC'
      or (subject_user_id=(select auth.uid()) and visibility='OWNER_VISIBLE')
    ))
  );

-- Keep the historical subject reference after removal, but do not let it block
-- later GM resolution/expiration. New or changed subject assignments still
-- require current membership. All other write validation remains intact.
do $migration$
declare definition text; needle text;
begin
  definition:=pg_get_functiondef('private.validate_player_status_effect()'::regprocedure);
  needle:='if new.subject_user_id is not null and not exists(';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected status-subject validation boundary'; end if;
  execute replace(definition,needle,'if new.subject_user_id is not null and (tg_op=''INSERT'' or new.subject_user_id is distinct from old.subject_user_id) and not exists(');
end $migration$;
