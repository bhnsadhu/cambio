-- Durable credentials are separate from public profiles. Only secret gated
-- RPCs can access credentials and sessions. Existing profiles can be claimed
-- by presenting their original browser token, without changing their IDs.
begin;

create table private.accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9]{3,18}$'),
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table private.account_sessions (
  token_hash text primary key,
  profile_id uuid not null references private.accounts(profile_id) on delete cascade,
  expires_at timestamptz not null default now() + interval '30 days'
);
create index account_sessions_profile_idx on private.account_sessions(profile_id);
create table private.auth_limits (
  key text primary key,
  attempts integer not null,
  reset_at timestamptz not null
);
revoke all on private.accounts, private.account_sessions, private.auth_limits from public, anon, authenticated;

-- Fail closed even when an installation has no configured server secret.
create or replace function private.check_secret(p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or not exists (
    select 1 from private.server_config where key = 'server_secret' and value = p_secret
  ) then raise exception 'unauthorized' using errcode = '42501'; end if;
end $$;

create or replace function public.account_rate_limit(p_secret text, p_key text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_attempts integer;
begin
  perform private.check_secret(p_secret);
  delete from private.auth_limits where reset_at < now() - interval '1 day';
  insert into private.auth_limits as l(key, attempts, reset_at)
    values (p_key, 1, now() + interval '15 minutes')
  on conflict (key) do update set
    attempts = case when l.reset_at <= now() then 1 else l.attempts + 1 end,
    reset_at = case when l.reset_at <= now() then now() + interval '15 minutes' else l.reset_at end
  returning attempts into v_attempts;
  return v_attempts <= p_limit;
end $$;

create or replace function public.account_register(
  p_secret text, p_username text, p_display_name text, p_handle text,
  p_password_hash text, p_session_hash text, p_legacy_hash text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_profile jsonb;
begin
  perform private.check_secret(p_secret);
  if p_legacy_hash is not null then
    select id into v_id from public.profiles where token_hash = p_legacy_hash for update;
    if v_id is null or exists (select 1 from private.accounts where profile_id = v_id) then
      raise exception 'legacy_expired';
    end if;
    update public.profiles set display_name = p_display_name where id = v_id;
  else
    v_profile := public.profile_create(p_secret, p_handle, p_display_name, p_session_hash);
    v_id := (v_profile->>'id')::uuid;
  end if;
  insert into private.accounts(profile_id, username, password_hash) values (v_id, p_username, p_password_hash);
  insert into private.account_sessions(token_hash, profile_id) values (p_session_hash, v_id);
  return jsonb_build_object('profile', private.profile_row(v_id), 'username', p_username);
end $$;

-- Credential hashes are returned only to the trusted server, never to a browser.
create or replace function public.account_credentials(p_secret text, p_username text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret);
  return (select to_jsonb(a) from private.accounts a where username = p_username);
end $$;

create or replace function public.account_session_create(
  p_secret text, p_id uuid, p_expected_hash text, p_session_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account private.accounts;
begin
  perform private.check_secret(p_secret);
  select * into v_account from private.accounts where profile_id = p_id for update;
  if v_account.profile_id is null or v_account.password_hash <> p_expected_hash then raise exception 'session_expired'; end if;
  delete from private.account_sessions where profile_id = p_id and expires_at <= now();
  insert into private.account_sessions(token_hash, profile_id) values (p_session_hash, p_id);
  return jsonb_build_object('profile', private.profile_row(p_id), 'username', v_account.username);
end $$;

create or replace function public.account_session(p_secret text, p_session_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret);
  return (select jsonb_build_object('profile', private.profile_row(a.profile_id),
      'username', a.username, 'password_hash', a.password_hash)
    from private.accounts a join private.account_sessions s on s.profile_id = a.profile_id
    where s.token_hash = p_session_hash and s.expires_at > now());
end $$;

create or replace function public.profile_by_token(p_secret text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.check_secret(p_secret);
  select profile_id into v_id from private.account_sessions where token_hash = p_token_hash and expires_at > now();
  if v_id is null then
    -- A claimed profile's old token can never authenticate it again.
    select p.id into v_id from public.profiles p where p.token_hash = p_token_hash
      and not exists (select 1 from private.accounts a where a.profile_id = p.id);
  end if;
  if v_id is null then return null; end if;
  update public.profiles set last_seen_at = now() where id = v_id;
  return private.profile_row(v_id);
end $$;

create or replace function public.account_logout(p_secret text, p_session_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.check_secret(p_secret);
  delete from private.account_sessions where token_hash = p_session_hash returning profile_id into v_id;
  if v_id is not null then delete from public.presence where profile_id = v_id; end if;
end $$;

create or replace function public.account_update(
  p_secret text, p_session_hash text, p_expected_hash text, p_display_name text,
  p_username text, p_password_hash text default null, p_next_session_hash text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_account private.accounts;
begin
  perform private.check_secret(p_secret);
  select profile_id into v_id from private.account_sessions where token_hash = p_session_hash and expires_at > now();
  select * into v_account from private.accounts where profile_id = v_id for update;
  -- Recheck the session after acquiring the account lock: a password change
  -- or deletion may have revoked it while this request waited.
  if v_account.profile_id is null or v_account.password_hash <> p_expected_hash or not exists (
    select 1 from private.account_sessions where token_hash = p_session_hash and expires_at > now()
  ) then raise exception 'session_expired'; end if;
  update private.accounts set username = p_username,
    password_hash = coalesce(p_password_hash, password_hash) where profile_id = v_id;
  update public.profiles set display_name = p_display_name where id = v_id;
  if p_password_hash is not null then
    if p_next_session_hash is null then raise exception 'session_expired'; end if;
    delete from private.account_sessions where profile_id = v_id;
    insert into private.account_sessions(token_hash, profile_id) values (p_next_session_hash, v_id);
  end if;
  return jsonb_build_object('profile', private.profile_row(v_id), 'username', p_username);
end $$;

create or replace function public.account_delete(p_secret text, p_session_hash text, p_expected_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_account private.accounts;
begin
  perform private.check_secret(p_secret);
  select profile_id into v_id from private.account_sessions where token_hash = p_session_hash and expires_at > now();
  select * into v_account from private.accounts where profile_id = v_id for update;
  if v_account.profile_id is null or v_account.password_hash <> p_expected_hash or not exists (
    select 1 from private.account_sessions where token_hash = p_session_hash and expires_at > now()
  ) then raise exception 'session_expired'; end if;
  -- Foreign keys cascade through credentials, sessions, friends, encounters,
  -- invites and presence. No account record remains available to restore.
  delete from public.profiles where id = v_id;
end $$;

create or replace function public.profile_games(p_secret text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret);
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'player_id', p->>'id'))
    from public.games g cross join lateral jsonb_array_elements(g.state->'players') p
    where p->>'profileId' = p_id::text), '[]'::jsonb);
end $$;

create or replace function public.profile_record_round(p_secret text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_id uuid; v_won boolean; opp uuid;
begin
  perform private.check_secret(p_secret);
  for r in select * from jsonb_array_elements(p_rows) loop
    v_id := (r->>'profile_id')::uuid;
    -- A deleted account can still occur in an active game's old snapshot.
    perform 1 from public.profiles where id = v_id for key share;
    if not found then continue; end if;
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
      perform 1 from public.profiles where id = opp for key share;
      if not found then continue; end if;
      insert into public.encounters(profile_id, opponent_id, rounds, wins, last_played_at)
      values (v_id, opp, 1, case when v_won then 1 else 0 end, now())
      on conflict (profile_id, opponent_id) do update
        set rounds = public.encounters.rounds + 1,
            wins = public.encounters.wins + (case when v_won then 1 else 0 end),
            last_played_at = now();
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
