// Admin server actions are wired to plain <form action={...}> elements
// with no client-side result handling — on failure they redirect back to
// the same page with ?error=..., and each admin page renders this at the
// top so the failure is actually visible instead of only landing in a
// server log nobody's watching.
//
// The query param is attacker-reachable: anyone can send an admin a link
// like /admin/users?error=Session+expired,+re-enter+your+password+at+...
// and this component used to render that text verbatim inside trusted admin
// chrome — exactly the surface a phishing message wants (same class of
// issue app/settings fixed for its own ?error=). So the param is treated as
// a CODE, never as copy: only the exact strings our own admin actions
// redirect with are shown as-is, a few families that carry a dynamic tail
// (Stripe error details, DB messages) collapse to a fixed safe summary
// matched by prefix, and anything unrecognized becomes one generic line.
// The trade-off is deliberate: an admin loses the raw Stripe/Postgres
// detail in the banner (it's still in the server logs), and gains a banner
// that can never be scripted into saying something we didn't write.
//
// Kept dependency-light on purpose: two lookup tables in this one file.
// When an action gains a new fixed message, add it to KNOWN_ERRORS.

const KNOWN_ERRORS = new Set<string>([
  // admin/actions.ts
  "Invalid status.",
  "You can't suspend your own account.",
  "You can't delete your own account.",
  "Invalid role.",
  "You can't remove your own admin role.",
  "Invalid plan.",
  "Bonus credits must be 0 or more.",
  "Value can't be empty.",
  "Label and ElevenLabs voice ID are both required.",
  "Missing model",
  "Unknown model",
  "max_retry_attempts must be a whole number from 1 to 10.",
  "support_email must be a valid email address.",
  "admin_users_last_viewed_at must be a valid timestamp.",
  "Value is too long (500 characters max).",
  // admin/promo-actions.ts
  "Code must be 3-24 letters/numbers (e.g. MARIA20).",
  "Salesperson name is required.",
  "Discount must be 1-100%.",
  "Duration must be 0-36 months (0 = forever).",
  "Commission must be 0-100%.",
  "Code not found.",
  // admin/email-actions.ts
  "Key must be 2-40 characters: lowercase letters, numbers and hyphens.",
  "Subject is required (200 characters max).",
  "Body is required (20,000 characters max).",
  "Template not found.",
  "Couldn't load your profile email.",
  "Invalid audience.",
  "Confirmation text doesn't match the audience — nothing was sent.",
  "Confirmation text doesn't match — a service notice must be confirmed as service:<audience>. Nothing was sent.",
  "No recipients match that audience (opted-out and suspended accounts are excluded).",
  "No recipients match that audience (suspended accounts are excluded; service notices include opted-out accounts).",
  "The blast could not be sent — nothing went out. Check RESEND_API_KEY and the server log.",
]);

// Messages whose tail is dynamic (a Stripe or Postgres error string). The
// prefix identifies which of OUR messages it was; the mapped value is what
// actually renders, so the dynamic tail — the part a crafted link could
// abuse — never reaches the page.
const PREFIX_SUMMARIES: [string, string][] = [
  [
    "Couldn't cancel their Stripe billing",
    "Couldn't cancel their Stripe billing — the account was NOT deleted. Sort it out in the Stripe dashboard, then try again.",
  ],
  [
    "Couldn't update the profile status",
    "Couldn't update the profile status — check whether the login ban matches the listed status, and retry to reconcile. Details are in the server log.",
  ],
  [
    "Stripe couldn't create the code:",
    "Stripe couldn't create the code — nothing was saved. Details are in the server log.",
  ],
  [
    "Couldn't remove the code from Stripe",
    "Couldn't remove the code from Stripe, so nothing was deleted — try again.",
  ],
  ["The code ", "That code already exists."],
  [
    "Couldn't record the Stripe ids",
    "Stripe accepted the code but saving its ids here failed — the code was rolled back on both sides. Try again.",
  ],
  [
    "Unknown video model",
    "Unknown video model — pick one of the ids from the AI providers page.",
  ],
  [
    "Unknown image model",
    "Unknown image model — pick one of the ids from the AI providers page.",
  ],
  // admin/email-actions.ts
  [
    "Couldn't save the template",
    "Couldn't save the template — details are in the server log.",
  ],
  [
    "Couldn't delete the template",
    "Couldn't delete the template — details are in the server log.",
  ],
  [
    "Couldn't send the test email",
    "Couldn't send the test email — details are in the server log.",
  ],
  [
    "Couldn't count the audience",
    "Couldn't load the audience — check that supabase/applied/2026-08-19/email.sql has been applied. Details are in the server log.",
  ],
  [
    "Couldn't load the audience",
    "Couldn't load the audience — check that supabase/applied/2026-08-19/email.sql has been applied. Details are in the server log.",
  ],
  [
    "That audience has ",
    "That audience is over the per-blast recipient cap — nothing was sent. The cap lives in lib/admin/email-actions.ts; raise it deliberately when the list outgrows it.",
  ],
];

const GENERIC_ERROR = "Something went wrong — try again. Details are in the server log.";

function displayError(error: string): string {
  if (KNOWN_ERRORS.has(error)) return error;
  const family = PREFIX_SUMMARIES.find(([prefix]) => error.startsWith(prefix));
  return family ? family[1] : GENERIC_ERROR;
}

export function AdminErrorBanner({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div className="mb-6 rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {displayError(error)}
    </div>
  );
}

// Success counterpart, same allowlist rule: ?message= is just as reachable
// by a crafted link as ?error=, so only messages our own actions actually
// redirect with are shown, and anything else renders nothing at all (a
// success banner has no honest generic fallback).
const KNOWN_MESSAGES = new Set<string>([
  "User deleted.", // deleteUser in lib/admin/actions.ts
  // admin/email-actions.ts
  "Template saved.",
  "Template deleted.",
  "Test email sent — check your inbox.",
]);

// Success messages whose only dynamic part is a COUNT (email blast
// summaries). Anchored patterns where the sole variable content is digits —
// a crafted link can change the number, but can't make the banner say
// anything we didn't write, which is the whole allowlist's promise.
const KNOWN_MESSAGE_PATTERNS: RegExp[] = [
  /^Sent to \d+ recipients?\.$/, // sendEmailBlast in lib/admin/email-actions.ts
  /^Sent to \d+ of \d+ recipients — some chunks failed; details are in the server log\.$/,
];

export function AdminSuccessBanner({ message }: { message?: string }) {
  if (
    !message ||
    (!KNOWN_MESSAGES.has(message) && !KNOWN_MESSAGE_PATTERNS.some((re) => re.test(message)))
  ) {
    return null;
  }
  return (
    <div className="mb-6 rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
      {message}
    </div>
  );
}
