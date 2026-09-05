"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getOrigin } from "@/lib/origin";
import { notifyAdmins } from "@/lib/push/web-push";
import { rateLimited, hashedRateKey } from "@/lib/rate-limit";
import { isDisposableEmail } from "@/lib/auth/disposable-domains";

// Pre-auth throttling (2026-09-05 audit). These are server actions, so the
// auth request Supabase sees comes from VERCEL'S egress address — its
// built-in per-IP limits cannot tell an attacker from everyone else, and
// nothing else limited login, signup, or the username probe at all
// (credential stuffing, signup farming, and account enumeration all ran at
// line speed). The limiter fails closed, same policy as every other caller.
async function callerIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

// Errors travel to /login and /signup as CODES, never as text (2026-09-05
// flaw hunt): the pages used to print whatever ?error= carried — a crafted
// link could put attacker-chosen wording in the site's own error slot on the
// exact page where people type passwords, and real failures leaked the
// provider's raw English internals. The pages map each code to their own
// translated wording (t.auth.errors) and show a generic line for anything
// unrecognized.
export async function login(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  // Per-IP first, then per-target-email — distributed stuffing against one
  // account trips the second bucket even when each attacking address stays
  // under the first. 10/15min per email is far above any human retyping a
  // password and matches the password-verify ceiling's reasoning.
  const ip = await callerIp();
  if (await rateLimited(hashedRateKey(ip, "login-ip"), "login-ip", 60, 10)) {
    redirect("/login?error=throttled");
  }
  const emailKey = String(email ?? "").trim().toLowerCase();
  if (await rateLimited(hashedRateKey(emailKey, "login-email"), "login-email", 15 * 60, 10)) {
    redirect("/login?error=throttled");
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // The two answers a person can act on get their own codes; everything
    // else — outages, config drift — is one generic retry line rather than
    // provider internals that leak account-state differences.
    const code = /invalid login credentials/i.test(error.message)
      ? "invalid"
      : /email not confirmed/i.test(error.message)
        ? "unconfirmed"
        : "failed";
    redirect(`/login?error=${code}`);
  }

  redirect("/app");
}

