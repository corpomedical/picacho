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

export async function submitFeedback(message: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const trimmed = message.trim();
  if (!trimmed) return { error: "Write a message first." };
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { error: `Keep feedback under ${MAX_MESSAGE_LENGTH} characters.` };
  }

  const { error } = await supabase.from("feedback").insert({
    user_id: userData.user.id,
    message: trimmed,
  });

  if (error) {
    console.error("submitFeedback failed:", error.message);
    return { error: "Couldn't send that — try again." };
  }

  return { error: null };
}
