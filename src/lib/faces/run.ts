// Face verification's server work (model.ts says what is allowed; this does
// it). Shared by the actions, the callback route, account and character
// deletion, the daily prune and the render path. Every write uses the admin
// client: the tables are read-only to their owners (face-verification.sql).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createFaceAsset,
  deleteFaceAsset,
  deleteFaceGroup,
  faceApiConfigured,
  getFaceAsset,
} from "@/lib/faces/byteplus-faces";
import {
  faceAssetPlan,
  faceAssetStatusOf,
  faceAssetUri,
  type FaceAssetStatus,
  type FaceVerificationStatus,
} from "@/lib/faces/model";

type Admin = SupabaseClient;

export type FaceVerificationRow = {
  id: string;
  user_id: string;
  character_id: string | null;
  status: FaceVerificationStatus;
  state: string;
  byted_token: string | null;
  group_id: string | null;
  created_at: string;
  completed_at: string | null;
};

export type FaceAssetRow = {
  id: string;
  character_id: string;
  photo_path: string;
  asset_id: string | null;
  status: FaceAssetStatus;
  error_code: string | null;
  error_message: string | null;
};

/**
 * Whether face verification exists at all: an env kill switch, the access
 * keys, and its own feature_flags row (inserted OFF). Who may use it is the
 * actions' call — admins while it is proved.
 */
export async function isFaceVerificationEnabled(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.FACE_VERIFICATION_DISABLED === "1") return false;
  if (!faceApiConfigured()) return false;
  try {
    const { data } = await supabase.from("feature_flags").select("enabled").eq("key", "face_verification").maybeSingle<{ enabled: boolean }>();
    return data?.enabled === true;
  } catch {
    return false;
  }
}

/** The account's verified face, or null. A missing table reads as null. */
export async function verifiedFaceOf(admin: Admin, userId: string): Promise<FaceVerificationRow | null> {
  const { data, error } = await admin
    .from("face_verifications")
    .select("id, user_id, character_id, status, state, byted_token, group_id, created_at, completed_at")
    .eq("user_id", userId)
    .eq("status", "verified")
    .maybeSingle<FaceVerificationRow>();
  if (error) return null;
  return data ?? null;
}

export async function faceAssetsOf(admin: Admin, verificationId: string, characterId: string): Promise<FaceAssetRow[]> {
  const { data } = await admin
    .from("face_assets")
    .select("id, character_id, photo_path, asset_id, status, error_code, error_message")
    .eq("verification_id", verificationId)
    .eq("character_id", characterId)
    .order("created_at", { ascending: true })
    .returns<FaceAssetRow[]>();
  return data ?? [];
}

/**
 * Makes a character's assets match its photos: the first photos go to the
 * person's group (BytePlus compares each against the verified face), and an
 * asset whose photo is gone is deleted there. Best-effort per photo — one
 * refused photo never stops the others.
 */
export async function syncCharacterFaceAssets(
  admin: Admin,
  input: { userId: string; verification: FaceVerificationRow; characterId: string; photoPaths: string[] },
): Promise<void> {
  const groupId = input.verification.group_id;
  if (!groupId) return;
  const existing = await faceAssetsOf(admin, input.verification.id, input.characterId);
  const plan = faceAssetPlan(
    input.photoPaths,
    existing.map((a) => ({ photoPath: a.photo_path, status: a.status })),
  );

  for (const path of plan.remove) {
    const row = existing.find((a) => a.photo_path === path && a.status !== "removed");
    if (!row) continue;
    try {
      if (row.asset_id) await deleteFaceAsset(row.asset_id);
      await admin.from("face_assets").update({ status: "removed", updated_at: new Date().toISOString() }).eq("id", row.id);
    } catch (err) {
      console.warn("[faces] asset delete failed; it stays until the next sync or withdrawal.", err);
    }
  }

  for (const path of plan.add) {
    // Only ever the owner's own folder, whatever the character row says.
    if (!path.startsWith(`${input.userId}/`)) continue;
    const { data: signed } = await admin.storage.from("character-references").createSignedUrl(path, 60 * 60);
    const base = {
      user_id: input.userId,
      verification_id: input.verification.id,
      character_id: input.characterId,
      photo_path: path,
      updated_at: new Date().toISOString(),
    };
    if (!signed?.signedUrl) {
      await admin.from("face_assets").upsert({ ...base, status: "failed", error_code: "Unsigned", error_message: "The photo couldn't be read." }, { onConflict: "verification_id,character_id,photo_path" });
      continue;
    }
    try {
      const assetId = await createFaceAsset({ groupId, url: signed.signedUrl, name: path.split("/").pop() ?? "photo" });
      await admin.from("face_assets").upsert({ ...base, asset_id: assetId, status: "processing", error_code: null, error_message: null }, { onConflict: "verification_id,character_id,photo_path" });
    } catch (err) {
      const code = (err as { code?: string }).code ?? "CreateFailed";
      await admin.from("face_assets").upsert({ ...base, status: "failed", error_code: code, error_message: err instanceof Error ? err.message.slice(0, 300) : null }, { onConflict: "verification_id,character_id,photo_path" });
    }
  }
}

