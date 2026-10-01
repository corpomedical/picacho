import type { SupabaseClient } from "@supabase/supabase-js";
import { speechEngineForHistory, type SpeechEngine } from "./voice-lock";

// Which ElevenLabs engine a character speaks on (voice-lock.ts, 2026-10-01,
// operator: "Keep old characters on v3"). Read from the character's own
// takes, through the caller's client, so it only ever sees rows the caller
// may see.
//
// Two facts decide it:
//   1. the first take recorded as spoken in our voice (voice_source =
//      'character', recorded since 2026-09-23) — its voice_settings say
//      which engine it ran on;
//   2. failing that, any finished take whose log carries the lip-sync step,
//      which is how a take spoken before 2026-09-23 can be recognised.
//
// A lookup that fails gives v3: the character may have spoken before, and a
// voice that changes between two of a person's takes is the one thing this
// lock must never do. The cost of the opposite mistake is one character
// starting on the older engine.
export const SYNCED_STEP_DETAIL = "Synced the character's mouth to the dialogue via Sync Labs.";

export async function speechEngineForCharacter(
  // Any client: the user's own (RLS keeps it to their rows) or the service role's.
  supabase: SupabaseClient,
  characterId: string,
): Promise<SpeechEngine> {
  try {
    const { data: recorded, error: recordedErr } = await supabase
      .from("generations")
      .select("voice_settings")
      .eq("character_profile_id", characterId)
      .eq("voice_source", "character")
      .order("created_at", { ascending: true })
      .limit(1);
    if (recordedErr) throw recordedErr;
    const first = (recorded?.[0] as { voice_settings?: { endpoint?: unknown } | null } | undefined) ?? null;
    if (first) return speechEngineForHistory({ firstRecorded: first, spokeBeforeRecords: false });

    const { data: legacy, error: legacyErr } = await supabase
      .from("generations")
      .select("id")
      .eq("character_profile_id", characterId)
      .eq("status", "succeeded")
      .contains("pipeline_log", [{ steps: [{ step: "lipsync", detail: SYNCED_STEP_DETAIL }] }])
      .limit(1);
    if (legacyErr) throw legacyErr;
    return speechEngineForHistory({ firstRecorded: null, spokeBeforeRecords: (legacy?.length ?? 0) > 0 });
  } catch (err) {
    console.error(`speech engine lookup failed for character ${characterId}; speaking v3:`, err);
    return "v3";
  }
}
