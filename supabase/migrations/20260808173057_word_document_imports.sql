-- Private Word source documents and atomic import/re-import audit records.
create table public.game_imports (
  id uuid primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  import_kind text not null check (import_kind in ('initial','reimport')),
  source_file_name text not null check (char_length(source_file_name) between 1 and 255),
  storage_path text not null unique check (char_length(storage_path) between 1 and 700),
  file_size bigint not null check (file_size between 1 and 10485760),
  content_type text not null check (content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  source_sha256 text not null default '' check (source_sha256='' or source_sha256~'^[0-9a-f]{64}$'),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary)='object'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings)='array'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index game_imports_game_created_idx on public.game_imports(game_id,created_at desc);
create index game_imports_created_by_idx on public.game_imports(created_by);
alter table public.game_imports enable row level security;
create policy game_imports_read_member on public.game_imports for select to authenticated using(public.is_game_member(game_id));
grant select on public.game_imports to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('game-import-documents','game-import-documents',false,10485760,array['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy word_import_upload_own_prefix on storage.objects for insert to authenticated with check(
  bucket_id='game-import-documents'
  and (storage.foldername(name))[1]=(select auth.uid()::text)
  and right(lower(name),5)='.docx'
);
create policy word_import_read_game_member on storage.objects for select to authenticated using(
  bucket_id='game-import-documents' and (
    owner_id=(select auth.uid()::text)
    or exists(select 1 from public.game_imports imported where imported.storage_path=name and public.is_game_member(imported.game_id))
  )
);
create policy word_import_cleanup_unregistered on storage.objects for delete to authenticated using(
  bucket_id='game-import-documents'
  and owner_id=(select auth.uid()::text)
  and not exists(select 1 from public.game_imports imported where imported.storage_path=name)
);

create function public.create_game_from_import(
  game_id uuid,
  initial_document jsonb,
  source_import_id uuid,
  source_file_name text,
  source_storage_path text,
  source_file_size bigint,
  source_content_type text,
  source_sha256 text,
  import_summary jsonb,
  import_warnings jsonb
)
returns table(id uuid,version integer,share_code text)
language plpgsql security definer set search_path=''
as $$
declare created record;
begin
  if auth.uid() is null then raise exception using errcode='28000',message='Authentication required.'; end if;
  if source_import_id is null
    or nullif(btrim(source_file_name),'') is null
    or char_length(source_file_name)>255
    or source_file_size not between 1 and 10485760
    or source_content_type<>'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    or right(lower(source_storage_path),5)<>'.docx'
    or split_part(source_storage_path,'/',1)<>auth.uid()::text
    or (coalesce(source_sha256,'')<>'' and coalesce(source_sha256,'')!~'^[0-9a-f]{64}$')
    or jsonb_typeof(import_summary)<>'object'
    or jsonb_typeof(import_warnings)<>'array'
  then raise exception using errcode='22023',message='Invalid Word import metadata.'; end if;
  if not exists(
    select 1 from storage.objects object
    where object.bucket_id='game-import-documents'
      and object.name=source_storage_path
      and object.owner_id=auth.uid()::text
  ) then raise exception using errcode='P0002',message='Uploaded Word source document was not found.'; end if;

  select * into created from public.create_game(game_id,initial_document);
  insert into public.game_imports(id,game_id,import_kind,source_file_name,storage_path,file_size,content_type,source_sha256,summary,warnings,created_by)
  values(source_import_id,game_id,'initial',source_file_name,source_storage_path,source_file_size,source_content_type,coalesce(source_sha256,''),import_summary,import_warnings,auth.uid());
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(game_id,auth.uid(),'import',source_import_id::text,'Game imported from Word document',jsonb_build_object('fileName',source_file_name,'summary',import_summary,'warnings',import_warnings));
  return query select created.id,created.version,created.share_code;
end$$;

create function public.save_game_reimport(
  target_game_id uuid,
  expected_version integer,
  next_document jsonb,
  source_import_id uuid,
  source_file_name text,
  source_storage_path text,
  source_file_size bigint,
  source_content_type text,
  source_sha256 text,
  import_summary jsonb,
  import_warnings jsonb
)
returns table(document jsonb,version integer,updated_at timestamptz,updated_by uuid)
language plpgsql security definer set search_path=''
as $$
declare saved record;
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='You do not have permission to re-import this game.'; end if;
  if source_import_id is null
    or nullif(btrim(source_file_name),'') is null
    or char_length(source_file_name)>255
    or source_file_size not between 1 and 10485760
    or source_content_type<>'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    or right(lower(source_storage_path),5)<>'.docx'
    or split_part(source_storage_path,'/',1)<>auth.uid()::text
    or (coalesce(source_sha256,'')<>'' and coalesce(source_sha256,'')!~'^[0-9a-f]{64}$')
    or jsonb_typeof(import_summary)<>'object'
    or jsonb_typeof(import_warnings)<>'array'
  then raise exception using errcode='22023',message='Invalid Word re-import metadata.'; end if;
  if not exists(
    select 1 from storage.objects object
    where object.bucket_id='game-import-documents'
      and object.name=source_storage_path
      and object.owner_id=auth.uid()::text
  ) then raise exception using errcode='P0002',message='Uploaded Word source document was not found.'; end if;

  select * into saved from public.save_game_document(target_game_id,expected_version,next_document,'Document re-import reviewed','game',target_game_id::text);
  insert into public.game_imports(id,game_id,import_kind,source_file_name,storage_path,file_size,content_type,source_sha256,summary,warnings,created_by)
  values(source_import_id,target_game_id,'reimport',source_file_name,source_storage_path,source_file_size,source_content_type,coalesce(source_sha256,''),import_summary,import_warnings,auth.uid());
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(target_game_id,auth.uid(),'import',source_import_id::text,'Word document re-imported',jsonb_build_object('fileName',source_file_name,'summary',import_summary,'warnings',import_warnings));
  return query select saved.document,saved.version,saved.updated_at,saved.updated_by;
end$$;

revoke execute on function public.create_game_from_import(uuid,jsonb,uuid,text,text,bigint,text,text,jsonb,jsonb) from public,anon;
revoke execute on function public.save_game_reimport(uuid,integer,jsonb,uuid,text,text,bigint,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.create_game_from_import(uuid,jsonb,uuid,text,text,bigint,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.save_game_reimport(uuid,integer,jsonb,uuid,text,text,bigint,text,text,jsonb,jsonb) to authenticated;
