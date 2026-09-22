-- Room preferences live in game state and change through the game reducer.
-- Both new requests and approval of pending requests respect this setting.
begin;

create or replace function private.join_request_problem(p_from uuid, p_to uuid, p_game_id uuid)
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
  if coalesce((g.state->>'doNotDisturb')::boolean, false) then
    return 'This table has Do not disturb on. Your friend can still invite you.';
  end if;
  if g.state->>'phase' <> 'lobby' then return 'That round has already started. Ask again between rounds.'; end if;
  if (select count(*) from jsonb_array_elements(g.state->'players') p where p->>'isBot' = 'false') >= 4 then
    return 'Every seat at that table is taken.';
  end if;
  select code into v_where from public.presence where profile_id = p_from and updated_at > now() - interval '75 seconds';
  if v_where is not null and v_where <> g.code then return 'Leave your current table before asking to join another.'; end if;
  return null;
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
  return snapshot;
end $$;
notify pgrst, 'reload schema';
commit;
