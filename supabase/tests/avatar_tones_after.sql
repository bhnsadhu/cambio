do $$
begin
  assert (select array_agg(avatar_id order by handle) from public.profiles
    where token_hash like 'avatar-migration-%') is not distinct from array[0, 1, 2, 3, 4, 5, null]::integer[],
    'Adding tones must preserve every existing avatar and the unchosen default';
  assert (select count(*) from public.profiles where token_hash like 'avatar-migration-%'
    and display_name = 'Existing avatar') = 7, 'Existing profile identity must survive the migration';
end $$;
delete from public.profiles where token_hash like 'avatar-migration-%';
