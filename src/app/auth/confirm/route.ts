import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// This is what a brand-new user's "Confirm your email" link actually points
// to. Supabase's default email template sends token_hash + type as query
// params (not the older #access_token hash fragment, and not a `code` param
// like OAuth uses in /auth/callback) — that requires a dedicated verifyOtp()
// call, which this route was missing entirely. Without it, clicking the
// confirmation link hit a route that didn't exist and Next.js served its
// generic 404, which is the "error page" a signing-up user saw instead of
// landing in the app. /auth/callback (OAuth's `code` exchange) is a
// different flow and can't handle this.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/app";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
      "That confirmation link is invalid or has expired — please sign up again.",
    )}`,
  );
}
