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
// When an action gains a new fixed message, add it to KNOWN_ERRORS —
// admin-error-banner.test.ts reads the admin actions and fails until it is.
// And the generic line promises the details are in the server log, so an
// action that puts a caught error's text in ?error logs it first (the same
// test holds every one of them to that).

const KNOWN_ERRORS = new Set<string>([
  // admin/actions.ts
  "Invalid status.",
  "You can't suspend your own account.",
  "You can't delete your own account.",
  "Couldn't erase their email from the promo sales — the account was NOT deleted, and nothing was changed. Try again; details are in the server log.",
  "This account's subscription is billed through Google Play and can't be cancelled from here — the account was NOT deleted. Have them cancel in the Play Store (or revoke it in the Play Console), then delete.",
  "Invalid role.",
  "That voice isn't in the list any more.",
  "You can't remove your own admin role.",
  "Invalid plan.",
  "This account is billed through Google Play — comping over it would hide a live Google subscription. Have them cancel in the Play Store first, then set the plan.",
  "Bonus credits must be 0 or more.",
  "That's more than 10,000 bonus credits — if you really mean it, do it in two steps.",
  "Their bonus credits changed while this page was open (a render spent some, or a refund put some back) — the value was NOT saved. Check the new number and try again.",
  "Missing generation id.",
  "Generation not found.",
  "Only succeeded generations can be featured.",
  "Only admin-owned generations can be featured — customer content needs a consent mechanism the gallery doesn't have yet.",
  "Value can't be empty.",
  "Label and ElevenLabs voice ID are both required.",
  "Characters are still using this voice — reassign them to another voice first.",
  "Couldn't check whether characters are using this voice — nothing was deleted. Details are in the server log.",
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
  "Couldn't save the code.",
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
  "A blast from this account is already in flight (or just ran) — check Recent sends before retrying. Nothing was sent.",
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
    "Couldn't delete the account",
    "Couldn't delete the account — it was NOT deleted, but their Stripe billing WAS already cancelled, and a verified face, if they had one, was withdrawn (they'd have to verify again). Retry the deletion, or restore their plan manually if they should stay. Details are in the server log.",
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
  [
    "Couldn't remove the code from this list",
    "Couldn't remove the code from this list — but it WAS already switched off in Stripe and its coupon deleted, so it can't be redeemed any more, even if it still shows as active here. Delete it again to clear it. Details are in the server log.",
  ],
  ["The code ", "That code already exists."],
  [
    "Couldn't record the Stripe ids",
    "Stripe accepted the code but saving its ids here failed — the code was rolled back on both sides. Try again.",
  ],
  // createPromoCode when its own clean-up fails: what is left, and where.
  [
    "Couldn't undo the code in Stripe after",
    "Stripe accepted the code but saving its ids here failed, and so did undoing it in Stripe — it may still be live there, with nothing on this list. Deactivate it and delete its coupon by hand in the Stripe dashboard; the ids are in the server log.",
  ],
  [
    "Couldn't undo the code in Stripe or clear it from this list",
    "Stripe accepted the code but saving its ids here failed, and so did undoing it in Stripe and clearing it from this list. It may still be live in Stripe: deactivate it and delete its coupon by hand in the Stripe dashboard (the ids are in the server log). Then delete it from this list, which won't touch Stripe.",
  ],
  [
    "Couldn't clear the unsaved code from this list",
    "The code wasn't saved, and clearing it from this list failed too — it shows here as active, but it isn't live in Stripe, so it can't be redeemed. Delete it from this list, which won't touch Stripe, then add it again. Details are in the server log.",
  ],
  // setPromoCodeActive after Stripe took the change: what Stripe now has.
  [
    "Couldn't mark the code active on this list",
    "Couldn't mark the code active on this list — but it IS on in Stripe, so it can be redeemed, even though it still shows as off here. Press Turn on again to bring the two in step. Details are in the server log.",
  ],
  [
    "Couldn't mark the code off on this list",
    "Couldn't mark the code off on this list — but it IS off in Stripe, so it can't be redeemed, even though it still shows as active here. Press Turn off again to bring the two in step. Details are in the server log.",
  ],
  [
    "Unknown video model",
    "Unknown video model — pick one of the ids from the AI providers page.",
  ],
  [
    "Unknown image model",
    "Unknown image model — pick one of the ids from the AI providers page.",
  ],
  // The range is MIN/MAX_IDENTITY_THRESHOLD (lib/generations/identity-gate.ts);
  // admin-error-banner.test.ts fails if they move and this doesn't.
  [
    "identity_gate_threshold must be",
    "identity_gate_threshold must be a whole number from 0 to 95 (0 turns the gate off).",
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
    "Couldn't resolve confirmed addresses",
    "Couldn't resolve the audience's confirmed addresses — nothing was sent. Check that supabase/applied/2026-09-05/email-truth.sql has been applied. Details are in the server log.",
  ],
  [
    "Couldn't record the blast before sending",
    "Couldn't record the blast before sending — nothing was sent. Details are in the server log.",
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
