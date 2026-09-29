"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isAlyChatEnabled } from "./enabled";
import { bytesMatch, extractText, kindOf, mimeFor, safeName, MAX_FILE_BYTES } from "./files";
import { canChangeKept, parseRow, type StoredRow } from "./history";
import { isBrain } from "./brains";
import { MAX_DOC_CHARS } from "./docs";
import { FILES_BUCKET } from "./store";

// The chat page's small writes (2026-09-29). Every one takes the user from
// the session and scopes every row to it; the tables give a session SELECT
// on its own rows only, so writes go through the service role here.

type Fail = { error: string };

async function who(): Promise<{ userId: string } | Fail> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Sign in first." };
  if (!(await isAlyChatEnabled(supabase))) return { error: "Chat isn't open right now." };
  const admin = createAdminClient();
  const { data: p } = await admin.from("profiles").select("status").eq("id", data.user.id).maybeSingle();
  if (p?.status === "suspended") return { error: "Your account is suspended." };
  return { userId: data.user.id };
}

const UUID = /^[0-9a-f-]{36}$/i;

// ---- Files --------------------------------------------------------------------

/** Step 1 of an upload: a row and a signed upload into the person's own folder. */
export async function startChatUpload(input: { name: string; type: string; size: number; projectId?: string | null }): Promise<
  { id: string; path: string; token: string; bucket: string; mime: string } | Fail
> {
  const w = await who();
  if ("error" in w) return w;
  const name = String(input.name ?? "").slice(0, 200) || "file";
  const mime = mimeFor(name, String(input.type ?? ""));
  if (!mime) return { error: `Aly can't read ${name}. Try a PDF, picture, Word file, spreadsheet or text file.` };
  const size = Number(input.size);
  if (!Number.isFinite(size) || size <= 0) return { error: `${name} is empty.` };
  if (size > MAX_FILE_BYTES) return { error: `${name} is over 20 MB.` };

  const admin = createAdminClient();
  const id = randomUUID();
  const path = `${w.userId}/${id}/${safeName(name)}`;
  const projectId = typeof input.projectId === "string" && UUID.test(input.projectId) ? input.projectId : null;
  const { error } = await admin.from("aly_chat_files").insert({
    id,
    user_id: w.userId,
    project_id: projectId,
    name,
    mime,
    bytes: Math.round(size),
    storage_path: path,
  });
  if (error) return { error: "Uploads aren't available right now." };
  const signed = await admin.storage.from(FILES_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data) return { error: "Uploads aren't available right now." };
  return { id, path, token: signed.data.token, bucket: FILES_BUCKET, mime };
}

/** Step 2: check what arrived is what it says, read out its words, mark it ready. */
export async function finishChatUpload(id: string): Promise<{ ok: true; kind: string } | Fail> {
  const w = await who();
  if ("error" in w) return w;
  if (!UUID.test(id)) return { error: "That upload isn't there." };
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("aly_chat_files")
    .select("id, name, mime, storage_path, ready")
    .eq("id", id)
    .eq("user_id", w.userId)
    .maybeSingle();
  if (!row) return { error: "That upload isn't there." };
  const kind = kindOf(row.mime as string);
  if (!kind) return { error: "Aly can't read that kind of file." };
  if (row.ready) return { ok: true, kind };

  const { data: blob, error } = await admin.storage.from(FILES_BUCKET).download(row.storage_path as string);
  if (error || !blob) return { error: `${row.name} didn't finish uploading. Try again.` };
  if (blob.size > MAX_FILE_BYTES) {
    await discard(admin, row.id as string, row.storage_path as string);
    return { error: `${row.name} is over 20 MB.` };
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!bytesMatch(kind, row.mime as string, bytes)) {
    await discard(admin, row.id as string, row.storage_path as string);
    return { error: `${row.name} isn't a real ${kind === "image" ? "picture" : kind.toUpperCase()} file.` };
  }
  let text: string | null = null;
  try {
    text = extractText(kind, bytes);
  } catch {
    await discard(admin, row.id as string, row.storage_path as string);
    return { error: `${row.name} couldn't be read. Save it again from its app and retry.` };
  }
  const { error: upErr } = await admin
    .from("aly_chat_files")
    .update({ ready: true, bytes: bytes.length, text_content: text })
    .eq("id", row.id)
    .eq("user_id", w.userId);
  if (upErr) return { error: "Uploads aren't available right now." };
  return { ok: true, kind };
}

