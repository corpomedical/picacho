# Play Billing setup — operator runbook (2026-08-21)

The in-app purchase build (versionCode 6) sells the five monthly plans and
the three credit packs inside the Android app through Google Play Billing,
with RevenueCat as the receipt/entitlement layer. Stripe on the web is
untouched. This file is the operator's checklist — every dashboard step, in
order, one sitting (~45 min). The code is already wired; nothing works end
to end until these steps are done.

**The product-ID contract** (must match `src/lib/play/products.ts` exactly):

| Play Console product id | Type | Maps to | Price (USD) |
|---|---|---|---|
| `sub_basic` | Subscription (base plan `monthly`) | Basic | 9 |
| `sub_starter` | Subscription (base plan `monthly`) | Starter | 19 |
| `sub_growth` | Subscription (base plan `monthly`) | Growth | 79 |
| `sub_studio` | Subscription (base plan `monthly`) | Studio | 299 |
| `sub_elite` | Subscription (base plan `monthly`) | Elite | 499 |
| `pack_small` | In-app product (consumable) | 20 credits | 15 |
| `pack_medium` | In-app product (consumable) | 60 credits | 42 |
| `pack_large` | In-app product (consumable) | 150 credits | 99 |

Same sticker prices as the web (identical-price policy, operator-accepted
15% margin hit on app-originated revenue, decision 2026-08-21).

## 1 · Play Console — create the products

Play Console → Picacho → **Monetize** section.

1. **Products → Subscriptions → Create subscription**, five times. For each:
   - Product ID exactly as in the table (`sub_basic` …), name = plan name.
   - **Add base plan** → ID `monthly`, auto-renewing, billing period 1 month
     → set the USD price from the table → let Google auto-convert other
     currencies (adjust EUR to match the web's €-equals-$ pricing if
     offered) → **Activate** the base plan.
2. **Products → In-app products → Create product**, three times:
   - Product ID `pack_small` / `pack_medium` / `pack_large`, price from the
     table, **Activate**. (Consumption is handled by the app/RevenueCat.)
3. Monetize → **Monetization setup**: note this page — RevenueCat's Play
   credentials get pasted here later if RC asks for the Pub/Sub topic
   (real-time developer notifications). RC's connect flow (step 3) walks it.

## 2 · Google Cloud — service account for RevenueCat

RevenueCat validates Play purchases with a service-account key.

1. console.cloud.google.com → the project linked to Play (or create one) →
   IAM & Admin → **Service accounts** → Create: name `revenuecat`, no roles
   in Cloud itself → Create key → **JSON** → the file downloads. Guard it
   like a password.
2. Play Console → **Users and permissions** → Invite new user → the service
   account's email (`revenuecat@…iam.gserviceaccount.com`) → App
   permissions: Picacho → grant **View app information**, **Manage orders
   and subscriptions**, and (if listed) **Manage store presence → financial
   data** → Invite.

## 3 · RevenueCat — project and connection

1. app.revenuecat.com → sign up (free) → Create project "Picacho".
2. **Add app → Play Store**: package `ai.picacho.app`; upload the service
   account JSON from step 2. RC verifies the link (can take a few minutes;
   Google says permissions may need up to 24 h to propagate).
3. Project settings → **API keys**: copy the **Google Play public SDK key**
   (`goog_…`).
4. **Integrations → Webhooks** → Add: URL
   `https://picacho.ai/api/webhooks/revenuecat`, and set an **Authorization
   header value** — generate a long random string (e.g. `openssl rand -hex
   32` prefixed with nothing; paste the SAME string into the env var below).
5. Products: RC auto-imports from Play once connected; no RC "entitlements"
   configuration is needed — the server maps product ids directly.

## 4 · Environment variables (Vercel → picacho → Settings → Env)

| Name | Value |
|---|---|
| `NEXT_PUBLIC_REVENUECAT_GOOGLE_KEY` | the `goog_…` public SDK key (safe to be public) |
| `REVENUECAT_WEBHOOK_AUTH` | the exact Authorization header string from step 3.4 |

Redeploy after saving (any push does it).

## 5 · Database

Run `supabase/pending-2026-08-21/play-billing.sql` in the Supabase SQL
editor (adds `profiles.plan_source` + `profiles.play_product_id`, backfills
current payers as `stripe`).

## 6 · Testing (before Production)

1. Play Console → Settings → **License testing**: add your Google account →
   purchases in internal-testing builds charge nothing and auto-refund.
2. Install the internal-testing build (versionCode 6), open Settings →
   plans, buy Basic with the test card sheet, then a pack. Verify in Admin:
   plan flips with `plan_source = play`, credits granted; cancel from Play
   Store → subscription center and verify expiration resets the plan after
   the (accelerated, ~5-minute) test renewal window lapses.

## Review-facing changes at submission time

- Content rating questionnaire → "Does the app allow users to purchase
  digital goods?" flips to **Yes** (everything else unchanged).
- Play adds the automatic "In-app purchases" badge to the listing.
- App access/reader-mode notes stay valid: the app now sells through
  GOOGLE'S OWN billing, which is the fully compliant configuration
  everywhere.
