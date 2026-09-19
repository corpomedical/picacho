import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getVerificationGroup, deleteFaceGroup } from "@/lib/faces/byteplus-faces";
import { faceCheckPassed, faceSessionExpired, isFaceState } from "@/lib/faces/model";
import { syncCharacterFaceAssets, type FaceVerificationRow } from "@/lib/faces/run";

// Where BytePlus's live face check sends the person back (lib/faces/). The
// address carries OUR state token; BytePlus appends bytedToken, resultCode
// (10000 = passed), algorithmBaseRespCode, reqMeasureInfoValue, verify_type.
//
// Nothing the query says is trusted on its own: the state must name a
// pending check of ours less than 30 minutes old, the person arriving must be
// signed in as the account that started it (Usage Rules 5.2 — a verification
// is that account's own), and the group is read from BytePlus with the token
// WE stored, never the one in the address.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const home = new URL("/app/character", url.origin);
  if (!isFaceState(state)) return NextResponse.redirect(home);

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("face_verifications")
    .select("id, user_id, character_id, status, state, byted_token, group_id, created_at, completed_at")
    .eq("state", state)
    .maybeSingle<FaceVerificationRow>();
  if (!row) return NextResponse.redirect(home);

  const back = (face: string) => {
    const to = new URL(row.character_id ? `/app/character/${row.character_id}` : "/app/character", url.origin);
    to.searchParams.set("face", face);
    return NextResponse.redirect(to);
  };
  const close = async (status: "failed" | "expired", fields: Record<string, unknown> = {}) => {
    await admin
      .from("face_verifications")
      .update({ status, completed_at: new Date().toISOString(), ...fields })
      .eq("id", row.id)
      .eq("status", "pending");
    return back(status);
  };

  if (row.status !== "pending") return back(row.status === "verified" ? "verified" : "failed");

  // The state token is the proof of origin: unguessable, single-use, and
  // written with the consent by the signed-in account that started the check.
  // A person who did the face check on their phone arrives signed out, and
  // that is allowed; arriving signed in as a DIFFERENT account is not.
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user && auth.user.id !== row.user_id) return close("failed", { error: "Returned signed in as a different account." });

  const returned = url.searchParams.get("bytedToken");
  if (returned && returned !== row.byted_token) return close("failed", { error: "The check's token did not match." });
  if (faceSessionExpired(row.created_at, new Date())) return close("expired");

  const resultCode = url.searchParams.get("resultCode");
  if (!faceCheckPassed(resultCode)) {
    return close("failed", { result_code: resultCode, error: `algorithmBaseRespCode ${url.searchParams.get("algorithmBaseRespCode") ?? "-"}` });
  }

  let groupId: string;
  try {
    groupId = await getVerificationGroup(row.byted_token ?? "");
  } catch (err) {
    return close("failed", { result_code: resultCode, error: err instanceof Error ? err.message.slice(0, 300) : "No group." });
  }

  const { data: verified, error } = await admin
    .from("face_verifications")
    .update({ status: "verified", group_id: groupId, result_code: resultCode, completed_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id, user_id, character_id, status, state, byted_token, group_id, created_at, completed_at")
    .maybeSingle<FaceVerificationRow>();
  if (error || !verified) {
    // Another face is already verified on this account (one per account), or
    // the write failed: this person's group must not be left at BytePlus.
    try {
      await deleteFaceGroup(groupId);
    } catch {
      await admin.from("face_group_deletions").upsert({ group_id: groupId, last_error: "orphaned at verification" }, { onConflict: "group_id" });
    }
    return close("failed", { error: error?.message ?? "Already verified." });
  }

  if (verified.character_id) {
    const { data: character } = await admin
      .from("character_profiles")
      .select("reference_image_urls")
      .eq("id", verified.character_id)
      .eq("user_id", verified.user_id)
      .maybeSingle<{ reference_image_urls: string[] | null }>();
    await syncCharacterFaceAssets(admin, {
      userId: verified.user_id,
      verification: verified,
      characterId: verified.character_id,
      photoPaths: character?.reference_image_urls ?? [],
    });
  }
  return back("verified");
}
