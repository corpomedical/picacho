-- =====================================================================
-- 2026-08-30  The project-aware chat agent: usage ledger + budget RPC.
--
-- RUN THIS BEFORE THE DEPLOY. The chat route reads and writes agent_usage
-- and calls record_agent_units; without them every chat turn fails closed
-- (which is the safe direction, but the feature simply will not work).
--
-- The feature flag row is inserted DISABLED. Nothing turns on until someone
-- flips it in Admin > Feature flags — a feature that spends money on every
-- use should never arrive switched on.
--
-- WHY DOLLARS, NOT MESSAGES. A "Smarter" turn costs several times a
-- "Faster" one-liner, and a cached turn a tenth of an uncached one, so a
-- message count would overcharge one and undercharge the other by a wide
-- margin. Every turn is priced from the API's own reported usage and
-- charged in 2-cent units.
--
-- WHY ELITE IS CAPPED, unlike PLAN_PROMPT_ASSIST_LIMITS where it is
-- Infinity: plans.ts already names the failure mode for the SMALLER feature
-- — "an assist writes no generations row, so it bypasses both the credit
-- meter and the 3-second cooldown. Without a cap the endpoint is a free
-- Claude proxy for anyone with an account and a script." A streaming chat
-- endpoint is that same bypass with a bigger output budget. The cap ships;
-- raise it deliberately if a real account approaches it.
-- =====================================================================

create table if not exists public.agent_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- "faster" | "smarter" — which effort the turn ran at.
  mode text not null,
  -- Billed units (2 cents each), always >= 1 so a trivial turn still counts.
  units int not null,
  -- What the turn actually cost us, for tuning the unit price later. Every
  -- number in PLAN_CHAT_UNIT_LIMITS is a guess until there is a week of this.
  cost_usd numeric(10, 6) not null default 0,
  input_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists agent_usage_user_created_idx
  on public.agent_usage (user_id, created_at desc);

alter table public.agent_usage enable row level security;

-- Read-your-own, for a future usage display. Every WRITE goes through the
-- service role inside the RPC below — same shape as the other meters.
drop policy if exists "Users read their own agent usage" on public.agent_usage;
create policy "Users read their own agent usage"
  on public.agent_usage for select
  using (auth.uid() = user_id);

drop policy if exists "Admins read all agent usage" on public.agent_usage;
create policy "Admins read all agent usage"
  on public.agent_usage for select
  using (is_admin());

-- Atomic "reserve these units iff the period total stays under the cap".
--
-- Modelled line-for-line on record_prompt_assist: an advisory lock keyed on
-- the user, a re-count INSIDE the lock, and an insert only when it fits.
-- Without the lock, two concurrent turns both read "under cap" and both
-- write — the same read-check-write race the reference-image caps still have.
--
-- RETURNS THE ROW'S ID, and that return value is what makes this a
-- RESERVATION rather than a charge. The route updates this same row with the
-- turn's real cost when it ends. The first draft returned a boolean and had
-- the route INSERT a second row afterwards, which charged every turn twice:
-- the worst-case reservation plus the actual cost. On the free tier — 25
-- units against a worst-case reservation — that reduced "about fifteen free
-- questions" to exactly one, and nothing in the code said so.
--
-- Returns NULL when the cap is reached. The caller distinguishes that from a
-- failure by the absence of an error, not by the value alone.
create or replace function public.record_agent_units(
  p_user_id uuid,
  p_since timestamptz,
  p_cap int,
  p_units int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  used int;
  new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 91));
  select coalesce(sum(units), 0)::int into used
    from public.agent_usage
   where user_id = p_user_id and created_at >= p_since;
  if used + p_units > p_cap then
    return null;
  end if;
  -- Reserved at the worst case the mode can cost. If the process dies
  -- between here and the route's update, the row STAYS at the reservation:
  -- the user is charged rather than refunded, which is the safe direction
  -- for an endpoint that has already spent someone else's tokens.
  insert into public.agent_usage (user_id, mode, units)
  values (p_user_id, 'reserved', p_units)
  returning id into new_id;
  return new_id;
end $$;

-- Service-role only, exactly like every other meter RPC here: a client that
-- can call this directly can grant itself budget.
revoke execute on function public.record_agent_units(uuid, timestamptz, int, int)
  from public, anon, authenticated;
grant execute on function public.record_agent_units(uuid, timestamptz, int, int)
  to service_role;

-- Off. Deliberately.
insert into public.feature_flags (key, enabled, description)
values (
  'chat_agent',
  false,
  'Project-aware chat agent in the composer (the Ask mode next to Render). Costs Anthropic tokens on every message — leave off until the unit limits have been checked against real usage.'
)
on conflict (key) do nothing;