export async function signup(formData: FormData) {
  const supabase = await createClient();

  // Before anything else — the flag read below and the email-status probe
  // further down both cost a query, and the distinct "already exists"
  // answer was bulk-harvestable at line speed without this.
  if (await rateLimited(hashedRateKey(await callerIp(), "signup-ip"), "signup-ip", 60 * 60, 10)) {
    redirect("/signup?error=throttled");
  }

  // Re-checked here, not just hidden in the UI — the signup page itself
  // already gates on this, but this is the actual enforcement in case
  // someone posts to this action directly. Fails open on a missing/errored
  // row, same as the page.
  const { data: flag } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "signups_enabled")
    .maybeSingle();
  if (flag?.enabled === false) {
    redirect("/signup?error=closed");
  }

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const agreed = formData.get("agree_to_terms") === "on";
  const fullName = ((formData.get("full_name") as string) ?? "").trim();
  const username = ((formData.get("username") as string) ?? "").trim().toLowerCase();
  const company = ((formData.get("company") as string) ?? "").trim();

  if (!fullName || fullName.length > 80) {
    redirect("/signup?error=name");
  }
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    redirect("/signup?error=username");
  }
  if (company.length > 120) {
    redirect("/signup?error=company");
  }

  // Disposable-address screen (2026-09-05 flaw hunt: free-account farming
  // needs nothing but a throwaway inbox). High-confidence list only, and it
  // fails open — see disposable-domains.ts. Checked before any query is
  // spent on this address.
  if (isDisposableEmail(email)) {
    redirect("/signup?error=disposable");
  }

  // Required checkbox gates account creation — see the Content Policy's
  // strict rules on real-people likeness and its zero-tolerance policy for
  // anything involving minors. This isn't just a UI nicety: it's the
  // affirmative record that the person agreed before we ever let them
  // generate anything.
  if (!agreed) {
    redirect("/signup?error=terms");
  }

  // Authoritative already-registered check, BEFORE spending a signUp call.
  //
  // signUp() deliberately refuses to tell us this (Supabase's anti-
  // enumeration behaviour: normal-looking response, no email sent, the only
  // hint an empty `identities` array). Depending on that array alone means
  // depending on an SDK response shape — and if it ever comes back undefined
  // instead of [], the check silently stops working and we're back to
  // telling people to check an inbox for mail that will never arrive.
  //
  // auth_email_status is SECURITY DEFINER and executable only by
  // service_role, so it's reachable from here and from nowhere public.
  //
  // Fails OPEN on any error: a broken lookup must never block real signups,
  // and the identities check below still backs it up.
  //
  // 'unconfirmed' deliberately falls through — that person never finished
  // signing up, and letting signUp() resend their confirmation email is
  // exactly the behaviour they need.
  let existingUnconfirmed = false;
  try {
    const admin = createAdminClient();
    const { data: status } = await admin.rpc("auth_email_status", { p_email: email });
    if (status === "confirmed") {
      redirect("/signup?error=exists");
    }
    // Remembered for below: on 'unconfirmed', signUp() RESENDS confirmation
    // for the EXISTING account and returns the victim's real user — the
    // profile write and referral attribution must not run against it.
    existingUnconfirmed = status === "unconfirmed";
  } catch (err) {
    // redirect() signals by throwing — never swallow it as a lookup failure.
    if (err && typeof err === "object" && "digest" in err && typeof (err as { digest?: unknown }).digest === "string" && (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")) {
      throw err;
    }
  }

  // emailRedirectTo is what makes the confirmation link land back in THIS
  // app instead of wherever the Supabase dashboard Site URL happens to point.
  // It's built from the host the person actually signed up on (getOrigin),
  // so someone on picacho.ai gets a picacho.ai link — critical, because the
  // session cookie set on confirm only belongs to that exact domain. Points
  // at /auth/confirm, the route that calls verifyOtp and establishes the
  // session, so the user lands on /app already signed in rather than back on
  // the homepage logged out.
  //
  // NOTE: this only takes effect if the Supabase "Confirm signup" email
  // template is set to the token_hash form that /auth/confirm expects:
  //   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/app
  // With the default {{ .ConfirmationURL }} template, Supabase uses its own
  // verify endpoint (implicit flow) which the SSR server can't read, and the
  // user ends up logged out. Template + Redirect URL allowlist are dashboard
  // settings, documented alongside this change.
  const origin = await getOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?next=/app`,
    },
  });

  if (error) {
    // Same code treatment as login: the two actionable answers by name,
    // everything else generic instead of the provider's raw wording.
    const code = /password/i.test(error.message)
      ? "password"
      : /email/i.test(error.message) && /invalid|validate/i.test(error.message)
        ? "bademail"
        : "signupFailed";
    redirect(`/signup?error=${code}`);
  }

  // Supabase does NOT return an error when the email already belongs to a
  // confirmed account — that's its built-in email-enumeration protection: it
  // returns a normal-looking user object and sends nothing. Left unhandled,
  // signing up again with an existing address showed the cheerful "check
  // your email" screen and then no email ever arrived, which is how someone
  // ends up locked out of an account they already have, waiting on a message
  // that was never sent.
  //
  // The documented signal for this case is an empty `identities` array.
  // Telling the person plainly is the deliberate call here: it does reveal
  // that an account exists, but a signup form that silently pretends to
  // work is a worse failure than that disclosure — and the login page's own
  // errors already reveal the same thing.
  //
  // Note the ordering: an existing but UNCONFIRMED account still has its
  // identity attached, so it falls through to the "check your email" screen
  // and Supabase resends the confirmation, which is exactly right.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    redirect("/signup?error=exists");
  }

  // The profiles row is created by a database trigger on auth.users insert,
  // which runs synchronously within signUp() — safe to update it here. The
  // trigger only sets a provisional username derived from the email; this
  // writes the one the person actually chose, plus name and company.
  //
  // ONLY for a user this call actually created (2026-09-05 round-two audit):
  // in the unconfirmed-resend case, data.user is the EXISTING account, and
  // this block used to overwrite the victim's name, username, company and
  // consent timestamp with attacker-chosen values — and then hand the
  // attacker referral attribution over the victim's account. Two independent
  // signals gate it: the status lookup above, and the account's own
  // created_at (a resend returns the original creation time; the lookup can
  // fail open, the timestamp cannot lie about an old account).
  const createdJustNow =
    !!data.user?.created_at && Date.now() - new Date(data.user.created_at).getTime() < 60_000;
  if (data.user && !existingUnconfirmed && createdJustNow) {
    const admin = createAdminClient();
    const { error: profileError } = await admin
      .from("profiles")
      .update({
        terms_accepted_at: new Date().toISOString(),
        full_name: fullName,
        username,
        company: company || null,
      })
      .eq("id", data.user.id);

    // A unique-violation here means someone claimed the username between
    // the live check and now. Not worth failing an already-created account
    // over: keep the trigger's provisional username, still record name,
    // company and consent, and let them pick a new handle in Settings.
    if (profileError) {
      await admin
        .from("profiles")
        .update({
          terms_accepted_at: new Date().toISOString(),
          full_name: fullName,
          company: company || null,
        })
        .eq("id", data.user.id);
    }

    // Referral attribution (see app/r/[username]/route.ts, which sets the
    // cookie). Best-effort by design: a broken referral must never break a
    // signup, so every failure path here is silent. Self-referral can't
    // happen (the referrer's row predates this one), and referred_by is
    // written only when still NULL — first attribution wins.
    try {
      const refUsername = (await cookies()).get("picacho_ref")?.value?.trim().toLowerCase();
      if (refUsername && /^[a-z0-9_]{3,24}$/.test(refUsername) && refUsername !== username) {
        const { data: referrer } = await admin
          .from("profiles")
          .select("id")
          .eq("username", refUsername)
          .maybeSingle();
        if (referrer?.id && referrer.id !== data.user.id) {
          await admin
            .from("profiles")
            .update({ referred_by: referrer.id })
            .eq("id", data.user.id)
            .is("referred_by", null);
        }
      }
    } catch {
      // Attribution is a bonus, never a blocker.
    }

    // Buzz the admin console (best-effort, never throws). OAuth signups
    // don't pass through here — the PWA's live feed still sees their
    // profiles INSERT — but email/password is the main path and the only
    // one the native app offers.
    await notifyAdmins({
      title: "New signup",
      body: email,
      path: "#users",
    });
  }

  // Dedicated "check your email" screen rather than bouncing to /login with a
  // faint one-line message — the old behavior read as "the page just
  // reloaded" and nothing telling the user to go check their inbox.
  redirect("/signup?sent=1");
}

// Live username check for the signup form. Boolean only; the database
// function re-validates the format, so garbage input can't probe anything.
// The client debounce is a courtesy, not a limit — the real ceiling is the
// per-IP bucket below (a limited caller sees "taken", which blocks nothing:
// signup itself re-validates).
export async function checkUsernameAvailability(username: string): Promise<boolean> {
  if (typeof username !== "string" || !/^[a-z0-9_]{3,24}$/.test(username)) return false;
  if (await rateLimited(hashedRateKey(await callerIp(), "username-check"), "username-check", 60, 30)) {
    return false;
  }
  const supabase = await createClient();
  const { data } = await supabase.rpc("username_available", { p_username: username });
  return data === true;
}

export async function logout() {
  const supabase = await createClient();

  // Delete this user's push tokens BEFORE the session dies (2026-08-31
  // inspection: forgetPushToken existed for exactly this and nothing ever
  // called it — so on a shared or resold phone, the next person to sign in
  // kept receiving the previous account's "your render finished"
  // notifications). All of the user's tokens, not just this device's: the
  // server has no way to know which token belongs to the device logging
  // out, and NativePush re-registers on every app launch, so any OTHER
  // device the person still uses heals itself the next time it opens the
  // app. A missed notification on a second phone is a far smaller harm than
  // a stranger receiving them.
  const { data: userData } = await supabase.auth.getUser();
  if (userData.user) {
    try {
      await supabase.from("push_tokens").delete().eq("user_id", userData.user.id);
    } catch (err) {
      // Never block a sign-out on housekeeping.
      console.error("logout: push token cleanup failed", err);
    }
  }

  await supabase.auth.signOut();
  redirect("/login");
}
