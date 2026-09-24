"use server";

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isProducerEnabled, isProducerOpenToElite, producerAllowed, PRODUCER_UNAVAILABLE } from "./enabled";
import { closeThread, loadMessages, loadPrefs, notesStore, openThread, savePrefs, DEFAULT_PRODUCER_NAME } from "./store";
import { MAX_NOTE_CHARS, normalizeNotePath, type Note } from "./notes";
import { loadWatchBar, loadWatchList, type WatchItem } from "./watch";
import type { PreparedSend } from "./tools";

// The sheet's server actions (2026-09-24). Each one re-checks the same gate
// as the route: a hidden lamp is not an access control.

export type ProducerLine =
  | { seq: number; role: "user"; text: string }
  | { seq: number; role: "assistant"; text: string; cards: PreparedSend[] };

export type ProducerSnapshot = {
  name: string;
  lines: ProducerLine[];
  notes: Note[];
  watch: WatchItem[];
  watchBar: number;
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
    .select("plan, plan_status, role, status")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin";
  const access = producerAllowed(profile, isAdmin || (await isProducerOpenToElite(supabase)));
  if (access.error) return { ok: false as const, error: access.error };
  return { ok: true as const, supabase, admin, userId: user.id };
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
    const [rows, watch] = await Promise.all([
      loadMessages(g.admin, thread.id),
      loadWatchList(g.supabase, g.userId, prefs.watchSeenAt, watchBar),
    ]);
    const lines: ProducerLine[] = [];
    for (const r of rows) {
      const d = r.display as { text?: unknown; cards?: unknown; kind?: unknown } | null;
      if (!d || d.kind === "state") continue;
      const text = typeof d.text === "string" ? d.text : "";
      if (r.role === "user") lines.push({ seq: r.seq, role: "user", text });
      else if (r.role === "assistant") {
        lines.push({ seq: r.seq, role: "assistant", text, cards: Array.isArray(d.cards) ? (d.cards as PreparedSend[]) : [] });
      }
    }
    return { error: null, snapshot: { name: prefs.name, lines, notes, watch, watchBar } };
  } catch (err) {
    console.error("producer: load failed —", err);
    return { error: "The Producer couldn't load just now." };
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
 * "Producer" stores null, so the default can be renamed later in one place.
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
