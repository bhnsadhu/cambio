-- Run with psql after migrations. All fixtures are rolled back.
begin;
insert into private.server_config(key, value) values ('server_secret', 'account-test-secret')
  on conflict (key) do update set value = excluded.value;
do $$
declare
  a jsonb; b jsonb; p jsonb; id_a uuid; id_b uuid; denied boolean := false;
begin
  p := public.profile_create('account-test-secret', 'original', 'Original Name', 'legacy-token');
  id_a := (p->>'id')::uuid;
  update public.profiles set rounds_played = 7, rounds_won = 3 where id = id_a;
  b := public.account_register('account-test-secret', 'friendlogin', 'Friend Name', 'friend', 'hash-b', 'session-b');
  id_b := (b->'profile'->>'id')::uuid;
  assert b->'profile'->>'handle' = 'friendlogin', 'Registration must use the username for public lookup';
  perform public.friend_request('account-test-secret', id_a, id_b);
  perform public.friend_respond('account-test-secret', id_b, id_a, true);
  a := public.account_register('account-test-secret', 'mylogin', 'Display Name', 'display', 'hash-a', 'session-a', 'legacy-token');
  assert (a->'profile'->>'id')::uuid = id_a, 'Upgrade must keep profile identity';
  assert a->'profile'->>'handle' = 'mylogin', 'Upgrade must replace the generated public name with the username';
  assert public.profile_by_handle('account-test-secret', 'mylogin')->>'id' = id_a::text;
  assert public.profile_by_handle('account-test-secret', 'original') is null;
  assert a->'profile'->>'rounds_won' = '3', 'Upgrade must preserve stats';
  assert jsonb_array_length(public.social_snapshot('account-test-secret', id_a)->'friends') = 1, 'Upgrade must preserve friends';
  assert public.profile_by_token('account-test-secret', 'legacy-token') is null, 'Claimed legacy token must stop working';
  assert public.profile_by_token('account-test-secret', 'session-a')->>'display_name' = 'Display Name';
  assert not (a->'profile' ? 'password_hash') and not (a->'profile' ? 'token_hash'), 'Public profile must not expose credentials';

  -- Avatar writes use the account session, preserve unrelated data, and are
  -- visible to every public identity projection without exposing credentials.
  a := public.account_update('account-test-secret', 'session-a', 'hash-a', null, null, null, null, 5);
  assert a->'profile'->>'avatar_id' = '5';
  assert a->>'username' = 'mylogin' and a->'profile'->>'display_name' = 'Display Name';
  assert public.account_session('account-test-secret', 'session-a')->'profile'->>'avatar_id' = '5';
  assert public.profile_by_handle('account-test-secret', 'mylogin')->>'avatar_id' = '5';
  assert public.social_snapshot_with_requests('account-test-secret', id_b)->'friends'->0->>'avatar_id' = '5';
  assert public.leaderboard_snapshot('account-test-secret', id_a, 'all')->'me'->>'avatarId' = '5';
  assert public.leaderboard_snapshot('account-test-secret', id_a, 'friends')->'me'->>'avatarId' = '5';
  assert public.account_session('account-test-secret', 'session-b')->'profile'->'avatar_id' = 'null'::jsonb, 'One account must not change another head';
  denied := false;
  begin
    perform public.account_update('account-test-secret', 'session-a', 'hash-a', null, null, null, null, 6);
  exception when others then denied := true;
  end;
  assert denied, 'Invalid head indices must fail at the database boundary';
  denied := false;
  begin
    perform public.account_update('account-test-secret', 'not-a-session', 'hash-a', null, null, null, null, 1);
  exception when others then denied := true;
  end;
  assert denied, 'An avatar change must require a live session';
  a := public.account_update('account-test-secret', 'session-a', 'hash-a', null, null, null, null, 0);
  assert a->'profile'->>'avatar_id' = '0', 'The first head must be selectable';
  denied := false;

  begin
    perform public.account_register('account-test-secret', 'mylogin', 'Duplicate', 'duplicate', 'hash-x', 'session-x');
  exception when unique_violation then denied := true;
  end;
  assert denied, 'Duplicate username must be rejected';
  assert not exists (select 1 from public.profiles where display_name = 'Duplicate'), 'Failed registration must be atomic';

  perform public.profile_create('account-test-secret', 'reservedlegacy', 'Unclaimed player', 'unclaimed-token');
  denied := false;
  begin
    perform public.account_update('account-test-secret', 'session-a', 'hash-a', 'Failed rename', 'reservedlegacy');
  exception when unique_violation then denied := true;
  end;
  assert denied, 'Username changes must reject public name collisions';
  assert public.account_session('account-test-secret', 'session-a')->>'username' = 'mylogin', 'Failed rename must leave login unchanged';
  assert public.profile_by_handle('account-test-secret', 'mylogin')->>'display_name' = 'Display Name', 'Failed rename must be atomic';
  denied := false;
  begin
    perform public.account_register('account-test-secret', 'reservedlegacy', 'Failed signup', 'unused', 'hash-x', 'session-x');
  exception when unique_violation then denied := true;
  end;
  assert denied, 'Registration must never silently suffix a taken public username';

  perform public.account_session_create('account-test-secret', id_a, 'hash-a', 'session-a2');
  perform public.account_logout('account-test-secret', 'session-a');
  assert public.account_session('account-test-secret', 'session-a') is null, 'Logout must revoke the session';
  assert public.account_session('account-test-secret', 'session-a2') is not null, 'Logout must leave other devices signed in';
  a := public.account_update('account-test-secret', 'session-a2', 'hash-a', 'New Name', 'newlogin', 'new-hash', 'session-a3');
  assert a->>'username' = 'newlogin' and a->'profile'->>'display_name' = 'New Name';
  assert a->'profile'->>'avatar_id' = '0', 'Other account settings must preserve the selected avatar';
  assert a->'profile'->>'handle' = 'newlogin', 'Renaming must update public lookup with login';
  assert public.profile_by_handle('account-test-secret', 'newlogin')->>'id' = id_a::text;
  assert public.profile_by_handle('account-test-secret', 'mylogin') is null, 'Old profile link must stop resolving';
  assert public.social_snapshot('account-test-secret', id_b)->'friends'->0->>'handle' = 'newlogin', 'Friends must see the new username';
  assert public.account_session('account-test-secret', 'session-a2') is null, 'Password change must revoke previous sessions';
  assert public.account_credentials('account-test-secret', 'mylogin') is null, 'Old username must stop working';
  denied := false;
  begin
    perform public.account_session_create('account-test-secret', id_a, 'hash-a', 'stale-login');
  exception when others then denied := true;
  end;
  assert denied, 'A login racing a password change must fail';
  perform public.account_session_create('account-test-secret', id_a, 'new-hash', 'fresh-browser');
  assert public.profile_by_token('account-test-secret', 'fresh-browser')->>'rounds_won' = '3', 'A fresh browser must get the same stats';
  update private.account_sessions set expires_at = now() - interval '1 second' where token_hash = 'fresh-browser';
  assert public.account_session('account-test-secret', 'fresh-browser') is null, 'Expired sessions must fail';

  perform public.account_delete('account-test-secret', 'session-a3', 'new-hash');
  assert public.profile_by_handle('account-test-secret', 'newlogin') is null, 'Deleted profile must be absent';
  assert public.account_credentials('account-test-secret', 'newlogin') is null, 'Credentials must be deleted';
  assert not exists (select 1 from private.account_sessions where profile_id = id_a), 'All sessions must be deleted';
  assert jsonb_array_length(public.social_snapshot('account-test-secret', id_b)->'friends') = 0, 'Friend references must be deleted';
  perform public.profile_record_round('account-test-secret', jsonb_build_array(
    jsonb_build_object('profile_id', id_a, 'opponents', jsonb_build_array(id_b)),
    jsonb_build_object('profile_id', id_b, 'opponents', jsonb_build_array(id_a))
  ));
  assert (select rounds_played from public.profiles where id = id_b) = 1, 'A deleted opponent must not break survivor stats';
  assert public.account_rate_limit('account-test-secret', 'test-limit', 1);
  assert not public.account_rate_limit('account-test-secret', 'test-limit', 1), 'Limits must survive independent requests';
  denied := false;
  begin perform public.account_credentials('wrong-secret', 'friendlogin');
  exception when insufficient_privilege then denied := true; end;
  assert denied, 'RPCs must reject an incorrect server secret';
end $$;
rollback;
