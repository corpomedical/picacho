"use server";

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { after } from "next/server";
import {
  isProducerEnabled,
  isProducerOpenToElite,
  producerAllowed,
  producerUnitCap,
  readProducerGrant,
  PRODUCER_UNAVAILABLE,
} from "./enabled";
import {
  closeThread,
  loadMessages,
  loadPrefs,
  loadProducerVoice,
  notesStore,
  openThread,
  savePrefs,
  DEFAULT_PRODUCER_NAME,
} from "./store";
import { isHumanVoiceConfigured, speakHuman } from "./speech";
import { isStreamableVoiceId, isVoiceStreamConfigured } from "./voice-stream";
import { LAMP_LOOKS, parseLampLook, type LampLook } from "@/components/producer/lamp-look";
import { WHEEL_STYLES, parseWheelStyle, type WheelStyle } from "@/components/producer/wheel-style";
import { rateLimited } from "@/lib/rate-limit";
import { MAX_NOTE_CHARS, normalizeNotePath, type Note } from "./notes";
import { loadWatchBar, loadWatchList, type WatchItem } from "./watch";
import type { PreparedSend } from "./tools";
import { monthlyWindowStart } from "@/lib/generations/core";

// The sheet's server actions (2026-09-24). Each one re-checks the same gate
// as the route: a hidden lamp is not an access control.

export type ProducerLine =
  | { seq: number; role: "user"; text: string; /** Typed during an answer: goes when it finishes. */ queued?: boolean }
  | { seq: number; role: "assistant"; text: string; cards: PreparedSend[] };

export type ProducerSnapshot = {
  name: string;
  lines: ProducerLine[];
  notes: Note[];
  watch: WatchItem[];
  watchBar: number;
  /** Assistant units used this period and the plan's cap (the wheel's light). */
  usage: { used: number; cap: number };
};

async function gate() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return { ok: false as const, error: "Sign in first." };
  if (!(await isProducerEnabled(supabase))) return { ok: false as const, error: PRODUCER_UNAVAILABLE };
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, plan_status, role, status, current_period_start")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin";
  const granted = !isAdmin && profile ? await readProducerGrant(admin, user.id) : false;
  const access = producerAllowed(
    profile ? { ...profile, producer_access: granted } : profile,
    isAdmin || granted || (await isProducerOpenToElite(supabase)),
  );
  if (access.error) return { ok: false as const, error: access.error };
  // The same allowance and window the route meters against.
  const cap = producerUnitCap(access, profile?.plan);
  const since = monthlyWindowStart(profile?.current_period_start as string | null).toISOString();
  return { ok: true as const, supabase, admin, userId: user.id, cap, since };
}

export async function loadProducer(): Promise<{ error: string } | { error: null; snapshot: ProducerSnapshot }> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  try {
    const [thread, prefs, notes, watchBar] = await Promise.all([
      openThread(g.admin, g.userId),
      loadPrefs(g.admin, g.userId),
      notesStore(g.admin, g.userId).list(),
      loadWatchBar(g.supabase),
    ]);
    const [rows, watch, usageRows] = await Promise.all([
      loadMessages(g.admin, thread.id),
      loadWatchList(g.supabase, g.userId, prefs.watchSeenAt, watchBar),
      g.admin.from("agent_usage").select("units").eq("user_id", g.userId).gte("created_at", g.since).limit(10000),
    ]);
    const used = (usageRows.data ?? []).reduce((a, r) => a + (Number(r.units) || 0), 0);
    const lines: ProducerLine[] = [];
    for (const r of rows) {
      const d = r.display as { text?: unknown; cards?: unknown; kind?: unknown } | null;
      if (!d || d.kind === "state" || d.kind === "set_undo") continue;
      const text = typeof d.text === "string" ? d.text : "";
      if (r.role === "user") lines.push({ seq: r.seq, role: "user", text });
      else if (r.role === "assistant") {
        lines.push({ seq: r.seq, role: "assistant", text, cards: Array.isArray(d.cards) ? (d.cards as PreparedSend[]) : [] });
      }
    }
    return {
      error: null,
      snapshot: { name: prefs.name, lines, notes, watch, watchBar, usage: { used, cap: g.cap } },
    };
  } catch (err) {
    console.error("producer: load failed —", err);
    return { error: "Your assistant couldn't load just now." };
  }
}

/** Closes the conversation; the next message opens a new one. Notes stay. */
export async function startFresh(): Promise<{ error: string | null }> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  await closeThread(g.admin, g.userId);
  return { error: null };
}

