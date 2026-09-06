-- Registration must be checked independently of a former member's RLS view.
-- This private predicate exposes no records and accepts only the caller's own
-- upload prefix/owner. Storage metadata and file bytes are never modified here.
create or replace function private.can_cleanup_document_source(
  target_bucket text,target_path text,target_owner_id text
) returns boolean language sql stable security definer set search_path='' as $function$
  select coalesce(
    (select auth.uid()) is not null
    and target_owner_id=(select auth.uid())::text
    and split_part(target_path,'/',1)=(select auth.uid())::text
    and case target_bucket
      when 'game-import-documents' then not exists(
        select 1 from public.game_imports imported where imported.storage_path=target_path)
      when 'game-knowledge-documents' then not exists(
        select 1 from public.official_document_versions version where version.storage_path=target_path)
      else false end,
    false)
$function$;
revoke all on function private.can_cleanup_document_source(text,text,text) from public,anon,authenticated;
grant execute on function private.can_cleanup_document_source(text,text,text) to authenticated;

alter policy word_import_cleanup_unregistered on storage.objects using (
  bucket_id='game-import-documents'
  and private.can_cleanup_document_source(bucket_id,name,owner_id)
);
alter policy knowledge_cleanup_unregistered on storage.objects using (
  bucket_id='game-knowledge-documents'
  and private.can_cleanup_document_source(bucket_id,name,owner_id)
);

-- Storage removal requires SELECT as well as DELETE. Let the uploader clean up
-- an unsuccessful registration, without granting access to registered sources.
create policy knowledge_read_own_unregistered on storage.objects
  for select to authenticated using (
    bucket_id='game-knowledge-documents'
    and private.can_cleanup_document_source(bucket_id,name,owner_id)
  );
