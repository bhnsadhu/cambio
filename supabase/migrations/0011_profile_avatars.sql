-- Selected heads are a public profile preference; credentials still gate writes.
begin;
alter table public.profiles add column avatar_id integer check (avatar_id between 0 and 5);
-- private.profile_row already projects public columns (excluding token_hash),
-- so existing profiles keep null and the client retains their original head.

-- Replace the old signature to avoid ambiguous PostgREST overloads. The new
-- final parameter has a default, preserving existing clients during rollout.
drop function public.account_update(text, text, text, text, text, text, text);
create or replace function public.account_update(
  p_secret text, p_session_hash text, p_expected_hash text, p_display_name text,
  p_username text, p_password_hash text default null, p_next_session_hash text default null,
  p_avatar_id integer default null
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
  if p_avatar_id is not null and (p_avatar_id < 0 or p_avatar_id > 5) then
    raise exception 'invalid_avatar';
  end if;
  update private.accounts set username = coalesce(p_username, username),
    password_hash = coalesce(p_password_hash, password_hash) where profile_id = v_id;
  -- Omitted fields stay untouched, including when another tab saved them first.
  update public.profiles set display_name = coalesce(p_display_name, display_name),
    avatar_id = coalesce(p_avatar_id, avatar_id) where id = v_id;
  if p_password_hash is not null then
    if p_next_session_hash is null then raise exception 'session_expired'; end if;
    delete from private.account_sessions where profile_id = v_id;
    insert into private.account_sessions(token_hash, profile_id) values (p_next_session_hash, v_id);
  end if;
  return jsonb_build_object('profile', private.profile_row(v_id), 'username', (select username from private.accounts where profile_id = v_id));
end $$;

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
          'id', o.id, 'handle', o.handle, 'display_name', o.display_name, 'avatar_id', o.avatar_id,
          'points', o.points, 'rounds_won', o.rounds_won, 'rounds_played', o.rounds_played,
          'since', fr.responded_at,
          'online', coalesce(pr.updated_at > now() - interval '75 seconds', false),
          'last_seen_at', greatest(pr.updated_at, o.last_seen_at),
          'playing', case
            when pr.code is not null and pr.updated_at > now() - interval '75 seconds'
            then jsonb_build_object('code', pr.code, 'phase', pr.phase, 'open_seats', pr.open_seats)
            else null end,
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
      select jsonb_agg(jsonb_build_object('id', o.id, 'handle', o.handle, 'display_name', o.display_name, 'avatar_id', o.avatar_id, 'at', fr.created_at))
      from public.friendships fr join public.profiles o on o.id = fr.requester_id
      where fr.addressee_id = p_id and fr.status = 'pending'
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'handle', o.handle, 'display_name', o.display_name, 'avatar_id', o.avatar_id, 'at', fr.created_at))
      from public.friendships fr join public.profiles o on o.id = fr.addressee_id
      where fr.requester_id = p_id and fr.status = 'pending'
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code, 'at', i.created_at,
                                          'from', jsonb_build_object('id', o.id, 'handle', o.handle, 'display_name', o.display_name, 'avatar_id', o.avatar_id)))
      from public.game_invites i join public.profiles o on o.id = i.from_id
      where i.to_id = p_id and i.status = 'pending' and i.created_at > now() - interval '2 hours'
    ), '[]'::jsonb),
    'sent', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code, 'at', i.created_at, 'to_id', i.to_id))
      from public.game_invites i
      where i.from_id = p_id and i.status = 'pending' and i.created_at > now() - interval '2 hours'
    ), '[]'::jsonb),
    'opponents', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'handle', o.handle, 'display_name', o.display_name, 'avatar_id', o.avatar_id,
                                          'rounds', e.rounds, 'wins', e.wins, 'last_played_at', e.last_played_at)
                       order by e.last_played_at desc)
      from public.encounters e join public.profiles o on o.id = e.opponent_id
      where e.profile_id = p_id
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.social_snapshot_with_requests(p_secret text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  perform private.check_secret(p_secret);
  snapshot := public.social_snapshot_requests_v1(p_secret, p_id);
  snapshot := jsonb_set(snapshot, '{sent}', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'code', i.code, 'at', i.created_at, 'to_id', i.to_id)), '[]'::jsonb)
    from (select distinct on (code, to_id) * from public.game_invites where from_id = p_id
      and created_at > now() - interval '2 hours' order by code, to_id, created_at desc) i));
  snapshot := jsonb_set(snapshot, '{sent_join_requests}', (select coalesce(jsonb_agg(r || jsonb_build_object('at', stored.created_at)), '[]'::jsonb)
    from jsonb_array_elements(snapshot->'sent_join_requests') r join public.table_join_requests stored on stored.id = (r->>'id')::uuid));
  snapshot := jsonb_set(snapshot, '{friends}', (select coalesce(jsonb_agg(case
    when f->'playing' <> 'null'::jsonb then jsonb_set(f, '{playing,do_not_disturb}',
      to_jsonb(coalesce((g.state->>'doNotDisturb')::boolean, false))) else f end), '[]'::jsonb)
    from jsonb_array_elements(snapshot->'friends') f
    left join public.games g on g.id = (f->'playing'->>'table_id')::uuid));
  snapshot := jsonb_set(snapshot, '{join_requests}', (select coalesce(jsonb_agg(
    jsonb_set(r, '{from,avatar_id}', coalesce(to_jsonb(p.avatar_id), 'null'::jsonb))), '[]'::jsonb)
    from jsonb_array_elements(snapshot->'join_requests') r
    join public.profiles p on p.id = (r->'from'->>'id')::uuid));
  return snapshot;
end $$;

create or replace function public.leaderboard_snapshot(
  p_secret text, p_id uuid, p_scope text, p_offset integer default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.check_secret(p_secret);
  if p_scope is null or p_scope not in ('all', 'friends') or p_offset is null or p_offset < 0 then
    raise exception 'invalid_leaderboard_query';
  end if;
  if p_scope = 'friends' and not exists (select 1 from public.profiles where id = p_id) then
    raise exception 'profile_required';
  end if;
  with ranked as materialized (
    select p.id, p.handle, p.display_name as "displayName", p.avatar_id as "avatarId", p.points,
      p.rounds_won as "roundsWon", p.rounds_played as "roundsPlayed",
      rank() over (order by p.points desc) as rank
    from public.profiles p
    where p_scope = 'all' or p.id = p_id or exists (
      select 1 from public.friendships f where f.status = 'accepted' and
        ((f.requester_id = p_id and f.addressee_id = p.id) or
         (f.addressee_id = p_id and f.requester_id = p.id))
    )
  ), page as (
    select * from ranked order by points desc, handle, id limit 50 offset p_offset
  )
  select jsonb_build_object(
    'entries', (select coalesce(jsonb_agg(to_jsonb(p) order by p.points desc, p.handle, p.id), '[]'::jsonb) from page p),
    'me', (select to_jsonb(r) from ranked r where id = p_id),
    'total', (select count(*) from ranked),
    'offset', p_offset,
    'nextOffset', case when (select count(*) from ranked) > p_offset + 50 then p_offset + 50 else null end
  ) into result;
  return result;
end $$;
notify pgrst, 'reload schema';
commit;
