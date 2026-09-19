// Face verification, "Verify it's you" (2026-09-19): the rules, pure and
// alias-free. byteplus-faces.ts talks to BytePlus, actions.ts and the
// callback route run the flow, this says what the flow is allowed to do.
//
// WHY IT EXISTS. Seedance refuses a photograph of a real face, on fal and on
// BytePlus direct alike ("the input image may contain real person"). The
// route ByteDance sanctions is its real-person asset library: the person
// passes a live face check on BytePlus's own page, BytePlus keeps a reference
// image, every photo added afterwards is compared against it, and the video
// call names the photos as asset://<id> instead of URLs.
//
// WHAT BYTEPLUS'S USAGE RULES REQUIRE (BytePlus Real Person Verification
// H5/API — Usage Rules, read 2026-09-19) and where each is kept:
//   2.1–2.3  explicit consent BEFORE any face is processed, by an unticked
//            box, with a real way to say no          → the panel's consent step
//   2.4      a record of it: when, which notice, how  → face_verifications
//   3        a privacy-policy section on facial info  → /privacy
//   4.2      access, deletion and WITHDRAWAL, which stops processing and
//            deletes                                   → withdraw + account deletion
//   5.2      a verification lifts the real-face check ONLY for requests from
//            the person who passed it, on their own account — never for
//            anyone else                              → verification is per USER, and
//            only the verifying user's own renders ever carry its assets
//   5.3      no use beyond what was consented to, no sharing, stop at withdrawal

/** The consent notice the panel shows. Bump it whenever those words change — the record names the version agreed to. */
export const FACE_CONSENT_NOTICE_VERSION = "2026-09-19";

/** How consent is given: the one mechanism the panel offers. */
export const FACE_CONSENT_METHOD = "checkbox";

/** BytePlus's session token and page link live 30 minutes; a pending check older than this is abandoned. */
export const FACE_SESSION_MINUTES = 30;

/**
 * Photos sent per character. Seedance's direct lane cites up to four
 * references, and the free Entry tier holds only 50 assets across the whole
 * account — three a character is the pilot's budget.
 */
export const FACE_ASSETS_PER_CHARACTER = 3;

export type FaceVerificationStatus = "pending" | "verified" | "failed" | "expired" | "withdrawn";
export type FaceAssetStatus = "processing" | "active" | "failed" | "removed";

/** BytePlus's page speaks Simplified Chinese, English and Traditional Chinese; everyone else gets English. */
export function faceCheckLink(h5Link: string): string {
  const url = new URL(h5Link);
  url.searchParams.set("lng", "en");
  return url.toString();
}

/** The callback's own verdict: 10000 is a pass, anything else is not. */
export function faceCheckPassed(resultCode: string | null | undefined): boolean {
  return resultCode === "10000";
}

/** Our anti-forgery token in the callback address: 64 hex characters, nothing else. */
export function isFaceState(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/** Whether a pending check has outlived BytePlus's own 30 minutes. */
export function faceSessionExpired(createdAt: string, now: Date): boolean {
  const started = Date.parse(createdAt);
  return !Number.isFinite(started) || now.getTime() - started > FACE_SESSION_MINUTES * 60_000;
}

export function faceAssetStatusOf(byteplus: "Active" | "Processing" | "Failed"): FaceAssetStatus {
  return byteplus === "Active" ? "active" : byteplus === "Failed" ? "failed" : "processing";
}

/** How a video call names an asset: the URI goes where a photo's URL would. */
export function faceAssetUri(assetId: string): string {
  return `asset://${assetId}`;
}

/**
 * Which of a character's photos go to BytePlus: the first ones, in the
 * character's own order (photo 1 is the identity photo everywhere else).
 */
export function facePhotosToSend(photoPaths: string[]): string[] {
  return photoPaths.slice(0, FACE_ASSETS_PER_CHARACTER);
}

/**
 * What to change so a character's assets match its photos: photos to add,
 * and assets whose photo is gone (or beyond the budget) to remove.
 */
export function faceAssetPlan(
  photoPaths: string[],
  assets: { photoPath: string; status: FaceAssetStatus }[],
): { add: string[]; remove: string[] } {
  const wanted = new Set(facePhotosToSend(photoPaths));
  const live = assets.filter((a) => a.status !== "removed");
  const have = new Set(live.map((a) => a.photoPath));
  return {
    add: [...wanted].filter((p) => !have.has(p)),
    remove: live.filter((a) => !wanted.has(a.photoPath)).map((a) => a.photoPath),
  };
}
