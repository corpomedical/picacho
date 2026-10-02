import { createAdminClient } from "@/lib/supabase/server";
import { mediaUrl } from "@/lib/media/url";
import { FILES_BUCKET } from "./store";
import { RENDER_ROLE, type CardPhoto } from "./card-photos-rules";

// A chat picture riding into a render (2026-10-02, card-photos-rules.ts).
//
// The renderer takes only our own /api/media URLs (actions.ts's SSRF guard),
// and Aly's chat files live in their own private bucket with no media route.
// So each photo is copied, once, into the composer's own attachment bucket at
// a path fixed by the file's id: a second Make it, a retry on another engine
// or Aly's hands-free start all land on the same object, and nothing piles up.
// Service role, scoped twice: the file row must be this person's, and the
// copy is written under their own folder, as the composer's uploads are.

const ATTACHMENTS_BUCKET = "chat-attachments";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export type RenderRoleEntry = { url: string; role: "identity" | "prop" };

/**
 * The card's photos as the renderer's attachment_roles, or an error in the
 * person's words when one can't be read (deleted, or not theirs).
 */
export async function cardPhotoRoles(userId: string, photos: readonly CardPhoto[]): Promise<{ roles: RenderRoleEntry[] } | { error: string }> {
  if (photos.length === 0) return { roles: [] };
  const admin = createAdminClient();
  const ids = photos.map((p) => p.fileId);
  const { data: rows } = await admin.from("aly_chat_files").select("id, name, mime, storage_path, ready").eq("user_id", userId).in("id", ids);
  const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));

  const roles: RenderRoleEntry[] = [];
  for (const photo of photos) {
    const row = byId.get(photo.fileId);
    const ext = row ? EXT[row.mime as string] : undefined;
    if (!row || !row.ready || !ext) return { error: `${photo.name || "A photo"} isn't in this chat any more. Attach it again.` };
    const path = `${userId}/aly-${photo.fileId}.${ext}`;
    const { data: existing } = await admin.storage.from(ATTACHMENTS_BUCKET).list(userId, { search: `aly-${photo.fileId}.${ext}`, limit: 1 });
    if (!existing?.some((o) => o.name === `aly-${photo.fileId}.${ext}`)) {
      const { data: blob, error } = await admin.storage.from(FILES_BUCKET).download(row.storage_path as string);
      if (error || !blob) return { error: `${photo.name || "A photo"} couldn't be read just now. Try again.` };
      const { error: upErr } = await admin.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(path, Buffer.from(await blob.arrayBuffer()), { contentType: row.mime as string, upsert: true });
      if (upErr) return { error: "Your photos couldn't be got ready just now. Try again." };
    }
    roles.push({ url: mediaUrl(ATTACHMENTS_BUCKET, path), role: RENDER_ROLE[photo.role] });
  }
  return { roles };
}
