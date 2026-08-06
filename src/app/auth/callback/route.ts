import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Where OAuth providers (Google, Apple, Microsoft, Facebook) send the user
// back to after they approve sign-in. Supabase includes a one-time `code`
// here that gets exchanged for a real session — or, if something went wrong
// before the provider's consent screen (most commonly: that provider isn't
// enabled/configured in Supabase yet), an `error_description` instead.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";
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
