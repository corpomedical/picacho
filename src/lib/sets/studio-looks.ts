// Helios Studio · a look from the character's own gallery (2026-09-30,
// operator: "…pick from eva's image gallery"), for Video with your character
// (Recast's added image) and Photo with your character (the still's outfit
// reference). Server-only; both doors call it after their own access checks.
//
// The picture is checked again here — this person's, a finished image, of
// THIS character, not deleted — and copied into their own folder of the
// chat-attachments bucket: the one place Recast reads an added image from,
// and the one the render lane takes its attachments from (and cleans up with
// the render when it is deleted).

import type { SupabaseClient } from "@supabase/supabase-js";
import { mediaStoragePath } from "@/lib/media/url";
import { createAdminClient } from "@/lib/supabase/server";
import { IN_ACTION_CHECK_COLUMNS, isInActionImage } from "@/lib/characters/in-action";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const STUDIO_LOOK_BUCKET = "chat-attachments";

type Db = Pick<SupabaseClient, "from">;

/**
 * The look copied for one use: its storage path in STUDIO_LOOK_BUCKET, or null when the picture isn't this
 * person's finished image of this character (nothing is copied then). `tag` names the copy (a press id).
 */
export async function copyStudioLook(db: Db, a: { userId: string; lookId: unknown; characterId: string; tag?: string }): Promise<string | null> {
  if (typeof a.lookId !== "string" || !UUID.test(a.lookId)) return null;
  const { data: row } = await db
    .from("generations")
    .select(IN_ACTION_CHECK_COLUMNS.join(", "))
    .eq("id", a.lookId)
    .eq("user_id", a.userId)
    .is("deleted_at", null)
    .maybeSingle();
  // The Look strip's own rule, row by row (lib/characters/in-action.ts): exactly the rows it lists.
  if (!isInActionImage(row as Record<string, unknown> | null, { userId: a.userId, characterId: a.characterId })) return null;
  const at = mediaStoragePath((row as unknown as { result_url: string }).result_url);
  if (!at) return null;
  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage.from(at.bucket).download(at.path);
  if (error || !blob) return null;
  const ext = (at.path.match(/\.(png|jpe?g|webp)$/i)?.[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
  const tag = a.tag && /^[A-Za-z0-9-]{1,64}$/.test(a.tag) ? `-${a.tag}` : "";
  const path = `${a.userId}/studio-look-${a.lookId}${tag}.${ext}`;
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const { error: upErr } = await admin.storage.from(STUDIO_LOOK_BUCKET).upload(path, Buffer.from(await blob.arrayBuffer()), { contentType: type, upsert: true });
  return upErr ? null : path;
}
