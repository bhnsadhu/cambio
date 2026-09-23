begin;

-- Realtime carries only an opaque invalidation key. Presence rows themselves
-- contain private join codes and must never be published to anonymous clients.
create table private.social_channels (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  channel_id uuid not null unique default gen_random_uuid()
);
revoke all on private.social_channels from public, anon, authenticated;
create table public.social_signals (
  channel_id uuid primary key references private.social_channels(channel_id) on delete cascade,
  revision bigint not null default 0
);
alter table public.social_signals enable row level security;
revoke all on public.social_signals from public, anon, authenticated;
grant select on public.social_signals to anon, authenticated;
create policy "opaque social invalidations are readable" on public.social_signals for select using (true);
alter publication supabase_realtime add table public.social_signals;

create function public.social_channel(p_secret text, p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_channel uuid;
begin
  perform private.check_secret(p_secret);
  insert into private.social_channels(profile_id) select id from public.profiles where id = p_id
    on conflict (profile_id) do nothing;
  select channel_id into v_channel from private.social_channels where profile_id = p_id;
  if v_channel is not null then
    insert into public.social_signals(channel_id) values (v_channel) on conflict do nothing;
  end if;
  return v_channel;
end $$;

create function private.signal_presence_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_channel uuid;
begin
  -- Fresh leases with an unchanged location need no immediate UI refresh.
  if tg_op = 'UPDATE' and old.code is not distinct from new.code
    and old.phase is not distinct from new.phase and old.open_seats = new.open_seats
    and old.updated_at > now() - interval '75 seconds' then return new; end if;
  v_id := case when tg_op = 'DELETE' then old.profile_id else new.profile_id end;
  -- Stable lock order prevents simultaneous friends' heartbeats deadlocking.
  for v_channel in
    select c.channel_id from private.social_channels c where c.profile_id = v_id or exists (
      select 1 from public.friendships f where f.status = 'accepted' and
        ((f.requester_id = v_id and f.addressee_id = c.profile_id) or
         (f.addressee_id = v_id and f.requester_id = c.profile_id))) order by c.channel_id
  loop
    update public.social_signals set revision = revision + 1 where channel_id = v_channel;
  end loop;
  return null;
end $$;
revoke all on function private.signal_presence_change() from public, anon, authenticated;
create trigger presence_changed after insert or update or delete on public.presence
  for each row execute function private.signal_presence_change();

-- Having an account or authenticating an API request does not mean a browser
-- document is open. Only the document lease may bring a profile online.
create or replace function public.profile_create(p_secret text, p_handle text, p_display_name text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_handle text; v_try integer := 0;
begin
  perform private.check_secret(p_secret);
  v_handle := p_handle;
  loop
    begin
      insert into public.profiles(handle, display_name, token_hash)
        values (v_handle, p_display_name, p_token_hash) returning id into v_id;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 40 then raise exception 'handle_taken'; end if;
      v_handle := p_handle || v_try::text;
    end;
  end loop;
  return private.profile_row(v_id);
end $$;

create or replace function public.account_register(
  p_secret text, p_username text, p_display_name text, p_handle text,
  p_password_hash text, p_session_hash text, p_legacy_hash text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.check_secret(p_secret);
  if p_legacy_hash is not null then
    select id into v_id from public.profiles where token_hash = p_legacy_hash for update;
    if v_id is null or exists (select 1 from private.accounts where profile_id = v_id) then raise exception 'legacy_expired'; end if;
    update public.profiles set display_name = p_display_name where id = v_id;
  else
    insert into public.profiles(handle, display_name, token_hash)
      values (p_username, p_display_name, p_session_hash) returning id into v_id;
  end if;
  insert into private.accounts(profile_id, username, password_hash) values (v_id, p_username, p_password_hash);
  insert into private.account_sessions(token_hash, profile_id) values (p_session_hash, v_id);
  return jsonb_build_object('profile', private.profile_row(v_id), 'username', p_username);
end $$;

delete from public.presence p where not exists (
  select 1 from private.presence_tabs t where t.profile_id = p.profile_id and t.online
    and t.updated_at > now() - interval '75 seconds' and (t.session_hash is null or exists (
      select 1 from private.account_sessions s where s.token_hash = t.session_hash
        and s.profile_id = p.profile_id and s.expires_at > now())));

notify pgrst, 'reload schema';
commit;
