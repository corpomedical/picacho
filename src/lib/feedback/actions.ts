"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";

// Stamps profiles.rating_prompted_at and drops the cached layout that decides
// whether to show the star prompt.
//
// The revalidate is the important half. RatePrompt is rendered from
// src/app/app/layout.tsx, and Next does NOT re-render a layout when you
// navigate between its children — so without this, the card kept rendering
// from an RSC payload computed before the rating was given. Real incident,
// 2026-08-10: rated once at 16:59, asked twice more afterwards, and only
// stopped after being dismissed outright at 19:20. Being re-asked after
// answering is worse than never being asked.
//
// The write is verified rather than fire-and-forget: if it silently fails,
// the prompt returns forever, and a silent failure here is indistinguishable
// from the bug above.
async function closeRatingPrompt(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ rating_prompted_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) {
    console.error("closeRatingPrompt failed:", error.message);
    return false;
  }

  revalidatePath("/app", "layout");
  return true;
}

// General "give us your feedback" — reachable from the small link next to
// the AI disclaimer under the composer. Deliberately separate from
// generation_reports (src/lib/generations/reports.ts): a report is "this
// specific result is wrong," always readable next to the generation it's
// about; this is open-ended product feedback with no result attached, and
// gets reviewed in its own /admin/feedback queue instead of mixed into the
// reports one.

const MAX_MESSAGE_LENGTH = 2000;

// Cheap per-user rate cap — same atomic advisory-lock limiter the voice
// preview uses (rateLimited in lib/rate-limit.ts, service-role only), under
// its own 'feedback' scope so uploads or API traffic in the same minute
// can't eat this budget. Feedback is free to serve, but the table lands in
// the /admin/feedback review queue, so an unthrottled loop is a
// queue-flooding vector. Ten a minute is far more than any sincere human
// files.
const FEEDBACK_RATE_WINDOW_SECONDS = 60;
const FEEDBACK_RATE_MAX_PER_WINDOW = 10;

// rating is optional so this one action serves both the written feedback
// form and the star prompt. A rating with no message is valid — most people
// who bother to rate won't write anything, and refusing those would throw
// away the majority of the signal.
export async function submitFeedback(
  message: string,
  rating?: number,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const trimmed = message.trim();
  // Number.isInteger: the star prompt only ever sends 1–5, so a fractional
  // rating (4.5 from a crafted POST — a server action is a public endpoint)
  // is treated as no rating at all rather than stored to skew the average.
  const hasRating =
    typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5;

  if (!trimmed && !hasRating) return { error: "Write a message first." };
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { error: `Keep feedback under ${MAX_MESSAGE_LENGTH} characters.` };
  }

  // Fails closed on a limiter error, same as previewVoice — a retry beats an
  // unbounded queue-flooding loop when the limiter itself is unavailable.
  if (
    await rateLimited(
      userData.user.id,
      "feedback",
      FEEDBACK_RATE_WINDOW_SECONDS,
      FEEDBACK_RATE_MAX_PER_WINDOW,
    )
  ) {
    return { error: "You're sending feedback a bit fast — wait a moment and try again." };
  }

  const { error } = await supabase.from("feedback").insert({
    user_id: userData.user.id,
    message: trimmed,
    rating: hasRating ? rating : null,
  });

  // Checked BEFORE closing the star prompt: closing used to run first, so a
  // failed insert still stamped rating_prompted_at — the rating was lost AND
  // the prompt never came back to ask again. Now a failed insert leaves the
  // prompt open so the person can retry.
  if (error) {
    console.error("submitFeedback failed:", error.message);
    return { error: "Couldn't send that — try again." };
  }

  // Answering the star prompt also closes it, so it isn't shown again.
  if (hasRating) {
    await closeRatingPrompt(userData.user.id);
  }

  return { error: null };
}

// "Not now" on the rating prompt. Recorded the same way as an answer, so a
// dismissal is respected rather than re-asked on the next page load — being
// nagged after saying no is worse than never being asked.
export async function dismissRatingPrompt(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  await closeRatingPrompt(userData.user.id);

  return { error: null };
}
