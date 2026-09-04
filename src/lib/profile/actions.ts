"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { User } from "@supabase/supabase-js";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { cancelStripeCustomerBilling } from "@/lib/stripe/cancel-customer";
import { getOrigin } from "@/lib/origin";
import { rateLimited } from "@/lib/rate-limit";
// Moved out of this file 2026-09-04: a "use server" module may export only
// async functions, and exporting this array broke `next build`.
import { USER_STORAGE_BUCKETS } from "@/lib/profile/storage-buckets";


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

// Whether this account can be asked for its password. OAuth-only accounts
// (Google/Apple/etc., never set a password) have no "email" provider in
// app_metadata, and challenging them for a password they don't have would
// lock them out of the very settings that let them manage their account —
// so the sensitive-change re-authentication below is skipped for them.
// app_metadata is set server-side by Supabase Auth and not client-writable,
// so it's safe to trust here.
function hasPasswordIdentity(user: User): boolean {
  const meta = (user.app_metadata ?? {}) as { provider?: string; providers?: string[] };
  const providers = Array.isArray(meta.providers)
    ? meta.providers
    : meta.provider
      ? [meta.provider]
      : [];
  return providers.includes("email");
}

// Verification attempts are throttled: "That password isn't right" is a
// per-guess oracle, and unlike a login page (throttled by Supabase per
// caller IP) these calls all originate from this server's egress IP — so
// without our own per-user ceiling, a stolen-session holder could
// brute-force the current password through updatePassword/updateEmail.
// 5/min is far more than any human retyping a password, nothing for a script.
const PASSWORD_VERIFY_RATE_WINDOW_SECONDS = 60;
const PASSWORD_VERIFY_RATE_MAX_PER_WINDOW = 5;

// Verifies the caller's current password before an email/password change goes
// through — the standard guard against a hijacked session (an unattended
// laptop, a stolen cookie) being able to silently take over the account by
// swapping its login credentials. Returns null when verified, or the error
// message to show. Skipped entirely for OAuth-only accounts (see above).
//
// The check runs on a BARE supabase-js client, never the request's SSR
// client: signInWithPassword on the SSR client succeeds by minting a brand
// new session and writing fresh auth cookies — so a routine email change
// would silently rotate the caller's session (orphaning the old refresh
// token, and under single-session enforcement logging them out elsewhere).
// The bare client verifies the password and its session evaporates with it.
async function verifyCurrentPassword(user: User, formData: FormData): Promise<string | null> {
  if (!hasPasswordIdentity(user)) return null;
  const currentPassword = (formData.get("current_password") as string) ?? "";
  if (!currentPassword) return "Enter your current password to confirm this change.";

  // Fails closed, same reasoning as every other limiter added in this round:
  // better a retry message than an unthrottled password oracle. Own scope —
  // 5/min is the tightest budget in the app, and in the old shared bucket a
  // handful of unrelated uploads or voice calls would consume it and lock a
  // legitimate user out of their own settings.
  if (
    await rateLimited(
      user.id,
      "password-verify",
      PASSWORD_VERIFY_RATE_WINDOW_SECONDS,
      PASSWORD_VERIFY_RATE_MAX_PER_WINDOW,
    )
  ) {
    return "Too many attempts — wait a minute and try again.";
  }

  const bare = createBareClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await bare.auth.signInWithPassword({
    email: user.email ?? "",
    password: currentPassword,
  });
  if (error) return "That password isn't right — check it and try again.";
  return null;
}

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

  // Friendly pre-check only — the real guarantee is the unique index on
  // lower(username) (supabase/pending-2026-08-19/auth-admin.sql). Note the
  // escaping: ilike treats `_` as a single-character wildcard, and usernames
  // may legitimately contain underscores — unescaped, checking "a_c" matched
  // "abc"/"axc" too, reporting real usernames as taken (and, the reverse
  // trap, letting lookalikes slip past nothing, since the check erred toward
  // false positives). `%` and `\` can't appear in a valid username but are
  // escaped anyway so the pattern is inert by construction.
  const escaped = raw.replace(/[\\%_]/g, "\\$&");
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", escaped)
    .neq("id", data.user.id)
    .maybeSingle();

  if (existing) return { error: "That username is taken." };

  const { error } = await supabase.from("profiles").update({ username: raw }).eq("id", data.user.id);
  if (error) {
    // Two concurrent claims can both pass the pre-check above; the unique
    // index then rejects the loser with 23505. Same message as the
    // pre-check — from the user's point of view it's the same fact.
    if (error.code === "23505") return { error: "That username is taken." };
    return { error: error.message };
  }

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

