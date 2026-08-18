import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrigin } from "@/lib/origin";

function safeNext(next: string | null): string {
  // Must be a single-leading-slash relative path — no "//", no scheme, no "@".
  if (!next || !/^\/[a-zA-Z0-9/_\-?=&.%]*$/.test(next) || next.startsWith("//")) return "/app";
  return next;
}

// Where OAuth providers (Google, Apple, Microsoft, Facebook) send the user
// back to after they approve sign-in. Supabase includes a one-time `code`
// here that gets exchanged for a real session — or, if something went wrong
// before the provider's consent screen (most commonly: that provider isn't
// enabled/configured in Supabase yet), an `error_description` instead.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Redirect origin comes from getOrigin(), NOT request.url — behind a proxy
  // the URL's host is reconstructed from the Host header, which a client can
  // set to anything, and building the post-login redirect from it makes this
  // an open redirect to an attacker-chosen host at the exact moment a fresh
  // session cookie was issued. getOrigin() only ever returns a host we
  // actually serve (or localhost in dev), same as every other redirect
  // builder in the app.
  const origin = await getOrigin();
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  const message = oauthError
    ? `Couldn't sign you in: ${oauthError}`
    : "Couldn't sign you in — please try again.";

  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);
}
