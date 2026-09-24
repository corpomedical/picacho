import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { mediaStoragePath } from "@/lib/media/url";

// look_at_render (2026-09-24): the Producer sees one of the person's renders —
// an image's picture, or a video's poster frame — together with what the
// scorer said about it.
//
// The picture is read from OUR storage with the service role and sent as
// base64, never as a URL: our media URLs are same-origin capabilities and
// Anthropic can't (and shouldn't) fetch them. It is shrunk to 1024 px on the
// long side first — plenty to judge a face, and an image costs roughly
// width × height ÷ 750 input tokens, so at most ~1,400 (a 9:16 frame ~780)
// and far fewer bytes stored in the conversation.
//
// Ownership is checked on the row with the person's own id before any byte
// is read: a render id from a conversation is data, and data doesn't get to
// name someone else's file.

export const LOOK_MAX_SIDE = 1024;

export type LookResult =
  | { ok: true; summary: string; image: { media_type: "image/jpeg"; data: string } | null }
  | { ok: false; error: string };

export async function lookAtRender(
  supabase: SupabaseClient,
  userId: string,
  renderId: unknown,
): Promise<LookResult> {
  if (typeof renderId !== "string" || !/^[0-9a-f-]{36}$/i.test(renderId)) {
    return { ok: false, error: "That isn't a render id. Use an id from search_renders or the renders list." };
  }
  const { data: g, error } = await supabase
    .from("generations")
    .select(
      "id, user_id, created_at, status, content_type, model_id, video_model_id, video_duration_seconds, match_score, match_notes, prompt_input, result_url, poster_url",
    )
    .eq("id", renderId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !g) return { ok: false, error: "No render of theirs has that id." };

  const model = g.model_id ?? g.video_model_id ?? (g.content_type === "image" ? "image" : "?");
  const summary = [
    `Render ${g.id}, ${String(g.created_at).slice(0, 16).replace("T", " ")}: ${g.content_type}${
      g.video_duration_seconds ? ` ${g.video_duration_seconds}s` : ""
    } on ${model}, ${g.status}.`,
    typeof g.match_score === "number" ? `Face score ${g.match_score}.` : "Not scored.",
    g.match_notes ? `Scorer's notes: ${String(g.match_notes).slice(0, 400)}` : null,
    `They asked for: "${String(g.prompt_input ?? "").slice(0, 400)}"`,
    g.content_type === "video" ? "The picture below is the video's poster frame, not the whole clip." : null,
  ]
    .filter(Boolean)
    .join("\n");

  const stored = (g.content_type === "image" ? g.result_url : g.poster_url) as string | null;
  const where = mediaStoragePath(stored);
  if (!where) {
    return { ok: true, summary: `${summary}\nThere is no stored picture to look at for this one.`, image: null };
  }

  try {
    const admin = createAdminClient();
    const { data: blob, error: dlError } = await admin.storage.from(where.bucket).download(where.path);
    if (dlError || !blob) throw new Error(dlError?.message ?? "empty");
    const jpeg = await sharp(Buffer.from(await blob.arrayBuffer()))
      .rotate()
      .resize(LOOK_MAX_SIDE, LOOK_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { ok: true, summary, image: { media_type: "image/jpeg", data: jpeg.toString("base64") } };
  } catch (err) {
    console.error("producer-look: couldn't read the picture —", err instanceof Error ? err.message : err);
    return { ok: true, summary: `${summary}\nThe picture couldn't be read just now.`, image: null };
  }
}
