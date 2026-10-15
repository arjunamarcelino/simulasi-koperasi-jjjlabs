-- Capture top-100 cut + rank contiguity at the boundary (SIM-17, review P3).
--
-- 082 proves ranking/ties on small fixtures; this isolates the LIMIT 100 cut that those <6-row
-- fixtures never exercise. Self-contained in its own begin/rollback so the 105 bulk users don't
-- entangle 082's shared transaction. 105 distinct XP values (1..105) → exactly the top 100 are
-- captured as contiguous ranks 1..100, and the 5 lowest (xp 1..5) are cut.
begin;
select plan(5);

-- Bulk-provision 105 players (the signup trigger creates profiles + user_progress at xp 0).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       'cap' || g || '@test.local', '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('test_identifier', 'cap' || g, 'name', 'P' || g), now(), now()
from generate_series(1, 105) g;

-- Distinct XP = the number baked into the display name (P1..P105).
update public.user_progress up
   set xp = (regexp_replace(p.display_name, '^P', ''))::int
  from public.profiles p
 where p.id = up.user_id and p.display_name ~ '^P[0-9]+$';

create temporary table cap_big as select admin.capture_leaderboard_snapshot('cap') as r;
create temporary table ids as
  select rank, xp from public.leaderboard_entries
   where season_id = (select (r->>'season_id')::uuid from cap_big);

select is((select (r->>'entry_count')::int from cap_big), 100, 'capture caps at 100 (105 eligible)');
select is((select count(*)::int from ids), 100, '100 entry rows persisted');
select is((select count(distinct rank)::int from ids), 100, 'ranks are all distinct');
select is((select min(rank) || '-' || max(rank) from ids), '1-100', 'ranks span exactly 1..100 (contiguous, no gaps)');
select is((select min(xp)::int from ids), 6, 'top-100 cut kept the highest XP (xp 1..5 dropped)');

select * from finish();
rollback;
