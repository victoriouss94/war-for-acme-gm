// Local-only PostgreSQL/RLS characterization. No external requests or production writes.
const {PGlite}=await import(process.env.PGLITE_MODULE_URL || '@electric-sql/pglite');
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),db=new PGlite();
const read=path=>readFile(new URL(path,root),'utf8');
const slice=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
try{
  const original=await read('supabase/migrations/20260812020135_consolidated_ai_gm_resolution_learning.sql');
  const global=await read('supabase/migrations/20260812024815_global_master_gm_ai.sql');
  const accounts=await read('supabase/migrations/20260808193900_username_password_accounts.sql');
  const initial=await read('supabase/migrations/202608080001_shared_game_documents.sql');
  await db.exec(`
    create role anon;create role authenticated;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key,legacy_account boolean not null default false);
    create table public.games(id uuid primary key,owner_id uuid not null,name text not null);
    create table public.game_members(game_id uuid,user_id uuid,member_role text,primary key(game_id,user_id));
    create table public.resolution_sessions(id uuid primary key);
  `);
  await db.exec(slice(accounts,'create or replace function public.is_permanent_account()','create or replace function public.is_game_owner('));
  await db.exec(slice(original,'create table public.gm_precedents (','alter table public.resolution_sessions\n  add constraint resolution_sessions_precedent_fkey'));
  await db.exec(slice(global,'alter table public.gm_precedents drop constraint','alter table public.resolution_sessions\n  add column teach_scope'));
  await db.exec(`
    alter table public.games enable row level security;
    alter table public.game_members enable row level security;
    alter table public.gm_precedents enable row level security;
    grant usage on schema public,auth to authenticated;
    grant select on public.games,public.game_members,public.gm_precedents,public.profiles to authenticated;
  `);
  for(const name of ['games_read_member','members_read_member']){
    const policy=initial.match(new RegExp('create policy '+name+'[^;]+;'));assert.ok(policy);await db.exec(policy[0]);
  }
  await db.exec(slice(global,'create policy gm_precedents_read_gm','drop policy official_documents_read'));
  await db.exec(slice(global,'create function public.search_gm_precedents(','drop function public.get_ai_learning_summary'));
  await db.exec('revoke execute on function public.search_gm_precedents(uuid,text[],text,integer) from public,anon; grant execute on function public.search_gm_precedents(uuid,text[],text,integer) to authenticated;');
  if(!process.argv.includes('--baseline')) await db.exec(await read('supabase/migrations/20260915135934_invited_gm_global_precedent_access.sql'));
  const results=await db.exec(await read('tests/precedent-retrieval-isolation.sql'));
  for(const result of results)for(const row of result.rows||[])if(row.audit_result)console.log(JSON.stringify(row.audit_result));
  assert.equal((await db.query('select count(*)::integer n from public.games')).rows[0].n,0);
  console.log(JSON.stringify({rollbackVerified:true,productionWrites:0,scope:'Real search function and policies; synthetic local auth/membership fixture, not fresh JWT or concurrency testing.'}));
}catch(error){console.error(JSON.stringify({message:error.message,code:error.code,detail:error.detail}));process.exitCode=1;}finally{await db.close();}
