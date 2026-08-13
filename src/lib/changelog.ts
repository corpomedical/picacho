// Picacho changelog — the source for the admin "Updates" section.
//
// HOW TO ADD AN ENTRY (done at the end of each work session):
// Prepend a new object to the top of RELEASES (newest first). Bump `version`
// (semver-ish: minor for features, patch for small fixes) and increment
// `build` by one. `date` is an ISO yyyy-mm-dd string. `items` is the plain-
// language list of what shipped — this is what shows in the dropdown.
//
// Kept as code (not a database table) on purpose: each entry describes a
// deploy, so it belongs with the code it describes and ships in the same
// push. No admin data-entry, no table to keep in sync with what actually
// shipped.

export type Release = {
  version: string;
  build: number;
  date: string; // yyyy-mm-dd
  title: string;
  items: string[];
};

export const RELEASES: Release[] = [
  {
    version: "1.6.0",
    build: 7,
    date: "2026-08-13",
    title: "Updates section",
    items: [
      "Added this Updates section to the admin area — a running changelog of every release, each expandable to see exactly what shipped.",
    ],
  },
  {
    version: "1.5.0",
    build: 6,
    date: "2026-08-13",
    title: "Admin navigation polish",
    items: [
      "Added smooth left/right scroll chevrons to the admin top navigation (Material/Google-tabs style) so tabs that run off the edge are easy to reach.",
      "The current page's tab is now centered automatically on load; the raw scrollbar is hidden in favor of the chevrons.",
    ],
  },
  {
    version: "1.4.0",
    build: 5,
    date: "2026-08-13",
    title: "Account controls",
    items: [
      "Fixed a security bug: suspended users could still log in and generate. Suspension is now enforced immediately — blocked in middleware, in the generation check, and banned at the auth layer so they can't sign back in.",
      "Added the ability to permanently delete a user from the admin area. Deletion removes the account and all its data (characters, generations, projects, billing records) and purges their stored files, with a confirmation step and self-delete protection.",
    ],
  },
  {
    version: "1.3.0",
    build: 4,
    date: "2026-08-13",
    title: "Signup & email system",
    items: [
      "Fixed the email-confirmation flow: after confirming, new users land in the app already signed in instead of being bounced to the homepage logged out.",
      "Added a clear \"Check your email\" screen after signup, replacing the silent redirect that looked like nothing happened.",
      "Set up real transactional email through Resend (custom SMTP) so confirmation and password-reset emails actually send.",
      "Added branded, Picacho-styled confirmation and password-reset email templates using the real logo.",
      "The confirm link now works across devices (sign up on laptop, confirm on phone).",
    ],
  },
  {
    version: "1.2.0",
    build: 3,
    date: "2026-08-12",
    title: "Pricing & reliability",
    items: [
      "Restructured plans: Studio now includes storyboard and multi-image reference; Elite adds priority rendering, early access, and API access.",
      "Fixed the pricing cards so the plan features display correctly.",
      "Fixed a caching issue that made marketing and legal pages serve stale content on one domain — pages now always reflect the latest deploy.",
    ],
  },
  {
    version: "1.1.0",
    build: 2,
    date: "2026-08-12",
    title: "Refunds & result confidence",
    items: [
      "Failed generations no longer consume a user's monthly allowance, purchased credits, or free-trial generations — the \"failed generations are free\" promise is now actually enforced.",
      "Each generation now records exactly what it consumed, so refunds on failure are precise.",
      "The validation result is now shown on each successful generation (\"passed on the first try\").",
    ],
  },
  {
    version: "1.0.0",
    build: 1,
    date: "2026-08-12",
    title: "Launch audit fixes",
    items: [
      "Fixed a recurring crash on history pages (a date/timezone rendering mismatch).",
      "Fixed a signup feature-flag error and hardened the signups kill switch.",
      "Security: pinned database function search paths, consolidated row-level-security policies, and added missing foreign-key indexes.",
      "Set picacho.ai as the canonical domain (www now redirects to it) and stopped admin traffic from polluting analytics.",
      "Pricing page: removed a contradictory line, defined what a generation is, added an FAQ, and surfaced the free trial.",
      "Finalized the Terms of Service and Privacy Policy (Spain/Madrid governing law, live Stripe billing terms, a 7-day refund policy, and GDPR rights).",
      "Landing page: added a feature card highlighting enforced brand rules.",
    ],
  },
];

// The current version, for showing elsewhere if ever useful (e.g. a footer).
export const CURRENT_VERSION = RELEASES[0]?.version ?? "0.0.0";
export const CURRENT_BUILD = RELEASES[0]?.build ?? 0;
