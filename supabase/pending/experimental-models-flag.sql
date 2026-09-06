-- The switch behind the dormant Seedance variants (2026-09-06).
--
-- Operator: "Wire them dormant with a switch I can flip to activate. (For
-- testing purposes)". Seedance 2.0 Fast and Seedance 2.0 Mini are in the
-- catalogue with real prices and credit weights, but nobody has judged their
-- output yet, so two gates keep them out of reach until this flag is on:
--
--   src/lib/generations/workspace-data.ts  keeps them out of the composer list
--   src/lib/generations/actions.ts         refuses the id server-side
--
-- The second is the one that matters; hiding an option is not a check.
--
-- Off by default, deliberately. An unproven model that costs a customer a
-- credit is worse than no model, and the flag exists so the operator can
-- render one first and decide.
--
-- Flip it in Admin > Feature flags, same as every other switch here.

insert into public.feature_flags (key, enabled, description)
values (
  'experimental_models',
  false,
  'Shows unproven video models (Seedance 2.0 Fast and Mini) in the composer. Off until someone has judged their output — Mini also needs the BytePlus lane, since it has no fal endpoint.'
)
on conflict (key) do nothing;
