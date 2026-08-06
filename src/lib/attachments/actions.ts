"use server";

import { createClient } from "@/lib/supabase/server";

export type ChatAttachment = {
  path: string;
  url: string;
  name: string;
  type: string;
  size: number;
};

type UploadResult = { error: string | null; attachment?: ChatAttachment };

// Generous enough for a handful of photos or a short clip, without letting
// someone accidentally upload something enormous through the chat composer.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

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

  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${data.user.id}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("chat-attachments")
    .upload(path, bytes, { contentType: file.type || "application/octet-stream" });
  if (uploadError) return { error: uploadError.message };

  const { data: signed, error: signError } = await supabase.storage
    .from("chat-attachments")
    .createSignedUrl(path, 60 * 60 * 24);
  if (signError || !signed?.signedUrl) {
    return { error: "Uploaded, but couldn't create a preview link." };
  }

  return {
    error: null,
    attachment: { path, url: signed.signedUrl, name: file.name, type: file.type, size: file.size },
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
