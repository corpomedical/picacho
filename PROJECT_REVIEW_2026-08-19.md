# Picacho — Full Project Review (2026-08-19)

Seven parallel subsystem reviews (billing/Stripe, generation pipeline, public API, auth/middleware, admin, user server actions, frontend) plus baseline checks. Every finding below was verified against the actual code by the reviewer before being reported; several candidate findings were discarded as already-defended.

**Baseline:** typecheck clean; hook-order check clean; eslint: 5 errors (all `require()` imports in the two standalone Node scripts `backfill-billing-period.js` / `setup-credit-packs.js`) + 55 warnings (mostly react-hooks style). No secrets tracked in git; `.env*` correctly ignored. `_snap8.tgz` at the repo root is untracked but **not** gitignored — a careless `git add -A` would commit it.

---

## Priority 1 — money and billing correctness

1. **HIGH — Free-tier users can buy credits they can't spend.** `src/lib/generations/core.ts:182-197`. Nothing gates credit-pack purchase (`credit-packs.ts:73-76` says "anyone can top up"; `BuyCreditsPanel` renders unconditionally), but the free-tier allowance branch (`plan === "none" && bonus_credits === 0`) returns "You've used all 5 free generations" without ever consulting `purchased_credits`. A trial user who pays €45 for 20 credits gets nothing — guaranteed chargeback. This is the exact outcome `stripe/actions.ts:189-191` calls "the one outcome worth being paranoid about."

2. **HIGH — Credits granted before payment confirmation.** `src/app/api/webhooks/stripe/route.ts:143`. `checkout.session.completed` grants credits without checking `session.payment_status === "paid"`, and there are no `async_payment_succeeded/failed` handlers. Checkout uses automatic payment methods, so enabling any delayed-notification method (SEPA, bank transfer — plausible for a Spain-settled account) makes this free credits: session completes `unpaid`, credits grant, payment later fails, nothing claws back.

3. **HIGH — Quota enforcement ignores `plan_status`.** `src/lib/generations/core.ts:133` + webhook `route.ts:227-238`. Only `customer.subscription.deleted` clears `plan`. (a) Upgrade to Elite with a declining card: `subscription.updated` still writes `plan: "elite"` with `plan_status: "past_due"` → Elite quota for €19. (b) Renewal failure leaves `past_due`/`unpaid` accounts with full monthly allowance indefinitely if Stripe dunning doesn't cancel.

4. **HIGH — Deleting a user never cancels their Stripe subscription.** `src/lib/admin/actions.ts:85-135` and self-serve `src/lib/profile/actions.ts:195`. No `subscriptions.cancel`/`customers.del` anywhere in the repo; after deletion the webhook's `stripe_customer_id` lookup no-ops. A deleted paying subscriber keeps getting charged monthly with no account, no service, and no in-app way to cancel.

5. **MEDIUM — Chargebacks don't claw back credits.** `webhooks/stripe/route.ts:269`. Only `charge.refunded` reverses a grant; `charge.dispute.*` is unhandled. Buy pack → spend credits → dispute charge: money pulled, credits stay. The exact "buy, spend, claw back, repeat" loop the refund handler's comment says must not exist.

6. **MEDIUM — No webhook event-ordering guard.** `webhooks/stripe/route.ts:188-240`. Subscription handlers blindly overwrite profile state; a retried `subscription.updated` delivered after `subscription.deleted` resurrects a canceled plan permanently (Stripe retries up to 3 days, no ordering guarantee). Compare `event.created` or track processed events.

7. **MEDIUM — Subscription handlers don't check subscription ID; no server-side "already subscribed" guard.** `webhooks/stripe/route.ts:244-262`, `stripe/actions.ts:32`. A subscribed user POSTing the checkout action directly gets a second concurrent subscription; whichever sub's events land last own the profile, and canceling either sets `plan: "none"` (a stray Starter sub deletion can wipe an Elite profile).

