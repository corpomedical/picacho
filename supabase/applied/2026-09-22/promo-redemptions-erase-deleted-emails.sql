-- Promo sales keep no email once the buyer's account is deleted
-- (2026-09-19; the code: lib/profile/promo-redemptions.ts).
--
-- From this deploy on, both deletion paths erase the email before the
-- account goes. This clears the ones earlier deletions left behind: a sale
-- whose account is gone has no user_id (the foreign key empties it when the
-- account is deleted, and checkout always records the account), yet it kept
-- the email it was paid with. The sale itself stays: code, salesperson,
-- amounts, commission and Stripe's checkout id.
--
-- The code does not need this and runs the same before or after it.
-- Idempotent: a second run clears nothing and answers 0.
with cleared as (
  update public.promo_redemptions
     set user_email = null
   where user_id is null
     and user_email is not null
  returning 1
)
select count(*) as emails_cleared from cleared;
