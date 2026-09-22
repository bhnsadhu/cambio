-- A shared code is an invitation. Presence reveals only an opaque table id.
-- Approval creates an ordinary invite, so claiming a seat uses the same flow.
begin;

create table public.table_join_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  invite_id uuid references public.game_invites(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (from_id, to_id, game_id),
  check (from_id <> to_id)
);
alter table public.table_join_requests enable row level security;
revoke all on public.table_join_requests from anon, authenticated;
create index table_join_requests_to_idx on public.table_join_requests(to_id, status);

create function private.join_request_problem(p_from uuid, p_to uuid, p_game_id uuid)
returns text language plpgsql set search_path = '' as $$
declare g public.games; v_where text;
begin
  if not exists (select 1 from public.friendships where status = 'accepted'
    and ((requester_id = p_from and addressee_id = p_to) or (requester_id = p_to and addressee_id = p_from))) then
    return 'You can only ask a friend to join their table.';
  end if;
  select * into g from public.games where id = p_game_id for share;
  if not found then return 'That table is gone.'; end if;
  if not exists (select 1 from jsonb_array_elements(g.state->'players') p where p->>'profileId' = p_to::text) then
    return 'Your friend has left that table.';
  end if;
  if exists (select 1 from jsonb_array_elements(g.state->'players') p where p->>'profileId' = p_from::text) then
    return 'You are already at that table.';
  end if;
  if g.state->>'phase' <> 'lobby' then return 'That round has already started. Ask again between rounds.'; end if;
  if (select count(*) from jsonb_array_elements(g.state->'players') p where p->>'isBot' = 'false') >= 4 then
    return 'Every seat at that table is taken.';
  end if;
  select code into v_where from public.presence where profile_id = p_from and updated_at > now() - interval '75 seconds';
  if v_where is not null and v_where <> g.code then return 'Leave your current table before asking to join another.'; end if;
  return null;
end $$;

create function public.table_join_request_create(p_secret text, p_from uuid, p_to uuid, p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare problem text;
begin
  perform private.check_secret(p_secret);
  problem := private.join_request_problem(p_from, p_to, p_game_id);
  if problem is not null then return jsonb_build_object('ok', false, 'message', problem); end if;
  insert into public.table_join_requests(from_id, to_id, game_id) values (p_from, p_to, p_game_id)
  on conflict (from_id, to_id, game_id) do update set status = 'pending', created_at = now(), invite_id = null
    where table_join_requests.status <> 'pending' or table_join_requests.created_at < now() - interval '10 minutes';
  return jsonb_build_object('ok', true);
end $$;

create function public.table_join_request_respond(p_secret text, p_me uuid, p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.table_join_requests; problem text; v_code text; v_invite uuid;
begin
  perform private.check_secret(p_secret);
  select * into r from public.table_join_requests where id = p_id and to_id = p_me for update;
  if not found or r.created_at < now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'message', 'That request has expired.');
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'message', 'That request has already been answered.');
  end if;
  if p_accept then
    problem := private.join_request_problem(r.from_id, p_me, r.game_id);
    if problem is not null then return jsonb_build_object('ok', false, 'message', problem); end if;
    select code into v_code from public.games where id = r.game_id;
    v_invite := public.invite_create(p_secret, p_me, r.from_id, v_code);
  end if;
  update public.table_join_requests set status = case when p_accept then 'accepted' else 'declined' end,
    invite_id = v_invite where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

-- Keep the old RPC compatible while the new application is deploying.
create function public.social_snapshot_with_requests(p_secret text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; v_friends jsonb; v_requests jsonb; v_sent jsonb;
begin
  perform private.check_secret(p_secret);
  snapshot := public.social_snapshot(p_secret, p_id);
  select coalesce(jsonb_agg(f || jsonb_build_object('playing', case when g.id is not null then
    jsonb_build_object('table_id', g.id, 'phase', g.state->>'phase',
      'open_seats', case when g.state->>'phase' = 'lobby' then greatest(0, 4 - (
        select count(*) from jsonb_array_elements(g.state->'players') p where p->>'isBot' = 'false')) else 0 end,
      'together', exists(select 1 from jsonb_array_elements(g.state->'players') p where p->>'profileId' = p_id::text))
    else null end)), '[]'::jsonb) into v_friends
  from jsonb_array_elements(snapshot->'friends') f
  left join public.games g on g.code = f->'playing'->>'code'
    and exists(select 1 from jsonb_array_elements(g.state->'players') p where p->>'profileId' = f->>'id');

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'table_id', r.game_id, 'at', r.created_at,
    'from', jsonb_build_object('id', o.id, 'handle', o.handle, 'display_name', o.display_name))), '[]'::jsonb)
    into v_requests
  from public.table_join_requests r join public.profiles o on o.id = r.from_id
  where r.to_id = p_id and r.status = 'pending' and r.created_at > now() - interval '10 minutes'
    and private.join_request_problem(r.from_id, r.to_id, r.game_id) is null;

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'table_id', r.game_id, 'to_id', r.to_id, 'status', r.status)), '[]'::jsonb)
    into v_sent
  from public.table_join_requests r
  where r.from_id = p_id and r.status in ('pending', 'declined') and r.created_at > now() - interval '10 minutes'
    and private.join_request_problem(r.from_id, r.to_id, r.game_id) is null;

  snapshot := snapshot || jsonb_build_object('friends', v_friends, 'join_requests', v_requests, 'sent_join_requests', v_sent);
  snapshot := jsonb_set(snapshot, '{invites}', (select coalesce(jsonb_agg(i || jsonb_build_object('table_id', g.id, 'requested',
    exists(select 1 from public.table_join_requests r where r.invite_id = (i->>'id')::uuid))), '[]'::jsonb)
    from jsonb_array_elements(snapshot->'invites') i join public.games g on g.code = i->>'code'
    where exists(select 1 from jsonb_array_elements(g.state->'players') p where p->>'profileId' = i->'from'->>'id')));
  return snapshot;
end $$;

-- Expired invitations must not work through a saved notification either.
create or replace function public.invite_peek(p_secret text, p_me uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.check_secret(p_secret);
  select jsonb_build_object('id', i.id, 'code', i.code, 'status', i.status,
    'from', jsonb_build_object('id', o.id, 'handle', o.handle, 'display_name', o.display_name)) into v
  from public.game_invites i join public.profiles o on o.id = i.from_id
  where i.id = p_id and i.to_id = p_me and i.created_at > now() - interval '2 hours';
  return v;
end $$;

notify pgrst, 'reload schema';
commit;