// Settings toggle for marketing email ("Product news and offers",
// 2026-08-19) — the re-subscribe path the emailed unsubscribe link can't
// offer, plus a plain in-app opt-out for anyone who'd rather not dig out an
// old email. Client-invoked from MarketingEmailsToggle, so it returns a
// result instead of calling redirect().
//
// The write goes through the SERVICE-ROLE client on purpose:
// profiles.marketing_opt_out is deliberately absent from the authenticated
// UPDATE column grant (see the section-3 posture comment in
// supabase/pending-2026-08-19/email.sql and the 2026-08-18 lockdown at the
// bottom of schema.sql), and widening that grant for one toggle would
// reopen the column to every authenticated PostgREST caller. So: identity
// comes from the verified session, then the service role writes that one
// column scoped to that one id — the same house pattern as the free-counter
// update in characters/actions.ts.
//
// Takes the DESIRED state ("on" / "off"), never a blind invert: a retried
// request or a second tab must converge on what the person last chose, not
// flip-flop them back onto a list they left.
export async function setMarketingEmails(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const desired = formData.get("enabled");
  if (desired !== "on" && desired !== "off") {
    return { error: "Invalid setting." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    // enabled=on means marketing email WANTED, i.e. opt-out false.
    .update({ marketing_opt_out: desired === "off" })
    .eq("id", data.user.id);

  if (error) return { error: error.message };

  revalidatePath("/app/settings");
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
//
// Changing the login email is an account takeover primitive, so it gets the
// full treatment: the caller must prove they know the current password
// (verifyCurrentPassword — a stolen session cookie alone isn't enough), and
// the confirmation link is pinned to the host the person is actually using
// via emailRedirectTo, same as signup (auth/actions.ts) — without it the
// link lands on whatever the Supabase dashboard Site URL points at, which
// may be the wrong domain for this session's cookies.
//
// OPERATOR: verify "Secure email change" (double opt-in — confirmation
// links sent to BOTH the old and the new address) is enabled in the
// Supabase dashboard (Authentication → Email). Without it a single click on
// the new address rehomes the account and the old owner is never told.
export async function updateEmail(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const email = ((formData.get("email") as string) || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };

  const reauthError = await verifyCurrentPassword(data.user, formData);
  if (reauthError) return { error: reauthError };

  // /auth/confirm verifies the token and lands the person back in Settings
  // signed in, rather than on the marketing homepage logged out.
  const origin = await getOrigin();
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${origin}/auth/confirm?next=/app/settings` },
  );
  if (error) return { error: error.message };

  return { error: null };
}

// Settings entry point (components/settings/password-form.tsx): requires the
// current password, because a change here is made from a long-lived session
// and "I hold the cookie" is not "I am the owner". The recovery flow — where
// not knowing the password is the entire premise — uses
// updatePasswordFromRecovery below instead.
export async function updatePassword(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const password = (formData.get("password") as string) ?? "";
  const confirmPassword = (formData.get("confirm_password") as string) ?? "";

  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirmPassword) return { error: "Passwords don't match." };

  // OAuth-only accounts (no password yet) skip this and simply set their
  // first password — see hasPasswordIdentity.
  const reauthError = await verifyCurrentPassword(data.user, formData);
  if (reauthError) return { error: reauthError };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  return { error: null };
}

// Recovery entry point (components/reset-password-form.tsx): the session was
// just minted by the emailed reset link (/auth/callback exchanged the code),
// so proving control of the inbox already happened and there is no current
// password to ask for. Kept as a separate action rather than a flag on
// updatePassword so the no-reauth path can't be reached by simply omitting a
// field on the Settings form.
export async function updatePasswordFromRecovery(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const password = (formData.get("password") as string) ?? "";
  const confirmPassword = (formData.get("confirm_password") as string) ?? "";

  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirmPassword) return { error: "Passwords don't match." };

  // Best-effort check that this session actually came from an email link
  // rather than a plain password login calling this endpoint to dodge the
  // current-password requirement above. The access token's amr claim lists
  // how the session was authenticated; a recovery/OTP/magic-link session
  // carries one of those methods, a plain login carries only "password".
  // Deliberately fails OPEN when the claim is missing or unreadable —
  // Supabase's amr vocabulary isn't a contract we control, and blocking a
  // legitimate reset outright is worse than falling back to the pre-existing
  // behaviour for an edge case. The token comes from our own httpOnly cookie
  // and getUser() above already validated the session, so decoding without
  // re-verifying the signature is fine here.
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (token) {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
      ) as { amr?: { method?: string }[] };
      if (Array.isArray(payload.amr) && payload.amr.length > 0) {
        const methods = payload.amr.map((m) => m?.method).filter(Boolean);
        const cameFromEmailLink = methods.some((m) =>
          ["otp", "recovery", "magiclink", "email/signup", "email_change"].includes(m as string),
        );
        const passwordOnly = methods.every((m) => m === "password" || m === "token_refresh");
        if (!cameFromEmailLink && passwordOnly) {
          return {
            error:
              "This reset link session has expired — use the link from your reset email again, or change your password from Settings.",
          };
        }
      }
    }
  } catch {
    // Unreadable token — fail open, see above.
  }

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

  // Cancel Stripe billing FIRST, while the profile row still holds the ids —
  // the auth deletion below cascades profiles away, taking the only record of
  // which subscription/customer to stop with it. Skipping this left people
  // who deleted their account still being charged every month for a service
  // they could no longer even log into. Deliberately NOT best-effort like the
  // storage purge: if Stripe errors, abort loudly and keep the account,
  // because "account gone, subscription still billing" is strictly worse than
  // asking them to try again. (redirect() throws, so the error is carried out
  // of the try/catch rather than redirecting inside it.)
  const { data: billingProfile } = await admin
    .from("profiles")
    .select("stripe_customer_id, stripe_subscription_id, plan_source, plan_status")
    .eq("id", userId)
    .single();

  // The Play-billed twin of the fail-loud rule below (2026-08-31 inspection).
  // A Google Play subscription lives at Google: we cannot cancel it from
  // here, and deleting the account anyway recreates the exact failure this
  // block exists to prevent — "account gone, subscription still billing",
  // with the renewal webhooks landing on a profile that no longer exists so
  // nobody would ever notice. Google cancels a subscription when the person
  // does it in the Play Store; the account can be deleted the moment that
  // has happened.
  if (
    billingProfile?.plan_source === "play" &&
    (billingProfile.plan_status === "active" || billingProfile.plan_status === "past_due")
  ) {
    redirect(
      `/app/settings?error=${encodeURIComponent(
        "Your subscription is billed through Google Play, and we can't cancel it from here. Cancel it in the Play Store first (Play Store → Payments & subscriptions), then delete your account.",
      )}`,
    );
  }

  let stripeCancelError = false;
  try {
    await cancelStripeCustomerBilling({
      stripeCustomerId: billingProfile?.stripe_customer_id ?? null,
      stripeSubscriptionId: billingProfile?.stripe_subscription_id ?? null,
    });
  } catch (err) {
    console.error("deleteAccount: Stripe cancellation failed — aborting deletion", err);
    stripeCancelError = true;
  }
  if (stripeCancelError) {
    redirect(
      `/app/settings?error=${encodeURIComponent(
        "We couldn't cancel your subscription just now, so your account was NOT deleted — try again in a minute, or contact support and we'll sort it out.",
      )}`,
    );
  }

  await removeAllUserFiles(admin, userId);

  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) {
    redirect(`/app/settings?error=${encodeURIComponent(`Couldn't delete your account: ${error.message}`)}`);
  }

  await supabase.auth.signOut();
  redirect("/");
}
