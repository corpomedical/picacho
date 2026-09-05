import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrigin } from "@/lib/origin";

function safeNext(next: string | null): string {
  // Must be a single-leading-slash relative path — no "//", no scheme, no "@".
  if (!next || !/^\/[a-zA-Z0-9/_\-?=&.%]*$/.test(next) || next.startsWith("//")) return "/app";
  return next;
}

// Where a new user's "Confirm your email" link lands. Handles BOTH shapes of
// confirmation link, because which one Supabase sends depends on a dashboard
// setting we don't fully control:
//
//  A) token_hash + type  — the SSR-recommended form. Only available once
//     custom SMTP is configured (Supabase locks email-template editing until
//     then). verifyOtp works across devices/browsers: the link can be opened
//     anywhere and still signs the person in.
//
//  B) code               — what the DEFAULT (built-in email) confirm template
//     produces. The built-in verify endpoint validates the token, then
//     redirects here with a one-time `code` (PKCE). exchangeCodeForSession
//     turns it into a session. Caveat: PKCE needs the code_verifier cookie
//     that was set in the browser at signup, so this path only completes in
//     the SAME browser the signup started in. A link opened on a different
//     device falls through to the login screen — the fix for that is custom
//     SMTP + the token_hash template (path A).
//
// Either way, on success the session cookie is set and we redirect to `next`
// (default /app), so the user lands signed in instead of back on the
// homepage logged out.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // getOrigin(), not request.url: the URL's host comes from the Host header,
  // which is client-controlled behind a proxy — an emailed confirmation link
  // replayed with a spoofed Host would otherwise bounce the fresh session to
  // an attacker-chosen origin. getOrigin() pins the redirect to a host we
  // actually serve. Same reasoning as /auth/callback.
  const origin = await getOrigin();
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  const supabase = await createClient();

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // A code, not text — the login page maps it to its own translated wording
  // (see lib/auth/actions.ts for why the pages never print URL text).
  return NextResponse.redirect(`${origin}/login?error=link`);
}
