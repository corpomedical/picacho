import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
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
    const { data: exchanged, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // The signups_enabled kill switch, enforced for OAuth too (2026-08-31
      // inspection). The email form checks the flag before creating anything,
      // but signInWithOAuth auto-creates a Supabase user for any Google or
      // Facebook identity it hasn't seen — so with signups closed during an
      // abuse wave, this callback was still minting fresh accounts, each
      // with the daily free render attached. Existing users are untouched:
      // the check only fires for a user whose account was created by THIS
      // exchange (seconds old), the same "is this a signup or a sign-in"
      // distinction the email paths get for free by being separate forms.
      const user = exchanged?.user;
      const createdAt = user?.created_at ? Date.parse(user.created_at) : NaN;
      // 15s, not the old 60s, and never on a recovery flow (round-two
      // audit): the heuristic cannot distinguish "created by THIS exchange"
      // from "a second exchange for a very fresh account" — at 60 seconds a
      // signup whose redirect was interrupted, retried after the operator
      // flipped signups off mid-wave, hard-deleted a legitimately created
      // account (with its terms record and referral). 15s keeps the
      // kill-switch teeth for the exchange that really just minted the user
      // while shrinking the misfire window fourfold; password-recovery
      // exchanges land on this same route with next=/reset-password and
      // never create accounts, so they are exempt outright.
      const isRecoveryFlow = next.startsWith("/reset-password");
      const brandNew =
        Number.isFinite(createdAt) && Date.now() - createdAt < 15_000 && !isRecoveryFlow;
      if (brandNew && user) {
        const { data: flag } = await supabase
          .from("feature_flags")
          .select("enabled")
          .eq("key", "signups_enabled")
          .maybeSingle();
        // Fails open on a missing row, exactly like the email path.
        if (flag?.enabled === false) {
          // Remove what the exchange just created, then end the session.
          // Deleting (not just signing out) matters: an orphaned auth user
          // would make the NEXT attempt look like an existing sign-in and
          // walk straight past this check.
          await createAdminClient().auth.admin.deleteUser(user.id);
          await supabase.auth.signOut();
          return NextResponse.redirect(
            `${origin}/login?error=closed`,
          );
        }

        // The bookkeeping every email signup gets and OAuth ones silently
        // did not (2026-08-31 inspection): the terms-acceptance timestamp —
        // the OAuth buttons sit under the same "by continuing you agree"
        // line, so continuing IS the affirmative act, and the row should
        // record when — and the referral cookie, which /r/<username> sets
        // for everyone but only the email form ever read, so every referred
        // signup that chose Google lost its referrer their bonus. Both
        // best-effort: bookkeeping must never break a login.
        try {
          const admin = createAdminClient();
          await admin
            .from("profiles")
            .update({ terms_accepted_at: new Date().toISOString() })
            .eq("id", user.id)
            .is("terms_accepted_at", null);
          const cookieStore = await cookies();
          const refUsername = cookieStore.get("picacho_ref")?.value?.trim().toLowerCase();
          if (refUsername && /^[a-z0-9_]{3,24}$/.test(refUsername)) {
            const { data: referrer } = await admin
              .from("profiles")
              .select("id")
              .eq("username", refUsername)
              .maybeSingle();
            if (referrer?.id && referrer.id !== user.id) {
              await admin
                .from("profiles")
                .update({ referred_by: referrer.id })
                .eq("id", user.id)
                .is("referred_by", null);
            }
          }
        } catch {
          // Attribution is a bonus, never a blocker.
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // The provider's raw error detail goes to the server log, never to the
  // page — the login page shows its own translated line for the code.
  if (oauthError) console.error("oauth callback error:", oauthError);
  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
