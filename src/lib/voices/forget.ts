import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteVoice } from "./elevenlabs";

// An account's generated and cloned voices live in Picacho's ElevenLabs
// account, not only in our database (2026-10-01, the voice sheet). The
// cascade that removes their voice_presets rows never reaches ElevenLabs, so
// on deletion each one is deleted there first, while the rows that name it
// still exist: a cloned voice is the person's own voice, and a left-over one
// would also keep a slot every other user needs. Library picks are someone
// else's voice and are only forgotten with the row. Best-effort and bounded:
// it never blocks the account's own deletion, and a failure is logged with
// the voice id so it can be deleted by hand.
export async function deleteUserVoices(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    const { data } = await admin
      .from("voice_presets")
      .select("elevenlabs_voice_id")
      .eq("owner_id", userId)
      .in("source", ["designed", "cloned"])
      .limit(50);
    for (const row of data ?? []) {
      const id = String((row as { elevenlabs_voice_id?: unknown }).elevenlabs_voice_id ?? "");
      try {
        await deleteVoice(id);
      } catch (err) {
        console.error(`account deletion: couldn't delete ElevenLabs voice ${id} — delete it by hand in ElevenLabs → My Voices`, err);
      }
    }
  } catch (err) {
    console.error("account deletion: couldn't read the account's own voices", err);
  }
}
