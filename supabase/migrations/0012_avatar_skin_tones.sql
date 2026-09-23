-- Each tone uses the same six styles. Existing ids 0..5 remain the default
-- artwork; additional tones occupy ids 6..35 without rewriting any profiles.
begin;
alter table public.profiles drop constraint profiles_avatar_id_check;
alter table public.profiles add constraint profiles_avatar_id_check check (avatar_id between 0 and 35);

-- Keep the existing signature and all session/password safeguards intact.
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
  if p_avatar_id is not null and (p_avatar_id < 0 or p_avatar_id > 35) then
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
notify pgrst, 'reload schema';
commit;
