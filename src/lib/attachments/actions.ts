"use server";

import { createClient } from "@/lib/supabase/server";
import { mediaUrl } from "@/lib/media/url";
import { rateLimited } from "@/lib/rate-limit";
import { classifyRenderStyle } from "@/lib/generations/providers/describe-image";

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
  /**
   * Whether this image reads as a real human being, judged once at upload by
   * the same classifier every saved character gets. Only ever used to SILENCE
   * a warning that would otherwise fire on anything at all — absent means
   * "unknown", which behaves exactly as before it existed.
   */
  style?: "photoreal" | "illustrated" | null;
  // Declared role (Send Receipt P2) — set client-side on the composer chip,
  // rides through submit plumbing. undefined = legacy identity contract.
  role?: "identity" | "outfit" | "scene" | "prop" | "unused";
};

/**
 * Machine-readable reason alongside the prose (2026-08-31 inspection: these
 * English strings were landing verbatim inside the fully-translated
 * composer). The client maps the code to its own locale's message and falls
 * back to `error` — same noteCode pattern the Send Receipt already uses for
 * server-fed lines. The prose stays for any older client.
 */
export type UploadErrorCode = "SESSION_EXPIRED" | "TOO_LARGE" | "RATE_LIMITED" | "UPLOAD_INCOMPLETE";

type UploadResult = {
  error: string | null;
  errorCode?: UploadErrorCode;
  attachment?: ChatAttachment;
};

// Generous enough for a handful of photos or a short clip, without letting
// someone accidentally upload something enormous through the chat composer.
// NOTE: this cap (and the mime types the composer accepts) is mirrored at the
// bucket itself in supabase/applied/2026-08-19/user-actions.sql — storage RLS
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
/**
 * Reserves a storage path for an attachment the BROWSER will upload directly.
 *
 * WHY THE BYTES NO LONGER COME THROUGH HERE (2026-08-31). Vercel rejects any
 * request body over 4.5MB BEFORE the function is invoked, with a raw 413 that
 * no application code can catch — not a try/catch, not an error boundary.
 * This action advertised a 25MB limit and next.config asks for a 30MB body,
 * and neither has any effect on that platform cap: the effective ceiling was
 * about 4.5MB minus multipart overhead, and a person attaching a 5MB photo
 * got a spinner that died with no explanation. The old catch in the composer
 * even named the symptom, blaming Next.js's own body limit rather than the
 * platform underneath it.
 *
 * So the file now goes straight from the browser to Supabase Storage, which
 * is exactly what character reference photos have always done
 * (character-form.tsx) — that is why a 4.5MB character photo uploaded fine
 * while the same file failed as a chat attachment. Storage RLS is what
 * authorises it, and the bucket's own file_size_limit is what enforces the
 * size, returning a catchable EntityTooLarge instead of an opaque 413.
 *
 * This half only hands out a path scoped to the caller's own folder, so a
 * client cannot choose where it writes.
 */
export async function reserveChatAttachmentPath(
  formData: FormData,
): Promise<{ error: string | null; errorCode?: UploadErrorCode; path?: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return { error: "Your session expired — please log in again.", errorCode: "SESSION_EXPIRED" };
  }

  const name = String(formData.get("name") ?? "");
  const size = Number(formData.get("size") ?? 0);
  if (!name) return { error: "No file provided." };
  if (size > MAX_FILE_BYTES) {
    return { error: `${name} is larger than 25MB.`, errorCode: "TOO_LARGE" };
  }

  // Same limiter as before, still failing closed: it now bounds how fast a
  // client can obtain paths, and storage RLS bounds what it can do with one.
  if (
    await rateLimited(data.user.id, "upload", UPLOAD_RATE_WINDOW_SECONDS, UPLOAD_RATE_MAX_PER_WINDOW)
  ) {
    return {
      error: "You're uploading a bit fast — wait a moment and try again.",
      errorCode: "RATE_LIMITED",
    };
  }

  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return { error: null, path: `${data.user.id}/${crypto.randomUUID()}-${safeName}` };
}

