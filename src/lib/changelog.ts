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
    version: "1.2.0",
    build: 3,
    date: "2026-08-16",
    title: "The app, perfected",
    items: [
      "Promo codes can now be edited and deleted from the admin area. Editable: the salesperson, the commission rate and the notes. Not editable, by Stripe\u2019s design: the code itself, the discount and its duration \u2014 a discount someone already subscribed under can\u2019t be rewritten underneath them, so changing those means issuing a new code. Deleting asks twice and spells out what happens to the sales the code already brought in.",
      "Commission is now recorded on each sale at the rate it closed at, instead of being recalculated from the code\u2019s current rate. Without this, editing a rep\u2019s commission would have silently rewritten what they were owed on business already banked. Existing sales were backfilled.",
      "Prompt Studio, phase three: save a prompt worth keeping and reuse it from the composer\u2019s + menu. Saved prompts remember which character they were written for \u2014 reuse one while a different character is selected and Picacho hands back the original sentence instead of the compiled text, so the first character\u2019s hair and features don\u2019t end up in someone else\u2019s picture. Up to 200 per account.",
      "Fixed: uploading a photo and then picking a character silently deleted the upload \u2014 switching character starts a fresh chat, and that was throwing away composer input the person hadn\u2019t sent yet. Attachments now survive a character switch; only things belonging to the old character (a photo picked from its gallery, advanced video frames) are cleared.",
      "Fixed: a photo used to write a prompt stayed attached afterwards, which quietly made it the generation\u2019s reference image \u2014 so the result came back as a near-copy of the uploaded picture instead of using your character\u2019s face. Accepting an image-written prompt now removes the photo, and the panel says so.",
      "Prompt Studio, phase two: attach a photo and Picacho writes the prompt that would recreate it \u2014 light, wardrobe, setting, lens, composition. With a character selected it deliberately describes everything EXCEPT the person\u2019s face and refers to them as \u201cthe subject\u201d, because describing a second face fights the identity photo the generator anchors on and the model splits the difference into someone who is neither. One tap switches to the full description, including the person, for generating without a character.",
      "Prompt Studio, phase one: an Enhance button in the composer turns a plain sentence into the full engineered prompt \u2014 lighting, wardrobe, lens, composition \u2014 and shows it to you before you spend anything. Crucially it is not a second prompt writer: it runs the generator\u2019s own drafting step in compile-only mode, so the prompt on screen is the prompt that runs, and approving one submits it with redrafting switched off. Assists have their own generous monthly allowance per plan (10 free on trial) and never touch generation credits.",
      "Fixed a bug that had been sitting in the pipeline: the compile-only switch was nested inside the video branch, so asking for a prompt without a render silently generated (and charged for) an image anyway. It now applies to both media types.",
      "Images across the app now load instantly on repeat visits: every picture used to be fetched through a freshly minted temporary link (new link every page view, so nothing could ever be cached) — they're now served through stable, permanently cacheable URLs. This also removed a storage round-trip from almost every page load.",
      "Fixed a serious latent bug the old links hid: every image in History silently broke 7 days after it was made, because the stored link expired even though the file was still there. New results use permanent links, and every OLD row — including ones already broken — is rescued automatically at display time.",
      "Chat attachment previews no longer expire mid-conversation (they used to die after 24 hours).",
      "Picacho now installs as an app — from the browser straight onto your phone's home screen, full-screen with its own icon, on both Android and iPhone. No app store, no 30% platform cut. A small card in the app offers the install (with step-by-step instructions on iPhone) and remembers if you decline.",
      "The app has a real home page now: credits and plan at a glance, your characters one tap from a new chat, your latest creations, and quick actions for images, video and the tutorial. The composer is one tap away and unchanged — and it's where the first-run walkthrough now lives, shown the first time you actually face those controls.",
      "A \u201cGet the app\u201d button now sits in the header of every marketing page, plus a badge row in the footer \u2014 Picacho-branded, deliberately not fake app-store artwork. On Android it opens the browser\u2019s real install dialog; on iPhone a card teaches the two Safari taps; on desktop a \u201cgrab your phone\u201d card shows the address. It lives in the header rather than the hero so it costs no vertical space and can\u2019t push the headline out of line with the photo grid. All four languages.",
      "The homepage finally says what Picacho runs on: a lit glass rail under the hero naming every engine behind the product \u2014 GPT Image and Flux for stills, Kling, Veo and Seedance for video, ElevenLabs for voice, Claude for prompt drafting \u2014 floating above a blurred wall of Picacho\u2019s own generations. The list is derived from the real model catalogue in the code, so it can never advertise an engine the product doesn\u2019t actually run.",
      "New app icon drawn from the real Picacho wordmark — the P with the brand's ochre full stop.",
    ],
  },
  {
    version: "1.1.0",
    build: 2,
    date: "2026-08-15",
    title: "Brand, sales tools and polish",
    items: [
      "New marketing theme — \u201cOchre & Grotesk\u201d: a display typeface with real personality for headlines, one disciplined brand accent (Picacho ochre — a mountain color, deliberately not another AI-purple), and a restructured homepage: asymmetric hero showing a real character\u2019s identity photo beside five genuinely generated scenes of her, a ruled proof band with verifiable numbers, and a dark section showcasing the identity match score. Copy sharpened to specific claims in all four languages. The previous look is preserved under the pre-theme-ochre tag for instant rollback.",
      "The new theme now runs through the whole product, not just the homepage: primary buttons everywhere (app, admin, checkout, auth) carry the Picacho ochre, the first-run walkthrough speaks in the brand accent instead of a borrowed system blue, and the display typeface reaches pricing, login, signup and the app\u2019s welcome greeting. Working surfaces stay deliberately neutral so the tool remains calm in daily use.",
      "Finished the homepage retheme: the bottom sections (how it works / set up your character and the closing call-to-action) still carried the old blue palette — sky backgrounds and blue ambient glows. They now use the warm paper-and-ochre family like the rest of the page.",
      "Homepage hero now shows six hand-picked scenes of the same character — winter, festival and a cooking show alongside her identity photo — all real Picacho output, scoring 91-95% identity match. The full-length chef shot is framed chest-up so the face still reads at tile size.",
      "Redesigned the Tutorial\u2019s visuals as faithful replicas of the real interface — the composer, the character gallery with its identity-photo badge, a finished result with its pipeline steps, match score and action row, the multi-angle tabs, and the usage meter. All text in the visuals is live and translated (drawn as overlays, not baked into images), and wherever the app already has the label, the tutorial reuses the exact same string \u2014 so the guide can never drift out of sync with the product or its translations.",
      "Annual billing, ~25% off: every plan now has a yearly option that is a literal \u201c3 months free\u201d (Starter \u20ac14/mo, Growth \u20ac59/mo, Studio \u20ac224/mo, Elite \u20ac374/mo when billed yearly). The pricing page leads with Annual and a strikethrough of the monthly price; monthly view nudges toward the annual rate. Also fixed a lurking quota bug this exposed: monthly generation allowances are now anchored to a monthly anniversary of the billing date, so an annual subscriber\u2019s quota resets every month rather than once a year.",
      "New promo code system for the sales team (Admin → Promo codes): create a code per salesperson with its own discount percentage, discount duration, and commission rate — all editable at creation. Clients enter the code on the Stripe payment page (Stripe computes the discount, so the math is always right), codes only work on a client's first payment, and every redemption is recorded with the revenue it brought, which rep it belongs to, and the commission owed. Each user's admin page shows who referred them.",
      "Registration now asks for name, a username with a live availability check, and an optional company — and usernames are finally genuinely unique (there was no database constraint before, so two people could hold the same one). The sidebar shows your plan beside your username.",
      "Admin → Users now shows sign-in activity for every user: last login (date and time), last seen, session time (how long they were actually on the site), signed-in device count, and a live \"online now\" dot — as tidy columns in the list and a dedicated Activity card on each user's page. Times display in your own timezone, not the server's.",
      "Time on site is genuinely measured, not guessed: a heartbeat runs while a signed-in user has the app open and visible, and each beat credits only the gap since the last one. Idle time, background tabs, and closed laptops don't count, and stepping away for more than five minutes starts a fresh visit — so the admin view shows both this visit's real usage and a lifetime total.",
      "Buttons now respond the moment you press them: while the action is running the button dims, locks, and shows a spinner — no more pressing Save and wondering whether anything happened. Applied across admin, settings, account and billing forms (the Generate page keeps its own progress display). Locking the button also prevents an impatient double-click from firing the same action twice.",
      "Sent prompts in the Generate chat now show a relative timestamp (\"5 minutes ago\", in the viewer's language, updating live) and a copy button underneath (revealed on hover on desktop, always visible on touch) — same pattern as Claude\u2019s chat. Older messages include the date, not just the time.",
      "Fixed admin dropdowns and fields snapping back after Save: setting a user's plan to Elite saved correctly but the dropdown reverted to \"none\", which looked like the change had failed. Same for role, bonus credits and app settings — the values were always saved, the controls just redisplayed the page's original values until a refresh.",
      "Fixed the advanced video options arrow opening onto nothing: multi-angle and storyboard were hidden entirely for accounts without the plan, so the arrow revealed an empty tray that read as a broken control. Both icons now always appear, switched off, and clicking one explains what unlocks it — and, if you're on the right plan but the wrong video model, says that instead.",
      "Hardened that duplicate-signup fix so it can't quietly stop working: instead of relying only on a hint in Supabase's response, signup now checks authoritatively (server-side, via a lookup that isn't reachable publicly) whether the email already has a confirmed account, before the signup call is even made.",
    ],
  },
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
    ],
  },
];

// The current version, for showing elsewhere if ever useful (e.g. a footer).
export const CURRENT_VERSION = RELEASES[0]?.version ?? "0.0.0";
export const CURRENT_BUILD = RELEASES[0]?.build ?? 0;
