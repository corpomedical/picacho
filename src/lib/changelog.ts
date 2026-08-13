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
    date: "2026-08-13",
    title: "Launch readiness",
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
    ],
  },
];

// The current version, for showing elsewhere if ever useful (e.g. a footer).
export const CURRENT_VERSION = RELEASES[0]?.version ?? "0.0.0";
export const CURRENT_BUILD = RELEASES[0]?.build ?? 0;
