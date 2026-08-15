// Picacho changelog — the source for the admin "Updates" section.
//
// ONE ENTRY PER SESSION. At the end of each work session, gather everything
// that shipped in that session into a single new object and prepend it to the
// top of RELEASES (newest first). Bump `version` (e.g. 1.0.0 -> 1.1.0) and
// increment `build` by one. `date` is an ISO yyyy-mm-dd string. `items` is the
// plain-language list of what was done — this is what shows in the dropdown.
//
// Kept as code (not a database table) on purpose: each entry describes a
// session's deploy, so it belongs with the code it describes and ships in the
// same push. No admin data-entry, no table to keep in sync with what shipped.

export type Release = {
  version: string;
  build: number;
  date: string; // yyyy-mm-dd
  title: string;
  items: string[];
};

export const RELEASES: Release[] = [
  {
    version: "1.0.0",
    build: 1,
    date: "2026-08-14",
    title: "Launch readiness & character consistency",
    items: [
      "Fixed a recurring crash on history pages (a date/timezone rendering mismatch).",
      "Fixed a signup feature-flag error and hardened the signups kill switch.",
      "Security hardening: pinned database function search paths, consolidated row-level-security policies, and added missing foreign-key indexes.",
      "Made picacho.ai the canonical domain (www now redirects to it) and stopped admin traffic from polluting analytics.",
      "Pricing: removed a contradictory line, defined what a generation is, added an FAQ, and surfaced the free trial. Restructured plans — Studio now includes storyboard and multi-image reference; Elite adds priority rendering, early access, and API access.",
      "Finalized the Terms of Service and Privacy Policy (Spain/Madrid governing law, live Stripe billing terms, a 7-day refund policy, and GDPR rights).",
      "Landing page: added a feature card highlighting enforced brand rules.",
      "Refunds: failed generations no longer consume a user's monthly allowance, purchased credits, or free-trial generations, and each generation records exactly what it used so refunds are precise.",
      "Show the validation result on each successful generation (\"passed on the first try\").",
      "Fixed a caching issue that served stale marketing and legal pages on one domain.",
      "Signup & email: new users now land in the app already signed in after confirming; added a \"Check your email\" screen; set up real transactional email through Resend (custom SMTP); added branded confirmation and password-reset email templates with the real logo; confirmation links now work across devices.",
      "Account safety: enforced account suspension (it was being set but ignored — suspended users could still log in and generate), and added the ability to permanently delete a user, which removes all their data and stored files with a confirmation step.",
      "Admin navigation: added smooth left/right scroll chevrons to the top tab bar.",
      "Added this Updates section to the admin area.",
      "Character consistency fix: AI-generated reference photos now anchor to the character's existing photo (same person, identity-locked) and include the typed visual traits — previously every generated photo invented a brand-new face, which made the character's own gallery inconsistent and poisoned downstream generations.",
      "Character photo generation is also far less strict: prompts OpenAI's safety filter wrongly flags (e.g. ordinary descriptions of people) now automatically retry on Flux instead of failing.",
      "Fixed the character page's describe-and-generate box appearing dead: successful generations were silently auto-added to the character's gallery without limit, and once past 5 photos the box disabled itself with no explanation. The auto-add now respects the 5-photo cap, and the box explains itself when a gallery is full.",
      "Fixed \"0 match\" results: when OpenAI's safety filter rejected a prompt, generation silently switched to Flux, which loses the character's identity — and the log still claimed GPT made the image. Now the wording is automatically softened and retried on GPT first (keeping the identity anchor); Flux is a clearly-labeled last resort, and the log reports the model that actually produced the image.",
      "Made brand-rule validation far less trigger-happy: the checker now knows that describing a fictional character's appearance is not a violation, applies each rule exactly as scoped (viewer-directed rules aren't about the character), and only blocks clear, unambiguous violations. Retries after a blocked attempt also no longer leak compliance language into the image prompt.",
      "Brand-rule enforcement is now switched off platform-wide behind a feature flag (brand_rules_enforcement, off by default) — rules stay visible and editable in Settings with a clear “paused” notice, and one click in Admin → Feature flags brings enforcement back.",
      "Fixed prompts silently losing the user's scene: a cut-short draft used to be accepted as-is and then \"completed\" from the character's traits alone — a request for \"sitting in a cafe in Paris, having a meeting\" came out as a generic portrait with no cafe, no Paris, no meeting. Cut-short drafts are now rejected (falling back to a prompt that keeps the request verbatim), and the review step now receives the original request as ground truth so the scene can never be dropped. Voice tone (a video trait) is also no longer injected into still-image prompts.",
      "Fixed the root cause of cut-short drafts: the Claude drafting call allowed only 500 output tokens, most of which the model spent on internal reasoning — on harder requests the visible draft (and even the safety-softening retry) came back truncated, silently dumping generations onto Flux and losing the character's face. Reasoning is now disabled for drafting and the token ceiling raised so a draft can never be cut off.",
      "Characters v2 — trait tiers: hair and distinguishing features are identity (always enforced); outfit and personality are now defaults the scene can override, so a business meeting no longer forces the character's saved swimsuit.",
      "Characters v2 — simpler prompt pipeline: removed the second-model review step (it could erase the user's scene and doubled cost and latency); one drafting call now receives the request as ground truth plus the tiered rulebook.",
      "Characters v2 — identity photos are sacred: generated images are no longer auto-added to a character's reference gallery; instead there's an explicit \"Use as reference photo\" action under image results, and the first gallery photo is labeled as the character's identity photo.",
      "Characters v2 — identity match score: every character image is now compared against the identity photo by a vision model and gets a 0-100 match score, shown under the result and in History.",
      "Safety net for all of the above: code tagged pre-characters-v2 and a database snapshot of all character profiles taken before the change — fully reversible.",
      "Fixed black pictures: when Flux's safety checker flags an image, fal.ai returns a solid black frame as if it succeeded — the pipeline now detects the flag and fails the generation honestly (with a refund) instead of delivering a black rectangle. The safety-softened wording is now reused for the Flux attempt too, and Flux results are saved into Picacho's own storage instead of living on fal.ai's servers, where they could expire.",
      "Automatic quality gate: the post-generation vision check now also judges whether the finished image is usable at all — a black/blank frame that a provider returned as a \"success\" is automatically marked failed and fully refunded, with an honest note in the pipeline log. No user report needed.",
      "Added an in-app Tutorial (settings menu → Tutorial): a seven-part illustrated guide covering characters, identity photos, trait tiers, generating, reading results and the match score, videos, credits/refunds, and troubleshooting — in all four languages.",
      "Fixed brand-new users getting no walkthrough at all: the tour lived inside the generation composer, but an account with no characters yet sees the \"create your first character\" screen instead, so the composer — and the entire tour — never rendered. New accounts now get a short welcome tour on that screen pointing at what to do first, and still get the composer walkthrough once they have a character.",
      "Fixed signing up with an email that already has an account: Supabase deliberately returns success without sending anything (anti-enumeration), so the app showed \"check your email\" for a message that was never sent — a great way to get locked out of an account you already have. Signup now says the account exists and points to logging in or resetting the password. Unconfirmed signups still correctly get their confirmation email resent.",
      "Hardened that duplicate-signup fix so it can't quietly stop working: instead of relying only on a hint in Supabase's response, signup now checks authoritatively (server-side, via a lookup that isn't reachable publicly) whether the email already has a confirmed account, before the signup call is even made.",
      "Admin → Users now shows sign-in activity for every user: last login (date and time), last seen, session time (how long they were actually on the site), signed-in device count, and a live \"online now\" dot — as tidy columns in the list and a dedicated Activity card on each user's page. Times display in your own timezone, not the server's.",
      "Fixed the advanced video options arrow opening onto nothing: multi-angle and storyboard were hidden entirely for accounts without the plan, so the arrow revealed an empty tray that read as a broken control. Both icons now always appear, switched off, and clicking one explains what unlocks it — and, if you're on the right plan but the wrong video model, says that instead.",
      "Buttons now respond the moment you press them: while the action is running the button dims, locks, and shows a spinner — no more pressing Save and wondering whether anything happened. Applied across admin, settings, account and billing forms (the Generate page keeps its own progress display). Locking the button also prevents an impatient double-click from firing the same action twice.",
      "Time on site is genuinely measured, not guessed: a heartbeat runs while a signed-in user has the app open and visible, and each beat credits only the gap since the last one. Idle time, background tabs, and closed laptops don't count, and stepping away for more than five minutes starts a fresh visit — so the admin view shows both this visit's real usage and a lifetime total.",
    ],
  },
];

// The current version, for showing elsewhere if ever useful (e.g. a footer).
export const CURRENT_VERSION = RELEASES[0]?.version ?? "0.0.0";
export const CURRENT_BUILD = RELEASES[0]?.build ?? 0;
