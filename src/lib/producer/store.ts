import type { SupabaseClient } from "@supabase/supabase-js";
import { currentProducerSetup, isProducerSetup, type ProducerSetup } from "./prompt";
import type { StoredBlock } from "./history";
import type { Note, NotesStore } from "./notes";

// The Producer's rows, read and written with the SERVICE ROLE and always
// scoped by the user id the caller took from the session (producer.sql grants
// sessions SELECT on their own rows and nothing else).

// Aly (2026-09-26, operator: "We need to give the assistant a name" →
// "How about Aly?" → "Yes, Aly + the fixes"). Checked first: no image or
// video AI uses it; spoken, speech-to-text writes it "Aly" when the prompt
// names it (English 3/3; other languages 4 in 6, misses "Ali", "Alê") and
// "Allie" when it doesn't. People who named it themselves keep their name.
export const DEFAULT_PRODUCER_NAME = "Aly";

export type ThreadRow = { id: string; setup: ProducerSetup };

export type MessageRow = {
  seq: number;
  role: "user" | "assistant" | "system";
  content: StoredBlock[] | string;
  display: Record<string, unknown> | null;
  created_at: string;
};

/** The person's open conversation, opened (with today's setup) if there is none. */
export async function openThread(admin: SupabaseClient, userId: string): Promise<ThreadRow> {
  const existing = await admin
    .from("producer_threads")
    .select("id, setup")
    .eq("user_id", userId)
    .is("closed_at", null)
    .maybeSingle();
  if (existing.error) throw new Error(`producer: thread read failed — ${existing.error.message}`);
  if (existing.data) {
    if (isProducerSetup(existing.data.setup)) {
      return { id: existing.data.id as string, setup: existing.data.setup };
    }
    // Opened on an older setup (or none): its prefix can't take the new
    // rules or tools, so it is closed and a new one starts. Notes carry over.
    await admin
      .from("producer_threads")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", existing.data.id);
  }

  const setup = currentProducerSetup();
  const created = await admin
    .from("producer_threads")
    .insert({ user_id: userId, setup })
    .select("id")
    .single();
  if (created.data) return { id: created.data.id as string, setup };

  // Two tabs opening at once: the unique index let one insert through; read it.
  const again = await admin
    .from("producer_threads")
    .select("id, setup")
    .eq("user_id", userId)
    .is("closed_at", null)
    .maybeSingle();
  if (again.data) {
    return { id: again.data.id as string, setup: isProducerSetup(again.data.setup) ? again.data.setup : setup };
  }
  throw new Error(`producer: couldn't open a conversation — ${created.error?.message ?? "unknown"}`);
}

export async function loadMessages(admin: SupabaseClient, threadId: string): Promise<MessageRow[]> {
  const { data, error } = await admin
    .from("producer_messages")
    .select("seq, role, content, display, created_at")
    .eq("thread_id", threadId)
    .order("seq", { ascending: true })
    .limit(2000);
  if (error) throw new Error(`producer: messages read failed — ${error.message}`);
  return (data ?? []) as MessageRow[];
}

/**
 * Appends messages at seq, seq+1, … A clash on (thread_id, seq) means another
 * turn is writing to this conversation right now: the caller stops rather than
 * interleave two turns.
 */
export async function appendMessages(
  admin: SupabaseClient,
  a: {
    threadId: string;
    userId: string;
    fromSeq: number;
    messages: { role: "user" | "assistant" | "system"; content: unknown; display?: Record<string, unknown> | null }[];
  },
): Promise<{ ok: true; nextSeq: number } | { ok: false; busy: boolean; error: string }> {
  if (a.messages.length === 0) return { ok: true, nextSeq: a.fromSeq };
  const rows = a.messages.map((m, i) => ({
    thread_id: a.threadId,
    user_id: a.userId,
    seq: a.fromSeq + i,
    role: m.role,
    content: m.content,
    display: m.display ?? null,
  }));
  const { error } = await admin.from("producer_messages").insert(rows);
  if (error) return { ok: false, busy: error.code === "23505", error: error.message };
  await admin.from("producer_threads").update({ updated_at: new Date().toISOString() }).eq("id", a.threadId);
  return { ok: true, nextSeq: a.fromSeq + rows.length };
}

export async function closeThread(admin: SupabaseClient, userId: string): Promise<void> {
  await admin
    .from("producer_threads")
    .update({ closed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("closed_at", null);
}

// ---------------------------------------------------------------------------
// Notes

export function notesStore(admin: SupabaseClient, userId: string): NotesStore {
  return {
    async list(): Promise<Note[]> {
      const { data, error } = await admin
        .from("producer_notes")
        .select("path, content, updated_at")
        .eq("user_id", userId)
        .order("path", { ascending: true })
        .limit(200);
      if (error) throw new Error(`producer: notes read failed — ${error.message}`);
      return (data ?? []) as Note[];
    },
    async put(path: string, content: string): Promise<void> {
      const { error } = await admin
        .from("producer_notes")
        .upsert({ user_id: userId, path, content, updated_at: new Date().toISOString() }, { onConflict: "user_id,path" });
      if (error) throw new Error(`producer: note write failed — ${error.message}`);
    },
    async remove(path: string): Promise<void> {
      const { error } = await admin.from("producer_notes").delete().eq("user_id", userId).eq("path", path);
      if (error) throw new Error(`producer: note delete failed — ${error.message}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Preferences

export type ProducerPrefs = { name: string; watchSeenAt: string | null };

export async function loadPrefs(admin: SupabaseClient, userId: string): Promise<ProducerPrefs> {
  const { data } = await admin
    .from("producer_prefs")
    .select("display_name, watch_seen_at")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    name: (data?.display_name as string | null)?.trim() || DEFAULT_PRODUCER_NAME,
    watchSeenAt: (data?.watch_seen_at as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// The voice (2026-09-25)

export type ProducerVoice = { presetId: string; label: string; elevenLabsVoiceId: string };

/**
 * The ElevenLabs voice the person's Producer speaks with: their pick from
 * voice_presets (producer_prefs.voice_preset_id), else the first voice in
 * that admin-curated list. Null when the list is empty — the route then falls
 * back to the OpenAI voice. Reads the column on its own so a database without
 * producer-voice.sql still answers (with the first voice).
 */
export async function loadProducerVoice(admin: SupabaseClient, userId: string): Promise<ProducerVoice | null> {
  const [{ data: pref }, { data: presets }] = await Promise.all([
    admin.from("producer_prefs").select("voice_preset_id").eq("user_id", userId).maybeSingle(),
    admin.from("voice_presets").select("id, label, elevenlabs_voice_id").order("sort_order", { ascending: true }).limit(50),
  ]);
  const list = (presets ?? []).filter((p) => typeof p.elevenlabs_voice_id === "string" && p.elevenlabs_voice_id);
  if (list.length === 0) return null;
  const wanted = (pref as { voice_preset_id?: string | null } | null)?.voice_preset_id ?? null;
  const chosen = list.find((p) => p.id === wanted) ?? list[0];
  return { presetId: chosen.id as string, label: String(chosen.label ?? ""), elevenLabsVoiceId: chosen.elevenlabs_voice_id as string };
}

export async function savePrefs(
  admin: SupabaseClient,
  userId: string,
  patch: { display_name?: string | null; watch_seen_at?: string; voice_preset_id?: string | null; lamp_look?: string | null },
): Promise<{ error: string | null }> {
  const { error } = await admin
    .from("producer_prefs")
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return { error: error?.message ?? null };
}
