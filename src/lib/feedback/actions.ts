"use server";

import { createClient } from "@/lib/supabase/server";

// General "give us your feedback" — reachable from the small link next to
// the AI disclaimer under the composer. Deliberately separate from
// generation_reports (src/lib/generations/reports.ts): a report is "this
// specific result is wrong," always readable next to the generation it's
// about; this is open-ended product feedback with no result attached, and
// gets reviewed in its own /admin/feedback queue instead of mixed into the
// reports one.

const MAX_MESSAGE_LENGTH = 2000;

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
  const hasRating = typeof rating === "number" && rating >= 1 && rating <= 5;

  if (!trimmed && !hasRating) return { error: "Write a message first." };
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { error: `Keep feedback under ${MAX_MESSAGE_LENGTH} characters.` };
  }

  const { error } = await supabase.from("feedback").insert({
    user_id: userData.user.id,
    message: trimmed,
    rating: hasRating ? rating : null,
  });

  // Answering the star prompt also closes it, so it isn't shown again.
  if (hasRating) {
    await supabase
      .from("profiles")
      .update({ rating_prompted_at: new Date().toISOString() })
      .eq("id", userData.user.id);
  }

  if (error) {
    console.error("submitFeedback failed:", error.message);
    return { error: "Couldn't send that — try again." };
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

  await supabase
    .from("profiles")
    .update({ rating_prompted_at: new Date().toISOString() })
    .eq("id", userData.user.id);

  return { error: null };
}
