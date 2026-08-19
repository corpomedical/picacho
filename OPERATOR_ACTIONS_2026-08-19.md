# Operator actions — required to complete the 2026-08-19 fix round

The code fixes in this round are complete and verified (`tsc`, lint, hook-order, `next build` all clean), but several depend on actions only the operator can take: applying SQL to the live Supabase project, setting env vars, and flipping dashboard settings. Work through this list top to bottom. Items marked **BEFORE DEPLOY** must land before (or together with) the next production deploy — the affected code paths fail closed (loud, retryable errors; no silent breakage) until they do.

## 1. Apply the SQL files (BEFORE DEPLOY)

Apply in the Supabase SQL editor, in this order (all idempotent):

1. `supabase/pending-2026-08-19/billing.sql` — `profiles.plan_currency`/`plan_interval` columns + atomic `clawback_credit_purchase` RPC. Until applied: webhook subscription/clawback writes 500 (Stripe retries safely, but noisily) and Admin → Billing's select fails.
2. `supabase/pending-2026-08-19/pipeline.sql` — `generations.refunded_at` + partial indexes + `record_model_failure` RPC. Header caveat: `model_health` has no DDL in the repo; the RPC assumes `model_id` unique and `failing_user_ids uuid[]` — adjust two casts if the live column is `text[]`. The TS code has a fallback, so this one degrades gracefully.
3. `supabase/pending-2026-08-19/user-actions.sql` — reference-image reservation RPCs, `insert_saved_prompt_capped`, `insert_brand_rules_capped`, grant revocations on `reference_image_generations`/`push_tokens`, storage-bucket size/mime limits. Until applied: reference-image generation, saved prompts, brand rules fail closed with retry messages. **Reconcile first**: verify the live column shapes for `reference_image_generations`/`saved_prompts`/`brand_rules` (the repo has no DDL for them) and drop any permissive live RLS policies the file's comments flag.
4. `supabase/pending-2026-08-19/auth-admin.sql` — unique index + format CHECK on `profiles.username`, `create_api_key_capped` RPC, role-checked `admin_traffic_daily`, and (section 4) per-feature rate-limit scoping: a `scope` column on `api_rate_hits` plus a 4-arg `api_rate_check` (the 3-arg one becomes a delegating shim). **Reconcile first**: the file contains queries to find duplicate/format-violating usernames — fix those rows or the index build fails. Verify the live `admin_traffic_daily` signature before the `CREATE OR REPLACE`. Until applied: creating API keys fails closed, and rate limiting falls back to the old shared per-user bucket (the app logs a warning naming this file on every limited call).

Advisory lock keyspace is now: 0/7/11/23 (pre-existing), 29 (reference images), 31 (saved prompts), 37 (brand rules), 41 (API keys) — documented in the SQL headers.

## 2. Environment variables (production)

- `FAL_ACCOUNT_ID` — pins the fal webhook to your own fal account. Until set, behavior is unchanged and the server logs the observed account id once so you can copy it.
- `MEDIA_SIGNING_SECRET` — decouples "permanent" media URLs from the Supabase service-role key. **Set it once, early, before any future service-key rotation.** Note: the first time you set it, previously issued media URLs are invalidated (one-time cost; the sooner the smaller).
- `SHOWCASE_CHARACTER_ID` / `SHOWCASE_OWNER_ID` (optional) — the showcase route's ids; code falls back to the current hardcoded values.

## 3. Stripe dashboard

- **Webhook endpoint**: add these event types to the existing endpoint subscription: `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.dispute.created`.
- **Dunning**: review Billing → Subscriptions and emails → what happens when payments fail. The code no longer grants plan allowance to `past_due`/`unpaid` accounts, so either setting is now safe — but "cancel after N retries" is still recommended so dead subscriptions eventually emit `customer.subscription.deleted`.

## 4. Supabase dashboard

- Authentication → Email: enable **"Secure email change"** (double opt-in) — the code now requires the current password and pins the redirect, but double opt-in is the backstop against session-theft email takeover.
- Storage: `user-actions.sql` sets bucket `file_size_limit`/`allowed_mime_types`; spot-check the bucket ids match (`chat-attachments`, `character-references`, `generated-images`) and that legitimate existing content fits the limits.

## 5. Schema re-snapshot (strongly recommended)

Three independent reviewers hit tables with no DDL in the repo (`api_keys`, `push_tokens`, `reference_image_generations`, `feedback`, `saved_prompts`, `prompt_assists`, `brand_rules`, `generation_jobs`, `credit_purchases`, `promo_codes`, `promo_redemptions`, `model_health`, plus admin view grants). Re-snapshot the live schema into `supabase/schema.sql` (e.g. `supabase db dump --schema public`) so RLS posture is versioned and auditable again. While there, specifically verify:
- `api_keys`: INSERT policy has `WITH CHECK (user_id = auth.uid())`; SELECT owner-scoped.
- `reference_image_generations`: after user-actions.sql, `authenticated` has no INSERT/UPDATE/DELETE grants.
- `push_tokens`: owner-scoped SELECT/DELETE only; INSERT/UPDATE revoked from `authenticated`.

