do $repair$
declare definition text;
begin
  select pg_get_functiondef('private.approve_and_apply_resolution_v11_5(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean)'::regprocedure) into definition;
  if position($old$item->>'ability_name'||': '||item->>'result'$old$ in definition)=0 then raise exception 'Expected approval summary expression not found'; end if;
  execute replace(definition,$old$item->>'ability_name'||': '||item->>'result'$old$,$new$(item->>'ability_name')||': '||(item->>'result')$new$);
end $repair$;
