// One-off local script — run this yourself, the sandbox this app is built
// in can't reach api.stripe.com (same reason setup-live-stripe.js and
// setup-eur-pricing.js had to be run locally too).
//
// What this does: profiles.current_period_start/end (added 2026-08-10, see
// LAUNCH_CHECKLIST.md "Live usage banner") only gets populated going forward
// by the Stripe webhook, on the next subscription event Stripe happens to
// send. For everyone who already subscribed before today, that column is
// still null — this script fills it in once by asking Stripe directly for
// each existing subscriber's real current billing period, so the new usage
// banner can show a real reset date immediately instead of waiting on
// whatever random subscription event fires next (could be days, could be at
// their renewal).
//
// Usage:
//   node backfill-billing-period.js
//
// Reads from .env.local, same as the app itself — needs STRIPE_SECRET_KEY
// (live secret key) and SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
// to already be set there.

const fs = require("fs");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

// Tiny inline .env.local reader instead of pulling in the `dotenv` package
// (not currently a dependency of this project — no reason to add one just
// for a script that's run once and then deleted). Same KEY=value format,
// skips blank lines and comments, doesn't touch anything already set in the
// real environment.
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  if (!(key in process.env)) process.env[key] = value;
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, stripe_subscription_id")
    .not("stripe_subscription_id", "is", null);

  if (error) {
    console.error("Failed to read profiles:", error.message);
    process.exit(1);
  }

  console.log(`Found ${profiles.length} profile(s) with a Stripe subscription.`);

  let updated = 0;
  let skipped = 0;

  for (const profile of profiles) {
    try {
      const subscription = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
      // current_period_start/end live on each line item, not the top-level
      // Subscription object, in the Stripe API version this project is on
      // (see the comment in src/app/api/webhooks/stripe/route.ts for why).
      const item = subscription.items.data[0];
      if (!item) {
        console.warn(`  ${profile.id}: subscription ${profile.stripe_subscription_id} has no items, skipping.`);
        skipped++;
        continue;
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          current_period_start: new Date(item.current_period_start * 1000).toISOString(),
          current_period_end: new Date(item.current_period_end * 1000).toISOString(),
        })
        .eq("id", profile.id);

      if (updateError) {
        console.error(`  ${profile.id}: failed to update — ${updateError.message}`);
        skipped++;
        continue;
      }

      updated++;
      console.log(`  ${profile.id}: period ${new Date(item.current_period_start * 1000).toISOString()} -> ${new Date(item.current_period_end * 1000).toISOString()}`);
    } catch (err) {
      console.error(`  ${profile.id}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skipped}.`);
}

main();