async function discard(admin: ReturnType<typeof createAdminClient>, id: string, path: string) {
  await admin.storage.from(FILES_BUCKET).remove([path]);
  await admin.from("aly_chat_files").delete().eq("id", id);
}

/** A file's bytes for the person to open again (a short-lived signed link). */
export async function chatFileLink(id: string): Promise<{ url: string } | Fail> {
  const w = await who();
  if ("error" in w) return w;
  if (!UUID.test(id)) return { error: "That file isn't there." };
  const admin = createAdminClient();
  const { data: row } = await admin.from("aly_chat_files").select("storage_path").eq("id", id).eq("user_id", w.userId).maybeSingle();
  if (!row) return { error: "That file isn't there." };
  const { data } = await admin.storage.from(FILES_BUCKET).createSignedUrl(row.storage_path as string, 600);
  return data?.signedUrl ? { url: data.signedUrl } : { error: "That file isn't there." };
}

// ---- Chats --------------------------------------------------------------------

export async function renameChat(chatId: string, title: string): Promise<{ ok: true } | Fail> {
  const w = await who();
  if ("error" in w) return w;
  const t = String(title ?? "").trim().slice(0, 120);
  if (!UUID.test(chatId) || !t) return { error: "Give it a name." };
  const admin = createAdminClient();
  const { error } = await admin.from("aly_chats").update({ title: t }).eq("id", chatId).eq("user_id", w.userId);
  if (error) return { error: "Couldn't rename it. Try again." };
  revalidatePath("/app/chat", "layout");
  return { ok: true };
}

/**
 * Deleting a chat deletes it: its messages and documents (the rows cascade)
 * and the files attached in it, bytes included. Files that belong to a
 * project stay with the project.
 */
export async function deleteChat(chatId: string): Promise<{ ok: true } | Fail> {
  const w = await who();
  if ("error" in w) return w;
  if (!UUID.test(chatId)) return { error: "That chat isn't there." };
  const admin = createAdminClient();
  const { data: owned } = await admin.from("aly_chats").select("id").eq("id", chatId).eq("user_id", w.userId).maybeSingle();
  if (!owned) return { error: "That chat isn't there." };
  const { data: msgs } = await admin
    .from("aly_chat_messages")
    .select("seq, role, content")
    .eq("chat_id", chatId)
    .eq("role", "user")
    .limit(1000);
  const fileIds = [
    ...new Set(
      (msgs ?? []).flatMap((m) => ((m.content as { files?: { id?: unknown }[] } | null)?.files ?? []).map((f) => f.id).filter((x): x is string => typeof x === "string")),
    ),
  ];
  const { error } = await admin.from("aly_chats").delete().eq("id", chatId).eq("user_id", w.userId);
  if (error) return { error: "Couldn't delete it. Try again." };
  if (fileIds.length > 0) {
    const { data: files } = await admin
      .from("aly_chat_files")
      .select("id, storage_path")
      .eq("user_id", w.userId)
      .is("project_id", null)
      .in("id", fileIds);
    const paths = (files ?? []).map((f) => f.storage_path as string);
    if (paths.length) await admin.storage.from(FILES_BUCKET).remove(paths);
    if (files?.length) await admin.from("aly_chat_files").delete().eq("user_id", w.userId).in("id", files.map((f) => f.id as string));
  }
  revalidatePath("/app/chat", "layout");
  return { ok: true };
}

