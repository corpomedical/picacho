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

  // Refresh the auth token if needed. Do not remove — required so
  // Server Components can read a valid session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
  if (user && request.nextUrl.pathname.startsWith("/app")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", user.id)
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
