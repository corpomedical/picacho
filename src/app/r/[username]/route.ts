import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Referral landing: picacho.ai/r/<username>. Validates the handle, drops a
// 30-day attribution cookie, and forwards to signup — the signup action
// reads the cookie and records referred_by (see auth/actions.ts). Unknown
// or malformed handles forward to the homepage with no cookie: a dead
// referral link should never look like an error page to the person opening
// it. The username lookup runs through the admin client because anon RLS
// deliberately can't read profiles.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username: raw } = await params;
  const username = (raw ?? "").trim().toLowerCase();
  const origin = new URL(request.url).origin;

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    return NextResponse.redirect(`${origin}/`);
  }

  const admin = createAdminClient();
  const { data: referrer } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (!referrer?.id) {
    return NextResponse.redirect(`${origin}/`);
  }

  const response = NextResponse.redirect(`${origin}/signup`);
  response.cookies.set("picacho_ref", username, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
