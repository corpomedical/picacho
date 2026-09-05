import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { unsubscribeSig } from "@/lib/email/send";
import { getOrigin } from "@/lib/origin";

// Marketing opt-out: GET /api/email/unsubscribe?u=<userId>&sig=<hmac> shows a
// one-button confirmation; the button POSTs back here and THAT flips
// marketing_opt_out.
//
// Signed rather than sessioned ON PURPOSE: the click comes from a mail
// client, where the person is almost never logged in — an unsubscribe that
// bounces through /login doesn't get completed, it gets the email reported
// as spam instead. The HMAC (minted by unsubscribeUrl in lib/email/send.ts)
// makes the link a capability for exactly one operation on exactly one
// account. Nothing else is reachable with it, and the flip is idempotent.
//
// GET never mutates (2026-09-05 audit): mail security layers — Safe Links,
// Mimecast, Gmail scanning — fetch every URL in an inbound message, and each
// automated GET carried a valid signature, silently opting the user out
// before they ever opened the email. The state change now requires the POST,
// which scanners don't send. (A POST with the same params is also what RFC
// 8058 one-click unsubscribe sends, so a List-Unsubscribe-Post header can
// point here whenever the send path grows one.)

export const runtime = "nodejs";

// Shape-check before touching crypto or the DB — the only valid `u` is a
// profiles UUID we minted ourselves.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Constant-time signature check — same discipline as the media route
// (api/media/[...key]): never compare secrets with ===. unsubscribeSig
// throws when no signing key is configured at all; that reads as invalid
// (fail closed — an unverifiable link must not flip anything).
function verifiedUserId(request: Request): string | null {
  const searchParams = new URL(request.url).searchParams;
  const userId = searchParams.get("u") ?? "";
  const provided = searchParams.get("sig") ?? "";
  if (!UUID_RE.test(userId)) return null;
  let expected: string;
  try {
    expected = unsubscribeSig(userId);
  } catch {
    return null;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return userId;
}

function page(body: string): NextResponse {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Unsubscribe — Picacho</title>
</head>
<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background-color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="margin:24px;text-align:center;">${body}</div>
</body>
</html>`;
  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  const userId = verifiedUserId(request);
  if (!userId) return new NextResponse("Invalid unsubscribe link.", { status: 400 });

  // Confirmation only — the POST below does the work. The form re-carries
  // the signed params in its action so the button needs no JS and no session.
  const searchParams = new URL(request.url).searchParams;
  const action = `/api/email/unsubscribe?u=${encodeURIComponent(userId)}&sig=${encodeURIComponent(searchParams.get("sig") ?? "")}`;
  return page(
    `<p style="margin:0;font-size:15px;color:#404040;">Stop receiving Picacho announcement emails?</p>
    <form method="POST" action="${action}" style="margin:16px 0 0;">
      <button type="submit" style="border:0;border-radius:9999px;background:#a84e24;color:#fff;padding:10px 22px;font-size:14px;font-weight:600;cursor:pointer;">Unsubscribe</button>
    </form>`,
  );
}

export async function POST(request: Request) {
  const userId = verifiedUserId(request);
  if (!userId) return new NextResponse("Invalid unsubscribe link.", { status: 400 });

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
  return page(
    `<p style="margin:0;font-size:15px;color:#404040;">You&#39;re unsubscribed &mdash; no more announcement emails. <a href="${origin}" style="color:#a84e24;">Back to Picacho</a></p>
    <p style="margin:10px 0 0;font-size:13px;color:#737373;">You can turn these back on any time in <a href="${origin}/app/settings" style="color:#a84e24;">Settings</a>.</p>`,
  );
}
