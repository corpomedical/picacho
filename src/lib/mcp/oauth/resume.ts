// Where sign-in may send a person back to when they came to connect an app
// (synthesis v2 #29: the pending authorization is stored on the server and
// ONLY its id travels through sign-in, two-step and the Google/Facebook
// round trip, as `next`).
//
// Exactly one shape is accepted: /oauth/authorize?pending=<uuid>. Anything
// else is null, and the caller falls back to /app as it always did. A
// person can therefore never be returned to a page a link chose, and the
// query cannot carry anything but an id the server made (which it looks up
// and checks again: expiry, one use, the account it belongs to).
//
// Pure and alias-free: the login page, the login action, the two-step page
// (a client component) and the consent page all use it.

const PENDING_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The consent page for one pending authorization. */
export function consentPath(pendingId: string): string {
  return `/oauth/authorize?pending=${pendingId}`;
}

/** The `next` a sign-in may return to, or null. */
export function oauthResumePath(next: unknown): string | null {
  if (typeof next !== "string" || next.length > 80) return null;
  const match = /^\/oauth\/authorize\?pending=([0-9a-fA-F-]{36})$/.exec(next);
  if (!match) return null;
  const id = match[1].toLowerCase();
  return PENDING_RE.test(id) ? consentPath(id) : null;
}

/** A pending id from the consent page's query, or null. */
export function pendingIdFrom(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.toLowerCase();
  return PENDING_RE.test(id) ? id : null;
}