/** Asks BytePlus how the photos still being checked are doing. A few at a time: this runs on a page load. */
export async function refreshFaceAssets(admin: Admin, assets: FaceAssetRow[]): Promise<FaceAssetRow[]> {
  const out = [...assets];
  const pending = out.filter((a) => a.status === "processing" && a.asset_id).slice(0, 6);
  await Promise.all(
    pending.map(async (a) => {
      try {
        const state = await getFaceAsset(a.asset_id!);
        const status = faceAssetStatusOf(state.status);
        if (status === a.status) return;
        await admin
          .from("face_assets")
          .update({ status, error_code: state.errorCode, error_message: state.errorMessage, updated_at: new Date().toISOString() })
          .eq("id", a.id);
        Object.assign(a, { status, error_code: state.errorCode, error_message: state.errorMessage });
      } catch {
        // Unreachable just now — the next load asks again.
      }
    }),
  );
  return out;
}

/**
 * The asset URIs a render may carry for this character — ONLY for the person
 * who verified, on their own account (Usage Rules 5.2), and only photos
 * BytePlus has accepted. Empty whenever anything is missing.
 */
export async function faceAssetUrisFor(admin: Admin, userId: string, characterId: string): Promise<string[]> {
  const face = await verifiedFaceOf(admin, userId);
  if (!face) return [];
  const assets = await faceAssetsOf(admin, face.id, characterId);
  return assets.filter((a) => a.status === "active" && a.asset_id).map((a) => faceAssetUri(a.asset_id!));
}

/** A character's photos, forgotten at BytePlus — before the character itself is deleted. */
export async function forgetCharacterFaceAssets(admin: Admin, userId: string, characterId: string): Promise<void> {
  const { data } = await admin
    .from("face_assets")
    .select("id, asset_id, status")
    .eq("user_id", userId)
    .eq("character_id", characterId)
    .neq("status", "removed");
  for (const row of (data ?? []) as { id: string; asset_id: string | null }[]) {
    try {
      if (row.asset_id) await deleteFaceAsset(row.asset_id);
      await admin.from("face_assets").update({ status: "removed", updated_at: new Date().toISOString() }).eq("id", row.id);
    } catch (err) {
      console.warn("[faces] character asset delete failed; withdrawal or account deletion removes the whole group.", err);
    }
  }
}

/** Deletes a group; one BytePlus no longer has is already what was asked for. */
async function deleteGroupOrGone(groupId: string): Promise<void> {
  try {
    await deleteFaceGroup(groupId);
  } catch (err) {
    if (/NotFound|NotExist/i.test((err as { code?: string }).code ?? "")) return;
    throw err;
  }
}

/**
 * Withdraws a person's face: processing stops at once (the row leaves
 * 'verified', so no render carries it), and the whole group is deleted at
 * BytePlus — or queued for the daily prune if BytePlus can't be reached.
 */
export async function withdrawFace(admin: Admin, verification: FaceVerificationRow): Promise<"deleted" | "queued"> {
  const now = new Date().toISOString();
  await admin.from("face_verifications").update({ status: "withdrawn", withdrawn_at: now }).eq("id", verification.id);
  await admin.from("face_assets").update({ status: "removed", updated_at: now }).eq("verification_id", verification.id);
  if (!verification.group_id) return "deleted";
  try {
    await deleteGroupOrGone(verification.group_id);
    return "deleted";
  } catch (err) {
    await admin
      .from("face_group_deletions")
      .upsert({ group_id: verification.group_id, last_error: err instanceof Error ? err.message.slice(0, 300) : String(err) }, { onConflict: "group_id" });
    return "queued";
  }
}

/**
 * Account deletion: every face this account ever verified, deleted at
 * BytePlus — BEFORE the account's rows cascade away, with anything BytePlus
 * refuses queued in the one table that outlives the account.
 */
export async function deleteUserFaces(admin: Admin, userId: string): Promise<void> {
  try {
    const { data, error } = await admin
      .from("face_verifications")
      .select("id, user_id, character_id, status, state, byted_token, group_id, created_at, completed_at")
      .eq("user_id", userId)
      .not("group_id", "is", null);
    if (error) return;
    for (const row of (data ?? []) as FaceVerificationRow[]) await withdrawFace(admin, row);
  } catch (err) {
    console.error("[faces] account deletion couldn't reach the face records.", err);
  }
}

/** The daily prune: deletions BytePlus refused before, tried again. */
export async function retryFaceGroupDeletions(admin: Admin): Promise<{ deleted: number; left: number }> {
  if (!faceApiConfigured()) return { deleted: 0, left: 0 };
  const { data, error } = await admin.from("face_group_deletions").select("group_id, attempts").limit(50);
  if (error || !data) return { deleted: 0, left: 0 };
  let deleted = 0;
  for (const row of data as { group_id: string; attempts: number }[]) {
    try {
      await deleteGroupOrGone(row.group_id);
      await admin.from("face_group_deletions").delete().eq("group_id", row.group_id);
      deleted++;
    } catch (err) {
      await admin
        .from("face_group_deletions")
        .update({ attempts: row.attempts + 1, last_error: err instanceof Error ? err.message.slice(0, 300) : String(err) })
        .eq("group_id", row.group_id);
    }
  }
  return { deleted, left: data.length - deleted };
}