export async function moveChatToProject(chatId: string, projectId: string | null): Promise<{ ok: true } | Fail> {
  const w = await who();
  if ("error" in w) return w;
  if (!UUID.test(chatId) || (projectId !== null && !UUID.test(projectId))) return { error: "That chat isn't there." };
  const admin = createAdminClient();
  if (projectId) {
    const { data: p } = await admin.from("projects").select("id").eq("id", projectId).eq("user_id", w.userId).maybeSingle();
    if (!p) return { error: "That project isn't there." };
  }
  const { error } = await admin.from("aly_chats").update({ project_id: projectId }).eq("id", chatId).eq("user_id", w.userId);
  if (error) return { error: "Couldn't move it. Try again." };
  revalidatePath("/app/chat", "layout");
  return { ok: true };
}

/**
 * "Keep this one" on an Ask-all-three answer. Only while it is the chat's
 * last message: once the conversation has gone on from it, what the brains
 * were told can't change (history.ts).
 */
export async function keepAnswer(chatId: string, seq: number, brain: string): Promise<{ ok: true } | Fail> {
  const w = await who();
  if ("error" in w) return w;
  if (!UUID.test(chatId) || !Number.isInteger(seq) || !isBrain(brain)) return { error: "That answer isn't there." };
  const admin = createAdminClient();
  const { data: owned } = await admin.from("aly_chats").select("id").eq("id", chatId).eq("user_id", w.userId).maybeSingle();
  if (!owned) return { error: "That answer isn't there." };
  const { data: last } = await admin
    .from("aly_chat_messages")
    .select("seq, role, brain, content")
    .eq("chat_id", chatId)
    .order("seq", { ascending: false })
    .limit(1);
  const rows = (last ?? []).map((r) => parseRow(r as never)).filter(Boolean) as StoredRow[];
  if (!canChangeKept(rows, seq)) return { error: "The chat has moved on from that answer." };
  const row = rows[0];
  if (row.role !== "assistant" || !row.content.lanes[brain] || row.content.lanes[brain]!.error) {
    return { error: "That answer isn't there." };
  }
  const { error } = await admin
    .from("aly_chat_messages")
    .update({ content: { ...row.content, kept: brain } })
    .eq("chat_id", chatId)
    .eq("seq", seq);
  if (error) return { error: "Couldn't keep it. Try again." };
  return { ok: true };
}

// ---- Documents ------------------------------------------------------------------

/** The person's own edit in the side panel. */
export async function saveChatDoc(docId: string, content: string, baseVersion: number): Promise<{ ok: true; version: number } | Fail> {
  const w = await who();
  if ("error" in w) return w;
  if (!UUID.test(docId)) return { error: "That document isn't there." };
  if (typeof content !== "string" || content.length > MAX_DOC_CHARS) return { error: "That document is too long." };
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("aly_chat_docs")
    .select("version")
    .eq("id", docId)
    .eq("user_id", w.userId)
    .maybeSingle();
  if (!doc) return { error: "That document isn't there." };
  if (Number(doc.version) !== baseVersion) return { error: "Aly changed this document while you were editing. Reopen it to see her version." };
  const version = baseVersion + 1;
  const { error } = await admin
    .from("aly_chat_docs")
    .update({ content, version, updated_at: new Date().toISOString() })
    .eq("id", docId)
    .eq("user_id", w.userId)
    .eq("version", baseVersion);
  if (error) return { error: "Couldn't save. Try again." };
  return { ok: true, version };
}

// ---- Projects -------------------------------------------------------------------

export async function saveProjectInstructions(projectId: string, instructions: string): Promise<{ ok: true } | Fail> {
  const w = await who();
  if ("error" in w) return w;
  if (!UUID.test(projectId)) return { error: "That project isn't there." };
  const text = String(instructions ?? "").trim().slice(0, 4000);
  const admin = createAdminClient();
  const { error } = await admin
    .from("projects")
    .update({ aly_instructions: text || null })
    .eq("id", projectId)
    .eq("user_id", w.userId);
  if (error) return { error: "Couldn't save the instructions. Try again." };
  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true };
}

