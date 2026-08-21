"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getOrigin } from "@/lib/origin";

export async function login(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/app");
}

export async function signup(formData: FormData) {
  const supabase = await createClient();

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
    redirect(`/signup?error=${encodeURIComponent("New signups are currently closed.")}`);
  }

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const agreed = formData.get("agree_to_terms") === "on";
  const fullName = ((formData.get("full_name") as string) ?? "").trim();
  const username = ((formData.get("username") as string) ?? "").trim().toLowerCase();
  const company = ((formData.get("company") as string) ?? "").trim();

  if (!fullName || fullName.length > 80) {
    redirect(`/signup?error=${encodeURIComponent("Please enter your name.")}`);
  }
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    redirect(
      `/signup?error=${encodeURIComponent(
        "Username must be 3-24 characters: lowercase letters, numbers, and underscores.",
      )}`,
    );
  }
  if (company.length > 120) {
    redirect(`/signup?error=${encodeURIComponent("Company name is too long.")}`);
  }

  // Required checkbox gates account creation — see the Content Policy's
  // strict rules on real-people likeness and its zero-tolerance policy for
  // anything involving minors. This isn't just a UI nicety: it's the
  // affirmative record that the person agreed before we ever let them
  // generate anything.
  if (!agreed) {
    redirect(
      `/signup?error=${encodeURIComponent(
        "You must agree to the Terms of Service, Privacy Policy, and Content Policy to create an account.",
      )}`,
    );
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
  try {
    const admin = createAdminClient();
    const { data: status } = await admin.rpc("auth_email_status", { p_email: email });
    if (status === "confirmed") {
      redirect(
        `/signup?error=${encodeURIComponent(
          "An account with this email already exists. Log in instead, or reset your password if you've forgotten it.",
        )}`,
      );
    }
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
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
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
    redirect(
      `/signup?error=${encodeURIComponent(
        "An account with this email already exists. Log in instead, or reset your password if you've forgotten it.",
      )}`,
    );
  }

  // The profiles row is created by a database trigger on auth.users insert,
  // which runs synchronously within signUp() — safe to update it here. The
  // trigger only sets a provisional username derived from the email; this
  // writes the one the person actually chose, plus name and company.
  if (data.user) {
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
  }

  // Dedicated "check your email" screen rather than bouncing to /login with a
  // faint one-line message — the old behavior read as "the page just
  // reloaded" and nothing telling the user to go check their inbox.
  redirect("/signup?sent=1");
}

// Live username check for the signup form. Boolean only, and rate-limited
// by the debounce client-side; the database function re-validates the
// format, so garbage input can't probe anything.
export async function checkUsernameAvailability(username: string): Promise<boolean> {
  if (typeof username !== "string" || !/^[a-z0-9_]{3,24}$/.test(username)) return false;
  const supabase = await createClient();
  const { data } = await supabase.rpc("username_available", { p_username: username });
  return data === true;
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
