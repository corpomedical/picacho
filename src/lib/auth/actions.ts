"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // The profiles row is created by a database trigger on auth.users insert,
  // which runs synchronously within signUp() — safe to update it here.
  if (data.user) {
    await supabase
      .from("profiles")
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq("id", data.user.id);
  }

  redirect("/login?message=" + encodeURIComponent("Check your email to confirm your account"));
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
