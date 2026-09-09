-- Undoes course-shoot-prep.sql exactly. The timestamp is the value the row
-- held before prep, not "now" — so the free-slot accounting is untouched.

update public.generations
   set deleted_at = null
 where id = 'a6a83d33-daf5-4e28-9073-29bb6e201459'
   and user_id = '39c38b63-db0b-43da-bf1e-e0e64c695f82';

update public.profiles
   set free_generation_last_at = '2026-09-09T07:39:18.989815+00:00'
 where id = '39c38b63-db0b-43da-bf1e-e0e64c695f82';
