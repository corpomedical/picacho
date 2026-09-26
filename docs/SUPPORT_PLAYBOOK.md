# Picacho support playbook

What to do when something goes wrong with Picacho, written for the operator and for any AI agent helping run it.

Started 2026-09-26. The operator said "Build all three" after a talk on who supports an AI-built app at 2 AM: alerts, failure reasons for the assistants, and this playbook. Everything here was read from the code that day, and each section names its files. **The code is the truth.** When the two disagree, fix this page.

**Rule for every future change:** a feature ships with its support section here, in the same commit. What breaks, what the customer sees, what fixes itself, and what you do.

---

## 1. How problems reach you

### Your phone (the admin app)

The admin app (picacho-admin, the admin web app on your phone's home screen) gets these pushes. Turn them on per device: tap the bell, then "Enable alerts on this device". Tapping an alert opens its screen: Overview, Money, Users, System or Content.

| Alert | What happened | First move |
|---|---|---|
| 🚨 **Provider account locked — renders are failing** | A provider refused for lack of money (fal "User is locked / Exhausted balance", OpenAI "exceeded your current quota", a 402). Every render on that provider fails until it is topped up. At most once per 30 minutes, whether images or videos saw it. | Top up that provider now (§3.4). Customers are refunded automatically meanwhile. |
| 🚨 **fal balance can't pay for a render** | Hourly check: the fal balance is below the priciest single render. Repeats every hour until fixed. | Top up fal now (§3.4). |
| **fal balance is low** | Hourly check: below ten of the priciest renders. Repeats every 6 hours. | Top up fal today. |
| **Renders are failing** | Three renders broke inside 15 minutes, across all customers. Refusals and stops don't count. At most once an hour. | §3.2. |
| **<Model> switched off** | The circuit breaker took a model out of service after 3 failures in a row from 2+ accounts. It says when the trial render comes. | §3.3. |
| **Scheduled job failed: <job>** | A cron answered 5xx or crashed, or the hourly reconcile couldn't clear someone's stuck renders. At most once every 3 hours per job. | §3.6. |
| **Generation failed** | A render that failed while the person waited, mostly images. Sent for every one. | Usually nothing: it is refunded by the rules in §2. Look if they pile up. |
| **New problem report** | A customer pressed "Report a problem" on a result. | Admin → Reports. |
| **New message from a customer** | Someone wrote in Settings → Help (a star rating alone doesn't alert). | §3.12. |
| **Client error** | The web app crashed in someone's browser. | Admin → Reports (marked auto). Look if the same error repeats. |
| **Checkout failed** / **Billing portal failed** | Stripe's checkout or billing page couldn't open for someone. | §3.7. |
| **Payment disputed (chargeback)** | A customer disputed a charge with their bank. Pack credits it bought were taken back automatically. | Answer it in Stripe → Disputes before the date in the alert (§3.7). |
| **Double subscription (Stripe + Play)** | Someone is paying on the web and in the Android app at once. | Refund one side (§3.8). |
| **Play entitlement transferred** | A Google Play subscription moved to another Picacho account. | Admin → Users: check the target account's plan. |
| Payment received / New subscription / New signup | Good news. | None. |

Where each alert comes from:
- **Rules and wording:** `src/lib/push/alert-rules.ts` (tested in `alert-rules.test.ts`).
- **Sending:** `src/lib/push/admin-alerts.ts`.
- **Delivery:** `src/lib/push/web-push.ts`. It sends nothing if the VAPID keys are missing from Vercel or no admin device has subscribed.

### The admin console (picacho.ai/admin)

- **Reports**: every failure filed automatically, plus what customers reported. Your work queue.
- **Moderation**: failed renders with their reason, split into *refused* (a rule said no) and *broke* (something failed).
- **Feedback**: what people wrote in Settings → Help and the star ratings.
- **System**: the failure rate (broke vs refused) over time.
- **Providers**: every model's health (working / trial / out), the last error, the fal balance, the Seedance lane, and suspend or restore for any model.
- **Flags** and **Settings**: switches that take effect at once, no deploy (§4).
- **Users**: find someone by email, see their renders and success rate, and give credits back (§3.1).

### Email

hello@picacho.ai, or the `support_email` setting. Settings → Help links to it.

### What customers are told without you

- **Failed renders:** a failed render explains itself in the composer, with the provider's own sentence when there is one, never raw error text (`src/lib/generations/failure-line.ts`).
- **The assistants:** Aly (the assistant in the lamp, called the Producer in the code; people can rename her) and the composer's chat see, for each failed render, that same sentence and whether its credits came back (`src/lib/agent/failure-notes.ts`). If the credits didn't come back and the person thinks they should have, the assistants send them to Settings → Help. Neither assistant can refund, change a plan or touch billing.

---

## 2. What fixes itself (tier 1)

These run with nobody watching.

- **Refunds for failed renders** (`src/lib/generations/refund-rules.ts`, `job-runner.ts refundGenerationCosts`). A refund puts back every credit the render took: plan credits, bought credits, bonus credits and the daily free render.
  - *Always refunded, past every switch and cap* (`refund-rules.ts forceRefundEligible`):
    - refusals before anything rendered, and provider rejections (a 4xx);
    - a brand-rules block;
    - a result our output check refused to show (Picacho absorbs that cost);
    - a failed or stopped upscale or layers job.
  - *Refunded while Admin → Flags → `automatic_refunds` is ON (it has been since 2026-09-06), up to a daily limit per plan (§3.1):* a provider failure, our own error, and a video the stuck-render reaper wrote off.
  - *Not refunded:* a render the person stopped after it started rendering, and one they walked away from.
- **Stuck renders** (`job-runner.ts reapStaleJobs`). The reaper runs hourly (the reconcile cron) and whenever the person opens Generate or History.
  - After **30 minutes** without a check-in, it asks the provider where the render is.
  - After **45 minutes** on one stage, it cancels the render at the provider and writes it off ("This render didn't finish in time and was stopped."). The refund follows the rules above.
  - A render left at "generating" with no job behind it is written off after **60 minutes**.
- **A model that keeps failing** (`src/lib/generations/model-health.ts`). After 3 provider failures in a row from 2+ accounts, the model is taken out of service. It stays out for 10 minutes, doubling on each repeat up to 6 hours; then one trial render goes through. New sends move to another working model where there is one, cheapest first. If none is left, the person is told nothing was charged.
- **Retries:** up to 3 tries per send (Admin → Settings `max_retry_attempts`). A 401, 403, 404 or 422 is never retried.
- **A send that arrives twice** (a dropped connection makes the browser resend) follows the first render instead of starting a second (`repeat-send.ts`).
- **Face check on paid images** (while Admin → Settings `identity_gate_threshold` is above 0): an image that scores under the bar re-renders once for free; if both miss, the credit goes back.

---

## 3. Playbooks

### 3.1 "My render failed" / "I want my credits back"

1. **Find the person.** Admin → Users → search their email. Open their failed render: History shows the steps. Admin → Moderation shows the reason with the provider's own words.
2. **Did the credits come back?** Look at the render itself: **0 credits used means refunded**, and the assistants say "its credits were returned". Don't go by the Refunds list on the user's page. It only lists refunds that counted toward the daily limit, so refusals, provider rejections and write-offs are missing, and its "credits returned" total reads zero. §2 says which failures refund on their own.
3. **The daily limit** (a rolling 24 hours, `src/lib/plans.ts refundedFailureDailyCap`) counts only the switch-controlled refunds. Free 10, Basic 12, Starter 30, Growth, Studio and Elite 60. Admins have no limit. A customer who hits it keeps paying for failures until the window rolls on. That is the case to put right by hand.
4. **Give credits back by hand:** Admin → Users → the person → **Bonus credits** → Save.
   - **The box SETS the number, it does not add to it.** Type their current bonus plus what you're giving back.
   - Bonus credits are spent before bought credits and don't expire at the month's end, despite the page's "(this month)" label.
   - The only record is a server log line, so note it in your reply.
5. **Reply** by email, in plain words: what happened, that the credits are back, and what to try next (the composer's line usually says it).

### 3.2 Alert: "Renders are failing"

1. **Read the alert:** it names the latest model and the provider's words.
2. **Is one model failing, or everything?** Admin → Providers shows which models are out and their last error. Admin → Moderation shows the reasons, newest first.
3. **One provider down** (fal, OpenAI, BytePlus): check their status page. The circuit breaker will switch the model off on its own; if it is plainly down for hours, suspend it on Admin → Providers so nobody waits on trials.
4. **Our own bug** (the same error on every model, or "unexpected error"): it's a code problem. Open a Claude session with the alert text and Admin → Reports.
5. **Money:** customers are refunded by §2. Check the daily limit didn't stop refunds for anyone who hit several failures.

### 3.3 Alert: "<Model> switched off"

- **Nothing to do if it recovers.** The trial render after the wait either brings the model back or switches it off again with a longer wait (up to 6 hours), and you get a new alert each time it goes off again.
- **If it keeps failing:** read the last error on Admin → Providers.
  - Provider outage: suspend the model until they're back.
  - Provider changed something (an endpoint, a parameter): code fix.
  - Out of money: §3.4.

### 3.4 A provider is out of money

1. **Top up.** fal: fal.ai → Billing. OpenAI: platform.openai.com → Billing. BytePlus: console.byteplus.com → Billing.
2. **Check it took:** Admin → Providers shows the fal balance.
3. **Afterwards:** renders that failed meanwhile were refunded (provider rejections always are). A model the circuit breaker switched off comes back on its trial render; you don't need to restore it by hand.
4. **Know the gap:** BytePlus's out-of-credit wording isn't recognised yet, so a BytePlus balance problem shows as "Renders are failing" or "<Model> switched off", not the siren.

### 3.5 A render stuck on "generating"

It fixes itself (§2): 45 minutes after it stopped moving, the next reaper pass writes it off. That's at most about two hours, sooner if the person opens Generate or History. The render then reads "This render didn't finish in time and was stopped." and its credits come back by the rules in §2. If one is stuck longer than 3 hours, the reconcile job is failing: §3.6.

### 3.6 Alert: "Scheduled job failed: <job>"

The six jobs (`vercel.json`):

| Job | When | What it does |
|---|---|---|
| reconcile | hourly | Clears stuck renders, heals shared posts, backfills posters, checks the fal balance |
| reels | hourly | Builds each dashboard's highlight reel from its best-scoring videos |
| drip | daily 09:00 UTC | Onboarding emails |
| prune | daily 04:45 UTC | Rate-limit rows; owed face deletions at BytePlus |
| sets | every minute | Finishes Helios set builds |
| edits | every minute | Moves Director's Cut edits along |

1. **Find the error.** Vercel → project **picacho-uv7z** (the one that serves picacho.ai) → Logs, search the job's name.
2. **One bad run** (a database blip): the next run usually fixes it, and the alert stays quiet for 3 hours.
3. **Every run fails:** code or configuration problem. Open a Claude session with the log lines.
4. **Crons run the last production deploy that finished building,** not necessarily the one picacho.ai shows. After pressing "Redeploy" on an old commit, the jobs run that old code.

### 3.7 Payments on the website (Stripe)

Code: `src/app/api/webhooks/stripe/route.ts`, `src/lib/stripe/`.

- **A card fails on a plan renewal.**
  - The plan goes "past due": its monthly credits pause, while bonus and bought credits still work.
  - The customer sees "Payment failed" with an **Update card** button in Settings, and the composer tells them why.
  - Stripe retries the card on the schedule set in the Stripe dashboard. The account drops to free only when Stripe cancels the subscription.
  - Usually you do nothing. If they write in, point them to Settings → Plan & billing → Update card.
- **A customer wants their money back.** No code in Picacho refunds money; do it in the Stripe dashboard.
  - A **full** refund of a credit pack takes back whatever of those credits they haven't spent. It stops at zero; spent credits aren't recovered.
  - A partial refund leaves the credits alone.
  - Refunding a **plan** payment does not end the plan: cancel the subscription in Stripe as well.
- **Alert "Payment disputed (chargeback)".**
  - The customer disputed a charge with their bank. Any credit pack it bought was taken back automatically.
  - Answer the dispute in Stripe → Disputes before the date in the alert.
  - If you win, give the credits back by hand (§3.1): nothing does it automatically.
- **Alert "Checkout failed" / "Billing portal failed".** Stripe's page couldn't open for someone. Admin → Reports has the Stripe error code. A card or country problem is theirs; a configuration error on every attempt is ours.
- **Invoices.**
  - Settings → Plan & billing → Invoices, as PDFs.
  - Packs bought before 23 August 2026 have a receipt only; for an invoice they write to hello@picacho.ai. The page's note says 22 August, and the cutoff in the code is the 23rd.

### 3.8 Payments in the Android app (Google Play)

**Paused since 2026-09-03:** the Play Billing plugin is out of the app, so nobody can buy in the app today. `PLAY_BILLING_SETUP.md` says how to turn it back on. When it is on (code: `src/app/api/webhooks/revenuecat/route.ts`):

- **Alert "Double subscription (Stripe + Play)".** Someone bought on Play while their Stripe plan was still live. Picacho kept the Stripe plan and didn't apply the Play one, so refund the Play purchase in Play Console.
- **Alert "Play entitlement transferred".** A Play subscription moved to another account. Check that account's plan on Admin → Users.
- **Play refunds.** A refunded credit pack is taken back automatically. A refunded plan ends when Google expires it.
- **Card problems** on Play show the same "Payment failed" text, without a button. The customer fixes it in the Play Store.

### 3.9 "I can't sign in"

Sign-in runs on Supabase Auth, and Supabase sends the emails through Resend. Picacho's admin can't reset a password, resend a confirmation or reset two-step verification. It can suspend, reinstate and delete an account.

- **Forgot password.** They use "Forgot password?" on the login page (/forgot-password), then follow the email to /reset-password. The page answers the same whether or not the email exists, so a person who "never got the email" may have typed another address. Check Admin → Users for the email they really signed up with.
- **Never confirmed their email.** There is no resend button: signing up again with the same email resends the confirmation. An expired link lands on the login page with an error. A confirmation link only works in the same browser the signup started in.
- **Google or Facebook sign-in** works on the website and in the Android app. The iOS app has no social buttons.
- **Lost the phone for two-step verification.** There are no recovery codes; the only way out is "Turn off" in Settings → Security, from a session that already passed the check.
  - A person who is signed out and lost the phone is locked out.
  - First make sure it's really them: they write from the account's own email address.
  - Then remove their factor in Supabase: have a Claude session prepare the one line for the SQL editor (`delete from auth.mfa_factors where user_id = '<their id>';`, with their id from Admin → Users) and run it yourself. They sign in with the password alone and can turn two-step back on.
- **Changing their email** needs their current password, then a confirmation link.
- **A suspended account** sees only a generic "Couldn't sign you in". Admin → Users shows suspended accounts and has Reinstate.

### 3.10 "It refused my video" (refusals)

A refusal is a rule doing its job, not a breakdown. It is always refunded (§2), counted as *refused* on Admin → System and Moderation, and never alerts your phone.

- **A real person's face on Seedance.** The Seedance family refuses photorealistic people: that's the provider's policy, and illustrated characters pass. The customer sees the provider's sentence ("may contain likenesses of real people"). The fix is another engine; the composer and the assistants suggest one.
- **A safety filter** (the provider's, or Picacho's own checks on the prompt and on the result). The customer sees the reason written for them. Picacho absorbs the cost of a result its output check refused, and the credit comes back.
- **The customer's own brand rules.** A blocking rule stops the send before anything renders and says which rule, which words and what to try. "Generate anyway" sends past it once. If every try trips the rule, the send fails and is refunded.
- **What you do:** usually nothing. If someone writes in, explain which kind it was (Admin → Moderation shows the words) and what to change. Don't promise a workaround for a provider's real-face policy.

### 3.11 "Delete my account" and data requests

- **They can do it themselves:** Settings → Privacy & data → Danger zone, then type their username or email.
  - It refuses while a Google Play plan is active or past due: they cancel that in the Play Store first.
  - It cancels a Stripe plan. If Stripe can't be reached, nothing is deleted.
  - It withdraws their face from BytePlus, deletes the account, and empties their files from all seven storage buckets.
- **They can't sign in:** the public page picacho.ai/delete-account tells them to email support and promises deletion within one month.
  - Confirm it's really them: the request comes from the account's own address.
  - Then Admin → Users → the person → Delete. It runs the same steps; the only confirmation is the browser's "Are you sure?".
- **What stays after deletion:**
  - page views and promo-code sales, with the person's id removed;
  - an owed face deletion at BytePlus, retried daily until done;
  - payment records at Stripe or Google, which the law requires.

### 3.12 Alert: "New message from a customer"

Admin → Feedback shows the message. Reply by email from hello@picacho.ai. If it's about credits, follow §3.1; if it's a bug, Admin → Reports may already hold the automatic report.

---

## 4. Emergencies (tier 3)

An emergency is when many customers are affected, money is going wrong, or security or data is involved. The order is always the same: **stop the damage, tell the people affected, fix, write it down.**

### 4.1 How bad is it?

| Level | Looks like | Do |
|---|---|---|
| One customer | A failed render, a sign-in problem, a question about a charge | §3 |
| A feature is down for everyone | "Renders are failing", a model switched off, a scheduled job failing every run | Switch the feature off (§4.2); tell customers if it lasts more than an hour (§4.4) |
| Money, security or data | Wrong charges, one customer seeing another's work, a leaked key, an account taken over | Lock down first (§4.2, §4.3), tell the affected customers today (§4.4), then fix |

### 4.2 Switches that act at once, no deploy

**Admin → Flags** (`feature_flags`). Off means the feature stops for everyone on the next request.

| Flag | Off means |
|---|---|
| `signups_enabled` | No new accounts. A Google or Facebook signup made while it's off is deleted within seconds. With no row at all, signups stay open. |
| `automatic_refunds` | Only refusals, rejections and write-offs are refunded (§2) |
| `real_ai_providers` | **Every render becomes a mock placeholder, and the customer is still charged for it.** Never switch it off on the live site. To stop all provider spend, suspend the models on Admin → Providers: customers are then told the model is unavailable and nothing is charged. |
| `recast` / `recast_lock` | Recast off |
| `live` | Picacho Live off |
| `producer` / `producer_elite` | Aly off (and any name a person gave her) |
| `chat_agent` | The in-app assistant off |
| `video_editor` | Director's Cut off |
| `astra_sets` (+ `astra_photo_sets`, `astra_previz`, `astra_recce`) | Helios 3D off |
| `face_verification`, `opening_frame`, `video_face_refund` | The face-lock features off |
| `brand_rules_enforcement` | Customers' brand rules are ignored. Don't switch this off in an emergency. |
| `prompt_studio` | Prompt "Enhance" refused |

**Elsewhere in Admin:**
- **Admin → Settings** (takes effect at once):
  - `max_retry_attempts` (1–10);
  - `identity_gate_threshold` (0 = off, meant to be 70);
  - the default video and image models;
  - `support_email`.
  - Leave `seedance_provider` alone there: use the picker on Providers.
- **Admin → Providers:**
  - **Suspend** a model: it stays off until you press Restore, whatever its trial says.
  - **Run Seedance on** fal or BytePlus: applies from the next render. Switching back to fal is the rollback.
- **Admin → Users:** **Suspend** an account (bans the sign-in); **Reinstate** undoes it.

**Slower switches, which need a redeploy.** These are Vercel environment variables set to `1`: `AGENT_CHAT_DISABLED`, `PRODUCER_DISABLED`, `ASTRA_DISABLED`, `RECAST_DISABLED`, `LIVE_DISABLED`, `VIDEO_EDITOR_DISABLED`, `FACE_VERIFICATION_DISABLED`, `NATIVE_OAUTH_DISABLED`.
- Vercel applies them only to a new deployment, so push or redeploy afterwards. Three older notes say "no deploy", and they're wrong.
- The flag above is always the instant off.

### 4.3 Undo a bad release

- **Website.**
  - picacho.ai is served by the Vercel project **picacho-uv7z** (a second project, `picacho`, builds too).
  - Vercel → picacho-uv7z → Deployments → the last good production deployment → ⋯ → **Instant Rollback**. The site is back in seconds.
  - Vercel then stops making new pushes live on their own, so once the fix is pushed, promote it (⋯ → Promote) or undo the rollback.
  - The scheduled jobs run whichever production deployment finished building last.
- **Code.** Tags named `pre-<thing>` mark points to go back to (`git tag -l "pre-*"`). A Claude session can revert a commit for you to push.
- **Database.** SQL only moves forward (`supabase/README.md`): a mistake is fixed by a new file in `supabase/pending/`, never by editing or re-running an old one. Before you ever need them, check what Supabase → Database → Backups offers on your plan.
- **Android app.** `NATIVE_OAUTH_DISABLED=1` (plus a deploy) turns off in-app Google/Facebook sign-in for every build. Retiring a bad build for good is in `MOBILE_APP.md`, "Turning it off, and retiring a bad build".
- **A leaked key.** Roll it in the provider's dashboard (Stripe, Supabase, fal, OpenAI, Anthropic, BytePlus, Resend), put the new value in Vercel → Settings → Environment Variables, then redeploy. Check the provider's usage page for spend you didn't make.

### 4.4 Tell the customers

- **By email:** Admin → Emails. Write the announcement and pick the audience (everyone, free, or one plan).
  - For an incident, tick **service notice**: it also reaches people who unsubscribed from marketing, which the law allows only for real service news.
  - Picacho makes you type `service:<audience>` to confirm, so it can't go out by accident.
- **What to say:** what happened, who it affected, what they need to do (usually nothing), and that credits are back (§2 does it; say so only once it's true).
- **There is no status page.** For a long outage, a line on Instagram and in the email is the honest channel.

### 4.5 Afterwards

Add a line to the incident log (§5): what happened, what fixed it, and what changed so it can't recur. If an alert should have caught it and didn't, that change is a new alert.

### 4.6 Known gaps (2026-09-26)

- BytePlus's out-of-credit wording isn't recognised, so it reaches you as a burst or a switched-off model, not the siren.
- There's no admin button to reset a password, resend a confirmation or remove two-step verification, and the two-step page has no help link.
- The Refunds list on Admin → Users misses the refunds that don't count toward the daily limit, and its total reads zero. A fix is queued; §3.1 says how to check meanwhile.
- The provider balances of OpenAI and BytePlus aren't checked on a schedule; only fal's is.
- Picacho's own content refusals are logged (`policy_refusals`), but no admin page shows them.
- There's no status page, and no error tracker beyond Vercel's logs.

---

## 5. Keeping this alive

- **A new feature ships with its section here,** in the same commit: what breaks, what the customer sees, what fixes itself, and what you do.
- **A new alert** goes in `alert-rules.ts` with a test, and in the table in §1.
- **After an incident,** add a line to the log below: the date, what happened, what fixed it, and what changed so it can't recur.

### Incident log

| Date | What happened | Fix | Changed so it can't recur |
|---|---|---|---|
| 2026-08-25 | fal balance hit zero at 04:34 UTC; every video failed for hours, and the alert looked like any other failure | Topped up | The provider-account siren (reports.ts) |
| 2026-09-26 | Found in review: failed videos, switched-off models, failed cron jobs and a low fal balance never reached the phone | This playbook's alerts | §1 alerts |
