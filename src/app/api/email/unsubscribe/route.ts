import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { unsubscribeSig } from "@/lib/email/send";
import { getOrigin } from "@/lib/origin";

// One-click marketing opt-out: GET /api/email/unsubscribe?u=<userId>&sig=<hmac>.
//
// Signed rather than sessioned ON PURPOSE: the click comes from a mail
// client, where the person is almost never logged in — an unsubscribe that
// bounces through /login doesn't get completed, it gets the email reported
// as spam instead. The HMAC (minted by unsubscribeUrl in lib/email/send.ts)
// makes the link a capability for exactly one operation on exactly one
// account: flipping that account's marketing_opt_out to true. Nothing else
// is reachable with it, and the flip is idempotent, so a forwarded or
// re-clicked link is harmless.

export const runtime = "nodejs";

// Shape-check before touching crypto or the DB — the only valid `u` is a
// profiles UUID we minted ourselves.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const userId = searchParams.get("u") ?? "";
  const provided = searchParams.get("sig") ?? "";

  if (!UUID_RE.test(userId)) {
    return new NextResponse("Invalid unsubscribe link.", { status: 400 });
  }

  // Constant-time signature check — same discipline as the media route
  // (api/media/[...key]): never compare secrets with ===. unsubscribeSig
  // throws when no signing key is configured at all; that's a 400 too
  // (fail closed — an unverifiable link must not flip anything).
  let expected: string;
  try {
    expected = unsubscribeSig(userId);
  } catch {
    return new NextResponse("Invalid unsubscribe link.", { status: 400 });
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return new NextResponse("Invalid unsubscribe link.", { status: 400 });
  }

  // Service role, because there is no session here (see above). The update
  // is scoped to the one id the signature vouches for. A deleted account
  // matches zero rows, which is fine — the outcome they asked for (no more
  // email) already holds.
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ marketing_opt_out: true })
    .eq("id", userId);

  if (error) {
    // Fail closed and say so — a "you're unsubscribed" page over a failed
    // write would be a lie that ends in exactly the spam report the page
    // exists to prevent.
    console.error("unsubscribe: opt-out write failed", { userId, error });
    return new NextResponse("Something went wrong — please try the link again.", { status: 500 });
  }

  const origin = await getOrigin();
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Unsubscribed — Picacho</title>
</head>
<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background-color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="margin:24px;text-align:center;">
    <p style="margin:0;font-size:15px;color:#404040;">You&#39;re unsubscribed &mdash; no more announcement emails. <a href="${origin}" style="color:#a84e24;">Back to Picacho</a></p>
    <p style="margin:10px 0 0;font-size:13px;color:#737373;">You can turn these back on any time in <a href="${origin}/app/settings" style="color:#a84e24;">Settings</a>.</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The link mutates state per-click; never let a CDN cache the response.
      "cache-control": "no-store",
    },
  });
}
