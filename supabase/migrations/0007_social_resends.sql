begin;

-- Serialize sends for a pair and table. A resend gets a fresh notification id.
create or replace function public.invite_create(p_secret text, p_from uuid, p_to uuid, p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.check_secret(p_secret);
  perform pg_advisory_xact_lock(hashtextextended(p_from::text || p_to::text || p_code, 0));
  select id into v_id from public.game_invites where from_id = p_from and to_id = p_to and code = p_code
    and status = 'pending' and created_at > now() - interval '1 minute' order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  update public.game_invites set status = 'declined', responded_at = now()
    where from_id = p_from and to_id = p_to and code = p_code and status = 'pending';
  insert into public.game_invites(from_id, to_id, code) values (p_from, p_to, p_code) returning id into v_id;
  return v_id;
end $$;

create function public.invite_send(p_secret text, p_from uuid, p_to uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret);
  perform pg_advisory_xact_lock(hashtextextended(p_from::text || p_to::text || p_code, 0));
  if exists(select 1 from public.game_invites where from_id = p_from and to_id = p_to and code = p_code
      and created_at > now() - interval '1 minute') then
    return jsonb_build_object('ok', false, 'reason', 'cooldown', 'message', 'Wait one minute before inviting again.');
  end if;
  perform public.invite_create(p_secret, p_from, p_to, p_code);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.table_join_request_create(p_secret text, p_from uuid, p_to uuid, p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare problem text;
begin
  perform private.check_secret(p_secret);
  problem := private.join_request_problem(p_from, p_to, p_game_id);
  if problem is not null then return jsonb_build_object('ok', false, 'message', problem); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_from::text || p_to::text || p_game_id::text, 0));
  if exists(select 1 from public.table_join_requests where from_id = p_from and to_id = p_to and game_id = p_game_id
      and created_at > now() - interval '1 minute') then
    return jsonb_build_object('ok', false, 'message', 'Wait one minute before asking again.');
  end if;
  insert into public.table_join_requests(from_id, to_id, game_id) values (p_from, p_to, p_game_id)
  on conflict (from_id, to_id, game_id) do update set id = gen_random_uuid(), status = 'pending', created_at = now(), invite_id = null;
  return jsonb_build_object('ok', true);
end $$;

-- Add the latest sent timestamp even after a decline, so the cooldown survives
-- refreshes and is the same on every device. The original snapshot stays usable.
alter function public.social_snapshot_with_requests(text, uuid) rename to social_snapshot_requests_v1;
create function public.social_snapshot_with_requests(p_secret text, p_id uuid)
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
  return snapshot;
end $$;
notify pgrst, 'reload schema';
commit;
