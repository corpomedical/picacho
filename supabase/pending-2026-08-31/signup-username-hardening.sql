-- =====================================================================
-- 2026-08-31  Signup must never die on a username.
--
-- FOUND in the 2026-08-31 site inspection, verified against the live
-- schema. handle_new_user derives a username from the email's local part
-- and does a plain INSERT. Two constraints added on 2026-08-19 can reject
-- that insert:
--
--   profiles_username_format   CHECK '^[a-z0-9_]{3,24}$'
--   profiles_username_lower_key UNIQUE on lower(username)
--
-- The trigger runs AFTER INSERT ON auth.users, so its failure rolls back
-- the auth row itself and GoTrue surfaces the opaque "Database error
-- saving new user". Which means, today:
--
--   - aj@example.com cannot sign up at all (2 chars < 3)
--   - firstname.lastname.department@corp.com cannot sign up (> 24 chars)
--   - anyone whose local part matches an EXISTING username cannot sign up
--     (ahmed@gmail.com after ahmed@hotmail.com) — and this class grows
--     with every account
--
-- OAuth is hit identically: the Google/Facebook round-trip ends back on
-- /login with no explanation. The email form's chosen-username field does
-- not help — the app only UPDATEs the profile AFTER signUp() returns, and
-- it is the trigger's provisional insert that fails first.
--
-- The rewrite below makes the provisional username unconditionally valid:
-- sanitise, pad short names, truncate long ones leaving suffix room, then
-- retry with a random numeric suffix until the unique index accepts it.
-- The person's CHOSEN username still lands afterwards via the app's
-- normal update path; this only has to be good enough to never block the
-- door. A final safety net: if anything in the naming logic still fails,
-- fall back to a uuid-derived handle rather than killing the signup —
-- a signup must never be lost to cosmetics.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  attempt int := 0;
begin
  base := regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9_]', '_', 'g');

  -- Too short: pad with the front of the uuid rather than inventing a word —
  -- "aj" becomes "aj_3f2a", never "ajuser" colliding with a real name.
  if length(base) < 3 then
    base := base || '_' || substr(replace(new.id::text, '-', ''), 1, 4);
  end if;

  -- Too long: keep 19 so a "_9999" suffix still fits inside 24.
  if length(base) > 19 then
    base := substr(base, 1, 19);
  end if;

  candidate := base;
  loop
    begin
      insert into public.profiles (id, email, username)
      values (new.id, new.email, candidate);
      return new;
    exception
      when unique_violation then
        -- Only retry when it is the USERNAME that collided. A duplicate
        -- profile id means this trigger already ran — re-raise that.
        if exists (select 1 from public.profiles where id = new.id) then
          raise;
        end if;
        attempt := attempt + 1;
        if attempt > 6 then
          -- The uuid-derived fallback below also collided, which means the
          -- table already holds a row derived from this same uuid — that is
          -- not a naming problem, re-raise rather than loop.
          raise;
        elsif attempt > 5 then
          -- Give up on prettiness, never on the signup.
          candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
        else
          candidate := base || '_' || (floor(random() * 9000) + 1000)::int;
        end if;
    end;
  end loop;
end;
$$;
