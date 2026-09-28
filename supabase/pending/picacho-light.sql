-- Picacho Light (2026-09-28, operator: "Create a light version of the
-- website", "I mean a light version for unexperienced users that seek Chat
-- gpt and Gemini experience"). Code: src/lib/light/mode.ts (the rules),
-- src/lib/light/actions.ts (saves), app/app/layout.tsx (reads),
-- app/app/welcome (the sign-up step), app/app/light (the chat).
--
-- Run it BEFORE the push. Without the columns the code keeps everyone in the
-- full studio and shows nobody the welcome step. Idempotent: a second paste
-- is harmless.
--
-- app_mode: light | advanced. NULL = a new account that hasn't picked yet
-- (it sees the welcome step). app_look: light | dark | system. NULL = the
-- look this device already had.
alter table public.profiles add column if not exists app_mode text;
alter table public.profiles add column if not exists app_look text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_app_mode_check') then
    alter table public.profiles
      add constraint profiles_app_mode_check check (app_mode is null or app_mode in ('light', 'advanced'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_app_look_check') then
    alter table public.profiles
      add constraint profiles_app_look_check check (app_look is null or app_look in ('light', 'dark', 'system'));
  end if;
end $$;

-- Every account that exists today stays in the full studio and is never
-- shown the new step. (Ten minutes back, so a second paste cannot skip the
-- step for someone who signed up a moment ago.)
update public.profiles
   set app_mode = 'advanced'
 where app_mode is null
   and created_at < now() - interval '10 minutes';

-- People save both choices themselves (the check constraints above keep
-- the values to the lists).
grant update (app_mode, app_look) on public.profiles to authenticated;
