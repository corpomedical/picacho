import { NextResponse } from "next/server";
import { getOrigin } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";
import { CONSENT_PAGE_PATH } from "@/lib/mcp/oauth/config";
import { consentErrorPath, handleConsentDecision } from "@/lib/mcp/oauth/endpoints";
import { fill } from "@/lib/mcp/oauth/messages";
import { getServerMessages } from "@/lib/i18n/server";
import { consentPath, pendingIdFrom } from "@/lib/mcp/oauth/resume";
import { consentSecret, endpointDeps, mayConnectApps } from "@/lib/mcp/oauth/runtime";

// POST /api/oauth/consent — the consent page's Allow / Don't allow (Press
// Tour Cut 8). The session says WHO; the form's anti-forgery value proves
// the form was ours, drawn for this request and this account; the pending
// authorization is answered once (oauth/store.ts decidePending).
//
// WHY AN HTML HAND-OFF AND NOT A 303 TO THE APP. The page's CSP carries
// `form-action 'self' …Stripe…` (middleware.ts), and Chrome enforces
// form-action on the REDIRECT after a form post: a 303 to
// claude.ai/…/auth_callback or a loopback port would be blocked. So the
// answer is a tiny page that moves on by itself (meta refresh, which CSP
// does not govern) with a link to press if it does not. Dead ends go to our
// own consent page, same-origin.

export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The hand-off page's words, in the reader's language (i18n connectApps). */
type HandoffWords = { lang: string; returning: string; continueLink: string; theApp: string };

async function handoffWords(): Promise<HandoffWords> {
  const { locale, t } = await getServerMessages();
  return { lang: locale, returning: t.connectApps.returning, continueLink: t.connectApps.continueLink, theApp: t.connectApps.theApp };
}

function handoff(location: string, w: HandoffWords): Response {
  let where = w.theApp;
  try {
    const u = new URL(location);
    where = u.protocol === "https:" ? u.hostname : w.theApp;
  } catch {
    /* keep the plain words */
  }
  const text = esc(fill(w.returning, { app: where }));
  const href = esc(location);
  const html = `<!DOCTYPE html><html lang="${esc(w.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${href}"><title>Picacho</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#1f1e1c;background:#faf9f6"><p style="text-align:center">${text}<br><br><a href="${href}" style="color:#a84e24">${esc(w.continueLink)}</a></p></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export async function POST(request: Request) {
  const deps = await endpointDeps();
  if (!deps.enabled) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Our own page's form only: an Origin, when a browser sends one, must be ours.
  const from = request.headers.get("origin");
  if (from && from !== deps.origin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    form = new URLSearchParams();
  }
  const pendingId = pendingIdFrom(form.get("pending"));
  const approve = form.get("decision") === "allow";

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (user && pendingId) {
    // Two-step first, as the app itself requires (the consent page checks
    // this too; the answer is checked again here, where it counts).
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      return NextResponse.redirect(`${deps.origin}/verify-2fa?next=${encodeURIComponent(consentPath(pendingId))}`, { status: 303 });
    }
  }
  const allowed = approve ? await mayConnectApps(supabase, user) : true;
  const answer = await handleConsentDecision(
    { pendingId, userId: user?.id ?? null, approve, formToken: form.get("form_token"), secret: consentSecret(), allowed },
    deps,
  );
  if (answer.kind === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (answer.kind === "page_error") return NextResponse.redirect(`${deps.origin}${consentErrorPath(answer.code)}`, { status: 303 });
  return handoff(answer.location, await handoffWords());
}

// A GET here is a person who reloaded the hand-off: send them to the page.
export async function GET() {
  return NextResponse.redirect(`${await getOrigin()}${CONSENT_PAGE_PATH}?error=expired`, { status: 303 });
}
