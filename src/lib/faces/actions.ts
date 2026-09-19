"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getOrigin } from "@/lib/origin";
import { rateLimited } from "@/lib/rate-limit";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/generations/user-facing-error";
import { createVerificationSession, faceApiConfigured } from "@/lib/faces/byteplus-faces";
import {
  FACE_ALREADY_VERIFIED,
  FACE_CHARACTER_MISSING,
  FACE_COULDNT_START,
  FACE_NEEDS_CONSENT,
  FACE_NEEDS_PHOTO,
  FACE_NOT_CONFIGURED,
  FACE_NOT_OPEN,
  FACE_NOT_VERIFIED,
  FACE_TOO_FAST,
  FACE_UNAVAILABLE,
} from "@/lib/faces/messages";
import {
  FACE_CONSENT_METHOD,
  FACE_CONSENT_NOTICE_VERSION,
  faceCheckLink,
  type FaceAssetStatus,
} from "@/lib/faces/model";
import {
  faceAssetsOf,
  isFaceVerificationEnabled,
  refreshFaceAssets,
  syncCharacterFaceAssets,
  verifiedFaceOf,
  withdrawFace,
} from "@/lib/faces/run";

// "Verify it's you" — the panel's actions. The order a face check goes in:
// consent ticked (and recorded, with the notice version) → BytePlus makes a
// one-time page → the person does the live check THERE → BytePlus sends them
// back to /api/face-verification/callback, which reads the result, keeps the
// person's group and sends this character's first photos to it. Nothing
// before the tick touches a face.
//
// WHO: admins while it is proved, behind the `face_verification` switch —
// the recast lane's shape.

type Access =
  | { error: string }
  | { error: null; userId: string; supabase: Awaited<ReturnType<typeof createClient>> };

async function faceAccess(): Promise<Access> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: SESSION_EXPIRED_MESSAGE };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (profile?.role !== "admin") return { error: FACE_NOT_OPEN };
  if (!faceApiConfigured()) return { error: FACE_NOT_CONFIGURED };
  if (!(await isFaceVerificationEnabled(supabase))) return { error: FACE_UNAVAILABLE };
  return { error: null, userId: data.user.id, supabase };
}

async function ownCharacter(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  characterId: string,
): Promise<{ id: string; photos: string[] } | null> {
  const { data } = await supabase
    .from("character_profiles")
    .select("id, reference_image_urls")
    .eq("id", typeof characterId === "string" ? characterId : "")
    .eq("user_id", userId)
    .maybeSingle<{ id: string; reference_image_urls: string[] | null }>();
  if (!data) return null;
  return { id: data.id, photos: (data.reference_image_urls ?? []).filter((p) => p.startsWith(`${userId}/`)) };
}

export type FaceStatus = {
  error: null;
  state: "none" | "verified";
  /** The verified face was made on this character. */
  isThisCharacter: boolean;
  verifiedAt: string | null;
  photos: { path: string; status: FaceAssetStatus; error: string | null }[];
  hasPhotos: boolean;
  noticeVersion: string;
};

/** What the panel shows. Null when the panel should not appear at all. */
export async function getFaceStatus(characterId: string): Promise<FaceStatus | null> {
  const access = await faceAccess();
  if (access.error !== null) return null;
  const character = await ownCharacter(access.supabase, access.userId, characterId);
  if (!character) return null;
  const admin = createAdminClient();
  const face = await verifiedFaceOf(admin, access.userId);
  const assets = face ? await refreshFaceAssets(admin, await faceAssetsOf(admin, face.id, character.id)) : [];
  return {
    error: null,
    state: face ? "verified" : "none",
    isThisCharacter: face?.character_id === character.id,
    verifiedAt: face?.completed_at ?? null,
    photos: assets
      .filter((a) => a.status !== "removed")
      .map((a) => ({ path: a.photo_path, status: a.status, error: a.error_message ?? a.error_code })),
    hasPhotos: character.photos.length > 0,
    noticeVersion: FACE_CONSENT_NOTICE_VERSION,
  };
}

/**
 * Consent in, a one-time BytePlus page out. The consent must name the notice
 * version the panel showed — a stale page agreeing to older words is sent
 * back to read the current ones.
 */
export async function startFaceCheck(input: {
  characterId: string;
  consent: boolean;
  noticeVersion: string;
}): Promise<{ error: string } | { error: null; link: string }> {
  const access = await faceAccess();
  if (access.error !== null) return { error: access.error };
  if (input?.consent !== true || input?.noticeVersion !== FACE_CONSENT_NOTICE_VERSION) return { error: FACE_NEEDS_CONSENT };
  const character = await ownCharacter(access.supabase, access.userId, input.characterId);
  if (!character) return { error: FACE_CHARACTER_MISSING };
  if (character.photos.length === 0) return { error: FACE_NEEDS_PHOTO };
  if (await rateLimited(access.userId, "face-check", 60 * 60, 6)) return { error: FACE_TOO_FAST };

  const admin = createAdminClient();
  if (await verifiedFaceOf(admin, access.userId)) return { error: FACE_ALREADY_VERIFIED };

  const state = randomBytes(32).toString("hex");
  const callback = `${await getOrigin()}/api/face-verification/callback?state=${state}`;
  let session: { bytedToken: string; h5Link: string };
  try {
    session = await createVerificationSession(callback);
  } catch (err) {
    console.error("[faces] couldn't create a verification session:", err instanceof Error ? err.message : err);
    return { error: FACE_COULDNT_START };
  }
  // The consent record, written before the person is sent anywhere.
  const { error } = await admin.from("face_verifications").insert({
    user_id: access.userId,
    character_id: character.id,
    status: "pending",
    consented_at: new Date().toISOString(),
    consent_notice_version: FACE_CONSENT_NOTICE_VERSION,
    consent_method: FACE_CONSENT_METHOD,
    state,
    byted_token: session.bytedToken,
  });
  if (error) {
    console.error("[faces] couldn't record the consent:", error.message);
    return { error: FACE_COULDNT_START };
  }
  return { error: null, link: faceCheckLink(session.h5Link) };
}

/** A second character that is also this person: its first photos go to the same verified face. */
export async function addCharacterToFace(characterId: string): Promise<{ error: string } | { error: null }> {
  const access = await faceAccess();
  if (access.error !== null) return { error: access.error };
  const character = await ownCharacter(access.supabase, access.userId, characterId);
  if (!character) return { error: FACE_CHARACTER_MISSING };
  if (character.photos.length === 0) return { error: FACE_NEEDS_PHOTO };
  const admin = createAdminClient();
  const face = await verifiedFaceOf(admin, access.userId);
  if (!face) return { error: FACE_NOT_VERIFIED };
  await syncCharacterFaceAssets(admin, { userId: access.userId, verification: face, characterId: character.id, photoPaths: character.photos });
  revalidatePath(`/app/character/${character.id}`);
  return { error: null };
}

/** Withdrawal: stops at once, deletes at BytePlus (or queues the deletion). */
export async function withdrawFaceVerification(characterId: string): Promise<{ error: string } | { error: null; queued: boolean }> {
  const access = await faceAccess();
  if (access.error !== null) return { error: access.error };
  const admin = createAdminClient();
  const face = await verifiedFaceOf(admin, access.userId);
  if (!face) return { error: FACE_NOT_VERIFIED };
  const outcome = await withdrawFace(admin, face);
  if (typeof characterId === "string") revalidatePath(`/app/character/${characterId}`);
  return { error: null, queued: outcome === "queued" };
}