// ---- Memory (Aly's notes, shared with the lamp) -----------------------------------

export async function deleteMemoryNote(path: string): Promise<{ ok: true } | Fail> {
  const w = await who();
  if ("error" in w) return w;
  if (typeof path !== "string" || !path.startsWith("/memories/")) return { error: "That note isn't there." };
  const admin = createAdminClient();
  const { error } = await admin.from("producer_notes").delete().eq("user_id", w.userId).eq("path", path);
  if (error) return { error: "Couldn't delete it. Try again." };
  revalidatePath("/app/chat/memory");
  return { ok: true };
}

export async function saveMemoryNote(path: string, content: string): Promise<{ ok: true } | Fail> {
  const w = await who();
  if ("error" in w) return w;
  if (typeof path !== "string" || !/^\/memories\/[A-Za-z0-9._/ -]{1,120}$/.test(path) || path.includes("..")) {
    return { error: "That note isn't there." };
  }
  const text = String(content ?? "").slice(0, 20000);
  const admin = createAdminClient();
  const { error } = await admin
    .from("producer_notes")
    .upsert({ user_id: w.userId, path, content: text, updated_at: new Date().toISOString() }, { onConflict: "user_id,path" });
  if (error) return { error: "Couldn't save it. Try again." };
  revalidatePath("/app/chat/memory");
  return { ok: true };
}

// ---- Render cards -----------------------------------------------------------------

/**
 * A card's "Make it" started a render: its id is kept on the card so the
 * chat shows the finished picture or clip when it's opened again. The cards
 * are never sent to a brain, so this changes nothing any brain was told.
 */
export async function linkRender(chatId: string, seq: number, cardId: string, generationId: string): Promise<{ ok: true } | Fail> {
  const w = await who();
  if ("error" in w) return w;
  if (!UUID.test(chatId) || !Number.isInteger(seq) || !UUID.test(generationId) || typeof cardId !== "string") {
    return { error: "That card isn't there." };
  }
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("aly_chat_messages")
    .select("content")
    .eq("chat_id", chatId)
    .eq("seq", seq)
    .eq("user_id", w.userId)
    .eq("role", "assistant")
    .maybeSingle();
  const content = row?.content as { renders?: { id?: string; generationId?: string | null }[] } | null;
  if (!content?.renders?.some((r) => r.id === cardId)) return { error: "That card isn't there." };
  const renders = content.renders.map((r) => (r.id === cardId ? { ...r, generationId } : r));
  const { error } = await admin
    .from("aly_chat_messages")
    .update({ content: { ...content, renders } })
    .eq("chat_id", chatId)
    .eq("seq", seq)
    .eq("user_id", w.userId);
  if (error) return { error: "Couldn't save that." };
  return { ok: true };
}

/** The person's chats, newest first, for the sidebar. */
export async function listMyChats(): Promise<{ id: string; title: string | null; projectId: string | null }[]> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return [];
  const { data: rows, error } = await supabase
    .from("aly_chats")
    .select("id, title, project_id")
    .eq("user_id", data.user.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) return [];
  return (rows ?? []).map((r) => ({ id: r.id as string, title: (r.title as string | null) ?? null, projectId: (r.project_id as string | null) ?? null }));
}

/** Picacho Light's "Search chats" (2026-09-29): the person's chats by their names. */
export async function searchMyChats(query: string): Promise<{ id: string; title: string | null }[]> {
  const words = query.trim().slice(0, 80);
  if (!words) return [];
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return [];
  // ilike's own wildcards and escape are taken literally.
  const pattern = `%${words.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const { data: rows, error } = await supabase
    .from("aly_chats")
    .select("id, title")
    .eq("user_id", data.user.id)
    .is("deleted_at", null)
    .ilike("title", pattern)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) return [];
  return (rows ?? []).map((r) => ({ id: r.id as string, title: (r.title as string | null) ?? null }));
}
