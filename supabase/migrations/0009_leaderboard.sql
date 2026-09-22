-- Public standings use the same points and competition ranks as profiles.
-- The server supplies the authenticated identity, never a browser supplied id.
begin;
create or replace function public.leaderboard_snapshot(
  p_secret text, p_id uuid, p_scope text, p_offset integer default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.check_secret(p_secret);
  if p_scope is null or p_scope not in ('all', 'friends') or p_offset is null or p_offset < 0 then
    raise exception 'invalid_leaderboard_query';
  end if;
  if p_scope = 'friends' and not exists (select 1 from public.profiles where id = p_id) then
    raise exception 'profile_required';
  end if;
  with ranked as materialized (
    select p.id, p.handle, p.display_name as "displayName", p.points,
      p.rounds_won as "roundsWon", p.rounds_played as "roundsPlayed",
      rank() over (order by p.points desc) as rank
    from public.profiles p
    where p_scope = 'all' or p.id = p_id or exists (
      select 1 from public.friendships f where f.status = 'accepted' and
        ((f.requester_id = p_id and f.addressee_id = p.id) or
         (f.addressee_id = p_id and f.requester_id = p.id))
    )
  ), page as (
    select * from ranked order by points desc, handle, id limit 50 offset p_offset
  )
  select jsonb_build_object(
    'entries', (select coalesce(jsonb_agg(to_jsonb(p) order by p.points desc, p.handle, p.id), '[]'::jsonb) from page p),
    'me', (select to_jsonb(r) from ranked r where id = p_id),
    'total', (select count(*) from ranked),
    'offset', p_offset,
    'nextOffset', case when (select count(*) from ranked) > p_offset + 50 then p_offset + 50 else null end
  ) into result;
  return result;
end $$;
notify pgrst, 'reload schema';
commit;
