-- Cambio: server-authoritative game state with a public realtime projection.
--
-- games       : the secret state (card identities). Never readable by clients.
-- game_views  : the redacted public projection, broadcast via Realtime.
-- private.*   : server-only config; the Next.js server proves itself with a
--               shared secret checked inside SECURITY DEFINER functions.
--
-- After applying: insert the server secret —
--   insert into private.server_config(key, value) values ('server_secret', '<hex>');

create schema if not exists private;

create table private.server_config (
  key text primary key,
  value text not null
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  version integer not null default 1,
  state jsonb not null,
  bot_lock_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.games enable row level security;
revoke all on public.games from anon, authenticated;

create table public.game_views (
  game_id uuid primary key references public.games(id) on delete cascade,
  code text not null unique,
  version integer not null,
  view jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.game_views enable row level security;
create policy "game views are public" on public.game_views for select using (true);
alter table public.game_views replica identity full;
alter publication supabase_realtime add table public.game_views;

create or replace function private.check_secret(p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or p_secret <> (select value from private.server_config where key = 'server_secret') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
end $$;

create or replace function public.game_create(p_secret text, p_code text, p_state jsonb, p_view jsonb)
returns table(id uuid, version integer)
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.check_secret(p_secret);
  insert into public.games(code, state) values (p_code, p_state) returning games.id into v_id;
  insert into public.game_views(game_id, code, version, view) values (v_id, p_code, 1, p_view);
  return query select v_id, 1;
end $$;

create or replace function public.game_load(p_secret text, p_code text default null, p_id uuid default null)
returns table(id uuid, code text, version integer, state jsonb, bot_lock_until timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret);
  return query
    select g.id, g.code, g.version, g.state, g.bot_lock_until
    from public.games g
    where (p_id is not null and g.id = p_id) or (p_id is null and g.code = p_code);
end $$;

-- Compare-and-swap commit: applies only if the caller saw the latest version.
create or replace function public.game_commit(p_secret text, p_id uuid, p_expected_version integer, p_state jsonb, p_view jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_new integer;
begin
  perform private.check_secret(p_secret);
  update public.games
     set state = p_state, version = games.version + 1, updated_at = now()
   where games.id = p_id and games.version = p_expected_version
   returning games.version into v_new;
  if v_new is null then return null; end if;
  update public.game_views set view = p_view, version = v_new, updated_at = now() where game_id = p_id;
  return v_new;
end $$;

-- Bot runner lease so only one server invocation drives the bots at a time.
create or replace function public.game_bot_lease(p_secret text, p_id uuid, p_seconds integer, p_renew boolean default false)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  perform private.check_secret(p_secret);
  update public.games
     set bot_lock_until = now() + make_interval(secs => p_seconds)
   where games.id = p_id and (p_renew or games.bot_lock_until is null or games.bot_lock_until < now())
   returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

create or replace function public.game_bot_release(p_secret text, p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret);
  update public.games set bot_lock_until = null where games.id = p_id;
end $$;
