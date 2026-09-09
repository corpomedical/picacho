-- Course reshoot, chapter 3: put the course account back into the state it
-- was in before its first render, so ch3-01 and ch3-02 photograph the same
-- moment ch3-03 does. Two values, both read from the live rows first and
-- restored exactly by course-shoot-restore.sql.
--
-- Why not fake it in the DOM: the course promises every number on screen is
-- the account's own. Hiding the "comes back tomorrow" banner and rewriting
-- the credits pill would be inventing a state; this recreates one the
-- account genuinely had at 07:39 today. Run prep, shoot, run restore.

update public.generations
   set deleted_at = now()
 where id = 'a6a83d33-daf5-4e28-9073-29bb6e201459'
   and user_id = '39c38b63-db0b-43da-bf1e-e0e64c695f82';

update public.profiles
   set free_generation_last_at = null
 where id = '39c38b63-db0b-43da-bf1e-e0e64c695f82';

-- Verify: the sidebar reads "Nothing generated yet." and the composer
-- footer reads "Uses today's free generation · image".
