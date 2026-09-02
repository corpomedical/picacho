# Play Billing setup — operator runbook (2026-08-21, resumed 2026-09-02)

The in-app purchase build (**versionCode 10** — the 08-21 pivot uninstalled
the plugin before 6 ever shipped a store; 10 is the build that actually
carries it) sells the five monthly plans and the three credit packs inside
the Android app through Google Play Billing, with RevenueCat as the
receipt/entitlement layer. Stripe on the web is untouched. This file is the
operator's checklist — every dashboard step, in order, one sitting
(~45 min). The code is wired end to end (store UI on Settings → usage, the
insufficient-credits banner links to it, webhook grants); nothing works
until these steps are done.

**Safety property to know:** every purchase surface self-gates on the
Purchases plugin being present in the installed binary
(`playBillingAvailable()` in `src/lib/native/purchases.ts`). Installs of
versionCode ≤ 9 — the reader-mode builds Play approved — keep showing zero
purchase UI even after the site deploys, so there is no policy exposure
while the rollout is in flight. The store also stays hidden until
`NEXT_PUBLIC_REVENUECAT_GOOGLE_KEY` is set (step 4).

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

## 0 · Prerequisites verified by research (2026-09-02)

**Policy verdict (primary sources, checked 2026-09-02):** selling in-app
through GOOGLE'S OWN billing is the required/default compliant path
everywhere — no enrollment, no injunction dependency, no US-specific
procedure (those apply only to ALTERNATIVE billing / external links).
Selling on the web via Stripe at any price alongside is explicitly fine —
Play policy has no price-parity rule; it governs only in-app flows.
Technical gate: uploads since Aug 31, 2026 must ship Billing Library 8+ —
the installed plugin bundles 8.3.0 (verified in the gradle tree). Plan one
plugin bump to the BL9 line before Aug 31, 2027.

Steps found MISSING from the original runbook — do these too:

0a. **Google payments merchant profile** — Play Console → Setup → Payments
    profile. Without it the Monetize section can't create products, and
    merchant verification can take days. Start this FIRST.
0b. **Data safety form update** — Play Console → App content → Data safety:
    declare "Purchase history" as collected (purposes: App functionality,
    Analytics; RevenueCat requirement). The app was reviewed as a
    no-purchase reader; shipping billing without this edit is a policy
    violation.
0c. **Content rating (IARC) resubmission** — the "digital purchases" answer
    changes, and Google requires a fresh questionnaire when answers change
    (this was already noted below; it is mandatory, not cosmetic).
0d. **15% reduced-fee tier enrollment** (legacy regions) — Play Console
    service-fee tier enrollment (needs an Account Group). Subscriptions get
    15% automatically; CONSUMABLE PACKS in not-yet-migrated regions bill 30%
    without this enrollment. In US/UK/EEA the new post-settlement structure
    already applies (~10%+5% billing fee on subs). Read the live fee table
    (support.google.com/googleplay/android-developer/answer/112622) before
    locking pack prices — the tiers shifted June 30, 2026 and the March 2026
    Epic settlement is still awaiting final court approval.
0e. **RevenueCat product config**: leave the three packs as DEFAULT
    (consumable) in the RC dashboard — RC then auto-consumes so they can be
    bought repeatedly; never flip them to non-consumable. The client is
    configured with purchasesAreCompletedBy: REVENUECAT — do not change it
    (observer mode would skip acknowledgment and Google auto-refunds
    unacknowledged purchases after 3 days).

⚠ **Separate compliance item, decide BEFORE pushing anything new**: the
US-only external Stripe checkout link (Settings plan card + shortfall
banner, live since 2026-08-21) predates but never enrolled in Google's
formal "external content links program" (launched Dec 9, 2025; existing
link users had to enroll by Jan 28, 2026 with a declaration form, Google's
external-links API and a pre-link disclosure screen). As shipped it is
likely out of program compliance today, and from Oct 1, 2026 external-link
transactions owe Google service fees + 24-hour reporting anyway. With
in-app Play Billing arriving, the simple fix is to REMOVE the external
link surfaces rather than enroll. Operator decision.

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

## 6 · Build & upload versionCode 10

`cd android && JAVA_HOME=$(/usr/libexec/java_home) ./gradlew bundleRelease`
→ upload the AAB to an internal-testing track. (Remember `npx cap copy
android` runs from the repo ROOT if web assets changed.)

## 7 · Testing (before Production)

1. Play Console → Settings → **License testing**: add your Google account →
   purchases in internal-testing builds charge nothing and auto-refund.
2. Install the internal-testing build (versionCode 10), open Settings →
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