/**
 * Completes an attachment the browser has already uploaded: reads it back out
 * of storage, measures it, judges whether it shows a real person, and returns
 * the record the composer holds.
 *
 * Reading the bytes back is an ordinary server-side fetch from storage, not a
 * request body, so the 4.5MB ceiling never applies to it.
 */
export async function finalizeChatAttachment(formData: FormData): Promise<UploadResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return { error: "Your session expired — please log in again.", errorCode: "SESSION_EXPIRED" };
  }

  const path = String(formData.get("path") ?? "");
  const name = String(formData.get("name") ?? "");
  const type = String(formData.get("type") ?? "");
  const size = Number(formData.get("size") ?? 0);

  // The path came back from the client, so it is re-checked here rather than
  // trusted: only ever this user's own folder, and no traversal.
  if (!path.startsWith(`${data.user.id}/`) || path.includes("..")) {
    return { error: "Not allowed." };
  }

  // Metered SEPARATELY from the reserve step, and this limiter is the whole
  // reason the split is safe: this half makes a paid vision call, and as a
  // "use server" export it is wire-callable in a loop with nothing but a
  // session cookie. The day it shipped it had no limiter at all — a free
  // account could have looped it into unlimited OpenAI spend against one
  // 40KB upload (found by the 2026-08-31 inspection, our own creation). Its
  // own scope, so an upload's reserve+finalize pair doesn't spend one budget
  // twice. Fails closed, like every limiter here.
  if (
    await rateLimited(
      data.user.id,
      "attachment-classify",
      UPLOAD_RATE_WINDOW_SECONDS,
      UPLOAD_RATE_MAX_PER_WINDOW,
    )
  ) {
    return { error: "You're uploading a bit fast — wait a moment and try again." };
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from("chat-attachments")
    .download(path);
  if (downloadError || !blob) {
    return {
      error: downloadError?.message ?? "That upload didn't finish — try again.",
      errorCode: "UPLOAD_INCOMPLETE",
    };
  }
  const bytes = Buffer.from(await blob.arrayBuffer());

  // Measure images while the bytes are in hand. EXIF orientations 5-8 are
  // 90°-rotated: swap so the dimensions describe the photo as DISPLAYED —
  // that's the shape the provider aspect checks care about.
  let width: number | undefined;
  let height: number | undefined;
  const isImage = type.startsWith("image/");
  if (isImage) {
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

  // Is the thing in this photo a real person? See classifyRenderStyle for why
  // this is worth a vision call and why it can only ever SILENCE a warning.
  let style: "photoreal" | "illustrated" | null = null;
  // Gated on MEASURED dimensions, not the client-declared mime type: `type`
  // is whatever the browser said, and a 25MB blob labelled image/png would
  // otherwise ride into sharp and a paid vision call. If sharp could not
  // read a width out of it, it is not a photo worth paying to classify.
  if (isImage && width && height) {
    try {
      const sharp = (await import("sharp")).default;
      const small = await sharp(bytes)
        // EXIF first — a sideways portrait is measurably harder to read.
        .rotate()
        // Flatten onto WHITE before the JPEG conversion. Without this a
        // transparent PNG composites onto BLACK, which is precisely the shape
        // of the uploads this check exists for: cut-out mascots and logos
        // become a dark silhouette on a dark field.
        .flatten({ background: "#ffffff" })
        // 768, not 512: what separates skin texture from CGI shading, and a
        // painting's brushwork from a photograph, is detail 512px throws away.
        .resize(768, 768, { fit: "inside", withoutEnlargement: true })
        // 4:4:4 keeps line-art edges crisp — the other thing that tells a
        // drawing from a photograph at small sizes.
        .jpeg({ quality: 82, chromaSubsampling: "4:4:4" })
        .toBuffer();
      style = await classifyRenderStyle(`data:image/jpeg;base64,${small.toString("base64")}`);
    } catch {
      // Unknown style behaves exactly as it did before this existed: warn.
    }
  }

  return {
    error: null,
    attachment: {
      path,
      // Stable capability URL — cacheable, never expires mid-thread. When
      // this attachment becomes a provider anchor, the server absolutizes
      // it first (see runGeneration).
      url: mediaUrl("chat-attachments", path),
      name,
      type,
      size,
      width,
      height,
      style,
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