## 6. Post-deploy smoke test

- **CSP** (biggest deploy-behavior change): log in, first-paint theme correct, run a generation and play the resulting video (served from `*.fal.media`), complete a Stripe checkout, open the billing portal ("Manage billing"), check the browser console for CSP violations.
- **Billing**: buy a credit pack on a free-tier account and confirm the credits are spendable (the round's #1 finding).
- **Webhooks**: Stripe endpoint shows the new event types delivering 200s; fal webhook still 200s (watch for the `FAL_ACCOUNT_ID` log line if unset).
- **Native shell**: confirm the iOS app no longer shows the "Install the app" card.

## 7. Pricing restructure (2026-08-19) — Stripe actions

The credits restructure (PLAN_LIMITS multiplied, $9 Basic tier, packs repriced to $15/$42/$99, annual trimmed to ~15%) ships fully fail-closed: everything below unlocks selling the new things, and nothing breaks while you get to it. Existing subscribers keep their Stripe price and simply receive the larger allowances on deploy — no migration.

1. **Basic tier prices** (unlocks selling Basic): in the LIVE Stripe Dashboard create a Product "Picacho Basic" with a **$9.00/month** recurring USD Price and a **€9.00/month** recurring EUR Price on the same Product (same shape as the four existing plan products). Paste the two price ids into `PLAN_PRICE_IDS.basic` and `PLAN_PRICE_IDS_EUR.basic` in `src/lib/stripe/plans.ts`. Until then the Basic card renders but checkout says "This plan isn't set up for checkout yet."
2. **Credit pack re-setup** (unlocks buying packs again): run `node setup-credit-packs.js` locally against the LIVE key. It reuses the existing pack Products, creates new Prices at the new amounts ($15/$42/$99 + EUR twins; a Stripe Price's amount is immutable, so new Prices are required), and prints the two id blocks — paste them into `CREDIT_PACK_PRICE_IDS` / `CREDIT_PACK_PRICE_IDS_EUR` in `src/lib/stripe/credit-packs.ts` (currently nulled, so packs are hidden and checkout fails closed until you do). Optionally archive the old $45/$119/$279 Prices in the Dashboard — the webhook still grants for any payment that straddled the deploy via `LEGACY_CREDIT_PACK_PRICE_CREDITS`, which is safe to delete from the code after ~30 days.
3. **Annual prices**: nothing to create — annual checkouts build inline `price_data` from `PRICING_TIERS.annualPrice`, so the 15% rates are live on deploy for new checkouts only.
4. Smoke test after pasting ids: buy Basic monthly (USD + a EU-geo check for EUR), buy the small pack, and confirm the webhook grants 20 credits.

## 8. Google Play submission (Android app) — 2026-08-19

The Android shell is submission-ready in code: versionName 1.4.0 / versionCode 1, targetSdk 36, `POST_NOTIFICATIONS` declared, offline fallback wired (`server.errorPath`), reader-mode gating verified, and an unsigned release AAB builds (`android/app/build/outputs/bundle/release/app-release.aab`). Everything below happens in the Play Console or on your machine. Policy facts were re-verified against Google's own pages on 2026-08-19 — sources linked inline.

### 8.1 Decide the account type FIRST — it changes the whole timeline

- **Personal developer account** (created after Nov 13, 2023): before you can publish to production you must run a **closed test with at least 12 testers opted in continuously for 14 days**, then apply for production access and answer questions about your testing ([official requirement](https://support.google.com/googleplay/android-developer/answer/14151465); it was 20 testers until Dec 2024, now 12). Testers who drop out and rejoin restart their own 14-day clock.
- **Organization account** (registered with a legal entity + D-U-N-S number): exempt from the 12-tester requirement entirely. If Picacho has a legal entity, an organization account is strictly less friction and looks better for a business product; if not, budget the 14+ days and line up 12 real people (they must actually open and use the app — Google evaluates engagement, not just opt-ins).

### 8.2 Create the app

Play Console → Create app: name **Picacho**, App (not game), **Free** (a free app can never later become paid — fine here, all selling stays on the web). The package id `ai.picacho.app` is claimed by the first AAB upload, not at app creation.

### 8.3 Play App Signing + upload key (do NOT commit any of this)

Use Play App Signing (default for new apps): Google holds the app signing key; you sign uploads with a separate **upload key**. Losing the upload key is recoverable through Play support precisely because Google holds the real one.

Generate the upload keystore **outside the repo** (note: `android/.gitignore` does NOT ignore `*.jks` — keep it out of the tree):

```bash
keytool -genkeypair -v \
  -keystore ~/keystores/picacho-upload.jks \
  -alias picacho-upload \
  -keyalg RSA -keysize 2048 -validity 9125 \
  -dname "CN=Picacho, O=Picacho, C=US"
```

Then wire it into `android/app/build.gradle` (inside the existing `android { … }` block, values via an untracked `~/keystores/picacho-keystore.properties` or environment — never literals in the file):

```groovy
def ksProps = new Properties()
def ksFile = file("${System.properties['user.home']}/keystores/picacho-keystore.properties")
if (ksFile.exists()) ksProps.load(new FileInputStream(ksFile))

signingConfigs {
    release {
        storeFile file(ksProps['storeFile'] ?: 'MISSING')
        storePassword ksProps['storePassword']
        keyAlias ksProps['keyAlias']
        keyPassword ksProps['keyPassword']
    }
}
// and inside buildTypes.release:  signingConfig signingConfigs.release
```

Rebuild with `cd android && ANDROID_HOME=~/Library/Android/sdk ./gradlew bundleRelease` — the AAB is now signed with the upload key. (Or Android Studio: Build → Generate Signed App Bundle.)

### 8.4 Closed testing track first

Testing → Closed testing → create a track → upload the AAB → add tester emails → start rollout → send testers the opt-in link. If on a personal account: keep ≥12 opted in for 14 unbroken days, visibly respond to feedback, then Apply for production from the Dashboard (review typically ≤7 days). Every later upload must bump `versionCode` in `android/app/build.gradle` (never reuse a value); keep `versionName` in step with `src/lib/changelog.ts`.

Target API sanity: the app targets **API 36**, which is what Google requires for new apps from **Aug 31, 2026** ([target API policy](https://support.google.com/googleplay/android-developer/answer/11926878)) — compliant now and after the deadline.

### 8.5 Store listing assets ([official specs](https://support.google.com/googleplay/android-developer/answer/9866151), current as of 2026-08-19)

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512, 32-bit PNG **with** alpha, ≤1024 KB | **Exists**: `android/play-store-icon-512.png` (512×512, alpha, 19 KB) |
| Feature graphic | 1024×500, JPEG or 24-bit PNG (**no** alpha) — **required to publish** | Needs creating (wordmark on flat paper/ochre works) |
| Phone screenshots | Min 2, JPEG/24-bit PNG, each side 320–3840 px; use 1080×1920 portrait (9:16 minimum 1080×1920 for large-format recommendation eligibility) | Take in the closed-test build: composer, a finished render with its identity score, History, Settings |
| 7"/10" tablet screenshots | Same formats; Google recommends ≥4 at 16:9 or 9:16 (1080–7680 px) for large-screen surfaces | Optional but cheap via a tablet emulator |
| Short description | ≤80 chars | — |
| Full description | ≤4000 chars | Do NOT mention prices/plans (keeps the listing consistent with the no-purchase app) |

### 8.6 App content declarations (Policy → App content)

- **Privacy policy URL**: `https://picacho.ai/privacy` — live, and already states data collected + Settings deletion (verified 2026-08-19).
- **App access**: login is required, so provide a **demo account with an active plan and real generation history** — reviewers reject accounts that open onto an empty app (same advice as the iOS section of MOBILE_APP.md). Free-trial-only demo accounts read as broken; comp the account a plan.
- **Ads**: contains no ads.
- **Content rating (IARC questionnaire)**: it's a productivity/creativity tool; answer the generative-AI questions honestly — users generate images/video of their own characters, output is private to the account, the public /gallery is admin-curated only (no user-to-user sharing in-app).
- **Target audience**: 18+ (a business/creator tool; selecting under-18 buckets triggers Families policy obligations for no benefit).
- **News app**: No. **Government app**: No. **Financial features**: none.

### 8.7 Data safety form — derived from what the app ACTUALLY collects

Everything is transmitted over HTTPS ("data encrypted in transit": **yes**). Nothing is sold; fal.ai (generation) and Stripe (web-only payments) act as processors on Picacho's behalf, which Play's definitions do not count as "sharing".

Declare **collected**:
- **Personal info → Email address** — account creation/sign-in (required). **Name** — optional username/company profile fields (Settings).
- **Photos and videos** — reference photos the user uploads or captures, and generated images/videos; stored on Picacho's servers (Supabase storage), processed by the AI provider to fulfill the generation.
- **App activity → App interactions** — first-party page-view analytics (`page_views` table: path, pseudonymous visitor id, country, referrer). No third-party analytics/ads SDK exists in the app.
- **Device or other IDs** — the FCM push token (`push_tokens` table), used only to deliver render-finished notifications.
- **Approximate location** — country only, derived server-side from IP for EUR pricing and the analytics country column; declare as app functionality + analytics, not shared. (Conservative-honest: it's region-level, never GPS.)

Explicitly **not** collected in-app: payment/card data (all purchases happen on the website via Stripe; the app contains no purchase flow), precise location, contacts, background camera/mic access (photo capture only happens when the user attaches a reference photo).

**Account deletion** (required since the app allows account creation — [policy](https://support.google.com/googleplay/android-developer/answer/13327111)): in-app path **exists** (Settings → Account → Danger zone → Delete account; also cancels the Stripe subscription). The form also demands a **web URL usable without reinstalling the app** — use `https://picacho.ai/app/settings`: because the app IS the website, the same signed-in Settings screen works in any browser. That satisfies the requirement as written; a nicer dedicated `/delete-account` explainer page is optional polish, not a blocker.

### 8.8 Billing posture — what the app must NOT do

Google's payments policy explicitly permits consumption-only apps ("any product(s) or service(s) … cannot be purchased from within the app") and — unlike Apple — even allows informational language like "Go to our website to upgrade" **provided there is no direct link** ([payments policy](https://support.google.com/googleplay/android-developer/answer/10281818)). Picacho is stricter than required (shows nothing at all), which also keeps iOS parity. Keep it that way:

- No pricing/plan-purchase UI, no buy-credits UI, no Stripe Customer Portal (it can take payment), no tappable link that lands on any page that sells.
- Server-side enforcement is already in place: `createCheckoutSession`, `createCreditCheckoutSession`, and `createPortalSession` all refuse native-app requests (`blockInNativeApp()` in `src/lib/stripe/actions.ts`), and every purchase surface is server-gated on `isNativeApp()` (pricing page, homepage pricing section, comparison pages, header/footer pricing links, Settings plan card + BuyCreditsPanel, composer shortfall button).
- The webview-wrapper policy risk is owned: Play forbids apps "whose primary purpose is to drive affiliate traffic to a website or provide a webview of a website **without permission from the website owner**" and low-value wrappers under Minimum Functionality ([policy overview](https://support.google.com/googleplay/android-developer/answer/16549787); [Play Academy course](https://playacademy.exceedlms.com/student/path/65190-comply-with-google-play-s-spam-and-minimum-functionality-policies)). Picacho wraps its OWN site and ships real native capability (push for finished renders, camera capture, bottom tab bar, offline fallback) — but expect reviewers to look; the demo account with history is your best defense.

### 8.9 App Links (assetlinks.json) — deliberately NOT configured for v1

Decision, not an omission: the manifest has no `https://picacho.ai` intent-filter and no `public/.well-known/assetlinks.json` exists. Consequences: links in emails (signup confirmation, render-finished) open the phone's browser rather than the app; notification taps still deep-route correctly inside the app via the push payload's `data.path` (no App Links involved). The verification fingerprint that assetlinks.json needs is the **app signing key's SHA-256, which only exists after Play App Signing is set up** (Play Console → Test and release → App signing) — that ordering is why it's deferred rather than half-wired with a placeholder. To adopt later: add an `autoVerify` intent-filter for `picacho.ai` to `android/app/src/main/AndroidManifest.xml`, publish `/.well-known/assetlinks.json` with that SHA-256, and re-test email links.

### 8.10 Push sanity check before rollout

`google-services.json` is present and `POST_NOTIFICATIONS` is now declared (Android 13+ shows nothing without it; the app prompts after sign-in, not at first launch). Confirm production has `FCM_SERVICE_ACCOUNT_JSON` + `FCM_PROJECT_ID` set (used by `src/lib/push/send.ts`). On a real device: sign in → allow notifications → start a render → background the app → the finished-render push must arrive and tapping it must open that render.

## Known accepted trade-offs (no action needed, just awareness)

- Reference-image caps reserve the slot **before** the paid provider call (that's what closed the unlimited-free-generations race). The flip side: if the serverless function dies mid-call (timeout/OOM/deploy), the catch-block refund never runs and the slot stays burned — for a free-tier account that's one of only 2 lifetime tries. Rare, and recoverable by support (reset `free_reference_generations_used` / delete the orphaned `reference_image_generations` row); a proper meter-reaper needs the live table schema, which the repo doesn't version yet (see §5).

- `/api/track` rate limit is in-memory per serverless instance — best-effort by design.
- The recovery-session check in `updatePasswordFromRecovery` fails open when the JWT lacks an `amr` claim (Supabase's vocabulary isn't contractual).
- Admin error banner now shows allowlisted/generic messages only; raw Stripe/Postgres detail is in server logs.
- All `api_rate_check` callers share one per-user hit bucket (no endpoint column) — caps interact across endpoints when tuning.
