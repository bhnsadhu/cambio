begin;

-- Each open document owns a lease. Closing one must not disconnect the others.
create table private.presence_tabs (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tab_id uuid not null,
  sequence bigint not null,
  online boolean not null,
  session_hash text,
  code text,
  phase text,
  open_seats integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (profile_id, tab_id)
);

create function private.refresh_presence(p_id uuid)
returns void language plpgsql set search_path = '' as $$
declare v record;
begin
  select t.*, max(t.updated_at) over () as latest_at into v from private.presence_tabs t
  where t.profile_id = p_id and t.online and t.updated_at > now() - interval '75 seconds'
    and (t.session_hash is null or exists (
      select 1 from private.account_sessions s
      where s.token_hash = t.session_hash and s.profile_id = p_id and s.expires_at > now()
    ))
  order by (t.code is not null) desc, t.updated_at desc limit 1;
  if found then
    insert into public.presence(profile_id, code, phase, open_seats, updated_at)
    values (p_id, v.code, v.phase, v.open_seats, v.latest_at)
    on conflict (profile_id) do update set code = excluded.code, phase = excluded.phase,
      open_seats = excluded.open_seats, updated_at = excluded.updated_at;
  else
    delete from public.presence where profile_id = p_id;
  end if;
end $$;

create function public.presence_tab_set(
  p_secret text, p_id uuid, p_tab_id uuid, p_sequence bigint, p_online boolean,
  p_session_hash text, p_code text, p_phase text, p_open_seats integer
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret);
  -- Serialize all tabs for a profile, including logout and concurrent beacons.
  perform 1 from public.profiles where id = p_id for update;
  if not found then return; end if;
  if p_session_hash is not null and not exists (
    select 1 from private.account_sessions where token_hash = p_session_hash
      and profile_id = p_id and expires_at > now()
  ) then return; end if;
  -- Retain departure tombstones so a late heartbeat cannot undo a close.
  delete from private.presence_tabs where profile_id = p_id and updated_at < now() - interval '1 day';
  insert into private.presence_tabs(profile_id, tab_id, sequence, online, session_hash, code, phase, open_seats)
  values (p_id, p_tab_id, p_sequence, p_online, p_session_hash, p_code, p_phase, p_open_seats)
  on conflict (profile_id, tab_id) do update set sequence = excluded.sequence,
    online = excluded.online, session_hash = excluded.session_hash, code = excluded.code,
    phase = excluded.phase, open_seats = excluded.open_seats, updated_at = now()
  where private.presence_tabs.sequence < excluded.sequence;
  perform private.refresh_presence(p_id);
end $$;

create or replace function public.account_logout(p_secret text, p_session_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.check_secret(p_secret);
  select profile_id into v_id from private.account_sessions where token_hash = p_session_hash;
  if v_id is null then return; end if;
  perform 1 from public.profiles where id = v_id for update;
  delete from private.account_sessions where token_hash = p_session_hash;
  delete from private.presence_tabs where profile_id = v_id and session_hash = p_session_hash;
  perform private.refresh_presence(v_id);
end $$;

notify pgrst, 'reload schema';
commit;
