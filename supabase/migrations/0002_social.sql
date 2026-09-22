-- Cambio: profiles, friends, invites and presence.
--
-- Identity without accounts, in the same shape as a seat at a table: the
-- browser holds a secret token, the server holds its hash, and every read or
-- write goes through a SECURITY DEFINER RPC gated by the shared server
-- secret. No client ever touches these tables directly.
--
--   profiles     lifetime stats for one player, addressed by @handle
--   friendships  one row per relationship, pending until it is accepted
--   encounters   who has played whom, so a friend can be known as an opponent
--   game_invites a friend asked to a specific table
--   presence     where a profile is playing right now, refreshed by its client

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  display_name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_played_at timestamptz,
  -- Lifetime record. A "game" is one scored round; a table is a sitting.
  rounds_played integer not null default 0,
  rounds_won integer not null default 0,
  tables_played integer not null default 0,
  score_total integer not null default 0,
  best_score integer,
  cambio_calls integer not null default 0,
  cambio_wins integer not null default 0,
  sticks_hit integer not null default 0,
  sticks_missed integer not null default 0,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  -- What the ladder is ordered by. A win is worth four turns at the table,
  -- and calling Cambio and making it stick is worth more again.
  points integer generated always as (
    rounds_won * 12 + (rounds_played - rounds_won) * 3 + cambio_wins * 5
  ) stored
);
create index profiles_points_idx on public.profiles (points desc);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;

create table public.friendships (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, addressee_id),
  constraint friendship_not_self check (requester_id <> addressee_id)
);
create index friendships_addressee_idx on public.friendships (addressee_id);
alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;

create table public.encounters (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  opponent_id uuid not null references public.profiles(id) on delete cascade,
  rounds integer not null default 0,
  wins integer not null default 0,
  last_played_at timestamptz not null default now(),
  primary key (profile_id, opponent_id)
);
alter table public.encounters enable row level security;
revoke all on public.encounters from anon, authenticated;

