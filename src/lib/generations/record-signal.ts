import { createAdminClient } from "@/lib/supabase/server";
import type { SignalKind } from "@/lib/generations/signals";

// Writes one revealed-preference signal. Never throws, never blocks.
//
// The vocabulary and its meaning live in signals.ts, which is alias-free and
// tested; this file is only the write.
//
// FAIL-SOFT IS THE WHOLE CONTRACT. These rows are research data. A person
// deleting a render or publishing one must never see an error, or wait, or
// have their action fail, because a table we added for our own analysis was
// missing or slow. Losing a signal costs one row of insight; letting one
// break a delete costs the user's work.
//
// That also makes the migration ordering safe in the direction that matters:
// if this ships before generation-signals.sql is run, every call is a no-op
// with a warning in the log, and nothing a user does changes.
export async function recordSignal(
  generationId: string,
  userId: string,
  kind: SignalKind,
): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("generation_signals")
      .insert({ generation_id: generationId, user_id: userId, kind });
    // 23505 is the unique index doing its job: a person who downloads the same
    // render four times has told us one thing, not four. Not worth a log line.
    if (error && error.code !== "23505") {
      console.warn("Couldn't record a generation signal (research data only).", {
        kind,
        message: error.message,
      });
    }
  } catch (err) {
    console.warn("Couldn't record a generation signal (research data only).", { kind, err });
  }
}
