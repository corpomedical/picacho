"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Every file a user ever uploaded or generated lives under a `${userId}/...`
// path in each of these buckets. Deleting the account previously only
// removed the database rows (which cascade automatically) — the actual files
// were never touched, so they sat in Storage, permanently orphaned and
// permanently billed, with no record left anywhere to ever find them again.
const USER_STORAGE_BUCKETS = ["character-references", "generated-images", "chat-attachments"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function removeAllUserFiles(admin: any, userId: string) {
  // Storage list() returns at most `limit` names per call, so a single
  // list({ limit: 1000 }) silently stops at 1000 — an account with more than
  // that many generated images (easily reached over time) would leave every
  // file past the first page permanently orphaned and billed, and, being a
  // deletion, unrecoverable.
  //
  // Collect every path FIRST by paging with an advancing offset, then remove.
  // Removing as we page would be wrong: deleting a page shifts every later
  // object forward in the listing, so the next offset window would skip a
  // page's worth of files. Reading the whole list against the unchanged bucket
  // and deleting afterwards avoids that.
  const PAGE = 1000;
  for (const bucket of USER_STORAGE_BUCKETS) {
    try {
      const paths: string[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data: files } = await admin.storage
          .from(bucket)
          .list(userId, { limit: PAGE, offset });
        if (!files || files.length === 0) break;
        for (const f of files as { name: string }[]) paths.push(`${userId}/${f.name}`);
        if (files.length < PAGE) break;
      }
      // remove() also caps the number of keys it accepts per call, so delete
      // in batches rather than handing it the whole list at once.
      for (let i = 0; i < paths.length; i += PAGE) {
        await admin.storage.from(bucket).remove(paths.slice(i, i + PAGE));
      }
    } catch {
      // Best-effort — a storage hiccup here shouldn't block account deletion
      // itself. Worst case, a follow-up cleanup pass can catch anything missed.
    }
  }
}

type ActionResult = { error: string | null };

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

// Invoked directly from the sidebar's inline editor (a Client Component),
// not a native <form> action — same reasoning as the character/project
// actions: it returns a result instead of calling redirect().
export async function updateUsername(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const raw = (formData.get("username") as string)?.trim().toLowerCase() ?? "";

  if (!USERNAME_PATTERN.test(raw)) {
    return {
      error: "Usernames are 3-24 characters — lowercase letters, numbers, and underscores only.",
    };
  }

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", raw)
    .neq("id", data.user.id)
    .maybeSingle();

  if (existing) return { error: "That username is taken." };

  const { error } = await supabase.from("profiles").update({ username: raw }).eq("id", data.user.id);
  if (error) return { error: error.message };

  revalidatePath("/app", "layout");
  return { error: null };
}

// Client-invoked from the sidebar's quick settings menu AND the fuller
// Settings page (same action, two entry points) — a plain toggle, so it
// returns a result rather than calling redirect() like updateUsername above.
// Per-user, not a global admin flag: each account controls whether ITS OWN
// generations skip the paid Claude draft + OpenAI review steps (see
// runRealPipeline's skipRefinement option in pipeline.ts).
export async function setSkipAiRefinement(enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const { error } = await supabase
    .from("profiles")
    .update({ skip_ai_refinement: enabled })
    .eq("id", data.user.id);

  if (error) return { error: error.message };

  revalidatePath("/app", "layout");
  return { error: null };
}

// Flips profiles.has_completed_onboarding — called once the first-login
// walkthrough (OnboardingTour, see generate-form.tsx) finishes OR is
// skipped, either way the tour shouldn't auto-show again. "Replay
// walkthrough" in the sidebar settings menu brings it back on demand without
// touching this flag (it navigates with ?tour=1 instead).
export async function setHasCompletedOnboarding(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const { error } = await supabase
    .from("profiles")
    .update({ has_completed_onboarding: true })
    .eq("id", data.user.id);

  if (error) return { error: error.message };

  return { error: null };
}

// Company and gender are both optional, self-reported fields — nothing here
// is inferred or looked up. A native <form> action, so it uses redirect()
// rather than returning a result.
export async function updateProfileDetails(formData: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const company = ((formData.get("company") as string) || "").trim().slice(0, 120) || null;
  const genderChoice = (formData.get("gender") as string) || "";
  const genderOther = ((formData.get("gender_other") as string) || "").trim().slice(0, 60);
  const gender = genderChoice === "self-describe" ? genderOther || null : genderChoice || null;

  const { error } = await supabase
    .from("profiles")
    .update({ company, gender })
    .eq("id", data.user.id);

  if (error) {
    redirect(`/app/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/app/settings");
  redirect("/app/settings?saved=1");
}

// Client-invoked (shows an inline success/error message without navigating
// away), so it returns a result instead of calling redirect().
export async function updateEmail(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const email = ((formData.get("email") as string) || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };

  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { error: error.message };

  return { error: null };
}

export async function updatePassword(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const password = (formData.get("password") as string) ?? "";
  const confirmPassword = (formData.get("confirm_password") as string) ?? "";

  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirmPassword) return { error: "Passwords don't match." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  return { error: null };
}

// Native <form> action (the confirmation gate lives client-side in
// DeleteAccountForm, which only lets the form submit once the person has
// typed their username to confirm) — so redirect() is safe to use here.
// Deletes the auth.users row via the service-role client, which every other
// table's user_id foreign key cascades from (character_profiles, projects,
// generations, notes) or sets to null for (page_views, to keep anonymized
// traffic history intact).
export async function deleteAccount() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const userId = data.user.id;
  const admin = createAdminClient();

  await removeAllUserFiles(admin, userId);

  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) {
    redirect(`/app/settings?error=${encodeURIComponent(`Couldn't delete your account: ${error.message}`)}`);
  }

  await supabase.auth.signOut();
  redirect("/");
}
