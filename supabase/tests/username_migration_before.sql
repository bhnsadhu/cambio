-- Fixtures for upgrading the old, separate public names and login usernames.
insert into private.server_config(key, value) values ('server_secret', 'account-test-secret');
select public.profile_create('account-test-secret', 'migrationlogin', 'Legacy player', 'username-migration-legacy');
select public.account_register('account-test-secret', 'migrationlogin', 'Account player', 'migrationdisplay', 'hash', 'username-migration-account');
select public.account_register('account-test-secret', 'migrationswapa', 'Swap A', 'migrationswapb', 'hash', 'username-migration-swap-a');
select public.account_register('account-test-secret', 'migrationswapb', 'Swap B', 'migrationswapa', 'hash', 'username-migration-swap-b');
update public.profiles set rounds_played = 9, rounds_won = 4 where token_hash = 'username-migration-account';
insert into public.friendships(requester_id, addressee_id, status)
  select a.id, b.id, 'accepted' from public.profiles a, public.profiles b
  where a.token_hash = 'username-migration-account' and b.token_hash = 'username-migration-legacy';
