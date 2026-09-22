-- Cambio: presence that means something, and invites that land you in a seat.
--
-- Presence was only ever written from a game page, so a friend sitting on the
-- home screen read as offline, and the heartbeat's own dependency churn could
-- blank a row seconds after it was set. A profile now checks in from wherever
-- it is: `code` null means online but idle, `code` set means at that table.
-- Anything older than PRESENCE_STALE is simply offline.
--
-- Invites gain a peek, so a client can look at one (is the table still there,
-- is there a seat) before committing to accepting it.

create index if not exists presence_updated_idx on public.presence (updated_at desc);

/* ---------------------------------------------------------------- */
/* Presence                                                          */
/* ---------------------------------------------------------------- */

-- One invite, if it is really yours and still open.
create or replace function public.invite_peek(p_secret text, p_me uuid, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.check_secret(p_secret);
  select jsonb_build_object('id', i.id, 'code', i.code, 'status', i.status,
                            'from', jsonb_build_object('id', o.id, 'handle', o.handle, 'display_name', o.display_name))
    into v
    from public.game_invites i join public.profiles o on o.id = i.from_id
   where i.id = p_id and i.to_id = p_me;
  return v;
end $$;

-- Where a profile is right now, for the guards around inviting.
create or replace function public.presence_of(p_secret text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.check_secret(p_secret);
  select jsonb_build_object(
           'code', case when pr.updated_at > now() - interval '75 seconds' then pr.code else null end,
           'online', pr.updated_at > now() - interval '75 seconds',
           'updated_at', pr.updated_at)
    into v from public.presence pr where pr.profile_id = p_id;
  return coalesce(v, jsonb_build_object('code', null, 'online', false, 'updated_at', null));
end $$;

/* ---------------------------------------------------------------- */
/* The one read a client makes                                       */
/* ---------------------------------------------------------------- */

-- As before, plus `online`: a friend with the app open but no table is not
-- playing, but they are certainly not offline either, and a green dot that
-- cannot tell the difference is just decoration.
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
    'sent', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code, 'at', i.created_at, 'to_id', i.to_id))
      from public.game_invites i
      where i.from_id = p_id and i.status = 'pending' and i.created_at > now() - interval '2 hours'
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
