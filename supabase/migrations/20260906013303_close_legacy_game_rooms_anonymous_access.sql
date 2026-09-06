-- The current application uses games/game_documents, not this legacy room table.
-- Preserve legacy records for recovery while closing unrestricted browser access.
do $migration$
begin
  if to_regclass('public.game_rooms') is not null then
    revoke all privileges on table public.game_rooms from public, anon, authenticated;
    drop policy if exists "Allow GMs to create game rooms" on public.game_rooms;
    drop policy if exists "Allow GMs to read game rooms" on public.game_rooms;
    drop policy if exists "Allow GMs to update game rooms" on public.game_rooms;
  end if;
end
$migration$;
