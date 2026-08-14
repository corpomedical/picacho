"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
  // which runs synchronously within signUp() — safe to update it here.
  if (data.user) {
    await supabase
      .from("profiles")
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq("id", data.user.id);
  }

  // Dedicated "check your email" screen rather than bouncing to /login with a
  // faint one-line message — the old behavior read as "the page just
  // reloaded" and nothing telling the user to go check their inbox.
  redirect("/signup?sent=1");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
