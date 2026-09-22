do $$
declare v_account jsonb; v_legacy jsonb;
begin
  assert not exists (select 1 from private.accounts a join public.profiles p on p.id = a.profile_id where a.username <> p.handle), 'All account usernames must match public names, including swaps';
  v_account := public.account_session('account-test-secret', 'username-migration-account');
  assert v_account->>'username' = 'migrationlogin', 'The existing login must stay unchanged';
  assert v_account->'profile'->>'handle' = 'migrationlogin', 'Public lookup must use the login username';
  assert v_account->'profile'->>'rounds_won' = '4', 'Migration must retain stats';
  assert public.account_credentials('account-test-secret', 'migrationlogin')->>'password_hash' = 'hash', 'Migration must retain credentials';
  v_legacy := public.profile_by_token('account-test-secret', 'username-migration-legacy');
  assert v_legacy->>'display_name' = 'Legacy player', 'A legacy name collision must preserve the legacy profile';
  assert v_legacy->>'handle' <> 'migrationlogin', 'Legacy public names must not shadow account usernames';
  assert jsonb_array_length(public.social_snapshot('account-test-secret', (v_account->'profile'->>'id')::uuid)->'friends') = 1, 'Migration must retain friendships';
end $$;
delete from public.profiles where token_hash like 'username-migration-%';
delete from private.server_config where key = 'server_secret';
