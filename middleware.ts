import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { NATIVE_COOKIE, userAgentIsNativeApp } from "@/lib/native/platform";
import { isSignedOutAppNavigation } from "@/lib/auth/signed-out-nav";

// ---------------------------------------------------------------------------
// Content-Security-Policy — built here, per request, because it carries a
// per-request nonce (the Next.js official CSP pattern).
//
// The previous policy lived in next.config.ts headers() and allowed
// script-src 'unsafe-inline' with connect-src https: and img-src https: —
// which contains almost nothing: any injected <script> ran, and any injected
// code could exfiltrate to any https host. With a nonce + 'strict-dynamic',
// only scripts stamped with this request's nonce (Next stamps its own
// bootstrap scripts automatically when it sees the nonce in the REQUEST's
// CSP header — that is why the header is set on the request below, not just
// the response) and scripts THEY load may execute. The remaining sources are
// the exact hosts the browser legitimately talks to, no wildcards.
//
// Serving both hosts' traffic notes:
//   • Supabase (auth + direct storage uploads from the browser — see
//     lib/supabase/client.ts and character-form.tsx) — derived from
//     NEXT_PUBLIC_SUPABASE_URL rather than hardcoded.
//   • fal.media — finished VIDEO renders stay hosted on fal's CDN
//     (generations.result_url; images are re-hosted into our storage but
//     fall back to the fal URL if that download hiccups — see
//     providers/image.ts), so <video>/<img> need it. Subdomain wildcard
//     because fal serves from versioned hosts (v3.fal.media etc.).
//   • Stripe — frame-src for js.stripe.com/hooks.stripe.com as Stripe
//     requires, and form-action for the Checkout/Billing-portal redirects
//     that follow our own server-action form posts (Chrome enforces
//     form-action on the redirect target). js.stripe.com stays in
//     script-src for older browsers that ignore 'strict-dynamic' and for
//     Stripe.js if it's ever added.
//   • Google Fonts hosts are kept from the old policy (next/font self-hosts,
//     but the entries are harmless and cover any legacy stylesheet link).
//
// The old inline theme-init script in app/layout.tsx now receives the nonce
// via the x-nonce request header (headers() in the root layout). JSON-LD
// <script type="application/ld+json"> blocks are inert data, not executable
// script, so CSP does not gate them and they need no nonce.
//
// 'unsafe-eval' in dev only: Next's dev tooling (react-refresh) needs it;
// production never gets it.
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  let supabaseOrigin = "";
  let supabaseWs = "";
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    supabaseOrigin = u.origin;
    supabaseWs = `wss://${u.host}`;
  } catch {
    // Missing/invalid env — the app can't talk to Supabase anyway; the
    // policy simply omits it rather than throwing in middleware.
  }

  return [
    `default-src 'self'`,
    // 'self' https: 'unsafe-inline' are fallbacks for pre-strict-dynamic
    // browsers only — anything that understands 'strict-dynamic' ignores
    // them, so modern browsers run nonce-approved scripts and nothing else.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com https: 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    // 'unsafe-inline' stays for styles: React writes style="" attributes
    // everywhere and Tailwind/Next inject style tags without nonce support.
    // Style injection is a far smaller sink than script and the script side
    // is what this change locks down.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""} https://*.fal.media`,
    `media-src 'self' blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""} https://*.fal.media`,
    // Browser-side fetch/XHR/WebSocket targets: our own routes plus Supabase
    // (auth token refresh, storage uploads, realtime). Previously `https:
    // wss:` — i.e. anywhere. fal.media must stay here too: DownloadButton
    // saves results via fetch(url) → blob (a plain <a download> can't save
    // cross-origin), and video result_urls live on fal's CDN — without this
    // entry every video Download silently degrades to opening a tab.
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin} ${supabaseWs}` : ""} https://*.fal.media`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `frame-src https://js.stripe.com https://hooks.stripe.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self' https://checkout.stripe.com https://billing.stripe.com`,
    `frame-ancestors 'none'`,
  ].join("; ");
}

