import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps the logged-in session fresh on every request. Next.js middleware
 * runs before a page loads; this re-issues the Supabase session cookie so
 * users don't get randomly logged out.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Establish who this is — and refresh the auth token if needed. Do not
  // remove the call: it is what keeps Server Components able to read a valid
  // session, because @supabase/ssr sets autoRefreshToken:false on the server
  // and middleware is the only place that persists a rotated token.
  //
  // getClaims(), NOT getUser(), and the difference is worth a paragraph.
  // Middleware executes at the Vercel edge PoP nearest the phone, not in the
  // iad1 function region beside the database — proved by the x-vercel-id
  // header, which carries only a PoP segment on a middleware-returned
  // redirect but a PoP::region pair on a rendered page. So every network
  // call middleware makes is a CROSS-REGION round trip: one Supabase auth
  // call measured 207-328ms from Europe. getUser() made that call on every
  // single authenticated request, and it sat inside the Android app's frozen
  // launch icon on every cold start (operator, 2026-08-29: "it's still
  // taking too long for the icon to disappear").
  //
  // getClaims() reaches the same identity without it: it still goes through
  // getSession()/__loadSession — so an expired token is still refreshed and
  // still persisted through the cookie handlers above, unchanged — and then
  // verifies the JWT's signature LOCALLY with WebCrypto against a JWKS that
  // is fetched once per isolate and cached. This project's tokens are
  // asymmetric (verified: the live access token's header is
  // {"alg":"ES256","kid":...}), which is what makes local verification
  // possible; on a symmetric token auth-js falls back to getUser() by itself,
  // so this is safe by construction rather than by assumption.
  //
  // The honest security trade: getUser() asks the auth server "is this
  // session still live?", so a ban or global sign-out takes effect on the
  // next request. getClaims() trusts a validly-signed token until it expires
  // (one hour). Revocation is not left unguarded — the suspension check
  // below is a real server round trip against profiles.status on every
  // authenticated /app request, which is this product's actual revocation
  // mechanism.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  // Enforce account suspension on every authenticated /app request. The
  // suspended flag lives in profiles.status; it used to be set by the admin
  // area but read nowhere, so a suspended user kept full access and could
  // still generate (reported bug). Checked here in middleware — before any
  // page or server action runs — so suspension takes effect immediately.
  //
  // Server actions POST to their own /app/* route, so this also blocks the
  // generate action, not just page views. The DB read only happens for
  // logged-in users on /app paths, so it adds nothing to public/marketing
  // traffic.
  if (userId && request.nextUrl.pathname.startsWith("/app")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.status === "suspended") {
      const redirectUrl = new URL("/login", request.url);
      redirectUrl.searchParams.set(
        "error",
        "Your account has been suspended. Contact support if you think this is a mistake.",
      );
      const res = NextResponse.redirect(redirectUrl);
      // Drop the Supabase session cookies on the way out. Without this the
      // browser keeps a valid session, /login sees it and bounces them
      // straight back to /app ("already signed in" redirect), and this
      // middleware bounces them back here — an infinite loop. Clearing the
      // cookies makes them land on /login logged out, as intended.
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.startsWith("sb-")) res.cookies.delete(cookie.name);
      }
      return res;
    }
  }

  return supabaseResponse;
}
