"use server";

import { createClient } from "@/lib/supabase/server";
import { mediaUrl } from "@/lib/media/url";
import { rateLimited } from "@/lib/rate-limit";

export type ChatAttachment = {
  path: string;
  url: string;
  name: string;
  type: string;
  size: number;
  // Pixel dimensions, measured server-side at upload for images (Send
  // Receipt P1). Lets the resolver check provider aspect bounds without the
  // old client-side Image() probe race. Absent on videos or if measuring
  // fails — absence never blocks anything.
  width?: number;
  height?: number;
};

type UploadResult = { error: string | null; attachment?: ChatAttachment };

// Generous enough for a handful of photos or a short clip, without letting
// someone accidentally upload something enormous through the chat composer.
// NOTE: this cap (and the mime types the composer accepts) is mirrored at the
// bucket itself in supabase/pending-2026-08-19/user-actions.sql — storage RLS
// lets clients upload directly, so an action-side check alone is advisory.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Per-user upload throttle — same atomic advisory-lock limiter the voice
// preview and public API use (rateLimited in lib/rate-limit.ts, service-role
// only), under its own 'upload' scope so API calls or voice traffic in the
// same minute can't eat the upload budget. The size cap bounds one file;
// this bounds how fast a script can loop the action and fill the bucket.
// Nobody attaches 30 files a minute by hand.
const UPLOAD_RATE_WINDOW_SECONDS = 60;
const UPLOAD_RATE_MAX_PER_WINDOW = 30;

// These attachments are preview-only for now — they upload and show inline
// in the chat, but aren't yet fed into the draft/review pipeline the way a
// character's reference photo is.
export async function uploadChatAttachment(formData: FormData): Promise<UploadResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const file = formData.get("file") as File | null;
  if (!file) return { error: "No file provided." };
  if (file.size > MAX_FILE_BYTES) return { error: `${file.name} is larger than 25MB.` };

  // Fails closed on a limiter error, like previewVoice: a retry beats an
  // unbounded storage-fill loop when the limiter itself is unavailable.
  if (
    await rateLimited(data.user.id, "upload", UPLOAD_RATE_WINDOW_SECONDS, UPLOAD_RATE_MAX_PER_WINDOW)
  ) {
    return { error: "You're uploading a bit fast — wait a moment and try again." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${data.user.id}/${crypto.randomUUID()}-${safeName}`;

  // Measure images while the bytes are in hand. EXIF orientations 5-8 are
  // 90°-rotated: swap so the dimensions describe the photo as DISPLAYED —
  // that's the shape the provider aspect checks care about.
  let width: number | undefined;
  let height: number | undefined;
  if (file.type.startsWith("image/")) {
    try {
      const sharp = (await import("sharp")).default;
      const meta = await sharp(bytes).metadata();
      if (meta.width && meta.height) {
        const swapped = (meta.orientation ?? 1) >= 5;
        width = swapped ? meta.height : meta.width;
        height = swapped ? meta.width : meta.height;
      }
    } catch {
      // Unmeasurable image — dims stay absent, nothing blocks.
    }
  }

  const { error: uploadError } = await supabase.storage
    .from("chat-attachments")
    .upload(path, bytes, { contentType: file.type || "application/octet-stream" });
  if (uploadError) return { error: uploadError.message };

  return {
    error: null,
    attachment: {
      path,
      // Stable capability URL — cacheable, never expires mid-thread. When
      // this attachment becomes a provider anchor, the server absolutizes
      // it first (see runGeneration).
      url: mediaUrl("chat-attachments", path),
      name: file.name,
      type: file.type,
      size: file.size,
      width,
      height,
    },
  };
}

export async function deleteChatAttachment(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const path = formData.get("path") as string;
  if (!path || !path.startsWith(`${data.user.id}/`)) return { error: "Not allowed." };

  const { error } = await supabase.storage.from("chat-attachments").remove([path]);
  if (error) return { error: error.message };
  return { error: null };
}