create table public.game_invites (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create index game_invites_to_idx on public.game_invites (to_id, status, created_at desc);
alter table public.game_invites enable row level security;
revoke all on public.game_invites from anon, authenticated;

create table public.presence (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  code text,
  phase text,
  open_seats integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.presence enable row level security;
revoke all on public.presence from anon, authenticated;

/* ---------------------------------------------------------------- */
/* Profiles                                                          */
/* ---------------------------------------------------------------- */

-- Kept in `private` so it is not reachable by the anon key: every public
-- entry point below checks the server secret first.
create or replace function private.profile_row(p_id uuid)
returns jsonb
language sql security definer set search_path = '' stable as $$
  select to_jsonb(p) - 'token_hash'
    || jsonb_build_object('rank', (select count(*) + 1 from public.profiles o where o.points > p.points))
    || jsonb_build_object('total_players', (select count(*) from public.profiles))
  from public.profiles p where p.id = p_id;
$$;

create or replace function public.profile_create(p_secret text, p_handle text, p_display_name text, p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_handle text; v_try integer := 0;
begin
  perform private.check_secret(p_secret);
  v_handle := p_handle;
  -- A handle is how friends find each other, so it has to be unique but
  -- should never be a form to fill in: the first free variant wins.
  loop
    begin
      insert into public.profiles(handle, display_name, token_hash)
      values (v_handle, p_display_name, p_token_hash)
      returning id into v_id;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 40 then raise exception 'handle_taken'; end if;
      v_handle := p_handle || v_try::text;
    end;
  end loop;
  insert into public.presence(profile_id) values (v_id);
  return private.profile_row(v_id);
end $$;

create or replace function public.profile_by_token(p_secret text, p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.check_secret(p_secret);
  update public.profiles set last_seen_at = now() where token_hash = p_token_hash returning id into v_id;
  if v_id is null then return null; end if;
  return private.profile_row(v_id);
end $$;

create or replace function public.profile_by_handle(p_secret text, p_handle text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.check_secret(p_secret);
  select id into v_id from public.profiles where handle = lower(p_handle);
  if v_id is null then return null; end if;
  return private.profile_row(v_id);
end $$;

create or replace function public.profile_rename(p_secret text, p_id uuid, p_display_name text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret);
  update public.profiles set display_name = p_display_name where id = p_id;
  return private.profile_row(p_id);
end $$;

/* ---------------------------------------------------------------- */
/* Recording a round                                                 */
/* ---------------------------------------------------------------- */

-- One scored round for every seated profile at the table, applied together.
-- Each element: {profile_id, won, score, sticks, misses, called, first_round,
--                opponents: [profile_id, ...]}
create or replace function public.profile_record_round(p_secret text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_id uuid; v_won boolean; opp uuid;
begin
  perform private.check_secret(p_secret);
  for r in select * from jsonb_array_elements(p_rows) loop
    v_id := (r->>'profile_id')::uuid;
    v_won := coalesce((r->>'won')::boolean, false);
    update public.profiles set
      rounds_played = rounds_played + 1,
      rounds_won = rounds_won + (case when v_won then 1 else 0 end),
      tables_played = tables_played + (case when coalesce((r->>'first_round')::boolean, false) then 1 else 0 end),
      score_total = score_total + coalesce((r->>'score')::integer, 0),
      best_score = least(coalesce(best_score, 999), coalesce((r->>'score')::integer, 999)),
      cambio_calls = cambio_calls + (case when coalesce((r->>'called')::boolean, false) then 1 else 0 end),
      cambio_wins = cambio_wins + (case when coalesce((r->>'called')::boolean, false) and v_won then 1 else 0 end),
      sticks_hit = sticks_hit + coalesce((r->>'sticks')::integer, 0),
      sticks_missed = sticks_missed + coalesce((r->>'misses')::integer, 0),
      current_streak = case when v_won then current_streak + 1 else 0 end,
      best_streak = greatest(best_streak, case when v_won then current_streak + 1 else 0 end),
      last_played_at = now()
    where id = v_id;

    for opp in select (jsonb_array_elements_text(coalesce(r->'opponents', '[]'::jsonb)))::uuid loop
      insert into public.encounters(profile_id, opponent_id, rounds, wins, last_played_at)
      values (v_id, opp, 1, case when v_won then 1 else 0 end, now())
      on conflict (profile_id, opponent_id) do update
        set rounds = public.encounters.rounds + 1,
            wins = public.encounters.wins + (case when v_won then 1 else 0 end),
            last_played_at = now();
    end loop;
  end loop;
end $$;

/* ---------------------------------------------------------------- */
/* Friends                                                           */
/* ---------------------------------------------------------------- */

create or replace function public.friend_request(p_secret text, p_from uuid, p_to uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  perform private.check_secret(p_secret);
  if p_from = p_to then return 'self'; end if;
  -- Already friends, or already asked, in either direction.
  select status into v_status from public.friendships
   where (requester_id = p_from and addressee_id = p_to) or (requester_id = p_to and addressee_id = p_from);
  if v_status = 'accepted' then return 'friends'; end if;
  if v_status = 'pending' then
    -- They asked first: asking back accepts it.
    if exists (select 1 from public.friendships where requester_id = p_to and addressee_id = p_from and status = 'pending') then
      update public.friendships set status = 'accepted', responded_at = now()
       where requester_id = p_to and addressee_id = p_from;
      return 'accepted';
    end if;
    return 'pending';
  end if;
  insert into public.friendships(requester_id, addressee_id, status) values (p_from, p_to, 'pending');
  return 'sent';
end $$;

create or replace function public.friend_respond(p_secret text, p_me uuid, p_other uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret);
  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now()
     where requester_id = p_other and addressee_id = p_me and status = 'pending';
    if not found then return 'missing'; end if;
    return 'accepted';
  end if;
  delete from public.friendships where requester_id = p_other and addressee_id = p_me and status = 'pending';
  return 'declined';
end $$;

create or replace function public.friend_remove(p_secret text, p_me uuid, p_other uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret);
  delete from public.friendships
   where (requester_id = p_me and addressee_id = p_other) or (requester_id = p_other and addressee_id = p_me);
end $$;

/* ---------------------------------------------------------------- */
/* Invites and presence                                              */
/* ---------------------------------------------------------------- */

create or replace function public.invite_create(p_secret text, p_from uuid, p_to uuid, p_code text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.check_secret(p_secret);
  -- One open invite per friend per table.
  update public.game_invites set created_at = now()
   where from_id = p_from and to_id = p_to and code = p_code and status = 'pending'
   returning id into v_id;
  if v_id is not null then return v_id; end if;
  insert into public.game_invites(from_id, to_id, code) values (p_from, p_to, p_code) returning id into v_id;
  return v_id;
end $$;

create or replace function public.invite_respond(p_secret text, p_me uuid, p_id uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  perform private.check_secret(p_secret);
  update public.game_invites
     set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
   where id = p_id and to_id = p_me and status = 'pending'
   returning code into v_code;
  return v_code;
end $$;

create or replace function public.presence_set(p_secret text, p_id uuid, p_code text, p_phase text, p_open_seats integer)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret);
  insert into public.presence(profile_id, code, phase, open_seats, updated_at)
  values (p_id, p_code, p_phase, coalesce(p_open_seats, 0), now())
  on conflict (profile_id) do update
    set code = excluded.code, phase = excluded.phase, open_seats = excluded.open_seats, updated_at = now();
end $$;

/* ---------------------------------------------------------------- */
/* Everything one client needs, in one read                          */
/* ---------------------------------------------------------------- */

-- A friend counts as "playing now" while their client has checked in within
-- the last two minutes; anything older is a tab that was closed.
create or replace function public.social_snapshot(p_secret text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.check_secret(p_secret);
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(f order by f->>'display_name')
      from (
        select jsonb_build_object(
          'id', o.id, 'handle', o.handle, 'display_name', o.display_name,
          'points', o.points, 'rounds_won', o.rounds_won, 'rounds_played', o.rounds_played,
          'since', fr.responded_at,
          'playing', case
            when pr.code is not null and pr.updated_at > now() - interval '2 minutes'
            then jsonb_build_object('code', pr.code, 'phase', pr.phase, 'open_seats', pr.open_seats)
            else null end,
          -- The head to head: rounds at the same table, and who took them.
          -- Neither of you winning a round counts for neither of you.
          'played_together', coalesce(e.rounds, 0),
          'your_wins', coalesce(e.wins, 0),
          'their_wins', coalesce(e2.wins, 0)
        ) as f
        from public.friendships fr
        join public.profiles o
          on o.id = case when fr.requester_id = p_id then fr.addressee_id else fr.requester_id end
        left join public.presence pr on pr.profile_id = o.id
        left join public.encounters e on e.profile_id = p_id and e.opponent_id = o.id
        left join public.encounters e2 on e2.profile_id = o.id and e2.opponent_id = p_id
        where fr.status = 'accepted' and (fr.requester_id = p_id or fr.addressee_id = p_id)
      ) s
    ), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'handle', o.handle, 'display_name', o.display_name, 'at', fr.created_at))
      from public.friendships fr join public.profiles o on o.id = fr.requester_id
      where fr.addressee_id = p_id and fr.status = 'pending'
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'handle', o.handle, 'display_name', o.display_name, 'at', fr.created_at))
      from public.friendships fr join public.profiles o on o.id = fr.addressee_id
      where fr.requester_id = p_id and fr.status = 'pending'
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code, 'at', i.created_at,
                                          'from', jsonb_build_object('id', o.id, 'handle', o.handle, 'display_name', o.display_name)))
      from public.game_invites i join public.profiles o on o.id = i.from_id
      where i.to_id = p_id and i.status = 'pending' and i.created_at > now() - interval '2 hours'
    ), '[]'::jsonb),
    'opponents', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'handle', o.handle, 'display_name', o.display_name,
                                          'rounds', e.rounds, 'wins', e.wins, 'last_played_at', e.last_played_at)
                       order by e.last_played_at desc)
      from public.encounters e join public.profiles o on o.id = e.opponent_id
      where e.profile_id = p_id
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