8. **LOW — Refund clawback not atomic/duplicate-safe.** `webhooks/stripe/route.ts:311-319`. `decrement_purchased_credits` and the `refunded_at` marker are separate statements with the marker-update error ignored; concurrent/redelivered `charge.refunded` decrements twice, silently eating credits from other packs. (The grant side, `record_credit_purchase`, was made atomic; the reverse side wasn't.)

## Priority 2 — meter poisoning and pipeline races

9. **HIGH — Multi-angle abort zeroes credits across the whole client-supplied `angle_group_id`.** `src/lib/generations/actions.ts:1727-1736`. The abort path zeroes `credits_used`/`purchased_credits_used` and fails **every** row matching `angle_group_id` (client-supplied, no uniqueness constraint — `schema.sql:173`), not just the fresh placeholders. Replaying an old succeeded batch's group id plus a forced concurrent-spend loss wipes ~hundreds of credits of historical usage on the admin client — bypassing the flag-gated refund path and refilling the monthly meter. Same class round 5 fixed elsewhere. (Shared-scene failure path 1814-1825 has the same over-broad keying for the status flip.)

10. **HIGH — Multi-angle Stop race submits paid renders after cancel.** `src/lib/generations/actions.ts:1774-1875`. `runMultiAngleGeneration` never checks `cancel_requested` between reserving rows and submitting renders (the shared-scene compile takes seconds and gets no `checkCancelled`, unlike `runGeneration`). Stop during compile → all N paid fal renders submitted anyway → webhook/reaper later delivers and charges every angle as a success.

11. **HIGH — Reference-image caps are a non-atomic read-check-write.** `src/lib/characters/actions.ts:153-197, 312-323`. Free-tier lifetime and paid monthly caps both race: a concurrent burst all reads used=0, all bill paid OpenAI/fal calls, all write 1. Repeatable forever. Exactly the race class `reserve_generation`/`record_prompt_assist` fixed on the composer paths but missed here.

12. **MEDIUM — `finish()` treats a failed terminal UPDATE as "already terminal."** `src/lib/generations/job-runner.ts:432-464`. On a transient DB error the job row is still deleted and success returned: webhook answers 200, polls get "gone", reaper has nothing to scan — generation permanently stranded at `generating`, charged, never delivered. Distinguish error from already-terminal; delete the job row only after a confirmed transition.

13. **MEDIUM — Transport failure on result fetch terminally fails a billed render.** `job-runner.ts:755-782`. After winning the advance claim on COMPLETED, a single 30s timeout/5xx fetching the result JSON marks the generation `provider_failed`, deletes the job row (no retry possible), keeps the charge (refund flag OFF), and feeds a healthy model a failure toward the circuit breaker. Release the claim and stay `pending`, as `checkQueuedJob` errors already do (617-625).

14. **MEDIUM — Unchecked stage-transition UPDATE can double-submit paid TTS.** `job-runner.ts:692-707, 719-733`. If the UPDATE after a paid `submitSpeechJob` fails silently, the row still says stage `video`; each 90s lease expiry re-claims and submits another paid TTS job until the 45-minute timeout.

15. **MEDIUM — No sweeper for `generating` rows with no job row.** `actions.ts:803-878` and inline image path. `reapStaleJobs` scans only `generation_jobs`; a function death between `reserve_generation` and `saveVideoJob`/terminal update (deploy kill, OOM, inline image path plausibly exceeding the 300s ceiling) strands the placeholder at `generating` forever, permanently counting against the monthly meter with no refund path.

16. **LOW** — `saveVideoJob` failure after successful submit never cancels the fal job (platform pays for an orphaned render) — `job-runner.ts:380-421` / `actions.ts:1055-1062`. `cancelQueueRequest` has no fetch timeout and is awaited on the Stop path — `providers/fal.ts:178-185`. `recordModelFailure` read-modify-write loses counts exactly during outage bursts — `model-health.ts:67-107`. Daily refund cap counts zero-credit abort releases as "forgiven", withholding legitimate refunds — `job-runner.ts:239-267`. Fal webhook doesn't pin `x-fal-webhook-user-id` to our account (any fal customer can send authentically-signed webhooks; currently harmless only because the handler re-checks everything) — `webhooks/fal/route.ts:45-93`.

## Priority 3 — security posture

17. **MEDIUM — CSP allows `'unsafe-inline'` scripts with wide-open `connect-src`/`img-src`.** `next.config.ts:76`. Any injected script executes and can exfiltrate to any HTTPS host — the CSP provides almost no XSS containment. Move theme/JSON-LD inline scripts to a nonce; tighten `connect-src`.

18. **MEDIUM — Suspension is enforced only by middleware path prefix for the core generate action.** `src/lib/supabase/middleware.ts:49` vs `generations/actions.ts:529-532`. The generate action reads the profile but never `status` (prompt-assist and the API path do check). A suspended user's still-valid token (~1h) works wherever routing bypasses `/app`. Add the `status` gate in the action.

19. **MEDIUM — Email change: no `emailRedirectTo`, no re-authentication.** `profile/actions.ts:157-168`. Confirmation link falls back to the Supabase dashboard Site URL; and a hijacked session can begin account-email takeover with no password re-entry (fully, if "Secure email change" isn't enabled in the dashboard — verify it is). Related LOW: `updatePassword` (171-186) requires no current password from the Settings entry point.

20. **MEDIUM — Admin role check lives only in the layout.** `src/app/admin/layout.tsx:14-29`. Layouts don't re-run on soft navigation; three service-role data paths have no check of their own (`getUserActivity`, `getAllModelHealth`, `admin_traffic_daily` RPC), so a demoted admin keeps reading them until a hard reload. Cheap fix: `requireAdmin()` at the top of each page or inside the service-role helpers. (Good news: all 21 admin server actions do call `requireAdmin()` first.)

21. **MEDIUM — `/api/track` accepts unauthenticated, un-rate-limited inserts.** `src/app/api/track/route.ts:72`. The Origin guard only rejects when Origin is present; a curl loop inserts unbounded `page_views` rows — table bloat and poisoned admin analytics.

22. **MEDIUM — Storage limits exist only in the server action.** `attachments/actions.ts:30-38` + storage RLS. Users can upload directly to their own folders via PostgREST with the anon key; no bucket `file_size_limit`/`allowed_mime_types` in the repo — the 25MB cap is bypassable, unbounded storage cost.

23. **MEDIUM — No rate limit on `transcribeVoice`/`synthesizeVoice`.** `voice/actions.ts:59-94, 96-129`. `previewVoice` got the `api_rate_check` limiter for exactly this reason; these two didn't — unbounded OpenAI billing from one cheap account.

24. **MEDIUM — `username` uniqueness/format enforced only app-side.** `schema.sql:25, 416-418` + `profile/actions.ts:63-80`. `authenticated` has direct column UPDATE; direct PATCH can take an admin's username (UI impersonation) or store megabytes. Bonus bug: the `ilike` check treats `_` as a wildcard, so `a_c` falsely collides with `abc`; concurrent calls race past uniqueness.

25. **MEDIUM — `push_tokens` upsert can't both satisfy owner-scoped RLS and work.** `push/actions.ts:25-33`. Either re-registration on a re-used device fails and the previous owner keeps receiving the new owner's notifications, or the policy is permissive and tokens are claimable. DDL absent from repo — unverifiable (see #27).

26. **MEDIUM — Promo-code Stripe-id patch error silently discarded.** `admin/promo-actions.ts:90-93`. If the patch fails, the row has null Stripe ids and both `setPromoCodeActive(false)` and `deletePromoCode` skip the Stripe side — code shows off/deleted while Stripe keeps redeeming it. Also: promo rollup sums mixed USD/EUR (`admin/promo/page.tsx:51-60`), so commission owed can be computed in the wrong currency.

## Priority 4 — cross-cutting structural issues

27. **`supabase/schema.sql` has drifted badly** (flagged independently by three reviewers). At least eight live tables the code depends on have no DDL/RLS in the repo: `api_keys`, `push_tokens`, `reference_image_generations`, `feedback`, `saved_prompts`, `prompt_assists`, `brand_rules`, `generation_jobs`, `credit_purchases`, plus `promo_codes`/`promo_redemptions`/`model_health` and the admin view grants. The security posture of the credential table (`api_keys`) and two metering tables is unauditable and unreproducible from the repo — and two potential highs (api-key insert forgery, meter-row self-delete) can't be ruled out without checking the live policies. Re-snapshot from the live project; verify `api_keys` INSERT has `WITH CHECK (user_id = auth.uid())` and that `reference_image_generations` is INSERT-only for `authenticated`.

28. **Unchecked Supabase write results are pervasive** in `job-runner.ts` and abort paths — the pattern behind findings 12 and 14. A small `mustUpdate()` helper that throws on `error` would close the class.

29. **Non-atomic count-then-insert caps** recur: API keys (max 5), saved prompts (200), brand rules, reference images (#11). All race under concurrency; only reference images have real cost impact.

30. **Dependencies pinned to `"latest"`** (`next`, `react`, `react-dom`, `@supabase/ssr`, `@supabase/supabase-js`, `stripe`, and most devDeps) — non-deterministic builds; an upstream auth/SSR regression can ship with no code change. Pin exact versions.

## Priority 5 — frontend bugs (top of 15 reported)

31. **HIGH — Android notification crash locks the composer.** `generate-form.tsx:258`. `new Notification(...)` throws on Android Chrome (page-context constructor illegal) and runs before success bookkeeping in both submit paths: a backgrounded render finishes, the constructor throws, the result never appears and the composer stays locked on Stop.

32. **HIGH — "Replay walkthrough" is dead.** `app-sidebar.tsx:1002`. Links to `/app?tour=1` but `/app` is now a dashboard with no `GenerateForm`; nothing consumes the param. Even `/app/generate?tour=1` navigates away from the page the tour runs on.

33. **HIGH — Hardcoded English on translated surfaces** at the worst moments: the entire insufficient-credits banner, queue progress, poll-loss copy, upload failures, and the Generate page header/stats (`generate-form.tsx` multiple sites; `app/generate/page.tsx:105-114`). None exist in `src/lib/i18n/messages/*`.

34. **MEDIUM** — Creation-mode chip clear button not disabled while submitting: wipes the live thread mid-render (`generate-form.tsx:4185-4193` + reset effect 2287-2290). Multi-angle Stop shows a red failure card instead of a clean stopped state (2168-2214). Search dialog has no stale-response guard — out-of-order results win (`search-dialog.tsx:94-106`). Onboarding tour claims a focus trap it doesn't have (`onboarding-tour.tsx:409-421`). "Install the app" card shows inside the native iOS shell — App Review flag risk (`install-app-hint.tsx:31-55`). Voice preview audio keeps playing after navigation, no unmount cleanup (`voice-preview-button.tsx:51-84`). `URL.createObjectURL` previews never revoked (`character-form.tsx:153`).

35. **LOW** — `?error=` query params rendered verbatim in trusted chrome (settings page, admin banner) — phishing-text planting, not XSS. Lightbox has no focus management and `alt=""`. Live result bubble uses current `contentType` instead of the submitted one (`generate-form.tsx:3613`). Timestamps show "1 minute ago" for 2-second-old messages.

## Smaller items worth batching

- Latent quantity bug: webhook credits ignore `line_item.quantity` (safe today, wrong the day adjustable quantity is enabled) — `webhooks/stripe/route.ts:149-151`.
- `setup-credit-packs.js` hand-copies `CREDIT_PACKS` despite a comment claiming it reads the shared file — they can drift.
- Two purchases before the first webhook create two Stripe customers for one profile (pass `customer` up front).
- `geo.ts:21` trusts `x-vercel-ip-country` — currency becomes client-controllable off-Vercel.
- Annual subs use ad-hoc inline prices, so admin MRR/currency reporting misvalues every annual subscriber.
- `mediaSig` is keyed off `SUPABASE_SERVICE_ROLE_KEY` — rotating the service key (the normal response to a leak) silently breaks every "permanent" media URL. Use a dedicated `MEDIA_SIGNING_SECRET`.
- v1 docs: rate limit is 30 requests (not generations) per minute — 402s consume slots; recovery GET omits `final_prompt`; real production UUIDs embedded in public docs.
- `usage` endpoint's `remaining_this_period` can read 0 while generations still succeed on purchased credits — document the second budget.
- Unguarded `JSON.parse` on client form fields in character actions (500s on malformed input); several unbounded text fields (`source_input`, brand-rule `label`, `gender`) with no length caps.
- `setUserStatus` updates profile before the auth-layer ban with a redirect-out on error — the two layers can desync.
- `deleteUser` redirects with `?message=` the users page never reads — success confirmation never displayed.
- Admin dashboard fetches all `generations`/`profiles` rows with no cap — fine today, quadratic later.
- `aspect-ratio.ts:18` — "a portrait of the character" silently forces 9:16.
- Failure push notification promises "credits weren't charged if it was our fault" while automatic refunds are OFF.
- `_snap8.tgz` untracked and unignored at repo root.

## What's solid (verified non-findings)

- **Public API**: per-user filtering everywhere (no IDOR), identical 404s (no existence oracle), shared atomic `reserve_generation` with the composer (no quota divergence), 32-byte CSPRNG keys stored hash-only, timing-safe media HMAC before storage access.
- **Auth**: `safeNext()` open-redirect guards are tight; `getOrigin()` clamps host spoofing; service-role key never reaches client bundles; Next 16 server-action CSRF covers the Capacitor origin; clickjacking and HSTS headers present.
- **Admin**: all 21 exported admin server actions call `requireAdmin()` first; column-level `REVOKE UPDATE` on `profiles` blocks role/plan/credit writes even through admin RLS.
- **Billing**: webhook signature handling, atomic `record_credit_purchase` idempotency, server-side price-id selection, `return_to` allowlist.
- **Frontend**: no real XSS surface; deep-link allowlisting correct; hydration hygiene exemplary; client-side gating consistently re-validated server-side.
- **Ownership discipline** in user actions: every mutation pairs `.eq("id", …)` with `.eq("user_id", …)`, treating RLS as backup, not sole defense.
