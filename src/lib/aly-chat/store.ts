import type { SupabaseClient } from "@supabase/supabase-js";
import type { Doc, DocsStore } from "./docs";
import { parseRow, type LoadedFile, type StoredRow, type FileRef } from "./history";
import { isChatSetup, type ChatSetup, type ProjectSnapshot } from "./prompt";
import { kindOf } from "./file-types";

// Aly's chat rows (2026-09-29), read and written with the SERVICE ROLE and
// always scoped by the user id the caller took from the session: the tables
// grant a session SELECT on its own rows and nothing else (aly-chat.sql).

export const FILES_BUCKET = "aly-files";

export type ChatRow = {
  id: string;
  title: string | null;
  projectId: string | null;
  setup: ChatSetup | null;
  updatedAt: string;
};

export type ChatListItem = { id: string; title: string | null; projectId: string | null; updatedAt: string };

export async function listChats(
  db: SupabaseClient,
  userId: string,
  opts: { limit?: number; projectId?: string | null; query?: string | null } = {},
): Promise<ChatListItem[]> {
  let q = db
    .from("aly_chats")
    .select("id, title, project_id, updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.projectId) q = q.eq("project_id", opts.projectId);
  if (opts.query) q = q.ilike("title", `%${opts.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    title: (r.title as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    updatedAt: r.updated_at as string,
  }));
}

export async function getChat(db: SupabaseClient, userId: string, chatId: string): Promise<ChatRow | null> {
  const { data } = await db
    .from("aly_chats")
    .select("id, title, project_id, setup, updated_at")
    .eq("id", chatId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    title: (data.title as string | null) ?? null,
    projectId: (data.project_id as string | null) ?? null,
    setup: isChatSetup(data.setup) ? data.setup : null,
    updatedAt: data.updated_at as string,
  };
}

export async function createChat(
  admin: SupabaseClient,
  a: { userId: string; setup: ChatSetup; projectId: string | null },
): Promise<string> {
  const { data, error } = await admin
    .from("aly_chats")
    .insert({ user_id: a.userId, setup: a.setup, project_id: a.projectId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`aly-chat: couldn't start a chat — ${error?.message ?? "no row"}`);
  return data.id as string;
}

export async function loadRows(db: SupabaseClient, chatId: string): Promise<StoredRow[]> {
  const { data, error } = await db
    .from("aly_chat_messages")
    .select("seq, role, brain, content, created_at")
    .eq("chat_id", chatId)
    .order("seq", { ascending: true })
    .limit(1000);
  if (error) throw new Error(`aly-chat: messages read failed — ${error.message}`);
  return (data ?? []).map((r) => parseRow(r as never)).filter((r): r is StoredRow => r !== null);
}

/**
 * Appends one message at `seq`. A clash on (chat_id, seq) means another turn
 * is writing to this chat right now: the caller stops rather than interleave.
 */
export async function appendRow(
  admin: SupabaseClient,
  a: { chatId: string; userId: string; seq: number; role: "user" | "assistant"; brain: string | null; content: unknown },
): Promise<{ ok: true } | { ok: false; busy: boolean; error: string }> {
  const { error } = await admin.from("aly_chat_messages").insert({
    chat_id: a.chatId,
    user_id: a.userId,
    seq: a.seq,
    role: a.role,
    brain: a.brain,
    content: a.content,
  });
  if (error) return { ok: false, busy: error.code === "23505", error: error.message };
  await admin.from("aly_chats").update({ updated_at: new Date().toISOString() }).eq("id", a.chatId);
  return { ok: true };
}

export async function setTitle(admin: SupabaseClient, userId: string, chatId: string, title: string): Promise<void> {
  await admin.from("aly_chats").update({ title: title.slice(0, 120) }).eq("id", chatId).eq("user_id", userId);
}

// ---------------------------------------------------------------------------
// Files

export async function fileRefs(admin: SupabaseClient, userId: string, ids: string[]): Promise<FileRef[]> {
  if (ids.length === 0) return [];
  const { data } = await admin
    .from("aly_chat_files")
    .select("id, name, mime, ready")
    .eq("user_id", userId)
    .in("id", ids);
  const byId = new Map((data ?? []).filter((r) => r.ready).map((r) => [r.id as string, r]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((r) => ({ id: r!.id as string, name: r!.name as string, mime: r!.mime as string, kind: kindOf(r!.mime as string)! }))
    .filter((f) => f.kind);
}

/** The bytes (PDFs, pictures) or words (everything else) of each file, for one turn. */
export async function loadFiles(admin: SupabaseClient, userId: string, refs: FileRef[]): Promise<Map<string, LoadedFile>> {
  const out = new Map<string, LoadedFile>();
  if (refs.length === 0) return out;
  const { data } = await admin
    .from("aly_chat_files")
    .select("id, storage_path, text_content")
    .eq("user_id", userId)
    .in("id", refs.map((r) => r.id));
  const rows = new Map((data ?? []).map((r) => [r.id as string, r]));
  await Promise.all(
    refs.map(async (ref) => {
      const row = rows.get(ref.id);
      if (!row) return;
      if (ref.kind === "pdf" || ref.kind === "image") {
        const { data: blob } = await admin.storage.from(FILES_BUCKET).download(row.storage_path as string);
        if (!blob) return;
        out.set(ref.id, { ref, base64: Buffer.from(await blob.arrayBuffer()).toString("base64") });
      } else {
        out.set(ref.id, { ref, text: (row.text_content as string | null) ?? "" });
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Documents

export function docsStore(admin: SupabaseClient, userId: string, chatId: string): DocsStore {
  const toDoc = (r: Record<string, unknown>): Doc => ({
    id: r.id as string,
    title: r.title as string,
    kind: r.kind === "code" ? "code" : "document",
    language: (r.language as string | null) ?? null,
    content: r.content as string,
    version: Number(r.version) || 1,
  });
  return {
    async count() {
      const { count } = await admin
        .from("aly_chat_docs")
        .select("id", { count: "exact", head: true })
        .eq("chat_id", chatId)
        .eq("user_id", userId);
      return count ?? 0;
    },
    async get(id) {
      const { data } = await admin
        .from("aly_chat_docs")
        .select("id, title, kind, language, content, version")
        .eq("id", id)
        .eq("chat_id", chatId)
        .eq("user_id", userId)
        .maybeSingle();
      return data ? toDoc(data) : null;
    },
    async create(d) {
      const { data, error } = await admin
        .from("aly_chat_docs")
        .insert({ user_id: userId, chat_id: chatId, title: d.title, kind: d.kind, language: d.language, content: d.content })
        .select("id, title, kind, language, content, version")
        .single();
      if (error || !data) throw new Error(`aly-chat: document write failed — ${error?.message ?? "no row"}`);
      return toDoc(data);
    },
    async update(id, content, version) {
      const { data, error } = await admin
        .from("aly_chat_docs")
        .update({ content, version, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("chat_id", chatId)
        .eq("user_id", userId)
        .select("id, title, kind, language, content, version")
        .single();
      if (error || !data) throw new Error(`aly-chat: document update failed — ${error?.message ?? "no row"}`);
      return toDoc(data);
    },
  };
}

export async function listDocs(db: SupabaseClient, userId: string, chatId: string): Promise<Doc[]> {
  const { data } = await db
    .from("aly_chat_docs")
    .select("id, title, kind, language, content, version")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(40);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    kind: r.kind === "code" ? "code" : "document",
    language: (r.language as string | null) ?? null,
    content: r.content as string,
    version: Number(r.version) || 1,
  }));
}

// ---------------------------------------------------------------------------
// What a new chat starts knowing

/** Aly's notes (shared with the lamp), as one block, capped. */
export async function memorySnapshot(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin
    .from("producer_notes")
    .select("path, content")
    .eq("user_id", userId)
    .order("path", { ascending: true })
    .limit(50);
  let out = "";
  for (const n of data ?? []) {
    const block = `${n.path}\n${String(n.content).slice(0, 2000)}\n\n`;
    if (out.length + block.length > 12000) break;
    out += block;
  }
  return out.trim();
}

export async function projectSnapshot(db: SupabaseClient, userId: string, projectId: string): Promise<ProjectSnapshot | null> {
  const { data: p } = await db
    .from("projects")
    .select("id, name, description")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!p) return null;
  // On its own: before aly-chat.sql runs the column is missing and the read errors.
  const { data: instr } = await db.from("projects").select("aly_instructions").eq("id", projectId).maybeSingle();
  // A render has no project of its own: a project's work is its characters'
  // work (the same rule as the project page).
  const { data: chars } = await db
    .from("character_profiles")
    .select("id, name")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .limit(30);
  const castIds = (chars ?? []).map((c) => c.id as string);
  const { data: gens } = castIds.length
    ? await db
        .from("generations")
        .select("created_at, content_type, prompt_input, match_score, status")
        .eq("user_id", userId)
        .in("character_profile_id", castIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(12)
    : { data: [] as Record<string, unknown>[] };
  return {
    id: p.id as string,
    name: String(p.name ?? "Untitled"),
    description: (p.description as string | null) || null,
    instructions: ((instr as { aly_instructions?: string | null } | null)?.aly_instructions ?? null) || null,
    characters: (chars ?? []).map((c) => String(c.name ?? "")).filter(Boolean),
    recent: (gens ?? []).map((g) => {
      const day = String(g.created_at).slice(0, 10);
      const score = typeof g.match_score === "number" ? `, score ${Math.round(g.match_score)}` : "";
      const words = String(g.prompt_input ?? "").replace(/\s+/g, " ").slice(0, 140);
      return `${day} ${g.content_type ?? "render"} (${g.status}${score}): ${words}`;
    }),
  };
}