/** The dot on the lamp goes out once the person has seen the watch list. */
export async function markWatchSeen(): Promise<{ error: string | null }> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  return savePrefs(g.admin, g.userId, { watch_seen_at: new Date().toISOString() });
}

export async function saveProducerNote(path: string, content: string): Promise<{ error: string | null }> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  const p = normalizeNotePath(path);
  if (!p) return { error: "That note's name isn't allowed." };
  if (typeof content !== "string" || content.length > MAX_NOTE_CHARS) {
    return { error: `A note can hold at most ${MAX_NOTE_CHARS} characters.` };
  }
  try {
    await notesStore(g.admin, g.userId).put(p, content);
    return { error: null };
  } catch {
    return { error: "The note didn't save. Try again." };
  }
}

export async function deleteProducerNote(path: string): Promise<{ error: string | null }> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  const p = normalizeNotePath(path);
  if (!p) return { error: "That note's name isn't allowed." };
  try {
    await notesStore(g.admin, g.userId).remove(p);
    return { error: null };
  } catch {
    return { error: "The note didn't delete. Try again." };
  }
}

export async function clearProducerNotes(): Promise<{ error: string | null }> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  const { error } = await g.admin.from("producer_notes").delete().eq("user_id", g.userId);
  return { error: error ? "The notes didn't clear. Try again." : null };
}

/**
 * What the person calls it (operator, 2026-09-24: "User picks"). Empty or
 * the default (Aly) stores null, so the default can be renamed later in one
 * place — as it was on 2026-09-26, from Producer to Aly.
 */
export async function setProducerName(raw: string): Promise<{ error: string | null; name: string }> {
  const g = await gate();
  if (!g.ok) return { error: g.error, name: DEFAULT_PRODUCER_NAME };
  const name = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  const stored = !name || name === DEFAULT_PRODUCER_NAME ? null : name;
  const r = await savePrefs(g.admin, g.userId, { display_name: stored });
  return { error: r.error ? "The name didn't save. Try again." : null, name: stored ?? DEFAULT_PRODUCER_NAME };
}

/** For Settings: whether to show the name row at all, and the current name. */
export async function loadProducerName(): Promise<{ available: boolean; name: string }> {
  const g = await gate();
  if (!g.ok) return { available: false, name: DEFAULT_PRODUCER_NAME };
  const prefs = await loadPrefs(g.admin, g.userId);
  return { available: true, name: prefs.name };
}

// ---------------------------------------------------------------------------
// The voice (2026-09-25, operator: "lets change the voice character, its
// sounds ai"). The choices are the admin-picked voices in voice_presets —
// the same list characters speak from — so a new voice is added in
// Admin > Voices, not here.

export type ProducerVoiceChoice = { id: string; label: string; description: string | null };

/** For Settings: the voices to pick from and the one it speaks with now (null = no voices yet). */
export async function loadProducerVoices(): Promise<{ voices: ProducerVoiceChoice[]; current: string | null } | null> {
  const g = await gate();
  if (!g.ok) return null;
  const [{ data }, voice] = await Promise.all([
    g.admin.from("voice_presets").select("id, label, description").order("sort_order", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(50),
    loadProducerVoice(g.admin, g.userId).catch(() => null),
  ]);
  const voices = (data ?? []).map((v) => ({
    id: v.id as string,
    label: String(v.label ?? ""),
    description: (v.description as string | null) ?? null,
  }));
  return { voices, current: voice?.presetId ?? null };
}

async function voiceExists(admin: ReturnType<typeof createAdminClient>, id: string): Promise<{ elevenlabs_voice_id: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin.from("voice_presets").select("elevenlabs_voice_id").eq("id", id).maybeSingle();
  return (data as { elevenlabs_voice_id: string } | null) ?? null;
}

export async function setProducerVoice(presetId: string): Promise<{ error: string | null }> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  if (!(await voiceExists(g.admin, String(presetId ?? "")))) return { error: "That voice isn't available any more." };
  const r = await savePrefs(g.admin, g.userId, { voice_preset_id: presetId });
  if (r.error) console.error("producer: voice save failed", r.error);
  return { error: r.error ? "The voice didn't save. Try again." : null };
}

