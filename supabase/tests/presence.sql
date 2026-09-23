-- Presence authority and realtime invalidation. Fixtures never persist.
begin;
do $$
declare
  a jsonb; b jsonb; c jsonb; id_a uuid; id_b uuid; id_c uuid;
  channel_b uuid; channel_c uuid; first_tab uuid := gen_random_uuid(); second_tab uuid := gen_random_uuid();
  before_revision bigint;
begin
  a := public.account_register('account-test-secret', 'presencea', 'Presence A', 'presencea', 'hash-a', 'presence-session-a');
  b := public.account_register('account-test-secret', 'presenceb', 'Presence B', 'presenceb', 'hash-b', 'presence-session-b');
  c := public.account_register('account-test-secret', 'presencec', 'Presence C', 'presencec', 'hash-c', 'presence-session-c');
  id_a := (a->'profile'->>'id')::uuid; id_b := (b->'profile'->>'id')::uuid; id_c := (c->'profile'->>'id')::uuid;
  assert (public.presence_of('account-test-secret', id_a)->>'online')::boolean = false,
    'Creating an account without an open document must not make it online';
  perform public.profile_by_token('account-test-secret', 'presence-session-a');
  assert (public.presence_of('account-test-secret', id_a)->>'online')::boolean = false,
    'Reading account or social data must not manufacture online presence';
  perform public.friend_request('account-test-secret', id_a, id_b);
  perform public.friend_respond('account-test-secret', id_b, id_a, true);
  channel_b := public.social_channel('account-test-secret', id_b);
  channel_c := public.social_channel('account-test-secret', id_c);
  assert channel_b <> id_b and channel_b <> channel_c, 'Realtime keys must be opaque and account-specific';
  assert channel_b = public.social_channel('account-test-secret', id_b), 'Subscription key must remain stable';
  select revision into before_revision from public.social_signals where channel_id = channel_b;
  perform public.presence_tab_set('account-test-secret', id_a, first_tab, 1, true, 'presence-session-a', null, null, 0);
  assert (select revision from public.social_signals where channel_id = channel_b) > before_revision,
    'A friend becoming online must invalidate the observer snapshot';
  assert (select revision from public.social_signals where channel_id = channel_c) = 0,
    'An unrelated account must not receive presence invalidations';
  select revision into before_revision from public.social_signals where channel_id = channel_b;
  perform public.presence_tab_set('account-test-secret', id_a, first_tab, 2, true, 'presence-session-a', null, null, 0);
  assert (select revision from public.social_signals where channel_id = channel_b) = before_revision,
    'Routine leases must not fan out redundant realtime requests';
  perform public.presence_tab_set('account-test-secret', id_a, second_tab, 1, true, 'presence-session-a', null, null, 0);
  perform public.presence_tab_set('account-test-secret', id_a, first_tab, 3, false, 'presence-session-a', null, null, 0);
  assert (public.presence_of('account-test-secret', id_a)->>'online')::boolean, 'Another open document must keep presence online';
  perform public.presence_tab_set('account-test-secret', id_a, second_tab, 2, false, 'presence-session-a', null, null, 0);
  assert not (public.presence_of('account-test-secret', id_a)->>'online')::boolean, 'The last departure must go offline immediately';
  assert (select revision from public.social_signals where channel_id = channel_b) > before_revision,
    'A friend departing must notify the observer immediately';
  perform public.presence_tab_set('account-test-secret', id_a, first_tab, 2, true, 'presence-session-a', null, null, 0);
  assert not (public.presence_of('account-test-secret', id_a)->>'online')::boolean, 'A late heartbeat cannot resurrect a closed document';
  perform public.presence_tab_set('account-test-secret', id_a, first_tab, 4, true, 'presence-session-a', null, null, 0);
  update public.presence set updated_at = now() - interval '76 seconds' where profile_id = id_a;
  assert not (public.presence_of('account-test-secret', id_a)->>'online')::boolean, 'A silent crash expires after the bounded lease';
  select revision into before_revision from public.social_signals where channel_id = channel_b;
  perform public.presence_tab_set('account-test-secret', id_a, first_tab, 5, true, 'presence-session-a', null, null, 0);
  assert (select revision from public.social_signals where channel_id = channel_b) > before_revision,
    'Returning after lease expiry must notify friends even at the same location';
  perform public.account_logout('account-test-secret', 'presence-session-a');
  perform public.presence_tab_set('account-test-secret', id_a, first_tab, 6, true, 'presence-session-a', null, null, 0);
  assert not (public.presence_of('account-test-secret', id_a)->>'online')::boolean, 'Revoked sessions cannot recreate presence';
  assert not has_table_privilege('anon', 'public.presence', 'SELECT'), 'Private table codes must remain unreadable';
  assert not has_table_privilege('anon', 'private.social_channels', 'SELECT'), 'Channel-to-account mapping must remain private';
  assert has_table_privilege('anon', 'public.social_signals', 'SELECT'), 'Realtime must be able to read its signal';
  assert not has_table_privilege('anon', 'public.social_signals', 'UPDATE')
    and not has_table_privilege('anon', 'public.social_signals', 'INSERT')
    and not has_table_privilege('anon', 'public.social_signals', 'DELETE'), 'Clients cannot forge presence notifications';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'social_signals') = 2,
    'Realtime may expose only an opaque key and revision';
end $$;
rollback;