export async function middleware(request: NextRequest) {
  // The native shell opens at the site root. A phone must land in the
  // product, not on the marketing homepage — the heaviest page on the site,
  // which on a cold fresh-install WebView held the splash screen for 30+
  // seconds (measured on the Play internal build, 2026-08-20) and read as
  // "app is dead". /app's own auth guard takes over from here (login when
  // signed out). Browsers are unaffected; the app can still reach the
  // homepage through in-app links if it ever needs to — only the entry
  // navigation is rerouted.
  if (
    request.nextUrl.pathname === "/" &&
    userAgentIsNativeApp(request.headers.get("user-agent"))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    const redirect = NextResponse.redirect(url);
    redirect.cookies.set(NATIVE_COOKIE, "1", { path: "/", sameSite: "lax" });
    return redirect;
  }

  // Signed-out /app navigations bounce to /login HERE, at the edge, instead
  // of inside the render.
  //
  // /app's auth guard lives behind the root layout's Suspense boundary, so a
  // request with no session returns HTTP 200 carrying a streamed
  // "NEXT_REDIRECT;replace;/login" directive (verified live: 20,873 bytes,
  // status 200). The phone therefore had to download that HTML, download the
  // whole JS bundle and hydrate React before it could even ASK for /login —
  // an entire download-and-hydrate cycle spent inside the Android app's
  // frozen launch icon on every first install and every signed-out open.
  //
  // The condition is deliberately the narrowest possible one: NO Supabase
  // auth cookie exists at all. It is never a judgement about whether a token
  // is valid or expired — a request that carries any sb-* cookie falls
  // through to the normal path and is authenticated exactly as before, so
  // this cannot log anyone out or shortcut a real session. GET only, so a
  // server action POST is never rewritten into a redirect.
  if (
    isSignedOutAppNavigation(
      request.method,
      request.nextUrl.pathname,
      request.cookies.getAll().map((c) => c.name),
    )
  ) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  // Nonce first, on the REQUEST headers, before updateSession builds the
  // response with NextResponse.next({ request }) — that forwarding is what
  // lets Next's renderer see the nonce and stamp its own inline scripts
  // with it. x-nonce is how the root layout reads it for the theme script.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);

  // Auth/session logic is unchanged and still runs on exactly the same
  // matcher as before — the CSP additions above touch only headers.
  const response = await updateSession(request);

  // Record whether this session is running inside the iOS/Android shell, so
  // Server Components can omit purchase UI rather than render it and hide it
  // afterwards. Capacitor appends a marker to the user agent (see
  // capacitor.config.ts); this turns that into something readable everywhere.
  //
  // Not httpOnly on purpose — client components need to read the same signal,
  // and there's nothing sensitive in it. Session-scoped so a browser can't
  // inherit a stale "I'm the app" flag from some earlier context.
  const isNative = userAgentIsNativeApp(request.headers.get("user-agent"));
  const existing = request.cookies.get(NATIVE_COOKIE)?.value;
  if (isNative && existing !== "1") {
    response.cookies.set(NATIVE_COOKIE, "1", { path: "/", sameSite: "lax" });
  } else if (!isNative && existing === "1") {
    response.cookies.delete(NATIVE_COOKIE);
  }

  // And on the response, which is what the browser actually enforces. Also
  // set on updateSession's redirect responses (suspension bounce) — harmless
  // there, correct everywhere else.
  response.headers.set("content-security-policy", csp);

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every route except static files and images, so the session
     * cookie stays fresh everywhere without wasting work on assets.
     * The CSP header rides along on the same matcher: excluded paths are
     * assets and API responses, which a document-level CSP doesn't apply to.
     */
    // api/v1 is excluded: it authenticates with an API key, has no
    // session cookie to refresh, and every request through it would
    // otherwise pay for a pointless Supabase auth round-trip.
    "/((?!_next/static|_next/image|api/v1|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
