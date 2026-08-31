import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Referral landing: picacho.ai/r/<username>. Validates the handle, drops a
// 30-day attribution cookie, and forwards to signup — the signup action
// reads the cookie and records referred_by (see auth/actions.ts). Unknown
// or malformed handles forward to the same signup page with no cookie, so
// the response never says whether a handle exists. The username lookup runs through the admin client because anon RLS
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

  // Known and unknown handles now land on the SAME page (2026-08-31
  // inspection: known -> /signup, unknown -> / made this route an
  // unauthenticated account-existence oracle — usernames default to the
  // email local part, so /r/ahmed answering differently from /r/xqzk
  // confirmed who has an account, one probe per name, no login needed).
  // The cookie still only drops for a real referrer; a dead link simply
  // becomes a plain signup visit, which is also the friendlier landing.
  const response = NextResponse.redirect(`${origin}/signup`);
  if (!referrer?.id) {
    return response;
  }

  response.cookies.set("picacho_ref", username, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
