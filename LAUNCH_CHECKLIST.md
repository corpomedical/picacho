# Picacho launch checklist

From a full read-through of every page, every server action, and the live database, done 2026-08-06. Refreshed 2026-08-08 with a final-revision pass, then again the same day once the app actually went live.

## Live now

Picacho is deployed and reachable at **https://picacho.io** and **https://picacho.ai** (both point at the same Vercel project, no redirect between them — that was a deliberate choice). GitHub repo: `corpomedical/picacho`. Every push to `master` auto-deploys.

One caveat worth flagging: Vercel's free Hobby plan caps a single request at 300 seconds. The video pipeline (Kling generation + optional dialogue/lipsync) can in rare worst-case combinations take longer than that — a generation that's still legitimately running would get cut off. Covers normal use fine; if "timed out" reports start showing up for longer/dialogue-heavy generations, upgrading to Vercel Pro + enabling Fluid Compute raises the ceiling back to 800s (see the comment in `src/app/app/generate/page.tsx`).

## Before launch (blocking)

- [x] **Turn on real AI providers.** All three keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FAL_KEY`) are saved in `.env.local` (2026-08-07), and `real_ai_providers` is now ON in the live database. Important caveat: I couldn't verify these keys actually work — my sandbox blocks outbound calls to api.anthropic.com, api.openai.com, and fal.ai (only an allowlisted set of domains, like Supabase, are reachable from here), so I could only confirm the keys were saved correctly, not that they're valid or that billing is set up on each provider. **First real test should be a real generation once the app is deployed (or run locally)** — if a generation fails, the most likely causes are a typo in a key or billing not finished on one of the three provider dashboards.
- [ ] **Add at least one real voice.** `voice_presets` is still empty — the dialogue/lip-sync feature is fully built but inert. Go to elevenlabs.io/voice-library, preview a few, and paste one's `voice_id` in (Admin > Voices, or just hand it to me and I'll add the row directly). One thing worth knowing: ElevenLabs' classic named voices (Rachel, Adam, Bella, George, etc.) are being retired and expire December 31, 2026 — pick from their current library, not those.
- [x] **Verify OAuth sign-in actually works.** Google and Facebook are both configured (2026-08-07) — real Client ID/Secret entered in Supabase for each, both providers enabled. Facebook's app is still in Development mode on Meta's side, so only you (and anyone added as a tester on the Facebook app) can sign in with it until it's switched to Live — fine for now, revisit before public launch. Microsoft is on hold: the personal Microsoft account hit a wall needing a real Azure AD tenant (M365 Developer sandbox declined it, Azure free signup wants a card) — its button is commented out in `oauth-buttons.tsx` until that's sorted, so it won't show as a broken option on the login page.
  - [ ] **Real user hit a broken Google sign-in, 2026-08-09** — bounced back to a public page with no session. Database shows their `auth.users` row was created (Google identity got linked) but `last_sign_in_at` is null, i.e. the flow died on the last step, not the first. Hardened `oauth-buttons.tsx`/`forgot-password-form.tsx` (`src/lib/client-origin.ts`, new) the same way `getOrigin()` already was, so a stray `*.vercel.app` origin can't leak into `redirectTo` — same bug class as the earlier Stripe redirect issue. Not fully closed: still needs Wigly to check the Supabase Auth Logs for this specific failed attempt (Dashboard > Authentication > Logs) for the actual error, and screenshot Authentication > URL Configuration (both Site URL and the Redirect URLs allowlist) — I can't read either of those through my tools. This is the same underlying dashboard setting flagged below as "still localhost."
- [x] **"Allow new signups" flag.** Now a real kill switch (2026-08-06) — `/signup` and the `signup` action both check it server-side. Off shows a "signups are closed" screen instead of the form; missing/errored row fails open so a database hiccup can't silently lock everyone out.
- [x] **Connect Stripe.** Checkout, the Customer Portal, and a webhook that keeps `profiles.plan` in sync are all built (2026-08-06). Went live 2026-08-09:
  - [x] Create the 4 products/prices in the Stripe Dashboard and give Claude the Price IDs so `src/lib/stripe/plans.ts` can be filled in. Done 2026-08-06 (test mode), redone 2026-08-09 in live mode via `setup-live-stripe.js` (a one-off script run locally, since this sandbox can't reach api.stripe.com) — `plans.ts` now has the live price IDs.
  - [x] Webhook endpoint registered — first attempt (2026-08-08) accidentally pointed at the raw `picacho-uv7z.vercel.app` deployment URL instead of `picacho.io`, which is why the first live test purchase (2026-08-09) never updated the buyer's `profiles` row. Recreated correctly 2026-08-09 (also via `setup-live-stripe.js`) at `https://picacho.io/api/webhooks/stripe`, listening for the same 4 events. Live signing secret needs to go into `STRIPE_WEBHOOK_SECRET` in Vercel (see below) — never added to `.env.local`, which stays on test-mode keys for local dev.
  - [x] Hardened `getOrigin()` (`src/lib/origin.ts`, 2026-08-09) so a Checkout/Portal redirect can never land on a `*.vercel.app` host again, and so a misconfigured `NEXT_PUBLIC_SITE_URL` pointing at that domain gets rejected outright rather than trusted — this was the root cause of a customer looking signed-out right after paying.
  - [x] **Set live env vars in Vercel and redeploy** — Wigly set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Vercel and redeployed (2026-08-09).
  - [x] Turn on the Customer Portal's "customers can switch plans" setting, and added the 4 live products as eligible (2026-08-09).
  - [x] **Found and fixed a second live-only bug, 2026-08-09**: the live webhook (registered against `picacho.io`) had a 100% error rate — Stripe was hitting a `308 Permanent Redirect` (apex `picacho.io` → `www.picacho.io` at the domain layer) and, unlike a browser, Stripe's webhook sender does not follow redirects, so every event failed before the handler ever ran. A real $19 Starter checkout (Wigly's own account, 2026-08-09) went through in Stripe but never updated `profiles` — diagnosed by checking the row directly (nothing written) and then the endpoint's delivery log (100% error rate). Fixed by pointing the webhook destination straight at `https://www.picacho.ai/api/webhooks/stripe` (no redirect hop), then manually resending the stuck `checkout.session.completed` and `customer.subscription.created` events from that purchase — both now show `200 OK`, and the profile correctly shows `plan: starter`, `plan_status: active`. Confirms live checkout → webhook → `profiles` works end-to-end for new purchases going forward.
  - [x] **EUR pricing for EU customers, 2026-08-09.** Revisited the earlier "keep USD" call once the fee showed up on a real transaction (the first live $19 sale settled as €16.44 gross). EU visitors (`x-vercel-ip-country`, `src/lib/geo.ts`) now get a real EUR-denominated Stripe Price at checkout — same-number swap (€19/€79/€299/€499), not a literal conversion — instead of USD converted at payout or Stripe's Adaptive Pricing (2-4% fluctuating markup). Falls back to USD until `setup-eur-pricing.js` (run locally, same pattern as the original live-Stripe script) creates the 4 EUR Prices and their IDs get pasted into `PLAN_PRICE_IDS_EUR` in `src/lib/stripe/plans.ts`. Pricing page, homepage, and the Settings upsell card all show the right symbol; Admin > Billing and the Admin dashboard now report MRR split by currency instead of summing USD and EUR into one misleading number.
  - [x] **Stripe Tax activated** (Wigly, in the Dashboard, 2026-08-09). Wired `automatic_tax: { enabled: true }` into `createCheckoutSession` (`src/lib/stripe/actions.ts`) the same day — that's what actually makes it apply to real charges; the Dashboard toggle alone doesn't touch existing checkout code. Stripe now collects whatever address it needs and calculates VAT itself at checkout, based on whatever registrations were configured in the Dashboard.
