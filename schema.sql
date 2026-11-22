begin;
create table if not exists public.saved_games (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check (char_length(name) between 1 and 200),
 game_version text not null,
 schema_version integer not null default 1 check (schema_version = 1),
 turn_number integer not null check (turn_number >= 0),
 state jsonb not null check (jsonb_typeof(state) = 'object'),
 created_at timestamptz not null default now()
);
-- Old snapshots retain a NULL slot and stay accessible under their original owner.
alter table public.saved_games add column if not exists slot smallint check (slot between 0 and 5);
alter table public.saved_games add column if not exists revision uuid not null default gen_random_uuid();
create unique index if not exists saved_games_owner_slot on public.saved_games(user_id, slot);
create index if not exists saved_games_owner_date on public.saved_games(user_id, created_at desc);
alter table public.saved_games enable row level security;
revoke all on public.saved_games from anon;
revoke all on public.saved_games from authenticated;
grant select, insert, update, delete on public.saved_games to authenticated;
drop policy if exists own_saves_read on public.saved_games;
create policy own_saves_read on public.saved_games for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists own_saves_insert on public.saved_games;
create policy own_saves_insert on public.saved_games for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists own_saves_delete on public.saved_games;
create policy own_saves_delete on public.saved_games for delete to authenticated using ((select auth.uid()) = user_id);
drop policy if exists own_saves_update on public.saved_games;
create policy own_saves_update on public.saved_games for update to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
notify pgrst, 'reload schema';
commit;
