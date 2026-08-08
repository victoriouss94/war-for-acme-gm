create or replace function public.create_game(game_id uuid,initial_document jsonb)
returns table(id uuid,version integer,share_code text) language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception using errcode='28000',message='Authentication required.'; end if;
  perform public.validate_game_document($1,initial_document);
  insert into public.games(id,owner_id,name,theme,description,status,created_by,updated_by) values($1,auth.uid(),initial_document#>>'{game,name}',coalesce(initial_document#>>'{game,theme}',''),coalesce(initial_document#>>'{game,description}',''),initial_document#>>'{game,status}',auth.uid(),auth.uid());
  insert into public.game_members values($1,auth.uid(),'owner',now());
  insert into public.game_documents(game_id,document,updated_by) values($1,initial_document,auth.uid());
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values($1,auth.uid(),'game',$1::text,'Game created',initial_document->'game');
  return query select g.id,d.version,g.share_code from public.games g join public.game_documents d on d.game_id=g.id where g.id=$1;
end$$;