- [x] **Studio/Elite overage pricing.** Dropped the "$2.50 per additional generation" promise from the pricing page and plan cards (2026-08-06) — it matches real behavior now (hard cap, upgrade to raise it). Also found and removed a second dead control while in there: a `studio_overage_billing` feature flag that, like the signups flag above, existed in the database with zero code ever reading it. If metered overage billing gets built later, it's a new feature from scratch, not a flag flip.
- [x] **Set `NEXT_PUBLIC_SITE_URL`** — set to `https://picacho.io` (2026-08-08) in both `.env.local` and Vercel, so `sitemap.ts` and Stripe's checkout redirect URLs point at the real domain.
- [ ] **Confirm Supabase's email-confirmation setting** matches the "check your email to confirm your account" message shown after signup — if confirmation is off, that message is misleading; if it's on, make sure the confirmation email itself is set up and on-brand. Still can't check this one myself — it's a GoTrue/Auth platform setting, not something queryable through the database connection my tools have; needs a look in Supabase Dashboard > Authentication > Sign In / Providers > Email.
- [x] **Deployed.** GitHub repo (`corpomedical/picacho`) connected to Vercel (2026-08-08), auto-deploys on push to `master`. Live at picacho.io / picacho.ai. See "Live now" above for the one caveat (Hobby plan's 300s function timeout).
- [x] **Found and fixed a blank secret that would've silently broken billing.** `SUPABASE_SERVICE_ROLE_KEY` was empty in `.env.local` (2026-08-08) — it's what the Stripe webhook handler uses to update a customer's plan after checkout, bypassing RLS. Blank meant that update would've failed silently once real traffic hit it. Filled in from the Supabase dashboard and added to both `.env.local` and Vercel.

## Full-site scan, 2026-08-09

Scanned the deployed site (both domains) plus the whole codebase. Fixed one live bug; the rest are listed here because they need Wigly's decision or dashboard access.

- [x] **Cross-domain redirect bug — fixed.** `NEXT_PUBLIC_SITE_URL` in Vercel is set to `https://picacho.ai` (confirmed: the live `robots.txt` renders `Sitemap: https://picacho.ai/sitemap.xml`, and the first live Checkout session's `success_url` was `https://picacho.ai/...`). `getOrigin()` returned that env var for *everyone*, so anyone signed in on **picacho.io** who started Checkout was sent back to **picacho.ai** afterwards — a different domain, so the Supabase auth cookie doesn't follow, and they land looking signed out right after paying. Identical failure to the earlier `*.vercel.app` incident, just between the two real domains, and it survived that fix. `getOrigin()` now keys off the request's own Host and stays on whichever known host the visitor is already using (`KNOWN_HOSTS` in `src/lib/origin.ts`), falling back to the env var only for unrecognized hosts. No env-var change needed.
- [x] **Canonical domain set to picacho.ai** (Wigly's call, 2026-08-09). `picacho.io` and `picacho.ai` return byte-identical pages with no redirect between them (deliberate, per "Live now" above), which had Google seeing two complete duplicate sites and splitting ranking signals. `src/app/layout.tsx` now sets `metadataBase` + `alternates.canonical` pointing at picacho.ai, so picacho.io stays reachable but stops competing with itself.
  - [ ] **Optional follow-up:** add a 301 redirect `picacho.io` → `picacho.ai` in Vercel (Project > Settings > Domains > Redirect). The canonical tag already consolidates SEO; a 301 additionally consolidates direct traffic and removes the two-domains-one-app confusion for good. Not done here because it changes real user-facing behavior for anyone with a picacho.io bookmark.
- [x] **Open Graph / Twitter card metadata added** (2026-08-09). `layout.tsx` previously set only `title`/`description`, so links shared to WhatsApp/X/LinkedIn/iMessage rendered as bare URLs. Now emits full OG + `summary_large_image` Twitter tags, with a purpose-built 1200x630 card at `public/og-image.png` (real logo, hero's sky-50/blue-600 palette, homepage headline).
- [x] **Sitemap trimmed** to marketing + legal routes (2026-08-09). It was also listing `/login`, `/signup`, and `/forgot-password` — auth screens have no business ranking in search, they're arrived at from inside the product.
- [ ] **Leaked-password protection is disabled** (Supabase advisor, `WARN`, external-facing). Supabase Dashboard > Authentication > Providers > Email — turning it on rejects passwords known to appear in HaveIBeenPwned breaches at signup/reset. One toggle, no code change, no downside.
- [x] **Second Supabase advisory (`public.is_admin()` is `SECURITY DEFINER` and executable by `authenticated`) deliberately NOT "fixed", 2026-08-09.** The advisor's suggested remediation is to revoke `EXECUTE` or switch to `SECURITY INVOKER`. Tested the revoke inside a rolled-back transaction against the live database: it fails with `permission denied for function is_admin`, because all 17 admin RLS policies (on `profiles`, `generations`, `feature_flags`, `voice_presets`, `feedback`, and others) call this function during policy evaluation as the querying role. Applying the advisor's advice would break every admin capability in the app. The actual exposure is nil — `is_admin()` takes no arguments and only reports whether *the caller themself* is an admin, which they can already determine by whether admin pages load. Leaving as-is is the correct call; re-verify if the function ever gains parameters or starts returning data about other users.
- [x] `tsc --noEmit` clean across the project. ESLint: 0 errors, 22 warnings, all `react-hooks/set-state-in-effect` in pre-existing components (`search-dialog.tsx`, `theme-provider.tsx`, project form). Non-blocking, no behavior impact.

## Generate composer left stuck on a Server Action failure — fixed, 2026-08-10

Investigated `generation_reports` id `abd93549` ("An unexpected response was received from the server", `/app/generate`, auto-filed 2026-08-09). Root cause: `submitPrompt` and the multi-angle confirm handler in `generate-form.tsx` both called `await runGeneration(...)` / `await runMultiAngleGeneration(...)` with **no try/catch**. That's fine when the action itself returns `{ error }` — but when the *call* throws instead (the response can't be parsed as a valid Server Action response at all), the await rejects, nothing after it runs, and the composer is left stuck in `submitting=true` forever with zero visible feedback. The only reason this was even reported is that the app-wide unhandled-rejection listener (`app-error-reporter.tsx`) caught what the component itself didn't.

The specific trigger that reported user hit: this landed during an unusually dense run of back-to-back deploys (5 pushes in about 2 hours that evening). A deploy landing while a tab is already open leaves the browser running the previous build's JS, which references a Server Action id the now-live server doesn't recognize — no amount of retrying fixes that from the stale tab, only a reload does. Deploy frequency will be back to normal going forward, so this specific trigger is rare, but the underlying gap (an unguarded await that can strand the UI) could be hit by any Server Action failure, not just this one.

Fixed properly rather than just patched: both call sites now catch the failure, restore the composer to a usable state (prompt/attachments/dialogue given back, `submitting` reset), and show a message — specifically recognizing the stale-deploy signature and auto-reloading the page after a beat, generic "check your connection" message otherwise. `tsc`/`eslint` clean. Report `abd93549` marked resolved.

## Admin nav made live — 2026-08-10

Two related requests: make the red-dot badge counts on the admin command bar update without a refresh, and add a drop-down notification banner for the admin area, modeled on `ComposerToast` in `generate-form.tsx` (the pill that rises up from behind the composer on upload errors/limits).

Badge counts were computed once per page load in `admin/layout.tsx` (a Server Component) and handed to `AdminCommandBar` as a static prop — accurate on arrival, frozen after that. Pulled the query logic out into `lib/admin/badges.ts` (`computeAdminBadgeCounts`), added an admin-gated `getAdminBadgeCounts` server action in `lib/admin/actions.ts`, and had `AdminCommandBar` poll it every 10s, updating its own badge state. Plain interval polling, not Supabase Realtime — same "no websocket infrastructure" approach `AutoRefresh` already uses to keep admin/stats numbers live, and cheap enough at one query per open admin tab per 10s.

New `AdminNotificationBanner` component (same file): fixed to the top-center of the viewport, drops down into place instead of rising up (no composer to hide behind in the admin area), same pill shape/color/shadow/timing as `ComposerToast` so it reads as the same design language. Fires whenever a poll finds a badge count went up — a real new signup, flagged item, report, or feedback message, never a false positive from the polling window shifting.

`tsc`/`eslint` clean.

## Global SEO pass — 2026-08-10

Request: "make the site appear on google everywhere anywhere in the world." Found the site had no per-page metadata (every page — pricing, privacy, terms, content policy — showed the identical generic title/description in search results), no structured data, and no Google Search Console verification set up.

Also found something bigger: Picacho already has Spanish, Portuguese, and Italian translations built in, but the language is chosen by a cookie (`picacho_locale`), not the URL — every page only ever exists at one URL regardless of language. Googlebot doesn't carry cookies between crawls, so every crawl sees the English version; the other three languages are effectively invisible to Google no matter where in the world someone searches. Fixing that for real means giving each language its own crawlable URL (`/es`, `/pt`, `/it`) with hreflang tags — a real routing change across the app. Wigly chose the quick pass for now (below); the full multi-language routing is still on the table if international search traffic becomes a priority.

What shipped today:
- [x] **Per-page titles/descriptions.** `/pricing`, `/privacy`, `/terms`, `/content-policy` each now export their own `metadata` (title, description, canonical) instead of inheriting the homepage's. Root layout's `title` is now `{ default, template: "%s | Picacho" }`, so e.g. the pricing page renders as "Pricing | Picacho" instead of just "Picacho" — previously every single page showed the identical title in a Google result, which gives Google nothing to tell them apart with.
- [x] **Homepage `<title>` made descriptive.** It was plain "Picacho" — a real name, but not something a stranger searching would type, and not what OG/Twitter were already using. Now "Picacho — Consistent AI Character Content, On the First Try" everywhere, matching what was already in the Open Graph tags.
- [x] **Structured data (JSON-LD).** `Organization` schema site-wide (root layout — name, url, logo, for Google's knowledge-panel/logo attribution), `SoftwareApplication` schema on the homepage. Deliberately left out ratings/reviews/prices in the structured data — nothing on the page shows a star rating, and fabricating one to get a richer search snippet is what Google's spam policy on structured data exists to catch, not a shortcut worth the risk.
- [x] **Google Search Console verification slot wired up.** `layout.tsx` reads `GOOGLE_SITE_VERIFICATION` and renders the meta tag only when it's set — no broken empty tag in the meantime.

- [x] **Verify picacho.ai in Google Search Console — HTML tag method.** Done 2026-08-10. `GOOGLE_SITE_VERIFICATION` set in Vercel, redeployed, Search Console shows "Ownership verified."
- [x] **Submitted the sitemap** — 2026-08-10, but Search Console shows status "Couldn't fetch." Diagnosed: `https://picacho.ai/` (the exact host the Search Console property was verified for) 308-redirects to `https://www.picacho.ai/` at the domain layer — same redirect-crosses-a-host issue already documented above for the Stripe webhook, just tripping up Search Console's sitemap fetcher this time instead. The sitemap file itself is fine (confirmed live, valid XML) — Search Console just won't reliably follow a cross-subdomain redirect when fetching a sitemap for a verified property, even though it followed the same redirect fine during ownership verification.
  - [ ] **Fix at the source, in Vercel** (recommended over changing the app's canonical to www, which would undo today's branding work): Project → Settings → Domains → find `picacho.ai` and `www.picacho.ai` → whichever is currently marked Production/primary is the one everything redirects *to*. Set `picacho.ai` (no www) as Production, and `www.picacho.ai` to redirect to it — the reverse of how it's set up now. Once that propagates, resubmit the sitemap (or wait — Search Console will retry it on its own).
- [x] **picacho.io deliberately left unverified** — Wigly's call (2026-08-10), to avoid two properties/two listings confusing search results. picacho.ai's canonical tag (`alternates.canonical`, every page) already tells Google picacho.io is the non-primary copy regardless, so this loses nothing.
- [ ] **Bing Webmaster Tools** ([bing.com/webmasters](https://www.bing.com/webmasters)) — covers Bing/Yahoo/DuckDuckGo's index too. Easiest path is "Import from Google Search Console," which pulls in the already-verified site and sitemap in one click.
- [ ] Real indexing takes days to weeks after submission either way — nothing to do but wait once the sitemap's submitted.

## Live usage banner — 2026-08-10

Request: a usage-status card near the composer like the "Now using credits • resets Aug 12 at 2:00 PM" banner in Claude's own app, covering three things: approaching-limit notice, real reset date/time, and a way to get more credits. Two scope decisions made with Wigly up front:
- "Buy tokens" → links to the existing upgrade flow (Settings usage tab), not a new one-time credit purchase. Picacho only sells monthly plan subscriptions today; a real "buy extra credits" purchase would be a new Stripe product + checkout flow + crediting logic, out of scope for this pass.
- Reset date shown → the account's **real** Stripe billing date, not the generic "resets on the 1st" the monthly usage count already used. This turned out to be the bigger half of the work, since nothing in the app tracked each user's actual billing cycle before now.

What shipped:
- [x] **Migration**: `profiles.current_period_start` / `current_period_end` (nullable timestamptz) — anchors each account's real Stripe billing cycle.
- [x] **Stripe webhook** (`api/webhooks/stripe/route.ts`) now writes both on `customer.subscription.created`/`updated`, clears them on `customer.subscription.deleted`. Worth knowing: `current_period_start`/`end` live on each subscription **line item** in this Stripe API version, not the top-level Subscription object anymore (Stripe moved it to support multi-item subscriptions on different cycles) — reads from `subscription.items.data[0]`, same item `priceId` already came from.
- [x] **`getMonthlyUsage`** (`lib/generations/actions.ts`) takes an optional `periodStart` now — uses the account's real billing-cycle start when known, falls back to calendar-month start (its original, only behavior) when null. Both call sites (`checkGenerationAllowance` and `getGenerateWorkspaceData`) fetch `current_period_start` alongside plan/bonus_credits and pass it through, so enforcement and the UI never disagree about the current window.
- [x] **`UsageBanner`** (new component in `generate-form.tsx`, replaces the old plain amber line): shows `{used} of {limit} credits used`, the real reset date when known ("Resets Aug 12 at 2:00 PM") or "Resets on the 1st" as a fallback, an Upgrade link, and a dismiss control. Went through two wrong visual passes before landing on the right one — final version is a flat, light `bg-neutral-50` strip, rendered as a normal-flow sibling directly above the composer `<form>` (not absolutely positioned, no animation), sharing the outer card's `rounded-[22px]` top corners so it and the composer read as one continuous attached shape, matching the reference screenshot Wigly sent of Claude's own "Now using credits" banner.
- [x] i18n: 4 new keys (`approachingLimitUsage`, `usageResetsOn`, `usageResetsFallback`, `dismissUsageBanner`) across en/es/pt/it; removed the now-unused `approachingLimitMessage`.

**Still needed from Wigly**: existing subscribers (anyone who subscribed before today) have `current_period_start`/`end` still null — the webhook only fires on the *next* subscription event for them, which could be days away. Run `node backfill-billing-period.js` locally (same "can't reach api.stripe.com from the sandbox" reason as `setup-live-stripe.js`/`setup-eur-pricing.js` before it) to fetch each existing subscriber's real billing period from Stripe right now instead of waiting. Reads `.env.local` itself — no setup beyond having that file populated. Until it's run, existing subscribers just see the "resets on the 1st" fallback instead of their real date, same as before this feature existed — nothing breaks in the meantime.

`tsc` clean; `eslint` shows only the same 9 pre-existing `react-hooks/set-state-in-effect` warnings from earlier full-project sweeps, none in the new code.

## Image size picker — built, then reverted — 2026-08-10

Request: give image generation the same (<) chevron video already has, plus 2K/4K size options — "only if image generation provides 2k and 4k capabilities." Checked both real providers first: OpenAI's `gpt-image-1`/2 API only accepts `1024x1024`, `1536x1024`, or `1024x1536` as its `size` param, and Flux/dev on fal.ai tops out in that same ~1MP neighborhood. Neither provider can do 2K or 4K.

Built a real square/landscape/portrait picker instead of fake 2K/4K labels (chevron + icon row in `generate-form.tsx`, real `size`/`image_size` params threaded through `openai-images.ts`/`fal-image.ts`/`image.ts`/`pipeline.ts`/`actions.ts`, `IMAGE_SIZES` catalog in `image-models.ts`). Wigly's call after seeing it: even labeling them by shape rather than by resolution still implies a quality/size choice that isn't real when every option is the same ~1MP the provider always produces — closer to it than to being lied to, but a fair concern either way. Fully reverted — every touched file is back to its pre-feature state, nothing shipped.

If size options come back later, it'd need either a provider that's genuinely higher-resolution (e.g. a fal.ai model built for 2K/4K output, not Flux/dev) or framing the picker purely as aspect ratio, not size/quality.

## Voice mode redesign — 2026-08-10

Wigly's report: "the voice mode that supposedly speaks with an AI is not working," plus a redesign brief — clicking the icon should expand the chat like generating mode, show a ChatGPT-style waveform, understand app commands ("pick a character and everything else"), and caption speech in real time.

What was actually broken: the old `voiceMode` was a silent localStorage preference toggle that changed nothing visually — no expand, no waveform, no indicator it was even on beyond the button's own color. The mic button itself used record-then-transcribe-after-you-stop-talking (`MediaRecorder` → upload → OpenAI Whisper), which structurally **cannot** show live captions no matter how it's tuned — there's no partial result until the whole clip is transcribed. Both legs (transcription and the AI's spoken reply) were also gated behind `real_ai_providers` + `OPENAI_API_KEY`, and failures on either were swallowed silently — a misconfigured account would see nothing happen with zero indication why, reading exactly like "not working."

Rebuilt as a real hands-free session instead of a preference toggle:
- [x] **`lib/voice/speech-recognition.ts`** (new): wraps the browser's native Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`) — live, in-browser, no server round-trip, no API key. This is what makes real-time captions possible at all; Whisper's batch model never could. Browser support: Chrome, Edge, Safari — not Firefox, which has no implementation. Unsupported/blocked-mic/lost-mic all surface a real message via the existing error banner instead of silently doing nothing.
- [x] **`lib/voice/commands.ts`**: `parseVoiceCommand` now takes an optional list of the account's own character names and returns a `switch-character` command when what's said matches one ("switch to Mia", "use Mia") — alongside the existing new-chat/navigate command types. Sidebar's global voice command (`app-sidebar.tsx`) is unaffected — it doesn't pass a character list, so that branch never fires there.
- [x] **`VoiceSessionCard`** (new component in `generate-form.tsx`): the "expand like generating mode" piece — renders in the message list with the same rounded-card visual language as the live pipeline-trace bubble, so it reads as an equally weighted live state. Center waveform is 7 CSS-animated bars (`globals.css`'s new `animate-voice-waveform`, respects `prefers-reduced-motion`) rather than real mic amplitude — real amplitude would need a second `getUserMedia`/`AnalyserNode` stream running alongside the recognizer's own internal mic capture, a second permission prompt and a real (if rare) risk of the two streams drifting out of sync for a purely decorative payoff. Shows live interim captions while mid-sentence, then a brief confirmation ("Switched to Mia.") after a recognized command before returning to listening.
- [x] **Session flow** (`generate-form.tsx`): the voice icon starts/stops a session (`startVoiceSession`/`stopVoiceSession`/`handleVoiceFinal`) instead of toggling the old silent preference. A recognized command executes immediately and keeps listening; anything else is treated as an ordinary prompt, closes the session, and hands off to `submitPrompt(text, { speak: true })` — the exact same call a typed-and-sent message uses, so it becomes the familiar generating bubble rather than a second competing expanded state.
- [x] Fixed the swallowed-TTS-error bug: `speak()` now calls `setError(...)` when `synthesizeVoice` reports a real config problem, instead of silently returning — autoplay-blocked (a genuine, non-actionable browser restriction) still fails quietly, same as before.
- [x] The plain mic button (`VoiceRecorderButton`, next to the voice-session icon) is unchanged — still record → Whisper → append to the text box for review before sending. That's a real, distinct capability (dictate without full hands-free mode) and stays as-is.
- [x] i18n: updated `voiceOnTitle`/`voiceOffTitle` copy for the new meaning, added `voiceListeningLabel`/`voiceListeningHint`/`voiceSwitchedCharacter`/`voiceNewChatStarted`/`voiceStopSession` (generate namespace) and `notSupported`/`lostMic` (voice namespace) across en/es/pt/it.

**Two bugs found immediately after the first push** (reported as "it doesn't work" — mic permission prompt appeared, but no card or waveform):
- [x] **Hero mode rendered nothing.** `VoiceSessionCard` was placed inside the message list, and the entire message list sits behind `{!isHero && ...}`. On the dashboard home (`/app`, hero mode) the session started and took the microphone with zero UI to show for it. Fixed by extracting the card to a `voiceSessionCard` variable rendered in both layouts — inside the message list when docked, directly above the composer in hero mode.
- [x] **Fatal errors restarted forever.** `onEnd` restarted the recognizer unconditionally so sessions survive the browser's own silence timeout — but browsers fire `onEnd` right after a fatal `onError` too, so a denied mic would re-trigger the same error in a tight loop. Added `voiceWantsListeningRef` to tell an intentional stop / fatal error apart from a timeout. Same pass also routed `onFinal` through a `handleVoiceFinalRef` so a long-running session doesn't keep calling the first render's closure (which would submit with a stale character after switching by voice).

`tsc` clean; `eslint` shows only the same pre-existing warnings from earlier sweeps, none in the new code.

## Voice agent + the "Hey generated a room" bug — 2026-08-10

Wigly, after the first voice-mode pass: the chat should expand like it does for Create image, the agent should speak first with varied wording, ask image-or-video / which character, and **confirm before generating** — plus "I tried 'Hey' and it generated a room", and Stop didn't stop it.

**Why "Hey" produced a room** — not a voice bug at all. The pipeline's draft/review step (see `pipeline.ts`) exists to expand a sparse prompt into a full scene description, so handed a greeting it invents an entire scene from nothing. Fixed at the entry point: `isTrivialUtterance` (in the new `lib/voice/agent.ts`) rejects input that is *entirely* greeting/filler, checked server-side in `runGeneration`/`runMultiAngleGeneration` so typed input is covered too. Deliberately conservative — it only fires when every word is filler, so short-but-real prompts ("sunset") still go through. Trying to make the refiner itself decline would have been neither cheap nor reliable.

**Why Stop looked broken** — cancellation is cooperative: it flips `cancel_requested`, which the running job checks between steps. A single fast image has already been sent to the provider by the time you press it, so there's nothing to abort, and the finished result was then rendered into the chat and saved to history as if nothing had happened. Now `userStoppedRef` (a ref — `submitPrompt`'s async body captured `stopping` as false and could never see the update) makes the result get discarded on return, and `discardStoppedGeneration` marks the row failed and clears its result URL. Credits are **not** refunded: the provider call really was billed, and quietly zeroing it would move the inaccuracy somewhere harder to notice.

**The agent** (`lib/voice/agent.ts` + the state machine in `generate-form.tsx`) — scripted, not an LLM per turn. Chosen with Wigly for latency (a spoken exchange falls apart at 1-3s per reply) and because a scripted flow can't wander off-task or invent a detail, which is the exact failure being fixed. Flow: opening question spoken before the person says anything → prompt → image-or-video → character (only when they have characters and none is picked; "skip" is a valid answer) → reads the whole request back and waits for a clear yes. `parseYesNo` returns null on anything ambiguous and re-asks rather than guessing — guessing "yes" wrong is what burns a generation. Question wording lives in i18n as **arrays**; `pickPhrasing` picks one at random and avoids repeating the previous one, so it isn't the same sentence every time. Model choice stays on the account default (asking a fourth question every time was the tedious option).

Also in this pass:
- [x] Voice start now sets `creationModeActive`, which is what un-heroes the composer — same expand as picking Create image, rather than a second differently-shaped expanded state.
- [x] Waveform card lost its border/background — it was reading as a white box parked in the chat instead of as the app listening.
- [x] `submitPrompt` gained `contentTypeOverride`/`characterIdOverride`: the agent decides both during the conversation, and `setContentType`/`setCharacterId` don't apply until the next render, so without these it would have generated with whatever was selected *before* the conversation.

`tsc` clean; `eslint` 0 errors (only the long-standing `set-state-in-effect`/`exhaustive-deps` warnings).

**Follow-up fixes, same day** — reported as "the agent speaks and repeats itself over and over, it doesn't listen, and the button doesn't cancel". All three came from two omissions in the pass above:
- [x] **The agent was hearing itself.** The microphone stayed open while its own TTS played out of the speakers, so it transcribed its own questions and answered them: the opening line came back as a prompt, the follow-up came back as the answer to itself, and it looped — which also meant it never got a chance to hear the actual person. Recognition is now closed for the whole duration of every spoken line (`agentSpeakingRef`) and reopened 350ms after the audio ends, since on laptop speakers the tail of the line is still audible for a moment past the `ended` event. `onFinal` also drops anything that lands while speaking, for results captured just before the stop took effect.
- [x] **Nothing tracked the audio, so Stop couldn't silence it.** `speak()` fired an `Audio` element and forgot it, and only awaited `play()` (which resolves when playback *starts*). It now resolves on `ended` and keeps the element plus its resolver in refs, so `stopSpeaking()` can cut a line off mid-sentence and release whatever was awaiting it. Stop now genuinely stops.
- [x] Restarts after a browser silence timeout are debounced by 250ms — some browsers end and immediately re-end when the mic isn't ready, and restarting inline pegged the CPU and threw from `start()`.

## Image generation reliability — 2026-08-10

Measured 50% failure rate on image generations (6 of 12) and 26.7% overall. Diagnosed from `pipeline_log` in the database rather than guessed — the logs name the cause exactly.

**Root cause: the rulebook check ran AFTER the paid generation call.** `validate()` only ever inspects the prompt *text*, which is fully known before generating — but it was being called after, and `passed` required both a result URL and a clean check, with the failure path returning `resultUrl: null`. So generation `22e5e970` produced three separate GPT Image renders across its three attempts and returned none of them. The person saw "couldn't validate"; the account was charged a credit; we paid for three images.

The specific miss is worth recording: the character's `distinguishing_features` is the single word "freckles". The draft included it; the **review step dropped it while rewriting** — the step whose entire job is enforcing the rulebook. So the check was correct. The cost of discovering it was the bug.

Fixes:
- [x] **Validate before generating.** Moved the rulebook check to immediately after review, before any provider call.
- [x] **Repair instead of discard.** A failing prompt now goes through `review()`, which appends the missing traits verbatim — the same helper the mock pipeline already used. That makes the check pass by construction, with no extra model call and no provider spend. Verified against the real failing prompt and trait: `distinguishing features` missing before, none missing after repair.
- [x] **Never bin a produced result.** `passed` is now just `Boolean(resultUrl)`. Anything that generated is returned.
- [x] **A draft/review hiccup no longer wastes an attempt.** "Claude returned an empty response" failed one generation on all three attempts while the character's saved traits sat unused. A retryable draft failure now falls back to `draft()`, which builds a complete prompt from the rulebook with no model call at all; a review failure continues with the drafted prompt.

Expected effect: image reliability should track the provider's own success rate rather than the paraphrasing luck of the review step, and a failed attempt costs a draft/review (~$0.02) instead of a full generation.

**Full failure taxonomy** (all 8 failed generations, from `pipeline_log`):

| Cause | Count | Status |
|---|---|---|
| Paid image discarded by post-hoc validation | 2 (6 renders) | Fixed above |
| OpenAI safety filter rejected the prompt | 3 | Fixed — falls back to Flux |
| Claude empty response / draft failure | 2 | Fixed — falls back to the rulebook |
| Kling 2.1 404 (wrong endpoint) | 1 | Already fixed 2026-08-07 |
| Video timeout at 180s | 1 | Predates the fal.ai queue rewrite |

- [x] **Safety-filter fallback.** OpenAI's classifier is aggressive about photorealistic people — exactly what this product makes — and was the most common named cause. `generateImageWithOpenAI` now throws a typed `ImageSafetyRejection`, and `generateImage` catches only that case and retries on Flux, which has a far less restrictive filter and is already wired up and paid for. Auth errors, outages and rate limits deliberately do NOT fall back — they say nothing about whether another model would fare better, and double-spending on them would be wrong. Multi-character images can't fall back (Flux's image-to-image takes one source), so they still surface the error. The pipeline log records when a fallback happened rather than crediting a model that didn't produce the result.

## Full-project audit — 2026-08-10 (partial)

Automated passes:
- [x] `tsc --noEmit` — clean.
- [x] `eslint src` — **0 errors**, 21 warnings: 18 long-standing `react-hooks/set-state-in-effect`, 2 unused icon components in `oauth-buttons.tsx` (Apple/Microsoft, deliberately kept for when those providers are enabled), 1 unused-directive.
- [ ] `next build` — **could not run here.** The SWC binary is compiled for macOS arm64 and this Linux sandbox has no matching build. Vercel compiles on push, so a broken build would surface there; `tsc` covers type errors in the meantime.

Supabase security advisors — 2 warnings, both known:
- `public.is_admin()` is a SECURITY DEFINER function callable by signed-in users. It only reports whether *the caller* is an admin, so it leaks nothing about other accounts, but it stays on the list.
- **Leaked-password protection is still disabled.** One toggle in the Supabase dashboard, still outstanding from an earlier pass.

Supabase performance advisors — no errors, all scale-related rather than functional:
- 11× "Auth RLS Initialization Plan" — policies call `auth.uid()` per row instead of `(select auth.uid())`. Harmless at 3 users, becomes a real cost at scale. Best cheap win on the list.
- ~40× "Multiple Permissive Policies" on the same table/role/action — each one is evaluated separately per query.
- 6 unindexed foreign keys, 5 unused indexes.

### Route + authorization sweep

- [x] **Routes mapped** — 38 pages plus 4 API/auth routes. **No broken internal links**: every route-like string in the source resolves to a real route. The only two non-matches are `Disallow: /api/` and `/auth/` in `robots.ts`, which are meant to be patterns.
- [x] **No dead pages.** `/app/profile` and `/app/usage` are referenced nowhere, but both are deliberate one-line redirects into the consolidated `/app/settings` tabs, documented as such.
- [x] **Admin pages** are guarded in `src/app/admin/layout.tsx` — signed-out redirects to `/login`, non-admin redirects to `/app`, checked server-side against `profiles.role`.
- [x] **All 13 admin server actions** call `requireAdmin()`. Verified by parsing each exported action's body rather than by eye, since the layout guard protects *pages* and does nothing for a server action POSTed directly.

- [x] **SECURITY FIX — voice actions were unauthenticated.** Swept all 62 exported server actions for an auth check. 17 had none; 15 are fine (`login`/`signup`/`logout` are meant to be open, `setLocaleCookie` only sets a cookie, and the projects/notes/generations actions are covered by row-level security — confirmed every policy is `auth.uid() = user_id`, with a separate admin-read policy).

  The exception was `src/lib/voice/actions.ts`. `transcribeVoice` and `synthesizeVoice` checked only the feature flag and the presence of `OPENAI_API_KEY` — never *who was calling*. They touch no table, so RLS could not help. A Next.js server action is a POST endpoint whose id is discoverable in the client bundle, which made Whisper transcription and OpenAI TTS a free, internet-facing API billed to this account. Now requires a signed-in user **and** a paid plan (admins exempt), matching how generations are already gated. No evidence of abuse — the exposure window was small and traffic is negligible — but it would not have survived launch.

- [x] **RLS is on for all 11 public tables**, every policy owner-scoped.

Noted for later: a `page_views` table and an `/api/track` route already exist, with an admin-only read policy — the traffic graph has its data source ready.

### Safety-filter rejection reported after the reliability fix

Reported as "there was an error generating a picture, I thought you fixed it — tone the rules down". Checked against the log rather than assumed, and the attribution turned out to be the other way round:

- **Our rulebook was not the cause and worked correctly** — the failed generation records `validate: Added missing rulebook items before generating: hair.`, i.e. the new pre-generation check ran, repaired the prompt for free, and passed it on. That fix was live (deployed 02:53 UTC).
- **The rejection came from OpenAI's own classifier**, which isn't tunable from here. Prompt: "Eva in a beautiful black satin dress" — an entirely ordinary request, bounced 6 times (2 generate-retries × 3 attempts).
- **The Flux fallback simply wasn't deployed yet.** The generation failed at 02:57:43 UTC; the fallback commit landed at 03:05:22 UTC, 8 minutes later. Once live, the first rejection routes straight to Flux instead of retrying a prompt that will deterministically be refused again.

Added on top, to reduce how often the fallback is needed at all (Flux holds a character's likeness less reliably than GPT Image, so leaning on it has a real quality cost): the draft instruction now tells the model to describe people plainly and avoid stacking photoreal intensifiers ("hyper-realistic", "ultra-detailed", "close-up selfie") around a person. Those phrasings read very differently to a safety classifier while meaning the same thing, and the model renders photorealistically regardless.

Also visible in the same window: two "hey"/"hello" prompts that generated full scenes (a room, a meadow). Both predate the trivial-prompt guard going live — that path is now blocked at the entry point.

### 404 after deleting from History — fixed, 2026-08-10

Reported: pressing the bin on a generation showed a 404 page.

Not the delete itself — `deleteGeneration` works and returns cleanly. The cause is the combination of two reasonable-looking things: the action calls `revalidatePath("/app", "layout")` (needed to refresh the sidebar's Recent list), which makes Next re-render the route the action fired from. If that route is the detail page for the row just deleted, the re-render runs `notFound()` before `router.push("/app/history")` can land — so the last thing painted is a 404.

The same trap existed on the character and project detail pages, which have their own delete buttons and the same `notFound()` on a missing row. All three now `redirect()` back to their list instead. That's the better outcome regardless of the race — a stale bookmark or a mistyped id also lands somewhere useful rather than a dead end. `/admin/users/[id]` deliberately keeps `notFound()`: accounts aren't deleted, so a missing one there is a genuine error worth surfacing.

### Error / empty-state sweep — 2026-08-10

- [x] **No unguarded `.single()` results.** Scanned every page for a `.single()` result whose properties are read without a null check first — the classic source of "cannot read property of null" crashes on a deleted or missing row. None found.
- [x] **List rendering checked.** Seven pages render `.map()` with no empty state; all seven are false positives — they iterate static config (`NAV`, `VIDEO_MODELS`, `IMAGE_MODELS`, pricing tiers, legal copy), never user data that could come back empty.
- [x] **Added `src/app/global-error.tsx`.** `error.tsx` only catches errors thrown inside the root layout's *children*; if the root layout itself fails, React never mounts it and Next falls back to its own unstyled default page — which reads as a broken site rather than a handled problem. The new boundary renders its own `<html>`/`<body>` and deliberately imports nothing: no providers, no i18n, no shared components, since any of those could be the reason the layout failed in the first place. That's why its copy is plain English rather than translated. The "Go home" link is a plain `<a>` on purpose (lint rule suppressed with a note) — a client-side transition would re-enter the same broken shell, so a full document load is the point.

Full project: `tsc` clean, `eslint` **0 errors**, 21 warnings (all pre-existing `set-state-in-effect` plus two intentionally-unused OAuth icons).

## Brand & compliance rulebook — Phase 1 shipped, 2026-08-10

Design and reasoning in `BRAND_RULEBOOK_DESIGN.md`. The strategic case: this is the one feature on the shortlist that a base model can't absorb, because it needs to know *your* rules, and it gets harder to leave the more rules an account accumulates.

- [x] **Migration `create_brand_rules`** — owner-scoped table, `kind` (`require`/`forbid`), `label`, `value`, `applies_to`, `severity`, `active`. RLS written as `(select auth.uid()) = user_id` rather than the bare call, so this table doesn't inherit the "Auth RLS Initialization Plan" per-row cost the advisors flag on the older ones.
- [x] **`lib/brand-rules/`** — `types.ts` (split out so `pipeline.ts` can use the types without importing a `"use server"` module, and to avoid a cycle) and `actions.ts` with auth-checked CRUD, capped at 40 rules since the whole rulebook goes into every draft prompt.
- [x] **Pipeline enforcement.** `require` rules join the character's own traits and go through the existing present-or-repair path unchanged. `forbid` rules get their own check in the pre-generation gate — so a block costs a draft/review and **never a generation**. Prohibitions are also written into the rulebook as a "Never include" section, so the draft and review models avoid them in the first place; the check is the backstop, not the first line.
- [x] **Prohibitions are genuinely non-overridable.** `splitOverrides` lets a request waive a character trait ("in a suit today"), which is correct. Brand rule labels are excluded from the overridable list shown to the model *and* hard-filtered out of the returned set afterwards, so a model that invents the label anyway still can't waive the rule. Without that second step the feature would be decorative.
- [x] **Checked even when `skipRefinement` is on.** Turning off the AI rewrite is a speed preference; a compliance rule must not be bypassable by flipping a setting.
- [x] **Settings → Brand rules tab** with add / enable / disable / delete, and copy stating plainly that rules are enforced on the prompt, not the finished image.
- [x] i18n across en/es/pt/it.

Verified by running the real matcher against sample rules: "guaranteed results after one session" and "before and after comparison" both blocked; an ordinary portrait prompt passed. `tsc` clean, `eslint` 0 errors.

**Known limit, stated deliberately:** Phase 1 matches on words, so a paraphrase ("results you can count on") slips through — confirmed in that same test. That's exactly what Phase 2 fixes by swapping prohibition checking to a single LLM classifier call. Do not describe this as compliance-grade until Phase 2 lands.

### Phase 2 — semantic checking, same day

- [x] **`lib/brand-rules/classify.ts`.** One classifier call per generation judges the prompt against the account's prohibitions on *meaning* rather than wording, closing the paraphrase hole Phase 1 knowingly left open ("results you can count on" vs "guaranteed results"). Rules are passed numbered rather than by uuid — short indices survive a generated response far better — and mapped back here.
- [x] **Never fails open.** If the classifier can't be reached, it returns `checked: false`, which is explicitly *not* the same as "clean". The pipeline then falls back to Phase 1's word matching — weaker, but enforcement continues — and records in the pipeline log that it did so, since a silent downgrade of a compliance check would be worse than the original bug.
- [x] **Audit trail.** The clean path now logs "Checked against N brand rules — no violations" as well as the failures. "Show me we never published that claim" is the actual buying reason for a regulated customer, and that line is what makes `pipeline_log` an audit record instead of an error log. It already renders in the History detail view with no extra work.
- [x] Response parsing unit-tested against 10 shapes a model realistically returns (`none`, `None.`, `1, 3`, prose like "Rules 2 and 3 are violated.", duplicates, out-of-range, empty, and the 1-indexing guard). 10/10.

`tsc` clean, `eslint` 0 errors. The classifier itself couldn't be exercised from the build sandbox — `OPENAI_API_KEY` lives in Vercel, not `.env.local` — so its live behaviour is unverified until it runs in production. Worth one deliberate test after deploy: add a rule forbidding "guaranteed results", then prompt for exactly that in different words.

## Buy extra credits — 2026-08-10

- [x] **Migration `add_purchased_credits`.** `profiles.purchased_credits` plus a `credit_purchases` audit table. Deliberately **not** reusing `bonus_credits`: that column is added to the allowance on *every* billing period and never depletes, so a one-time purchase parked there would have handed out the same credits again every month, forever. Caught before writing any code against it.
- [x] **`credit_purchases` has no insert policy on purpose.** The webhook writes it with the service-role key, which bypasses RLS. A client must never be able to grant itself credits, so there is no path for one to try.
- [x] **Allowance.** Purchased credits cover only what the monthly allowance can't. The overflow is `max(0, used + requested - limit) - max(0, used - limit)`, not the obvious `used + requested - limit` — the naive form re-charges every previous overspend in the period on each subsequent generation. Verified: over 5 credits of overspend the correct form charges 5 and the naive one charges 15.
- [x] **Consumed at placeholder-insert time**, because that row is what `getMonthlyUsage` counts — the credit is spent then, whether or not the generation succeeds. The balance is re-read inside `consumePurchasedCredits` rather than trusting the value the allowance check saw, and floored at zero, so concurrent requests can't drive it negative.
- [x] **Webhook grants credits** on `checkout.session.completed` with `mode: "payment"` (explicitly checked, so subscriptions can't fall through). Idempotent via a UNIQUE `stripe_session_id` — Stripe retries deliveries routinely, and insert-then-check-constraint avoids the race that check-then-insert would leave open.
- [x] **`setup-credit-packs.js`** for creating the Stripe products/prices locally (the sandbox can't reach api.stripe.com). Re-runnable: it searches by `picacho_credit_pack` metadata and reuses what exists rather than duplicating.
- [x] Settings → Usage shows the packs and the current balance; packs with no Stripe Price yet are hidden rather than offering a button that can't work. The usage banner's existing "Get more usage" link already lands on this tab.
- [x] i18n across en/es/pt/it.

**Pricing note:** packs are €45/20, €119/60, €279/150 — all at or above the best per-credit rate any plan offers. That's intentional: if topping up were cheaper per credit than subscribing, the rational move would be to sit on the smallest plan forever. Numbers are a starting point, not researched positioning.

**Also confirmed while in there:** `automatic_tax: { enabled: true }` is already set on checkout, so VAT is added on top at checkout rather than coming out of the listed price. The VAT-inclusive worst case in `Picacho pricing analysis.xlsx` therefore does not apply — set that switch to 0 in the model.

- [x] **Live Stripe prices created and wired** (2026-08-10). Six prices, USD + EUR for each of the three packs, created by running `setup-credit-packs.js` against the live key and pasted into `credit-packs.ts`. Webhook endpoint confirmed subscribed to `checkout.session.completed`.
- [x] **Refund handling.** Without it a top-up is free money: buy, spend, refund, repeat. `charge.refunded` now finds the purchase via the charge's payment intent → Checkout Session → `credit_purchases.stripe_session_id`, and takes the credits back. New `refunded_at` column doubles as the idempotency guard, since Stripe re-sends the event for every partial refund on the same charge. The balance is floored at zero — credits may already have been spent, and a negative balance would read as "owes us credits" wherever it's displayed; we absorb the cost of what was generated rather than leaving the account unusable. **Requires `charge.refunded` to be ticked on the webhook endpoint.**

## Admin traffic chart — 2026-08-10

The data layer already existed (`page_views` + `/api/track`, admin-only SELECT) — this is the missing view of it.

- [x] **`admin_traffic_daily(days)` Postgres function.** Aggregates in the database rather than pulling rows into the app: `page_views` grows with every visit (978 rows in the first week alone), and fetching a month of them just to count them would get slow fast. `generate_series` fills gaps so a quiet day charts as a real zero instead of vanishing and distorting the line.
- [x] **`SECURITY INVOKER`, stated explicitly.** The caller's own RLS still applies, so a non-admin calling this RPC gets an empty result. A `SECURITY DEFINER` function here would have handed every signed-in user the entire traffic table — the same trap the advisors already flag on `is_admin()`.
- [x] **Hand-built SVG chart**, no charting dependency. Recharts or Chart.js would add hundreds of KB for one chart on one page and still need overrides to match the app's flat hairline styling; this is ~100 lines, themes for free, and inherits dark mode. Filled area + line, four gridlines, dates thinned to ~6 labels so 30 days stays readable, and a full-height invisible hit area per day so the hover tooltip works across the whole column rather than only on a 2.5px dot.
- [x] Empty state for an account with no traffic yet.

Verified against real data: 978 views / 12 unique visitors across 2026-08-04 to 08-10.

## Voice mode disabled behind a flag — 2026-08-10

Wigly's call: the conversational agent needs more work and isn't needed now — disable it, but keep the code so it can be re-enabled and built on later.

- [x] New `voice_mode` feature flag, **off**. Re-enabling is one toggle in Admin > Feature flags, no deploy. Nothing was deleted.
- [x] **Defaults to off when the row is missing**, not on (`isVoiceModeEnabled` in `lib/voice/enabled.ts`). A feature that spends money on every use should never switch itself on because a lookup failed.
- [x] Hidden: the composer's voice-session button and the sidebar's global voice command.
- [x] **Enforced server-side too.** `synthesizeVoice` checks the flag and refuses, rather than relying on a hidden button — a server action stays callable and billable whether or not the UI shows it. Same reasoning as the auth hole found in the audit earlier today.
- [x] **The plain microphone button beside the composer stays.** That's a separate, finished feature: record, transcribe, drop the text in the box for you to review before sending. It uses `transcribeVoice`, which is deliberately left on the existing auth + paid-plan + `real_ai_providers` checks rather than the voice-mode flag.

Side effect worth noting: this closes the unmetered TTS cost from the pricing analysis. Whisper still runs for the plain mic, but only for signed-in paid accounts.

## Closed the unlimited AI character photo leak — 2026-08-10

The largest open item from the pricing analysis. `generateReferenceImage` metered only free accounts; every **paid** plan got unlimited AI character photos at ~$0.17 each, consuming zero credits. A Starter subscriber on €19 generating 200 of them cost more than they paid.

**Why a monthly cap and not a credit charge**, decided with Wigly:
- A credit is worth ~€1.90 of revenue against a ~€0.15 cost. Charging one would be an 11× markup on a *setup* action — the moment you most want someone to succeed, not to feel metered. Pricing it honestly would need fractional credits, which the integer ledger doesn't handle cleanly.
- **Daily** caps fight the real usage pattern. Character setup happens in bursts — someone builds five characters in one sitting — so a daily cap blocks exactly that session while doing nothing about a steady drip of 10/day (still 300/month).
- **Monthly** reuses the billing period already tracked, resets in step with credits, and bounds total exposure per plan.

- [x] `PLAN_REFERENCE_IMAGE_LIMITS`: starter 30, growth 75, studio 200, elite 400. Deliberately generous — a normal account generates a handful of these ever, so nobody legitimate will see the number. Worst case if maxed: ~€4.60 of €19, ~€11.60 of €79, ~€31 of €299, ~€62 of €499. Every plan stays comfortably profitable.
- [x] **`reference_image_generations` table**, one row per photo, rather than a counter column on `profiles`. A counter would need a reset job, and "reset" has no single meaning when every subscriber has a different billing anchor. Counting rows since `current_period_start` is correct for everyone with no scheduled job, and doubles as an audit trail.
- [x] Falls back to the calendar month when an account has no Stripe anchor yet, matching `getMonthlyUsage`.
- [x] **Only counted on success.** A safety-filter rejection or provider error throws before the log line, so a failed attempt never burns a slot — same rule the free-tier counter already followed.
- [x] Free tier keeps its 2-lifetime allowance; admins remain exempt and aren't logged at all.
- [x] Uploading your own photo stays free and unlimited, and the error message says so.

Verified the exact count query against the live paying account: counting from 2026-08-01, 0 of 30 used.

## Dialogue surcharge — 2026-08-10

The last unmetered path from the pricing analysis. Adding spoken dialogue runs two paid steps a silent video never touches — ElevenLabs speech, then a Sync Labs lipsync pass that re-renders the whole clip — and `creditWeight` was identical either way.

- [x] `getDialogueCreditWeight(seconds)` in `video-models.ts`: one credit per 5 seconds, so 5s→1, 8s→2, 10s→2, 15s→3.
- [x] **Scaled by duration, not by the model's credit weight.** Lipsync cost tracks how many seconds it has to re-render; it doesn't care whether those seconds came from Kling or Veo. A multiple of the model weight would have charged 11 extra credits for dialogue on Veo versus 1 on Kling, for identical lipsync work.
- [x] Surfaced in the composer before it's charged — a small note under the dialogue field, shown only once there's text in it. Charging more without saying so would be the kind of thing that makes people distrust a usage meter.
- [x] i18n across en/es/pt/it. Multi-angle is unaffected: that path has no dialogue field.

**Estimate, flagged as such:** unlike the video prices in this file (confirmed against fal.ai's own pricing page), the TTS and lipsync per-second costs are estimated. One credit per 5s is roughly cost-parity at the $0.28/credit peg — worth checking against a real invoice once there's one to check.

That closes every leak identified in `Picacho pricing analysis.xlsx`:
unlimited character photos (capped), failed generations billing 3× (fixed at the source), unmetered TTS (voice mode flagged off), unmetered dialogue (surcharged), stopped generations (unavoidable, documented).

## "Early access" badge — 2026-08-10

Asked whether to put BETA beside the logo. Argued against, and Wigly chose "Early access" instead.

**Why not BETA:** Picacho's entire pitch is reliability — consistent on the first try, validated before you see it. A BETA badge beside that claim argues against it. It's worse for the named audience: clinics are risk-averse, the wedge with them is a *compliance* feature, and "beta" next to regulated-advertising tooling is a reason to wait rather than buy. It also sits badly against a €499 tier. "Early access" sets the same expectation — things are still moving, be forgiving — with the opposite emotional register, and doesn't undercut the price.

- [x] One `EarlyAccessBadge` component, one string, used beside the wordmark in the marketing header and the app sidebar (both the mobile top bar and the expanded desktop rail).
- [x] **Not shown in /admin** — internal, and nobody needs reassuring about the maturity of a product they built.
- [x] **Not shown on the collapsed sidebar**, where the wordmark becomes a 24px "P" avatar in a narrow rail and the pill wouldn't fit.
- [x] Deliberately one file with one string, so removing it later is a two-minute job. Badges like this become permanent mostly because nobody can find every place they were pasted.

Separately agreed: multi-angle and storyboard should carry their own "Beta" marker when they go live, since those genuinely have never run. Not built yet.

## Multi-angle & storyboard review — 2026-08-10

Asked whether both "work perfectly". **They have never run.** Zero rows in `generations` with an `angle_group_id` — not one multi-angle batch has ever been started, successfully or otherwise — and zero pipeline logs mentioning storyboard. So neither can be called working; what follows is a code audit, not a verification. Only real end-to-end runs will settle it.

Fixed:
- [x] **Free-tier dead end (introduced hours earlier by the free tier itself).** `runMultiAngleGeneration` rejects free accounts, but the multi-angle button had no plan gate in the UI. A trial user could turn it on, write a prompt, pick angles, hit confirm, and only then be told it needs a plan — the worst possible moment to find out. New `multiAngleAvailable` from `workspace-data` now hides the button, mirroring how `advancedVideoEligible` already hides storyboard.
- [x] **N+1 query**, also mine: `loadBrandRules` was being called inside the per-angle map, so a 5-angle batch ran the same query five times. Hoisted.

**Unresolved risk, and it's the big one — the 300-second ceiling.** `maxDuration = 300` (Vercel Hobby's hard cap), while `MAX_WAIT_MS` in `fal.ts` allows a single video up to 10 minutes. A single video with dialogue can already exceed 300s; multi-angle runs several pipelines in parallel, each able to retry up to 3 times. The angles run concurrently rather than in series, so the batch takes as long as its slowest angle — but that alone can breach the limit, and the function is killed mid-flight while fal.ai keeps rendering and billing.

This is not a code defect that can be fixed in code. The realistic options are: upgrade to Vercel Pro with Fluid Compute (raises the ceiling to 800s), or restructure multi-angle to fire-and-poll rather than hold a request open. Worth deciding before multi-angle is put in front of anyone, because the failure mode is silent and expensive.

Structurally sound on review: `Promise.allSettled` so one angle failing can't strand its siblings, a placeholder row per angle written up front, per-angle cancel checks against each row, angle hints appended before the normal draft/review/validate pipeline so every angle gets the same reliability treatment. Storyboard correctly requires a start frame client-side and is Elite-gated in both UI and server.

## Free tier — 2026-08-10

Phase 0, step 1 of `Picacho distribution plan.pdf`. Until now a stranger could not see the product work without paying €19, which quietly undermined every acquisition channel.

**5 generations, lifetime, no card.** Five rather than three because the product's claim is consistency *across* generations — nobody can judge that from one image, and the first attempt is often not what someone pictured while still learning to describe it. Three works only if every attempt lands. Costs ~€1.50 per signup at ~€0.30/credit; pays back in about two months at a 5% conversion.

- [x] `profiles.free_generations_used` — a **lifetime** counter, deliberately not done by raising `PLAN_LIMITS.none`. That limit is monthly, so a free account would receive a fresh batch every billing period forever; an abandoned signup would keep costing money for the life of the account.
- [x] Checked **before** the monthly-allowance logic, because it works on a different axis entirely — never resets, unaffected by billing periods.
- [x] **Pinned to the cheapest model.** Veo is 11 credits for 8 seconds, so a free allowance counted in generations only equals a predictable cost if every free generation costs the same. Without this one signup choosing Veo would cost ~€3 of an allowance meant to total ~€1.50. Downgrades silently rather than erroring — a trial user hitting "that model needs a plan" before seeing a single result learns nothing.
- [x] **Multi-angle blocked on the free tier.** It's several generations per click, which would drain the trial instantly *and* make the per-generation counter undercount real cost.
- [x] **Accounts with bonus credits fall through to the normal path**, so the three existing users keep their granted allowances instead of being capped at five. Verified against all three live accounts.

**Still needed from Wigly:** confirm email confirmation is enabled in Supabase Auth. Without it free credits are farmable with throwaway addresses and the cost maths above stops holding.

## Naming consistency pass — 2026-08-10

Reported: "Usage & plan" couldn't be found because the sidebar calls the same destination something else. It turned out to be two cases, not one — the sidebar's gear menu named both of its settings links differently from the tabs they open:

| Sidebar said | Tab it opens | Now says |
|---|---|---|
| Profile details | Account | Account |
| Usage limits | Usage & plan | Usage & plan |

- [x] Sidebar entries now use `s.account` / `s.usageAndPlan` — the same keys the tabs use, so they can't drift apart again.
- [x] Deleted the orphaned `profileDetails` and `usageLimits` keys from all four locales rather than leaving duplicates with matching text.

**Swept the rest of the copy for the same problem and found none.** A script compared all 470 single-line English strings for repeated text: 28 pairs share wording, but every one is the same word in a *different context* (`nav.characters` vs `characters.listTitle`, `nav.settings` vs `settings.title`). Those are correct as they are — a nav label and a page heading should stay independently translatable even when English happens to use the same word. Merging them would be churn that makes translation worse, so nothing else was touched.

## Brand rulebook Phase 3 — preset packs, 2026-08-10

Unblocked once Wigly named the audience: social media creators, brands, marketing agencies, med spas, beauty salons and similar.

That list spans **three different compliance profiles**, not one, so it shipped as three packs rather than a single "med spa" pack:

| Pack | For | Shape of the rules |
|---|---|---|
| Aesthetics & wellness clinics | med spas, salons, cosmetic dentistry, skin/hair clinics, fitness, nutrition | Outcome and health claims — the genuinely regulated ones |
| Creators & sponsored content | creators, influencers, talent agencies, coaches | Disclosure, likeness, other people's brands |
| Brands & agencies | agencies, e-commerce, fashion, skincare, cosmetics | Brand safety and comparative claims |

- [x] `lib/brand-rules/packs.ts` — 22 rules across the three packs. Applied as **ordinary rules** in the same table, so they can be edited, disabled, or deleted like anything hand-written; nothing about them is special-cased.
- [x] `applyBrandRulePack` skips rules whose label the account already has, so applying a pack twice, or applying two packs that deliberately share rules (several do — "No real public figures" appears in two), tops up instead of duplicating.
- [x] Respects the 40-rule cap and says so rather than silently truncating.

**The disclaimer is prominent, not a footnote.** These rules touch advertising law, and the packs are drafting aids based on widely-shared advertising-standards principles — not legal advice, and not jurisdiction-specific. Rules for health and appearance claims differ materially between the US (FTC/FDA), UK (ASA/CAP) and EU states. A customer in a regulated trade must not infer from a tidy UI that their copy has been legally cleared, so the warning sits in an amber panel directly under the packs, and the same caveat is written at the top of `packs.ts`.

This is the part of the rulebook that's actually sold. Phases 1 and 2 built a mechanism; nobody buys a mechanism, and an empty rules box asks the customer to author compliance policy themselves — precisely the work they'd be paying to avoid. A competitor can copy the feature from a screenshot; they can't copy the rules.

Nothing outstanding. Optional next: verify Phase 2's classifier live (needs the OpenAI key, so only testable in production), and have the packs reviewed by a qualified adviser before leaning on them in marketing.

## After launch (polish, not blocking)

- [x] Highlight the active tab in the admin nav bar (2026-08-07) — new `AdminNav` client component compares the current path and bolds/underlines the matching tab.
- [x] Surface admin action failures in the UI (2026-08-07) — every admin server action (suspend/reinstate user, change role, change plan, toggle flag, edit setting, switch AI model, add/remove voice) now redirects back with `?error=...` on failure instead of only logging server-side; each admin page reads that param and shows it via a shared `AdminErrorBanner`.
- [x] Add a guardrail so an admin can't accidentally suspend or demote their own account (2026-08-07) — `setUserStatus` blocks self-suspend and `setUserRole` blocks self-demotion, both surfaced as an error banner instead of failing silently.
- [ ] Add "Sign in with Apple" once there's a paid Apple Developer account — already scaffolded in `oauth-buttons.tsx`, just commented out.
- [ ] Add a real subscription-events log so Admin > Billing's "Canceled" card can become an actual churn *rate* over time, instead of a current snapshot.
- [ ] Revisit Admin > Stats' country breakdown once deployed to Vercel — it reads geolocation headers that only exist in production.
- [ ] Consider whether admin's own generation/history views should visually distinguish "viewing someone else's data" from your own, since clicking into a user's generation from Admin > Users currently looks identical to your own History page.

## Already solid (verified, no action needed)

- Row-level security is enabled and correctly scoped (`auth.uid() = user_id`) on every table — checked directly against the live database's policies.
- Every admin server action independently re-checks admin status server-side, not just the page-level guard.
- Admin > Billing now shows real MRR/failed-payment/canceled numbers from Stripe's webhook data instead of placeholders. System-health pages still show honest "—" placeholders where nothing real exists yet.
- Cookie consent is legally sound — analytics genuinely stays off until explicitly accepted.
- All 4 languages (EN/ES/PT/IT) have identical message-key coverage, enforced by TypeScript.
- Destructive actions (delete account/project/character/generation) all require confirmation.