// A short line in the voice, exactly as the Producer would say it (same
// model and settings as speech.ts). ~70 characters = $0.0035 on fal; not
// metered, like the character voice previews, but rate-limited.
/**
 * Wakes her voice up before it's needed (2026-09-26). ElevenLabs loads a
 * voice on its first use after a while: that first answer took 5.6–10.6 s
 * to start speaking in the voice samples, the next ones 0.3–0.75 s. The
 * sheet calls this when it opens with read-aloud on, and when hands-free
 * starts; three characters in her voice (a fraction of a cent, unmetered),
 * at most once every two minutes per person. Never throws.
 */
export async function warmProducerVoice(): Promise<void> {
  try {
    const g = await gate();
    if (!g.ok || !isVoiceStreamConfigured()) return;
    const voice = await loadProducerVoice(g.admin, g.userId);
    if (!voice || !isStreamableVoiceId(voice.elevenLabsVoiceId)) return;
    if (await rateLimited(g.userId, "producer-voice-warm", 120, 1)) return;
    // After the action has answered: server actions run one at a time per
    // page, and a cold voice takes up to ~11 s — the sheet's other actions
    // (its conversation, notes, voice) mustn't wait behind it.
    const voiceId = voice.elevenLabsVoiceId;
    after(async () => {
      try {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`, {
          method: "POST",
          headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "", "content-type": "application/json" },
          body: JSON.stringify({ text: "Mm.", model_id: "eleven_flash_v2_5" }),
          signal: AbortSignal.timeout(15_000),
        });
        await res.arrayBuffer().catch(() => null);
      } catch {}
    });
  } catch {
    // A warm-up that fails costs only the slow first answer it was meant to spare.
  }
}

export async function previewProducerVoice(presetId: string): Promise<{ url?: string; error?: string }> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  if (!isHumanVoiceConfigured()) return { error: "Voices aren't set up on this server yet." };
  if (await rateLimited(g.userId, "producer-voice-preview", 60, 8)) {
    return { error: "You're trying voices a bit fast. Wait a moment and try again." };
  }
  const preset = await voiceExists(g.admin, String(presetId ?? ""));
  if (!preset) return { error: "That voice isn't available any more." };
  const { name } = await loadPrefs(g.admin, g.userId);
  try {
    const url = await speakHuman(`Hi, I'm ${name}. Tell me what we're making, and I'll set it up for you.`, preset.elevenlabs_voice_id, "");
    return { url };
  } catch {
    return { error: "That voice didn't play. Try again." };
  }
}

// ---------------------------------------------------------------------------
// The lamp's look (2026-09-25, operator: "I like Two fireflies. Lets try that
// and add Eclipse and The original perfected in the settings for the user to
// select from"). Saved on the account, so it follows the person to every
// device; lamp-look.ts lists the looks.

/** For Settings: the look the lamp shows now (null = this account has no Producer). */
export async function loadProducerLook(): Promise<LampLook | null> {
  const g = await gate();
  if (!g.ok) return null;
  // Missing column (producer-look.sql not run yet) → an error and no row → the default.
  const { data } = await g.admin.from("producer_prefs").select("lamp_look").eq("user_id", g.userId).maybeSingle();
  return parseLampLook((data as { lamp_look?: unknown } | null)?.lamp_look);
}

export async function setProducerLook(look: string): Promise<{ error: string | null }> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  if (!(LAMP_LOOKS as readonly string[]).includes(look)) return { error: "That look isn't available." };
  const r = await savePrefs(g.admin, g.userId, { lamp_look: look });
  if (r.error) console.error("producer: look save failed", r.error);
  return { error: r.error ? "The look didn't save. Try again." : null };
}

// Which wheel opens out of the lamp (2026-09-27, operator: "I like it, and
// add blossom. Let there be 2 options for the user to pick from").
// wheel-style.ts lists them.

/** For Settings: the wheel the lamp opens now (null = this account has no Producer). */
export async function loadProducerWheel(): Promise<WheelStyle | null> {
  const g = await gate();
  if (!g.ok) return null;
  // Missing column (producer-wheel.sql not run yet) → an error and no row → the default.
  const { data } = await g.admin.from("producer_prefs").select("wheel_style").eq("user_id", g.userId).maybeSingle();
  return parseWheelStyle((data as { wheel_style?: unknown } | null)?.wheel_style);
}

export async function setProducerWheel(style: string): Promise<{ error: string | null }> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  if (!(WHEEL_STYLES as readonly string[]).includes(style)) return { error: "That wheel isn't available." };
  const r = await savePrefs(g.admin, g.userId, { wheel_style: style });
  if (r.error) console.error("producer: wheel save failed", r.error);
  return { error: r.error ? "The wheel didn't save. Try again." : null };
}
