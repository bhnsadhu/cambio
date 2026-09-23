-- Stored choices from before tones were available, including the unchosen
-- default. These fixtures cross the real 0012 migration boundary.
insert into public.profiles (handle, display_name, token_hash, avatar_id)
select 'avatarmigration' || n, 'Existing avatar', 'avatar-migration-' || n,
  case when n < 6 then n else null end
from generate_series(0, 6) n;
