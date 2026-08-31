"use server";

import { revalidatePath } from "next/cache";
import { forceRefundEligible } from "@/lib/generations/refund-rules";
import { baselineIdentityReferences, resolveSendPlan } from "@/lib/generations/send-plan";
import { describeImageAsPrompt, describeSubjectImage } from "@/lib/generations/providers/describe-image";
import { resolvePresetBlocks } from "@/lib/generations/cinema-presets";
import { getOrigin } from "@/lib/origin";
import { toMediaUrl, absolutizeMediaUrl, isRenderableUrl, isAllowedFetchUrl } from "@/lib/media/url";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runPipeline,
  runRealPipeline,
  missingRealProviderKeys,
  type AttemptLog,
  type ContentType,
} from "@/lib/generations/pipeline";
import {
  saveVideoJob,
  advanceGeneration,
  reapStaleJobs,
  refundGenerationCosts,
  type AdvanceResult,
} from "@/lib/generations/job-runner";
import { getAnglePreset, angleSortIndex } from "@/lib/generations/angles";
import { submitVideoJob, cancelQueuedJob, type QueuedJob } from "@/lib/generations/providers/fal";
import { IMAGE_MODELS } from "@/lib/generations/providers/image-models";
import { resolveModel } from "@/lib/generations/model-health";

// Appended to the user's prompt when compiling the one scene that every angle
// in a multi-angle batch will share.
//
// The camera instruction is deliberately withheld here and added per angle
// afterwards. Without this, the draft invents its own camera position and
// then each angle carries two conflicting camera directions — the one the
// draft imagined and the one the angle preset appends — and Kling picks
// whichever it likes.
const SHARED_SCENE_INSTRUCTION =
  "Describe the setting, wardrobe, props, lighting and background precisely and concretely, " +
  "since several shots will be filmed from this same scene. Do not mention the camera angle, " +
  "camera position, or shot type — those are specified separately per shot. " +
  // The reference photo is handed to Kling as the opening frame (see the
  // negative_prompt note in providers/fal.ts), so without this every clip
  // began with the character held in their photographed pose before the
  // action started. Describing the scene as already underway gives the model
  // a reason to move off that frame immediately.
  "Write the scene as already in motion at the very first moment — the action is underway, " +
  "not about to begin, and the character is never standing still in a posed portrait.";
import { FREE_TIER_VIDEO_MODEL_ID } from "@/lib/plans";
import {
  getVideoModel,
  getDefaultDurationSeconds,
  getDurationCreditWeight,
  storyboardFrameExtraCredits,
  continuationExtraCredits,
  getDialogueCreditWeight,
  isValidDuration,
  requiresReferenceImage,
  VIDEO_MODELS,
  VIDEO_MODELS_BY_PRICE,
} from "@/lib/generations/providers/video-models";
import {
  resolutionCreditWeight,
  resolveVideoResolution,
} from "@/lib/generations/providers/video-resolution";
import { detectAspectRatioFromPrompt, type VideoAspectRatio } from "@/lib/generations/aspect-ratio";
import { autoReportFailedGeneration } from "@/lib/generations/reports";
import { scoreIdentityMatch } from "@/lib/generations/providers/openai";
import { isTrivialUtterance } from "@/lib/voice/agent";
import type { BrandRule } from "@/lib/brand-rules/types";
// Credits and image persistence live in a plain module, not here: this file
// is "use server", so anything exported from it becomes a public endpoint.
import {
  checkGenerationAllowance,
  consumeFreeGeneration,
  consumePurchasedCredits,
  getMonthlyUsageWith,
  persistGeneratedImage,
} from "@/lib/generations/core";

// Account-level brand/compliance rules, read straight from the table rather
// than via the brand-rules server action — a "use server" export is a
// callable endpoint, and this is an internal read on a path that already has
// the user's supabase client to hand. Only active rules are fetched; the
// pipeline narrows them further by content type.
async function loadBrandRules(
  supabase: SupabaseClient,
  userId: string,
): Promise<BrandRule[]> {
  // Global kill switch (Admin → Feature flags → brand_rules_enforcement).
  // With the flag off the pipeline sees zero rules: nothing is injected into
  // drafting and validation has nothing to block — while the rules themselves
  // stay visible and editable in Settings → Brand rules.
  const { data: flag } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "brand_rules_enforcement")
    .single();
  if (!flag?.enabled) return [];

  const { data } = await supabase
    .from("brand_rules")
    .select("id, kind, label, value, applies_to, severity, active")
    .eq("user_id", userId)
    .eq("active", true);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as BrandRule["kind"],
    label: r.label as string,
    value: r.value as string,
    appliesTo: r.applies_to as BrandRule["appliesTo"],
    severity: r.severity as BrandRule["severity"],
    active: r.active as boolean,
  }));
}



type RunResult =
  | {
      error: string;
    }
  | {
      error: null;
      id: string;
      succeeded: boolean;
      attempts: AttemptLog[];
      finalPrompt: string;
      resultUrl: string | null;
      // 0-100 identity-match score from the post-generation vision check
      // (characters v2, images with a character only); null when unscored.
      matchScore?: number | null;
      // True when the render has been queued with fal.ai and this call is
      // returning without waiting for it (video only — see submitVideoOnly in
      // pipeline.ts). `succeeded` is false and `resultUrl` null in that case
      // because nothing has finished yet; the caller must poll
      // advanceGeneration until it reports a terminal state.
      //
      // This is what keeps a ten-minute render from dying against Vercel's
      // 300s function limit, and what lets a generation survive a reload or a
      // locked phone.
      pending?: boolean;
      progress?: string;
      // Present when the failure was the user's OWN brand rules blocking the
      // prompt: rule label + the exact trigger words + a suggested fix —
      // drives the actionable failure UI and the Generate-anyway override.
      rulesBlock?: { label: string; evidence: string; fix: string }[];
    };

// The SERVER-SIDE BACKSTOP, sized to the largest legitimate payload rather
// than to what a person types. Those are two different numbers, and treating
// them as one was a live bug: a storyboard joins up to SIX shots of up to
// 1,200 characters each into a single prompt string
// (generate-form.tsx, `const joined = storyboardShots.map(...)`), which is
// ~7,300 characters — so the old 2,000 cap rejected any storyboard with more
// than one detailed shot, AFTER the person had written all of them, with the
// unhelpful message "Keep prompts under 2000 characters."
//
// 8,000 covers six full shots with room for the "Shot 1 (5s): " prefixes.
// What a human can TYPE is capped lower and separately, in the composer, so
// this stays what it was meant to be: a backstop against a stray giant paste
// turning into an oversized and costly AI call.
const MAX_PROMPT_LENGTH = 8000;

// A spoken line, not a scene description — kept much shorter than the main
// prompt. Also roughly bounds ElevenLabs TTS cost per generation.
const MAX_DIALOGUE_LENGTH = 500;


// Storyboard/multi-reference slots (see runGeneration below) can now come
// from either a character's own saved reference-photo bucket path (needs
// signing here, as before) or a photo freshly uploaded through the composer,
// which the client already has a ready, pre-signed URL for (see
// finalizeChatAttachment in attachments/actions.ts) — passed straight through
// with no extra signing needed. A signed URL always starts with "http"; a
// character-references storage path never does, so that's a simple, reliable
// way to tell the two apart without a second formData field per slot.
async function resolveMaybeSignedUrl(
  supabase: SupabaseClient,
  pathOrUrl: string,
): Promise<string | null> {
  if (pathOrUrl.startsWith("/api/media/")) {
    // A stable media URL from the composer (attachment or picker) — valid,
    // but relative, and fal/OpenAI fetch these over the open internet.
    return absolutizeMediaUrl(pathOrUrl, await getOrigin());
  }
  if (pathOrUrl.startsWith("http")) {
    // SSRF guard: only our own media route or Supabase storage are ever
    // legitimate server-fetch targets. Reject arbitrary/internal URLs
    // (metadata IPs, internal hosts) rather than fetch them or hand them to a
    // provider.
    return isAllowedFetchUrl(pathOrUrl, await getOrigin()) ? pathOrUrl : null;
  }
  const { data: signed } = await supabase.storage
    .from("character-references")
    .createSignedUrl(pathOrUrl, 60 * 10);
  return signed?.signedUrl ?? null;
}

// After a successful image generation, save a copy into the character's own
// reference-photo gallery — otherwise a freshly created character has no
// thumbnail at all until someone remembers to go upload one by hand. Only
// sets it as the actual thumbnail (index 0) when the character had no
// reference photos yet; if they already chose one, a newly generated image
// is added to the gallery instead of silently replacing it, since that
// existing photo is also what future generations anchor to for consistency.
// Best-effort: any failure here is swallowed rather than surfaced, since the
// generation itself already succeeded and shouldn't be reported as failed
// over a secondary, non-essential step.
async function addGeneratedImageAsReference(
  supabase: SupabaseClient,
  userId: string,
  characterId: string,
  imageUrl: string,
): Promise<"added" | "full" | "failed"> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return "failed";
    const bytes = Buffer.from(await res.arrayBuffer());
    const path = `${userId}/${crypto.randomUUID()}-generated.png`;

    const { error: uploadError } = await supabase.storage
      .from("character-references")
      .upload(path, bytes, { contentType: "image/png" });
    if (uploadError) return "failed";

    const { data: current } = await supabase
      .from("character_profiles")
      .select("reference_image_urls")
      .eq("id", characterId)
      .single();
    const existing: string[] = current?.reference_image_urls ?? [];

    // Respect the 5-photo gallery cap the character form enforces. This
    // used to append unbounded — every successful image generation grew the
    // gallery (real data: characters at 7 and 8 photos) — which silently
    // DISABLED the character page's describe-and-generate box forever,
    // since that box is gated on totalImages >= 5 ("the chat box is off,
    // I can't click or write in it"). The generated image is still saved in
    // History/Images either way; skipping the gallery append loses nothing.
    if (existing.length >= 5) {
      await supabase.storage.from("character-references").remove([path]);
      return "full";
    }

    // Compare-and-swap on the list that was read: the download+upload above
    // leaves a seconds-wide window, and two concurrent promotes both read
    // the same list, so the second write silently dropped the first photo
    // and stranded its upload in storage (2026-08-31 inspection). Paths are
    // uid/uuid names — no quotes, commas or backslashes — so the Postgres
    // array literal below is safe to assemble by hand.
    const currentLiteral = `{${existing.map((p) => `"${p}"`).join(",")}}`;
    const { data: swapped } = await supabase
      .from("character_profiles")
      .update({
        reference_image_urls: existing.length === 0 ? [path] : [...existing, path],
      })
      .eq("id", characterId)
      .filter("reference_image_urls", "eq", currentLiteral)
      .select("id");
    if (!swapped?.length) {
      // Lost the race — a concurrent promote landed first. Remove this
      // upload rather than stranding it, exactly as the "full" branch does.
      await supabase.storage.from("character-references").remove([path]);
      return "failed";
    }
    return "added";
  } catch {
    return "failed";
  }
}

// Characters v2: generated images are never auto-added to a character's
// reference gallery anymore — an invented or drifted face becoming an
// identity anchor poisons every later generation (real data: two characters
// had silently grown to 7 and 8 gallery photos of subtly different faces).
// Promotion is explicit and user-initiated, via the button under a finished
// image result, and runs through the same cap + storage path as before.
export async function promoteGenerationToReference(
  generationId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return { error: "You need to be signed in." };

  const { data: gen } = await supabase
    .from("generations")
    .select("id, user_id, character_profile_id, content_type, result_url, status")
    .eq("id", generationId)
    .single();

  if (!gen || gen.user_id !== userData.user.id) return { error: "Generation not found." };
  if (gen.content_type !== "image" || gen.status !== "succeeded" || !gen.result_url) {
    return { error: "Only finished images can become reference photos." };
  }
  if (!gen.character_profile_id) {
    return { error: "This image isn't linked to a character." };
  }

  // The stored result_url is a signed URL whose token may have expired long
  // before the user clicks promote — re-sign from the storage path rather
  // than trusting it.
  let freshUrl = gen.result_url as string;
  const marker = "/generated-images/";
  const markerIdx = freshUrl.indexOf(marker);
  if (markerIdx !== -1) {
    const storagePath = decodeURIComponent(freshUrl.slice(markerIdx + marker.length).split("?")[0]);
    const { data: signed } = await supabase.storage
      .from("generated-images")
      .createSignedUrl(storagePath, 600);
    if (signed?.signedUrl) freshUrl = signed.signedUrl;
  }
  // Stable media URLs are relative — the copy helper fetches server-side
  // and needs something absolute.
  freshUrl = absolutizeMediaUrl(freshUrl, await getOrigin());

  const outcome = await addGeneratedImageAsReference(
    supabase,
    userData.user.id,
    gen.character_profile_id as string,
    freshUrl,
  );
  if (outcome === "full") {
    return {
      error:
        "This character's reference gallery is full (5 photos). Remove one on the character page first.",
    };
  }
  if (outcome === "failed") {
    return { error: "Couldn't save that image as a reference — try again." };
  }

  revalidatePath("/app/character");
  revalidatePath(`/app/character/${gen.character_profile_id}`);
  return { error: null };
}

// Shared cost/abuse guardrail for both single and multi-angle generation.

export async function runGeneration(formData: FormData): Promise<RunResult> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const userInput = (formData.get("prompt") as string)?.trim();
  const characterId = formData.get("character_id") as string;
  const contentType = ((formData.get("content_type") as string) || "video") as ContentType;

  // Multiple DIFFERENT characters composited into one generation together —
  // a separate feature from the reference-photo-count options below, which
  // are all about MULTIPLE PHOTOS OF ONE character. The two are deliberately
  // mutually exclusive (see the check next to wantsAdvancedVideoOptions):
  // combining them would mean guessing which reference photos belong to
  // which of several characters with no way to express that to the video
  // model. Works for both video and images, and on every plan (no Elite
  // gate) — unlike the options below.
  const companionCharacterIds = JSON.parse(
    (formData.get("companion_character_ids") as string) || "[]",
  ) as string[];
  // Generated client-side (crypto.randomUUID()) before this action is even
  // called, so the Stop button has a real id to cancel against from the
  // moment the request goes out — waiting for this action to return would
  // mean the id (and the id alone) only exists after the whole thing is
  // already done, too late to be useful.
  const clientGenerationId = (formData.get("generation_id") as string) || undefined;

  // Advanced Kling-only video options — multi-image reference (2-4 of the
  // character's reference photos) and storyboard (a start and/or end frame).
  // Sent as storage paths from the client; resolved to signed URLs below
  // once we know the active video model actually supports them.
  const referencePhotoPaths = JSON.parse(
    (formData.get("reference_photo_paths") as string) || "[]",
  ) as string[];
  const storyboardStartPath = (formData.get("storyboard_start_path") as string) || "";
  const storyboardEndPath = (formData.get("storyboard_end_path") as string) || "";
  const wantsAdvancedVideoOptions =
    contentType === "video" &&
    (referencePhotoPaths.length > 0 || storyboardStartPath || storyboardEndPath);

  // A photo attached directly to this message (the generic "+" upload, not
  // the Elite-only multi-reference/storyboard pickers above) — already a
  // signed, fal.ai-fetchable URL from finalizeChatAttachment, so no further
  // signing is needed here. When present, this is what the person actually
  // wants used for this one generation, ahead of the character's saved
  // default photo (see the anchor-resolution block below).
  //
  // SSRF guard: the only legitimate value is one of our own relative /api/media
  // URLs (from finalizeChatAttachment). Anything else — an absolute http(s) URL,
  // a cloud-metadata IP — is discarded here so it can never become a
  // server-side fetch target or get handed to a provider.
  const legacyAttachmentUrl = (() => {
    const raw = (formData.get("attachment_reference_url") as string) || "";
    return raw.startsWith("/api/media/") ? raw : "";
  })();

  // Attachment roles (Send Receipt P2). New composers send the full role
  // list; when present it is EXHAUSTIVE — an outfit- or scene-role photo
  // must never fall through to the legacy identity field. Old clients
  // (including native shells that will emit the legacy field forever, per
  // the permanent-adapter rule) send no roles: their attachment keeps the
  // original identity contract unchanged. Same URL guard as the legacy
  // field — anything not our own media URL is discarded.
  type AttachmentRoleEntry = { url: string; role: "reference" | "identity" | "outfit" | "scene" | "prop" | "unused" };
  const attachmentRoles: AttachmentRoleEntry[] | null = (() => {
    const raw = formData.get("attachment_roles");
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(String(raw));
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(
        (x): x is AttachmentRoleEntry =>
          Boolean(x) &&
          typeof (x as AttachmentRoleEntry).url === "string" &&
          (x as AttachmentRoleEntry).url.startsWith("/api/media/") &&
          !(x as AttachmentRoleEntry).url.includes("..") &&
          ["reference", "identity", "outfit", "scene", "prop", "unused"].includes((x as AttachmentRoleEntry).role),
      );
    } catch {
      return null;
    }
  })();

  // The identity slot from an attachment. Two ways in:
  //
  //   1. role "identity" — the explicit legacy contract, still honoured.
  //   2. role "reference" WHEN NO CHARACTER IS SELECTED (2026-08-31,
  //      operator: "we decided the model should follow prompt").
  //
  // (2) is the server half of the send-plan change. The 2026-08-25 decision
  // made attachments neutral, with the user's prompt saying what they are
  // for — but the anchor only ever looked for role "identity", so the one
  // role every client actually sends could never become a face. Attaching a
  // portrait with no character selected produced a blocked send on the
  // client and, if it had got through, a faceless render here.
  //
  // Deliberately conditioned on there being no character: when one IS
  // selected its saved photo stays the face and the attachment stays a
  // neutral extra image, exactly as before. Resolved further down, where the
  // character row has been loaded.
  const identityRoleUrl = attachmentRoles
    ? (attachmentRoles.find((a) => a.role === "identity")?.url ?? "")
    : legacyAttachmentUrl;
  const outfitAttachmentUrl = attachmentRoles?.find((a) => a.role === "outfit")?.url ?? "";
  const sceneAttachmentUrl = attachmentRoles?.find((a) => a.role === "scene")?.url ?? "";
  const propAttachmentUrl = attachmentRoles?.find((a) => a.role === "prop")?.url ?? "";
  // The current client contract (2026-08-25): ONE neutral role. The image
  // rides to the model where an extra image is possible, and the USER'S
  // PROMPT says what it's for; identity never comes from it.
  const referenceAttachmentUrl = attachmentRoles?.find((a) => a.role === "reference")?.url ?? "";

  // Every chat-attachment storage path riding this send, whatever its role —
  // recorded on the row so deletion can clean them up. /api/media/<bucket>/
  // is the app's own stable media URL shape.
  const attachmentStoragePaths = (attachmentRoles ?? [])
    .map((a) => a.url)
    .filter((u) => u.startsWith("/api/media/chat-attachments/"))
    .map((u) => u.slice("/api/media/chat-attachments/".length));

  // Which of the character's OWN saved reference photos to anchor to —
  // from the picker in the composer, for characters with more than one
  // saved photo (e.g. a normal shot and a close-up). One step below an
  // attachment in priority, but still ahead of silently defaulting to
  // reference_image_urls[0] regardless of what the prompt actually asks
  // for. Verified against the character's own photos below, not trusted
  // as-is — a direct call could otherwise pass any storage path here.
  const requestedAnchorPhotoPath = (formData.get("anchor_photo_path") as string) || "";

  const wantsMultiCharacter = companionCharacterIds.length > 0;

  // Dialogue — a spoken line the character says, lip-synced onto the video.
  // Available on every plan (no Elite-style gate), but does need the
  // character to have a voice assigned first (see Character settings).
  const dialogueText = (formData.get("dialogue") as string)?.trim() || "";
  const wantsDialogue = contentType === "video" && dialogueText.length > 0;

  if (!userInput) return { error: "Describe what you want first." };
  if (userInput.length > MAX_PROMPT_LENGTH) {
    return { error: `Keep prompts under ${MAX_PROMPT_LENGTH} characters.` };
  }
  // Real incident, 2026-08-10: saying "Hey" into voice mode produced a
  // fully rendered room. Nothing downstream was broken — the pipeline's AI
  // refinement step (draft/review, see pipeline.ts) is designed to turn a
  // sparse prompt into a complete scene description, so given a greeting it
  // invents an entire scene from nothing. Guarding at the entry point
  // instead of trying to make the refiner refuse: this is cheap,
  // deterministic, and covers typed input too, whereas asking a model to
  // reliably decline is neither. Only fires when the input is ENTIRELY
  // greeting/filler, so short-but-real prompts still go through.
  if (isTrivialUtterance(userInput)) {
    return {
      error:
        "That didn't include anything to generate — describe what you want to see, like " +
        "\"a woman walking through a neon-lit street at night\".",
    };
  }
  // A character is no longer required — a person may just want to generate
  // a one-off image/video from an uploaded photo, or from the prompt alone,
  // with nothing saved to a character. Real request, 2026-08-09: this used
  // to hard-block every generation without one. Multi-angle and multi-
  // character mode still require a primary character (checked below, where
  // each of those options is actually validated) since both are inherently
  // about one saved character's consistency across several shots.
  if (referencePhotoPaths.length > 0 && referencePhotoPaths.length < 2) {
    return { error: "Pick at least 2 reference photos, or none, for multi-image reference." };
  }
  if (referencePhotoPaths.length > 4) {
    return { error: "Multi-image reference supports up to 4 photos." };
  }
  if (dialogueText.length > MAX_DIALOGUE_LENGTH) {
    return { error: `Keep dialogue under ${MAX_DIALOGUE_LENGTH} characters.` };
  }
  if (wantsMultiCharacter && new Set(companionCharacterIds).size !== companionCharacterIds.length) {
    return { error: "The same character can't be picked twice — choose different characters to appear together." };
  }
  if (wantsMultiCharacter && companionCharacterIds.includes(characterId)) {
    return { error: "The same character can't be picked twice — choose different characters to appear together." };
  }
  if (companionCharacterIds.length > 3) {
    return { error: "Up to 4 characters can appear together in one generation." };
  }
  // Separate, mutually exclusive modes — one is "several photos/angles of
  // ONE character," the other is "several DIFFERENT characters together."
  // Combining them leaves no way to say which reference photo belongs to
  // which character.
  if (wantsMultiCharacter && wantsAdvancedVideoOptions) {
    return {
      error:
        "Using multiple characters together can't be combined with multi-image reference or storyboard for one character — turn one off.",
    };
  }

  // Only fetched when a character was actually picked — see the removed
  // `!characterId` guard above. Everything below that dereferences
  // `character` is now null-guarded (optional chaining for the paths that
  // stay optional without one, an explicit check + early return for the
  // few — dialogue, multi-character — that still inherently need one).
  const characterQuery = characterId
    ? await supabase
        .from("character_profiles")
        .select("*")
        .eq("id", characterId)
        .eq("user_id", userData.user.id)
        .single()
    : { data: null, error: null };
  const character = characterQuery.data;
  type CharacterRow = NonNullable<typeof character>;

  if (characterId && (characterQuery.error || !character)) {
    return { error: "Couldn't find that character." };
  }

  // The identity anchor, resolved now that we know whether a character was
  // selected — see identityRoleUrl above for the two ways in. With NO
  // character, a neutral "reference" attachment becomes the face, because
  // the prompt is what says who it is. With one, the character's saved photo
  // stays the face and the attachment stays a neutral extra image.
  //
  // Note the guard further down already promised this in its own error text
  // — "add one to this character, ATTACH A PHOTO TO THIS MESSAGE, or pick a
  // different model" — so this restores behaviour the server said it had.
  // Promoted when NOTHING ELSE can supply a face — no character, or a
  // character with zero saved photos. The second half mirrors the resolver
  // exactly (send-plan's identityFromSaved keys on hasSavedPhotos): the
  // receipt was promising "Face: attached photo" for a photo-less character
  // while this line refused to promote, and the send then failed telling the
  // person to attach a photo they had already attached (2026-08-31).
  const attachmentReferenceUrl =
    identityRoleUrl ||
    (character?.reference_image_urls?.length ? "" : referenceAttachmentUrl);

  // Fetch + verify every companion character before spending anything — each
  // id must resolve to a real character actually owned by this account (not
  // just any id a direct call happened to send), and every participant needs
  // its own reference photo, since that photo is the only way the video/image
  // model can actually tell one selected character apart from another (see
  // the rulebook-injection comment in pipeline.ts — there's no per-image
  // identity tag on fal.ai's side, only the photo itself and the prompt text).
  let companionCharacters: CharacterRow[] = [];
  if (wantsMultiCharacter) {
    // Multiple DIFFERENT characters appearing together is inherently about
    // a primary character plus companions — there's no "no primary" version
    // of this feature, unlike ordinary single-subject generation.
    if (!character) {
      return { error: "Pick a primary character to appear together with the others." };
    }
    const { data: companions, error: companionsError } = await supabase
      .from("character_profiles")
      .select("*")
      .in("id", companionCharacterIds)
      .eq("user_id", userData.user.id);

    if (companionsError || !companions || companions.length !== companionCharacterIds.length) {
      return { error: "Couldn't find one or more of the selected characters." };
    }
    // .in() doesn't preserve the requested order — restore the order they
    // were actually selected in, since that order becomes the reference
    // photo order sent to the model.
    companionCharacters = companionCharacterIds.map((id) => companions.find((c) => c.id === id)!);

    const missingPhoto = [character, ...companionCharacters].find((c) => !c.reference_image_urls?.[0]);
    if (missingPhoto) {
      return {
        error: `${missingPhoto.name} needs a reference photo before it can be used together with other characters — add one in Character settings.`,
      };
    }
  }

  // Resolve the character's assigned voice (if any) to a real ElevenLabs
  // voice_id before spending a generation attempt on a dialogue request that
  // can't actually produce speech.
  let dialogueVoiceId: string | null = null;
  if (wantsDialogue) {
    // Dialogue is lip-synced onto the video using a specific character's
    // assigned ElevenLabs voice — there's no "anonymous voice" to fall back
    // to, so this one still genuinely needs a character selected.
    if (!character) {
      return {
        error: "Pick a character with a voice assigned to add dialogue, or clear the dialogue field.",
      };
    }
    if (!character.voice_id) {
      return {
        error:
          "This character doesn't have a voice assigned yet — add one in Character settings, or clear the dialogue field.",
      };
    }
    const { data: voicePreset } = await supabase
      .from("voice_presets")
      .select("elevenlabs_voice_id")
      .eq("id", character.voice_id)
      .single();
    dialogueVoiceId = voicePreset?.elevenlabs_voice_id ?? null;
    if (!dialogueVoiceId) {
      return { error: "This character's voice couldn't be found — try picking a different one." };
    }
  }

  const [
    { data: retrySetting },
    { data: flag },
    { data: videoModelSetting },
    { data: imageModelSetting },
    { data: userProfile },
  ] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "max_retry_attempts").single(),
    supabase.from("feature_flags").select("enabled").eq("key", "real_ai_providers").single(),
    supabase.from("app_settings").select("value").eq("key", "video_model").single(),
    supabase.from("app_settings").select("value").eq("key", "image_model").single(),
    supabase
      .from("profiles")
      .select("skip_ai_refinement, plan, bonus_credits, purchased_credits, role, status")
      .eq("id", userData.user.id)
      .single(),
  ]);
  // Suspension check IN the action, not just middleware. The middleware only
  // guards by path prefix, and a "use server" export is a wire-callable
  // endpoint — a suspended account could keep generating (and spending real
  // provider money) by POSTing the action directly. Same explicit check the
  // prompt-assist allowance does (see prompts/actions.ts).
  if (userProfile?.status === "suspended") {
    return { error: "This account is suspended." };
  }
  const maxAttempts = Number(retrySetting?.value) || undefined;
  const useRealProviders = flag?.enabled === true;
  let imageModelId = imageModelSetting?.value ?? "gpt-image";
  // Per-user preference (see setSkipAiRefinement in profile/actions.ts) —
  // skips the paid Claude draft + OpenAI review steps for THIS account's
  // generations only, not everyone's. See pipeline.ts's skipRefinement
  // option for what actually changes.
  // Also skipped for a single request when the composer says this prompt was
  // already compiled and approved in Prompt Studio (see prompts/actions.ts).
  // Redrafting it would mean the user approved one prompt and a different one
  // ran — which would make the whole feature a lie. The composer only sets
  // this when the text is still byte-for-byte what it showed.
  // Storyboard (Kling O3 Pro multi_prompt, live-verified 2026-08-21): 2-6
  // user-written shots, each 1-15s, one coherent video out. Shots are sent
  // AS WRITTEN (per-shot drafting would multiply pipeline cost and latency
  // for marginal gain — v1 decision), so a storyboard implies the
  // final-prompt path below. Total capped at 30s to bound worst-case spend.
  type StoryboardShot = { prompt: string; seconds: number };
  let storyboardShots: StoryboardShot[] | null = null;
  {
    const raw = ((formData.get("storyboard_shots") as string) || "").trim();
    if (raw) {
      if (contentType !== "video") {
        return { error: "Storyboards are a video feature." };
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("not an array");
        storyboardShots = parsed.map((s) => {
          const shot = s as { prompt?: unknown; seconds?: unknown };
          const promptText = typeof shot.prompt === "string" ? shot.prompt.trim() : "";
          const seconds = Number(shot.seconds);
          if (!promptText) throw new Error("empty shot");
          if (!Number.isInteger(seconds) || seconds < 1 || seconds > 15) throw new Error("bad seconds");
          return { prompt: promptText.slice(0, 1200), seconds };
        });
      } catch {
        return { error: "That storyboard couldn't be read — refresh and try again." };
      }
      if (storyboardShots.length < 2 || storyboardShots.length > 6) {
        return { error: "A storyboard is 2 to 6 shots." };
      }
      const totalSeconds = storyboardShots.reduce((n, s) => n + s.seconds, 0);
      if (totalSeconds > 30) {
        return { error: "Storyboards are capped at 30 seconds total for now." };
      }
    }
  }

  const promptIsFinal = formData.get("prompt_is_final") === "1" || storyboardShots !== null;
  const skipRefinement = userProfile?.skip_ai_refinement === true || promptIsFinal;

  // Multi-character images need OpenAI's real multi-image edit endpoint —
  // Flux's fal.ai endpoint only ever accepts one reference image, with no
  // way to composite several distinct characters into one picture. Caught
  // here against whatever the admin has the account's image model set to,
  // rather than silently generating with only one of the selected characters
  // actually represented.
  // Both image lanes composite multiple characters now — GPT's multi-image
  // edit always did, and FLUX.2 Pro's /edit joined it 2026-08-26. The guard
  // remains for any future lane that can't.
  if (
    wantsMultiCharacter &&
    contentType === "image" &&
    imageModelId !== "gpt-image" &&
    imageModelId !== "flux"
  ) {
    return {
      error:
        "Combining multiple characters in one image needs GPT Image 2 or Flux 2 Pro as the image model — " +
        "ask an admin to switch it in Admin > AI Providers, or remove the extra characters.",
    };
  }

  // The composer lets the user pick a video model per generation (see
  // generate-form.tsx); that choice arrives here as video_model_id and
  // overrides the admin's global default (Admin > AI Providers) for this
  // one request. Falls back to the admin default for image generations,
  // multi-angle requests that didn't send one, and anything invalid.
  const requestedVideoModelId = (formData.get("video_model_id") as string) || "";
  const adminDefaultVideoModelId = videoModelSetting?.value ?? "kling";
  // Free-tier accounts are pinned to the cheapest model regardless of what
  // was requested. Without this, one free user choosing Veo would cost ~$3.40
  // in a day budgeted at ~$0.29 (see the daily-trial note in plans.ts) — the
  // free allowance is counted in generations (one a day), which only equals
  // cost if every free generation is the same price. Silently downgrading
  // rather than erroring: a trial user hitting "that model needs a plan"
  // before they've seen a single result learns nothing about the product.
  //
  // Purchased top-up credits count as paid, same as a plan or bonus credits.
  // Credit packs are deliberately sellable to plan-less accounts (see
  // stripe/credit-packs.ts), and checkGenerationAllowance spends purchased
  // credits on any model at its real multi-credit weight — its own copy
  // advertises exactly that ("some models cost more than 1 per video... top
  // up"). Before this check the composer still pinned those buyers to the
  // trial's cheapest-model/short/silent shape, making every credit above the
  // first per video unspendable. The trial-mispricing worry doesn't apply:
  // core.ts only spends a free trial slot on a request within the trial's
  // own pinned cost (FREE_TIER_GENERATION_CREDITS), so an unpinned render
  // above that always draws on the credits they bought.
  const isFreeTierAccount =
    (userProfile?.plan ?? "none") === "none" &&
    (userProfile?.bonus_credits ?? 0) === 0 &&
    (userProfile?.purchased_credits ?? 0) === 0 &&
    userProfile?.role !== "admin";
  let videoModelId = isFreeTierAccount
    ? FREE_TIER_VIDEO_MODEL_ID
    : contentType === "video" && VIDEO_MODELS.some((m) => m.id === requestedVideoModelId)
      ? requestedVideoModelId
      : adminDefaultVideoModelId;
  const activeVideoModel = getVideoModel(videoModelId);

  // The free trial is pinned to the cheapest model at its default duration
  // (FREE_TIER_GENERATION_CREDITS worth) — no long durations and no dialogue
  // (dialogue fires extra paid ElevenLabs TTS + Sync Labs lipsync calls).
  // Without this a single free generation could cost several credits' worth
  // of provider spend while only spending the day's single trial slot.
  // Enforced server-side regardless of what the form sends.
  if (
    isFreeTierAccount &&
    contentType === "video" &&
    (wantsDialogue ||
      (Number(formData.get("video_duration_seconds")) || 0) > getDefaultDurationSeconds(activeVideoModel))
  ) {
    return {
      error:
        "Dialogue and longer videos are part of a paid plan — the free trial makes short, silent clips. Pick a plan to unlock them.",
    };
  }

  // Duration is a per-generation choice too (see generate-form.tsx), same
  // pattern as the model picker — but never trust the raw number a form
  // could send: only accept it if it's actually one of this model's real
  // fal.ai duration options, otherwise fall back to that model's default
  // rather than silently sending fal.ai a value it might reject.
  const requestedDurationSeconds = Number(formData.get("video_duration_seconds"));
  let videoDurationSeconds =
    contentType === "video" && isValidDuration(activeVideoModel, requestedDurationSeconds)
      ? requestedDurationSeconds
      : getDefaultDurationSeconds(activeVideoModel);

  // Pricier models — and longer durations within a model — cost more of the
  // user's monthly plan allowance than the 5s baseline. Resolved once here
  // so both the allowance check below and the row we save afterward agree
  // on the same number.
  //
  // Dialogue adds a surcharge on top: it runs ElevenLabs speech plus a Sync
  // Labs lipsync re-render, neither of which a silent video touches. See
  // getDialogueCreditWeight for why that's scaled by duration rather than by
  // the model's own weight.
  let creditWeight =
    contentType === "video"
      ? getDurationCreditWeight(activeVideoModel, videoDurationSeconds) +
        (wantsDialogue ? getDialogueCreditWeight(videoDurationSeconds) : 0)
      : 1;

  // Storyboard pricing: total seconds at the model's real per-second rate,
  // over the established $0.28/credit basis, rounded UP — the same formula
  // behind every duration weight in the catalog, just computed for an
  // arbitrary total instead of a preset. The duration enum check below is
  // skipped: per-shot lengths were validated at parse (1-15s each, ≤30s
  // total), and videoDurationSeconds becomes the TOTAL so the saved row and
  // any dialogue math stay honest.
  if (storyboardShots) {
    if (videoModelId !== "kling-o3-pro") {
      return { error: "Storyboards run on Kling O3 Pro — switch the model, or clear the storyboard." };
    }
    if (wantsDialogue) {
      return { error: "Storyboards and spoken dialogue can't combine yet — remove one." };
    }
    const totalSeconds = storyboardShots.reduce((n, s) => n + s.seconds, 0);
    videoDurationSeconds = totalSeconds;
    creditWeight = Math.ceil((totalSeconds * (activeVideoModel.costPerSecondUsd ?? 0.14)) / 0.28);
  }

  // Aspect ratio — resolution order (real incident, 2026-08-07: a user typed
  // "16:9, no side bars" into their prompt and still got a pillarboxed video,
  // because the model in use had no parameter that could have honored it —
  // see fal.ts's reframe workaround for Kling O3). An explicit ratio
  // mentioned in what the person actually typed always wins over whatever
  // icon they clicked in the composer — if you SAY vertical, that should
  // apply even if 16:9 is still selected from an earlier generation. Only
  // falls back to the icon pick, then the 16:9 default, when the prompt
  // itself doesn't say anything either way.
  const requestedAspectRatio = (formData.get("video_aspect_ratio") as string) || "";
  const iconAspectRatio: VideoAspectRatio | null =
    requestedAspectRatio === "16:9" || requestedAspectRatio === "9:16" ? requestedAspectRatio : null;
  const promptAspectRatio = contentType === "video" ? detectAspectRatioFromPrompt(userInput) : null;
  const videoAspectRatio: VideoAspectRatio = promptAspectRatio ?? iconAspectRatio ?? "16:9";

  // Optional free resolution upgrade (2026-08-30). Validated against the
  // FINAL model further down, once the circuit breaker and any server-side
  // pin have had their say — asking for 1080p on Veo and being rerouted to
  // Kling must not smuggle a resolution parameter into an endpoint that has
  // none. Only ever resolves to a resolution the provider bills at the same
  // rate as its default, so this cannot change what a generation costs.
  const requestedResolution = (formData.get("video_resolution") as string) || "";

  // Did the person send this AFTER being shown the policy warning?
  //
  // The composer arms this one-shot, bound to the exact prompt it was shown
  // for (same discipline as skip_brand_rules), so it can never leak to a
  // different send. Its only effect is on the refund decision: a provider
  // refusal normally force-refunds past the automatic_refunds switch because
  // it provably cost nothing, but a refusal someone was warned about and
  // chose anyway is a decision, not an accident, and keeps its credit.
  const policyWarningAcknowledged = formData.get("acknowledge_policy_warning") === "1";

  // Circuit breaker, checked BEFORE any credit is spent or any provider call
  // is made. A model that has failed three times in a row (across at least two
  // accounts) is out of service, and rather than turning the person away we
  // route them to a healthy model of the same kind. See model-health.ts for
  // why failover beats blocking — chiefly that free accounts are pinned to one
  // model, so blocking would make "under maintenance" the first thing every
  // new signup sees.
  //
  // Candidates are ordered cheapest-first on purpose: falling a free-tier user
  // over to Veo would turn a EUR0 trial into several euros of spend.
  const modelCandidates =
    contentType === "video"
      ? VIDEO_MODELS_BY_PRICE.map((m) => ({ id: m.id, name: m.name }))
      : IMAGE_MODELS.map((m) => ({ id: m.id, name: m.name }));

  const resolved = await resolveModel(
    contentType === "video" ? videoModelId : imageModelId,
    modelCandidates,
  );
  if (!resolved.ok) return { error: resolved.message };

  if (contentType === "video") videoModelId = resolved.modelId;
  else imageModelId = resolved.modelId;
  const substitutedFrom = resolved.substitutedFrom;

  // Re-price for the model actually used. resolveModel above may have failed
  // the user over to a DIFFERENT model when their pick was out of service, but
  // the credit weight and duration were computed against the ORIGINAL pick —
  // so without this, both the allowance check below and the credits_used saved
  // on the row would charge the old model's price for a render on the new one.
  // Substitution is cheapest-first, so this most often LOWERS the charge, but
  // the row must record what was actually rendered either way. Only the
  // resolved model's real durations are valid, so a duration the old model
  // allowed but the new one doesn't falls back to the new model's default (and
  // the placeholder row saves this same resolved duration below).
  if (contentType === "video" && substitutedFrom && !storyboardShots) {
    // (!storyboardShots: a storyboard's weight is computed above from total
    // seconds, and a substitution away from O3 Pro already errored — this
    // enum-based recompute would silently misprice it.)
    const substitutedModel = getVideoModel(videoModelId);
    if (!isValidDuration(substitutedModel, videoDurationSeconds)) {
      videoDurationSeconds = getDefaultDurationSeconds(substitutedModel);
    }
    creditWeight =
      getDurationCreditWeight(substitutedModel, videoDurationSeconds) +
      (wantsDialogue ? getDialogueCreditWeight(videoDurationSeconds) : 0);
  }

  // Resolution, priced (2026-08-30). Resolved HERE, deliberately after the
  // circuit breaker has had its say, against the model that will actually
  // render — so a 4K request on Veo that gets failed over to Kling neither
  // charges the 4K surcharge nor sends a parameter Kling has never heard of.
  //
  // resolutionCreditWeight returns the TOTAL weight for the duration at that
  // resolution, or null when the resolution costs nothing extra (1080p on
  // Veo) or is not offered at all — in which case the duration weight
  // computed above stands untouched. The dialogue surcharge rides on top of
  // whichever base applies, exactly as before.
  const videoResolution =
    contentType === "video" ? resolveVideoResolution(videoModelId, requestedResolution) : null;
  if (videoResolution && !storyboardShots) {
    const resolutionWeight = resolutionCreditWeight(
      videoModelId,
      videoResolution,
      videoDurationSeconds,
    );
    if (resolutionWeight !== null) {
      creditWeight =
        resolutionWeight + (wantsDialogue ? getDialogueCreditWeight(videoDurationSeconds) : 0);
    }
  }

  // Start/end frames ride the storyboard endpoint, which bills higher than
  // the base Kling weight assumes — see storyboardFrameExtraCredits for the
  // real prices. Charged AFTER substitution, on the exact conditions
  // buildVideoRequest uses to pick that endpoint (final model is kling, no
  // 2+ multi-reference riding, a frame actually present), so the charge and
  // the endpoint can never disagree. Every render on this lane before today
  // was billed $0.49 against a $0.28 charge — a loss on each one
  // (2026-08-31 inspection).
  if (
    contentType === "video" &&
    !storyboardShots &&
    videoModelId === "kling" &&
    referencePhotoPaths.length < 2 &&
    (storyboardStartPath || storyboardEndPath)
  ) {
    creditWeight += storyboardFrameExtraCredits(videoModelId, videoDurationSeconds);
  }

  // Clip continuation, validated and PRICED here — before the reservation.
  //
  // Two separate bugs lived in the old placement (2026-08-31 inspection).
  // The validation used to run AFTER reserve_generation, and its error
  // `return`s skipped the catch that refunds — a rejected continuation
  // stranded a fully charged row at 'generating' forever. And it was never
  // priced at all: fal bills the SOURCE clip's duration too ("If video
  // inputs are provided the price is multiplied by 0.6 ... charged for both
  // input and output videos"), which the old fal.ts comment flatly denied.
  // Two production continuations each cost $3.72 against a $1.68 charge.
  // Same stranding class, same fix: this conflict is knowable from the raw
  // paths at parse time, so it must refuse BEFORE the reservation — its old
  // home was past the charge, where a plain `return` skipped the refund.
  if (storyboardShots && (storyboardStartPath || storyboardEndPath)) {
    return { error: "Storyboards and start/end frames can't combine — remove one." };
  }

  let continuationSourceUrl: string | null = null;
  const continueFromGenerationId = ((formData.get("continue_from_generation_id") as string) || "").trim();
  if (continueFromGenerationId && contentType === "video") {
    if (videoModelId !== "seedance" && videoModelId !== "seedance-2") {
      return {
        error:
          "Continuing a clip works with the Seedance models — pick Seedance 2.0 (or 2.5 for illustrated characters), or clear the continuation.",
      };
    }
    const { data: prior } = await supabase
      .from("generations")
      .select("id, user_id, content_type, status, result_url, video_duration_seconds")
      .eq("id", continueFromGenerationId)
      .single();
    const priorUrl = prior ? toMediaUrl(prior.result_url) : null;
    if (
      !prior ||
      prior.user_id !== userData.user.id ||
      prior.content_type !== "video" ||
      prior.status !== "succeeded" ||
      !priorUrl ||
      !isRenderableUrl(priorUrl)
    ) {
      return { error: "That clip can't be continued — it must be one of your own finished videos." };
    }
    // The source's length IS the price, so a source whose length was never
    // recorded cannot be priced — refuse it plainly rather than guessing in
    // either direction. Only rows from before duration tracking lack it.
    const sourceSeconds = Number(prior.video_duration_seconds ?? 0);
    if (!sourceSeconds) {
      return {
        error:
          "That clip predates length tracking, so continuing from it can't be priced — pick a newer clip.",
      };
    }
    creditWeight += continuationExtraCredits(videoModelId, videoDurationSeconds, sourceSeconds);
    continuationSourceUrl = absolutizeMediaUrl(priorUrl, await getOrigin());
  }

  // A model whose fal endpoint starts from a frame (image/reference-to-video)
  // cannot run without one. Checked on the RESOLVED model — the circuit breaker
  // may have substituted the user's text-to-video pick into a frame-requiring
  // one (or vice-versa) — and before any credit is spent, so we never charge
  // for a render that could never start. This replaces the old kling-o3-only
  // guard that ran BEFORE substitution and so both missed a substituted-in
  // requirement and could wrongly reject a pick that got substituted away.
  if (
    contentType === "video" &&
    requiresReferenceImage(getVideoModel(videoModelId)) &&
    !attachmentReferenceUrl &&
    !character?.reference_image_urls?.[0]
  ) {
    return {
      error: `${getVideoModel(videoModelId).name} needs a reference photo — add one to this character, attach a photo to this message, or pick a different model.`,
    };
  }

  let allowance = await checkGenerationAllowance(supabase, userData.user.id, creditWeight);
  if (allowance.error) return { error: allowance.error };
  const userPlan = allowance.plan;
  const isAdmin = allowance.isAdmin;
  // Reassignable: the atomic reservation below may lose the monthly race and
  // re-decide (a request that fit the plan allowance a moment ago might now
  // need purchased credits), so the values the guarded spends use come from the
  // iteration that actually won the reservation.
  let consumePurchased = allowance.consumePurchased;
  let consumeFree = allowance.consumeFree;

  // Multi-image reference and storyboard are Studio-and-up. Checked here,
  // server-side, so this can't be bypassed by a direct call even though the
  // UI already hides the toggle for lower plans. (Moved down from Elite-only
  // on 2026-08-12 — keep in sync with workspace-data.ts and lib/pricing.ts.)
  if (wantsAdvancedVideoOptions && userPlan !== "studio" && userPlan !== "elite" && !isAdmin) {
    return {
      error:
        "Multi-image reference and storyboard are available on the Studio and Elite plans. Upgrade to use them, or turn these options off.",
    };
  }

  // Multi-image reference and storyboard are specific to Kling 1.6's
  // "elements"/storyboard endpoints — Kling O3 and Veo have no equivalent
  // wired up here. Catch this before spending a generation attempt, not
  // after a wasted paid call that silently ignores the options.
  if (wantsAdvancedVideoOptions && videoModelId !== "kling") {
    return {
      error:
        "Multi-image reference and storyboard need Kling 1.6 as the selected video model — " +
        "switch models, or turn these options off.",
    };
  }

  // Multiple characters in one video reuses Kling 1.6's "elements" endpoint
  // (the same one multi-image reference above uses) — Kling O3 and Veo have
  // no equivalent multi-subject compositing wired up here.
  if (wantsMultiCharacter && contentType === "video" && videoModelId !== "kling") {
    return {
      error:
        "Using multiple characters together needs Kling 1.6 as the selected video model — " +
        "switch models, or remove the extra characters.",
    };
  }

  if (useRealProviders) {
    const missingKeys = missingRealProviderKeys(contentType, imageModelId);
    if (missingKeys.length > 0) {
      return {
        error:
          `Real AI providers are turned on but missing: ${missingKeys.join(", ")}. ` +
          `Add them to .env.local, or turn the flag off in Admin > Feature flags to use the mock pipeline.`,
      };
    }
  }

  // Outfit-on-the-character (2026-08-24): on unless the composer's chip
  // explicitly said off — an absent field (older cached composer) keeps the
  // saved outfit applying, since outfit photos only exist when the user
  // deliberately added them. The vision-written description feeds DRAFTING
  // here for every model; the outfit PHOTO itself is signed further down and
  // attached only on the models whose endpoints can take it.
  const useOutfit = formData.get("use_outfit") !== "0";
  // Cinema preset (2026-08-26): resolved from id to its fixed, pre-proven
  // block HERE — the pipeline only ever sees our own tested text, never a
  // client-supplied string. Gated to the lane the matrix proved (Seedance
  // video, plain sends); anywhere else — and any unknown or stale id — is
  // a silent no-op, so an old client can never lose a render over it.
  // Comma-separated since stacking (one per category, resolved and ordered
  // by resolvePresetBlocks — the pipeline still receives ONE joined block of
  // our own tested text).
  const cinemaPresetIdRaw = String(formData.get("cinema_preset_id") ?? "").trim();
  const cinemaPresetBlock =
    cinemaPresetIdRaw &&
    contentType === "video" &&
    (videoModelId === "seedance" || videoModelId === "seedance-2")
      ? resolvePresetBlocks(cinemaPresetIdRaw.split(","))
      : null;
  const characterOutfitPaths = ((character?.outfit_image_urls as string[] | null) ?? []).filter(
    (p) => character && p.startsWith(`${character.user_id}/`),
  );
  const outfitActiveForCharacter =
    useOutfit && !wantsMultiCharacter && characterOutfitPaths.length > 0;

  // The empty-name placeholder is what tells pipeline.ts "no character was
  // selected" — draft()/buildRulebook() there both special-case an empty
  // name rather than writing an awkward "Character: ." into the prompt.
  const characterForPipeline = character
    ? {
        name: character.name,
        traits: character.traits ?? {},
        motion_style: character.motion_style,
        voice_tone_tags: character.voice_tone_tags ?? [],
        outfit_reference_description: outfitActiveForCharacter
          ? ((character.outfit_description as string | null) ?? null)
          : null,
      }
    : { name: "", traits: {}, motion_style: null, voice_tone_tags: [] };

  // Every companion, in the same shape — handed to runRealPipeline so it can
  // inject each one's name/traits into the compiled prompt text. That's the
  // only channel available to help the model tell characters apart: fal.ai's
  // elements/edit endpoints take a flat array of reference images with no
  // per-image identity tag pairing an image to a name.
  const companionsForPipeline = companionCharacters.map((c) => ({
    name: c.name,
    traits: c.traits ?? {},
    motion_style: c.motion_style,
    voice_tone_tags: c.voice_tone_tags ?? [],
  }));

  // Save an "in progress" row up front — there's always a record even if this
  // never gets past "generating".
  //
  // The insert goes through reserve_generation, an atomic per-user reservation:
  // it re-sums this window's usage and inserts the row only if this request's
  // MONTHLY portion still fits under one advisory lock. The old read-then-insert
  // let a concurrent burst all read the same usage and all pass the plan cap.
  // A request covered by purchased/free credits passes monthlyPortion 0 and is
  // never blocked here — those spends are guarded atomically just below. If the
  // reservation loses the monthly race it returns null; we re-decide against the
  // fresh usage (which may now route to purchased credits) and retry.
  const admin = createAdminClient();
  let placeholderId: string | null = null;
  for (let attempt = 0; attempt < 5 && !placeholderId; attempt++) {
    if (attempt > 0) {
      const reAllowance = await checkGenerationAllowance(supabase, userData.user.id, creditWeight);
      if (reAllowance.error) return { error: reAllowance.error };
      allowance = reAllowance;
      consumePurchased = reAllowance.consumePurchased;
      consumeFree = reAllowance.consumeFree;
    }

    const monthlyPortion =
      isAdmin || consumeFree ? 0 : Math.max(0, creditWeight - (consumePurchased ?? 0));

    const reservationRow = {
      id: clientGenerationId || crypto.randomUUID(),
      character_profile_id: characterId || null,
      character_profile_ids: wantsMultiCharacter ? [characterId, ...companionCharacterIds] : [],
      prompt_input: userInput,
      content_type: contentType,
      status: "generating",
      attempts: 0,
      result_url: null,
      pipeline_log: [],
      video_model_id: contentType === "video" ? videoModelId : null,
      // The model that rendered this, for BOTH content types (2026-08-30).
      // video_model_id stays exactly as it was so existing reporting is
      // untouched; model_id is the column you can actually GROUP BY.
      //
      // Why it had to exist: images were the only content type that got an
      // identity score, and images recorded no model anywhere — there was no
      // image model column at all. Video recorded a model and was never
      // scored. So the score and the model sat on opposite sides of a divide
      // nothing crossed, and "which model holds this character's face best"
      // was unanswerable from this table in either direction.
      //
      // Safe before the column exists: reserve_generation builds its row with
      // jsonb_populate_record, which silently drops keys that match no
      // column. If pending-2026-08-30/identity-scoring.sql hasn't run yet this
      // is a no-op rather than a failed insert.
      //
      // Records the SELECTED model. The image lane can fall back GPT → FLUX
      // on a safety rejection and the pipeline reports that only as a display
      // name in the step log, so pipeline_log stays the tiebreaker for those
      // rows until the pipeline returns the id it actually used.
      model_id: contentType === "video" ? videoModelId : imageModelId,
      video_duration_seconds: contentType === "video" ? videoDurationSeconds : null,
      video_aspect_ratio: contentType === "video" ? videoAspectRatio : null,
      credits_used: creditWeight,
      // Recorded so a failure can refund exactly what this row consumed
      // from the two profile-side credit sources (see refundGenerationCosts).
      purchased_credits_used: consumePurchased ?? 0,
      free_generation_used: !!consumeFree,
      // The chat-attachment storage paths that rode this send (2026-08-31).
      // Until now the row recorded nothing about them, so deleting a
      // generation could never clean its uploads and the bucket only ever
      // grew. Same pre-SQL safety as model_id above: jsonb_populate_record
      // drops the key until pending-2026-08-31/hygiene.sql adds the column.
      attachments: attachmentStoragePaths,
    };

    const { data: reservedId, error: reserveError } = await admin.rpc("reserve_generation", {
      p_user_id: userData.user.id,
      p_monthly_portion: monthlyPortion,
      p_limit: allowance.monthlyLimit ?? 0,
      p_since: allowance.periodStartIso ?? new Date(0).toISOString(),
      p_row: reservationRow,
    });
    if (reserveError) {
      console.error("reserve_generation failed:", reserveError);
      return { error: "Couldn't start this generation — try again." };
    }
    if (reservedId) placeholderId = reservedId as string;
    // else: another request took the monthly headroom — loop and re-decide.
  }

  if (!placeholderId) {
    return { error: "You've used all the credits included in your plan this month." };
  }

  // Downstream code refers to placeholder.id; keep that shape.
  const placeholder = { id: placeholderId };

  // Guarded spends: if a concurrent request already took the last credit / free
  // generation, these return false and we abort BEFORE any paid provider call.
  // Nothing has run, so this placeholder's charge is released (credits_used 0).
  const purchasedOk = await consumePurchasedCredits(supabase, userData.user.id, consumePurchased ?? 0);
  const freeOk = consumeFree ? await consumeFreeGeneration(supabase, userData.user.id) : true;
  if (!purchasedOk || !freeOk) {
    const { error: releaseError } = await createAdminClient()
      .from("generations")
      .update({
        status: "failed",
        credits_used: 0,
        purchased_credits_used: 0,
        free_generation_used: false,
        progress_stage: null,
      })
      .eq("id", placeholder.id);
    // A silent failure here has real cost: the row would keep counting against
    // the monthly meter for a generation that never ran. Nothing better to do
    // than say so loudly — the orphaned-generation reaper (reapStaleJobs) is
    // the backstop that eventually fails-and-releases a row stuck like this.
    if (releaseError) {
      console.error("Guarded-spend abort couldn't release the placeholder charge:", {
        generationId: placeholder.id,
        error: releaseError.message,
      });
    }
    return {
      error: consumeFree
        ? "You've used today's free generation — it comes back tomorrow. Top up credits or pick a plan to keep going."
        : "You're out of credits — that request couldn't be covered.",
    };
  }

  let attempts: AttemptLog[] = [];
  let rulesBlock: { label: string; evidence: string; fix: string }[] | null = null;
  let succeeded = false;
  let finalPrompt = "";
  let resultUrl: string | null = null;
  // Set the moment the pipeline hands back a queued fal job, BEFORE the
  // bookkeeping (saveVideoJob etc.) that can still throw. If that bookkeeping
  // fails, the catch below fails the row and refunds — but without also
  // cancelling at fal, the already-submitted render would keep running (and
  // billing) with nothing left on our side that could ever collect it.
  let pendingJobToCancel: QueuedJob | null = null;

  try {
    if (useRealProviders) {
      // Anchor to the character's first saved reference photo (if they have
      // one) so the result actually looks like them. Image generation has
      // always done this; video generation needs the exact same treatment —
      // without it, a video request only ever gets a text description of
      // the character, and Kling has to invent a face from adjectives (real
      // incident, 2026-08-07: this is why a video generated "as" a specific
      // saved character came back as a visibly different person). This is
      // deliberately NOT gated behind wantsAdvancedVideoOptions/Elite below —
      // that gate is for the multi-photo/storyboard EXTRAS, not for this
      // baseline "look like the character" behavior every plan should get.
      let referenceImageUrl: string | null = null;
      let videoCharacterAnchorUrl: string | null = null;
      // Multi-character mode resolves the primary's photo down in the cast
      // loop below instead (it needs to go into referenceImageUrls /
      // videoReferenceImageUrls alongside the companions', not the single-
      // character anchor fields), so this baseline anchor is skipped there.
      if (!wantsMultiCharacter) {
        let anchorUrl: string | null = null;
        if (attachmentReferenceUrl) {
          // The person attached a specific photo to this message — that
          // intent wins over the character's saved default for this request.
          // Media URLs are relative; the providers fetch them over the open
          // internet, so hand them out absolute.
          anchorUrl = absolutizeMediaUrl(attachmentReferenceUrl, await getOrigin());
        } else {
          // Otherwise, an explicitly picked photo from the character's own
          // gallery beats just always grabbing the first one — but only if
          // it's genuinely one of this character's saved photos. character
          // is null when no character was selected — every access below is
          // optional-chained, leaving anchorUrl/chosenPath null in that case
          // (a plain text-to-image/video generation, or one anchored purely
          // to an attachment, both already handled above).
          const chosenPath =
            requestedAnchorPhotoPath && character?.reference_image_urls?.includes(requestedAnchorPhotoPath)
              ? requestedAnchorPhotoPath
              : character?.reference_image_urls?.[0];
          if (chosenPath) {
            const { data: signed } = await supabase.storage
              .from("character-references")
              .createSignedUrl(chosenPath, 60 * 10);
            anchorUrl = signed?.signedUrl ?? null;
          }
        }
        if (contentType === "image") {
          referenceImageUrl = anchorUrl;
        } else {
          videoCharacterAnchorUrl = anchorUrl;
        }
      }

      // Resolve advanced-option storage paths to short-lived signed URLs —
      // fal.ai needs to be able to fetch these over the open internet, and
      // the character-references bucket is private. A sign failure on one
      // photo just drops that photo rather than failing the whole request;
      // multi-reference still needs 2+ to survive that filter to be useful.
      let videoReferenceImageUrls: string[] | undefined;
      let videoStartImageUrl: string | null = null;
      let videoEndImageUrl: string | null = null;
      // The image-generation equivalent of videoReferenceImageUrls above —
      // one photo per selected character, passed to OpenAI's multi-image
      // edit endpoint. Only ever set in multi-character mode; single-
      // character images keep using referenceImageUrl (singular) exactly as
      // before.
      let referenceImageUrls: string[] | undefined;

      if (wantsMultiCharacter) {
        // Already validated above that every selected character — primary
        // included — has at least one reference photo. Sign each one, in
        // the order they were picked, so the model has a real photo of
        // every participant to work from. wantsMultiCharacter can only be
        // true when a primary character is set (validated earlier in this
        // function, in the block right after companion ids are parsed) —
        // TS just can't see that far back, hence the assertion.
        const cast = [character!, ...companionCharacters];
        const signedUrls = await Promise.all(
          cast.map(async (c) => {
            // Every cast member was already confirmed to have a photo above
            // (the missingPhoto check) — the "" fallback only exists to
            // satisfy TypeScript, createSignedUrl("") will just fail and get
            // filtered out below same as any other sign failure.
            const { data: signed } = await supabase.storage
              .from("character-references")
              .createSignedUrl(c.reference_image_urls?.[0] ?? "", 60 * 10);
            return signed?.signedUrl ?? null;
          }),
        );
        const resolvedUrls = signedUrls.filter((u): u is string => Boolean(u));
        if (resolvedUrls.length < 2) {
          throw new Error("Couldn't prepare the selected characters' photos — try again.");
        }
        if (contentType === "video") {
          videoReferenceImageUrls = resolvedUrls;
        } else {
          referenceImageUrls = resolvedUrls;
        }
      } else if (
        // BASELINE MULTI-REFERENCE (2026-08-30). Every render used to send
        // the model exactly ONE photo — see the anchor resolution above,
        // which picks reference_image_urls[0] (or the one the person tapped)
        // and stops. Meanwhile buildVideoRequest has always been built to
        // take four: `referenceImageUrls.slice(0, 4)` in fal.ts, falling
        // through to a single-element array only because nothing ever
        // populated the plural field on an ordinary send.
        //
        // So a character with eight saved photos, on a model that accepts
        // four identity references, was being described to that model by
        // one photo. The extra photos were sitting in the row, already
        // signed-URL-able, already paid for. This is the cheapest identity
        // accuracy available anywhere in the product: no new provider, no
        // new credential, no per-render cost on the Kling elements lane.
        //
        // Gated on the capability matrix rather than a model-id list so it
        // can never drift from what each endpoint actually accepts:
        //   - kling / kling-o3-pro  -> "elements", max 4  ✓ helped
        //   - seedance / seedance-2 -> "citation", max 4   ✓ helped
        //   - kling-o3 / kling-2.5  -> "first-frame", max 1 ✗ skipped:
        //     the photo IS frame one, so a second photo has nowhere to go
        //   - veo                   -> mechanism "none"     ✗ skipped
        //
        // Deliberately does NOT fire when the person attached a photo to
        // this message: that attachment is their intent for this one render
        // and stays the sole reference, exactly as before.
        //
        // This is the baseline "look like the character" behaviour the
        // comment above says every plan should get — not the Studio-gated
        // multi-photo EXTRA, which is the user hand-picking specific photos
        // and pairing them with storyboard frames, and which stays gated.
        contentType === "video" &&
        !attachmentReferenceUrl &&
        !wantsAdvancedVideoOptions &&
        baselineIdentityReferences(
          videoModelId,
          (character?.reference_image_urls ?? []) as string[],
          requestedAnchorPhotoPath,
        ).length >= 2
      ) {
        // Which photos, in which order — decided by the capability matrix in
        // send-plan.ts (tested there), so this can never drift from what the
        // endpoint actually accepts.
        const ordered = baselineIdentityReferences(
          videoModelId,
          (character?.reference_image_urls ?? []) as string[],
          requestedAnchorPhotoPath,
        );
        const signed = await Promise.all(
          ordered.map(async (path) => {
            const { data } = await supabase.storage
              .from("character-references")
              .createSignedUrl(path, 60 * 10);
            return data?.signedUrl ?? null;
          }),
        );
        const usable = signed.filter((u): u is string => Boolean(u));
        // A sign failure on one photo just drops that photo. Below two there
        // is nothing multi-reference about the send, so fall back to the
        // single-anchor path that was already resolved above rather than
        // sending a one-element array down a different code path.
        if (usable.length >= 2) videoReferenceImageUrls = usable;
      } else if (wantsAdvancedVideoOptions) {
        if (referencePhotoPaths.length >= 2) {
          const signedUrls = await Promise.all(
            referencePhotoPaths.map((path) => resolveMaybeSignedUrl(supabase, path)),
          );
          videoReferenceImageUrls = signedUrls.filter((u): u is string => Boolean(u));
          if (videoReferenceImageUrls.length < 2) videoReferenceImageUrls = undefined;
        } else {
          if (storyboardStartPath) {
            videoStartImageUrl = await resolveMaybeSignedUrl(supabase, storyboardStartPath);
          }
          if (storyboardEndPath) {
            videoEndImageUrl = await resolveMaybeSignedUrl(supabase, storyboardEndPath);
          }
        }
      }

      // Clip continuation: validated and priced BEFORE the reservation (see
      // the block above the reserve) — only the already-verified URL is
      // consumed here.
      const videoContinueFromUrl: string | null = continuationSourceUrl;


      // The outfit PHOTO attaches only where an endpoint genuinely takes a
      // clothing reference — Seedance's cited image_urls and GPT Image's
      // multi-image edit — and only beside an identity anchor, so a clothing
      // shot can never BE the identity (the 2026-08-24 support case). Models
      // outside this set still carry the outfit through the drafted prompt's
      // description (see characterForPipeline above).
      let outfitImageUrl: string | null = null;
      {
        const identityAnchor =
          contentType === "image" ? referenceImageUrl : videoCharacterAnchorUrl;
        const modelTakesOutfitPhoto =
          contentType === "image"
            ? imageModelId === "gpt-image" || imageModelId === "flux"
            : videoModelId === "seedance" || videoModelId === "seedance-2";
        // Plain path only (no storyboard, no multi-image reference) — it
        // matches what the composer's caption promises, and keeps Seedance's
        // reference list inside its 4-image budget.
        // Baseline multi-reference counts as an identity anchor: the refs
        // ARE the face. The old `!videoReferenceImageUrls` clause silently
        // skipped the outfit photo on exactly the sends the receipt said
        // carried it (2026-08-31); the budget trim below keeps Seedance's
        // 4-image ceiling honest instead.
        const plainPath =
          (Boolean(identityAnchor) || Boolean(videoReferenceImageUrls?.length)) &&
          !storyboardShots;
        if (plainPath && modelTakesOutfitPhoto) {
          if (outfitAttachmentUrl) {
            // A per-message outfit-role attachment (Send Receipt P2)
            // outranks the character's saved outfit for this send.
            outfitImageUrl = absolutizeMediaUrl(outfitAttachmentUrl, await getOrigin());
          } else if (outfitActiveForCharacter) {
            const { data: signedOutfit } = await supabase.storage
              .from("character-references")
              .createSignedUrl(characterOutfitPaths[0], 60 * 10);
            outfitImageUrl = signedOutfit?.signedUrl ?? null;
          }
        }
      }

      // Scene-role attachment (Send Receipt P2): a photo of a PLACE is
      // vision-described into the prompt — prompt text works on every
      // model, which is what makes this lane universal. Best-effort: a
      // describe failure just sends the prompt as typed (the strip said
      // "described", and an undescribed scene photo costs nothing).
      // Prop-role attachment (Send Receipt P5): on cited-image models the
      // photo itself rides beside the identity refs (YOUR dog, not "a dog");
      // elsewhere a short subject spec is written into the prompt. Both
      // lanes best-effort — a vision hiccup never blocks the render.
      let propImageUrl: string | null = null;
      let propDescription: string | null = null;
      // When the neutral attachment was promoted to the identity anchor
      // (no character selected — see attachmentReferenceUrl above), it must
      // not ALSO ride this lane: the same photo would reach the model twice,
      // once as the face and once as an extra image, spending part of the
      // model's image budget to say the same thing. Mirrors the send plan's
      // own "one photo, one slot" rule.
      const referencePromoted =
        Boolean(referenceAttachmentUrl) && referenceAttachmentUrl === attachmentReferenceUrl;
      const neutralUrl = (referencePromoted ? "" : referenceAttachmentUrl) || propAttachmentUrl;
      // No `!videoReferenceImageUrls` here any more (2026-08-31): baseline
      // multi-reference used to silently DROP the person's attachment while
      // the receipt said it rides. On cited-image models it rides beside the
      // identity refs (the budget trim below makes room); elsewhere it is
      // vision-described into the prompt, which multi-reference never
      // interfered with in the first place.
      if (neutralUrl && !wantsMultiCharacter && !storyboardShots) {
        const propTakesPhoto =
          contentType === "image"
            ? imageModelId === "gpt-image" || imageModelId === "flux"
            : videoModelId === "seedance" || videoModelId === "seedance-2";
        const absoluteProp = absolutizeMediaUrl(neutralUrl, await getOrigin());
        if (propTakesPhoto) {
          propImageUrl = absoluteProp;
        } else {
          try {
            propDescription = referenceAttachmentUrl
              ? await describeImageAsPrompt(absoluteProp, "standalone")
              : await describeSubjectImage(absoluteProp);
          } catch {
            // Send without it.
          }
        }
      }

      // Seedance's reference list is capped at 4 images total. When the
      // outfit or the attachment rides beside baseline multi-reference,
      // trim the identity refs to make room — dropping the LAST refs, never
      // the person's outfit/attachment, and never below the 2 that make the
      // send multi-reference at all. fal.ts's own guard would otherwise
      // silently drop the outfit/prop instead, which is the exact
      // receipt-vs-reality lie this exists to prevent.
      if (
        videoReferenceImageUrls &&
        (videoModelId === "seedance" || videoModelId === "seedance-2")
      ) {
        const extras = (outfitImageUrl ? 1 : 0) + (propImageUrl ? 1 : 0);
        if (extras > 0) {
          videoReferenceImageUrls = videoReferenceImageUrls.slice(
            0,
            Math.max(2, 4 - extras),
          );
        }
      }

      let promptForPipeline = userInput;
      if (propDescription) {
        promptForPipeline = `${promptForPipeline}\n\nThe user attached an image; its contents (use as the prompt above describes): ${propDescription}`;
      }
      if (sceneAttachmentUrl && !wantsMultiCharacter) {
        try {
          const sceneDescription = await describeImageAsPrompt(
            absolutizeMediaUrl(sceneAttachmentUrl, await getOrigin()),
            "scene",
          );
          if (sceneDescription) {
            promptForPipeline = `${promptForPipeline}\n\nSetting (from the attached scene photo): ${sceneDescription}`;
          }
        } catch {
          // Send as typed.
        }
      }

      // Send-plan parity check (P0, log-only): re-resolve this send through
      // the same pure module the composer's receipt strip renders from, and
      // log the verdict. Divergence between what this logs and what the
      // code below actually does is exactly the split-brain the redesign
      // exists to kill — these logs are how we prove parity before the
      // resolver becomes authoritative. Guarded so a resolver bug can never
      // cost anyone a render.
      try {
        const serverPlan = resolveSendPlan({
          contentType,
          modelId: contentType === "video" ? videoModelId : imageModelId,
          character: character
            ? {
                name: character.name as string,
                referencePhotoCount: ((character.reference_image_urls as string[] | null) ?? []).length,
                hasOutfit: characterOutfitPaths.length > 0,
                outfitOn: useOutfit,
                photoreal: null,
              }
            : null,
          companionsCount: companionCharacters.length,
          attachments: attachmentRoles
            ? attachmentRoles.map((a, i) => ({ id: String(i), isImage: true, role: a.role }))
            : attachmentReferenceUrl
              ? [{ id: "attachment", isImage: true }]
              : [],
          anchorPhotoPicked: Boolean(requestedAnchorPhotoPath),
          advancedMode:
            referencePhotoPaths.length >= 2
              ? "multiref"
              : storyboardStartPath || storyboardEndPath
                ? "storyboard"
                : "none",
          multiRefCount: referencePhotoPaths.length,
          storyboardStart: Boolean(storyboardStartPath),
          storyboardEnd: Boolean(storyboardEndPath),
          storyboardShotsActive: Boolean(storyboardShots),
          continueFromId: continueFromGenerationId || null,
          dialogueText: wantsDialogue ? dialogueText : "",
          dialogueVoiceAssigned: Boolean(dialogueVoiceId),
          durationSeconds: videoDurationSeconds,
          aspect: videoAspectRatio,
          rulesSkipArmed: formData.get("skip_brand_rules") === "1",
        });
        console.log(
          "[send-plan]",
          JSON.stringify({
            gen: placeholder.id,
            entries: serverPlan.entries.map((e) => `${e.slot}:${e.source}:${e.consumption}${e.noteCode ? `:${e.noteCode}` : ""}`),
            issues: serverPlan.issues.map((i) => `${i.severity}:${i.code}`),
          }),
        );
      } catch (planErr) {
        console.warn("[send-plan] resolver parity check failed:", planErr);
      }

      const result = await runRealPipeline(
        promptForPipeline,
        characterForPipeline,
        {
          contentType,
          videoModelId,
          imageModelId,
          referenceImageUrl,
          referenceImageUrls,
          videoReferenceImageUrls,
          videoStartImageUrl,
          videoEndImageUrl,
          videoCharacterAnchorUrl,
          videoContinueFromUrl,
          outfitImageUrl,
          propImageUrl,
          // ONLY when the photo ITSELF rides to the model (propImageUrl).
          // Deliberately not set for the described-attachment lanes (models
          // that can't take an extra image, and the scene role): there the
          // image's description is already appended to the prompt text
          // above, and warning the drafter off "describing what the
          // attachment supplies" would make it drop that description —
          // reintroducing the very bug this fixes, one lane over.
          hasAttachedReference: Boolean(propImageUrl),
          cinemaPresetBlock: storyboardShots ? null : cinemaPresetBlock,
          videoStoryboardShots: storyboardShots,
          companions: wantsMultiCharacter ? companionsForPipeline : undefined,
          dialogueText: wantsDialogue ? dialogueText : undefined,
          dialogueVoiceId: wantsDialogue ? dialogueVoiceId : undefined,
          videoDurationSeconds: contentType === "video" ? videoDurationSeconds : undefined,
          videoAspectRatio: contentType === "video" ? videoAspectRatio : undefined,
          videoResolution,
          skipRefinement,
        skipBrandProhibitions: formData.get("skip_brand_rules") === "1",
          policyWarningAcknowledged,
          brandRules: await loadBrandRules(supabase, userData.user!.id),
          persistImage: (base64) => persistGeneratedImage(supabase, userData.user!.id, base64),
          // Video renders get queued and polled instead of awaited — see
          // job-runner.ts. Images stay inline: a single bounded call that
          // finishes well inside one request and gains nothing from staging.
          submitVideoOnly: contentType === "video",
        },
        maxAttempts,
        // Polled between attempts so the Stop button (a separate, later call
        // to requestGenerationCancel) actually has an effect on this
        // already-running request instead of just being cosmetic.
        async () => {
          const { data } = await supabase
            .from("generations")
            .select("cancel_requested")
            .eq("id", placeholder.id)
            .single();
          return data?.cancel_requested === true;
        },
      );

      // The render is now sitting in fal.ai's queue. Record the handle and
      // hand back control immediately — the client takes it from here by
      // polling pollGeneration. Deliberately returns BEFORE the "succeeded /
      // failed" update below, because neither is true yet: the row stays at
      // "generating" and job-runner writes the real outcome when it lands.
      if (result.pendingVideoJob) {
        pendingJobToCancel = result.pendingVideoJob;
        // Say so when a substitution happened. Quietly rendering with a
        // different model than the one someone picked is the kind of thing
        // that reads as a bug when they notice — and they will notice.
        if (substitutedFrom) {
          result.attempts[result.attempts.length - 1]?.steps.push({
            step: "generate",
            detail: `${getVideoModel(substitutedFrom).name} was unavailable, so this was rendered with ${getVideoModel(videoModelId).name}.`,
          });
        }

        await saveVideoJob({
          generationId: placeholder.id,
          userId: userData.user.id,
          job: result.pendingVideoJob,
          dialogueText: wantsDialogue ? dialogueText : undefined,
          dialogueVoiceId: wantsDialogue ? dialogueVoiceId : undefined,
          attempts: result.attempts,
        });

        await createAdminClient()
          .from("generations")
          .update({ attempts: result.attempts.length, pipeline_log: result.attempts })
          .eq("id", placeholder.id);

        revalidatePath("/app/history");

        return {
          error: null,
          id: placeholder.id,
          succeeded: false,
          attempts: result.attempts,
          finalPrompt: result.finalPrompt,
          resultUrl: null,
          pending: true,
          progress: "Rendering your video",
        };
      }

      ({ attempts, succeeded, finalPrompt, resultUrl } = result);
      rulesBlock = result.rulesBlock ?? null;
    } else {
      const result = runPipeline(userInput, characterForPipeline, maxAttempts, contentType);
      ({ attempts, succeeded, finalPrompt, resultUrl } = result);
    }
  } catch (err) {
    // Belt-and-suspenders: runPipeline/runRealPipeline shouldn't throw
    // anymore (every provider call inside them is caught and recorded as a
    // failed attempt instead), but if something truly unexpected happens
    // here, fail this generation cleanly instead of crashing the request and
    // leaving the placeholder stuck at "generating" forever.
    //
    // If a fal render was already queued (saveVideoJob or the follow-up
    // bookkeeping threw AFTER the submit succeeded), tell fal to stop it —
    // otherwise the platform pays for an orphaned render nobody can ever
    // collect, since the row is about to be failed and refunded here.
    // cancelQueuedJob is best-effort and never throws.
    if (pendingJobToCancel) {
      await cancelQueuedJob(pendingJobToCancel);
    }
    const message = err instanceof Error ? err.message : "Something went wrong generating this.";
    const crashLog: AttemptLog[] = [
      {
        attempt: 1,
        steps: [{ step: "generate", detail: message }],
        passed: false,
        issues: ["unexpected_error"],
        compiledPrompt: "",
      },
    ];
    await createAdminClient()
      .from("generations")
      .update({ status: "failed", pipeline_log: crashLog })
      .eq("id", placeholder.id);
    // Our fault — give back everything this row consumed (monthly
    // allowance, purchased credits, free-trial generation).
    await refundGenerationCosts(placeholder.id);
    await autoReportFailedGeneration(placeholder.id, userData.user.id, crashLog);
    return { error: message };
  }

  // The terminal write, hardened on two 2026-08-31 findings.
  //
  // STATUS GUARD: keyed on status='generating' like job-runner's finish(),
  // so a row the person already stopped and had refunded cannot be
  // resurrected to 'succeeded' by this late write — discardStoppedGeneration
  // is wire-callable and the race was real.
  //
  // RETRIES: this one UPDATE is all that connects a paid, already-persisted
  // PNG to its row. When it failed once (a pooler blip), the function gave
  // up, the row sat at 'generating', the reaper later wrote it off as failed
  // WITH a refund — and the rendered image became an orphan we paid OpenAI
  // for. Three attempts with a short backoff before conceding.
  let terminalWrite: { error: { message: string } | null; count: number | null } = {
    error: { message: "not attempted" },
    count: null,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error, count } = await createAdminClient()
      .from("generations")
      .update(
        {
          status: succeeded ? "succeeded" : "failed",
          attempts: attempts.length,
          result_url: resultUrl,
          pipeline_log: attempts,
        },
        { count: "exact" },
      )
      .eq("id", placeholder.id)
      .eq("status", "generating");
    terminalWrite = { error: error ? { message: error.message } : null, count };
    if (!error) break;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }

  if (terminalWrite.error) {
    console.error(
      `inline terminal write failed 3x for ${placeholder.id}:`,
      terminalWrite.error.message,
    );
    // Last resort: park the storage path on the row so the render is
    // findable by support and the orphan sweep even though the status
    // write keeps failing.
    await createAdminClient()
      .from("generations")
      .update({ result_url: resultUrl })
      .eq("id", placeholder.id)
      .eq("status", "generating");
    return { error: "Finished, but couldn't save the result — try refreshing History in a moment." };
  }

  if (terminalWrite.count === 0) {
    // Zero rows matched: the row went terminal underneath us (a Stop +
    // discard while the pipeline ran). The discard already refunded;
    // resurrecting it or re-running the success bookkeeping would re-charge
    // a render the person was told was gone. Report it as the stop it was.
    return {
      error: null,
      id: placeholder.id,
      succeeded: false,
      attempts,
      finalPrompt,
      resultUrl: null,
    };
  }

  if (!succeeded) {
    // The pipeline couldn't produce a passing result after its retries —
    // exactly the case the published promise covers. Give everything back.
    // Two failure classes are force-refunded past the automatic_refunds
    // switch, both provably zero-provider-cost: a block by the user's OWN
    // rules (happens before any provider call — and the published listing
    // promises "nothing is charged when a rule blocks" unconditionally),
    // and a provider REJECTION (4xx: the request was refused before
    // anything generated — policy fences, input validation). Everything
    // that may have consumed real provider work stays behind the flag.
    await refundGenerationCosts(placeholder.id, {
      // ...unless the person was warned this exact send would be refused and
      // chose to send it anyway (2026-08-30). Then the refusal is a decision
      // they made with the reason in front of them, not something that
      // happened to them, and the credit stands.
      // forceRefundEligible is the single authority (refund-rules.ts) —
      // this and job-runner's finish() used to assemble the same rule by
      // hand and had drifted apart.
      force: Boolean(rulesBlock?.length) || forceRefundEligible(attempts),
    });
    await autoReportFailedGeneration(placeholder.id, userData.user.id, attempts);
  }

  // Characters v2: successful images are NOT auto-added to the character's
  // reference gallery anymore — see promoteGenerationToReference above. The
  // image lives in History either way; making it an identity anchor is now
  // the user's explicit call.

  // Characters v2: image-level identity verification. Best-effort — a
  // scoring hiccup never affects the generation itself.
  let matchScore: number | null = null;
  if (succeeded && contentType === "image" && characterId && isRenderableUrl(resultUrl)) {
    const identityPath = character?.reference_image_urls?.[0];
    if (identityPath) {
      const { data: signedIdentity } = await supabase.storage
        .from("character-references")
        .createSignedUrl(identityPath, 600);
      if (signedIdentity?.signedUrl) {
        const traitSummary = [
          character?.traits?.hair ? `hair: ${character.traits.hair}` : null,
          character?.traits?.distinguishing_features
            ? `distinguishing features: ${character.traits.distinguishing_features}`
            : null,
        ]
          .filter(Boolean)
          .join("; ");
        const verdict = await scoreIdentityMatch(
          absolutizeMediaUrl(resultUrl!, await getOrigin()),
          signedIdentity.signedUrl,
          traitSummary,
        );
        if (verdict && verdict.unusable) {
          // The provider claimed success but delivered a black/blank frame
          // (fal.ai's safety checker does exactly this — HTTP 200, image
          // replaced with black). Nobody should pay for a black rectangle,
          // and nobody should have to notice and report it either:
          // automatically mark it failed, refund everything it consumed,
          // and say so honestly in the pipeline log.
          succeeded = false;
          matchScore = null;
          attempts[attempts.length - 1]?.steps.push({
            step: "generate",
            detail:
              "Post-generation check found the finished image unusable (blank/black frame) — automatically marked failed and refunded.",
          });
          await createAdminClient()
            .from("generations")
            .update({
              status: "failed",
              // Cleared, or History keeps serving the black frame the row
              // was refunded FOR — two live rows were doing exactly that
              // (2026-08-31 inspection).
              result_url: null,
              match_score: verdict.score,
              match_notes: verdict.notes || "Unusable result (blank/black frame).",
              pipeline_log: attempts,
            })
            .eq("id", placeholder.id);
          await refundGenerationCosts(placeholder.id);
          await autoReportFailedGeneration(placeholder.id, userData.user.id, attempts);
        } else if (verdict) {
          matchScore = verdict.score;
          await createAdminClient()
            .from("generations")
            .update({ match_score: verdict.score, match_notes: verdict.notes || null })
            .eq("id", placeholder.id);
        }
      }
    }
  }

  revalidatePath("/app/generate");
  revalidatePath("/app/history");

  return {
    error: null,
    id: placeholder.id,
    succeeded,
    attempts,
    finalPrompt,
    resultUrl,
    matchScore,
    ...(rulesBlock && rulesBlock.length > 0 ? { rulesBlock } : {}),
  };
}

// Advances a queued video generation by one step, and reports where it got to.
//
// Called on a timer by the composer for as long as a generation is in flight.
// Each call is short — one status check against fal.ai, and at most one new
// job submitted — which is the entire point: no request has to survive the
// ten-plus minutes the render itself takes, so Vercel's 300s function ceiling
// stops mattering.
//
// Ownership is enforced by passing the caller's own user id down to
// advanceGeneration, which filters on it. That matters more here than usual:
// the orchestrator runs on the service-role client to reach generation_jobs
// (which has RLS enabled and no policies, so it's server-only), and the
// service role bypasses RLS, so this is the check.
export async function pollGeneration(generationId: string): Promise<
  { error: string } | ({ error: null } & AdvanceResult)
> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  // Deliberately NO revalidatePath here.
  //
  // It used to revalidate on every terminal state, and that broke multi-angle
  // (real incident, 2026-08-10). A revalidate inside a Server Action ships a
  // fresh RSC payload back and the router applies it immediately — so the
  // moment the first of three angles finished, the route refetched underneath
  // the two polls still in flight and aborted them. The client counted those
  // aborts as failures, gave up after fifteen, and reported two perfectly
  // healthy renders as failed while they carried on rendering at fal.
  //
  // Refreshing is the caller's job now: it does it once, after everything has
  // settled, instead of once per angle mid-flight.
  return { error: null, ...(await advanceGeneration(generationId, userData.user.id)) };
}

// Every generation of this user's that is still queued at the provider.
//
// The composer calls this on load and re-attaches its poller to whatever it
// finds, so a render survives the page being reloaded, the tab being closed
// and reopened, or — as actually happened on 2026-08-10 — the original
// request erroring out and abandoning three jobs that were already paid for.
//
// Reads generation_jobs (server-only, service role) rather than looking for
// status='generating', because that status alone can't distinguish "queued at
// fal and collectable" from "died before it ever reached the provider".
export async function listInFlightGenerations(): Promise<
  { id: string; prompt: string; contentType: ContentType }[]
> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const admin = createAdminClient();
  const { data: jobs } = await admin
    .from("generation_jobs")
    .select("generation_id")
    .eq("user_id", userData.user.id)
    .limit(12);

  const ids = (jobs ?? []).map((j) => j.generation_id as string);
  if (ids.length === 0) return [];

  const { data: rows } = await supabase
    .from("generations")
    .select("id, prompt_input, content_type")
    .in("id", ids)
    .eq("status", "generating");

  return (rows ?? []).map((r) => ({
    id: r.id as string,
    prompt: (r.prompt_input as string) ?? "",
    contentType: ((r.content_type as string) ?? "video") as ContentType,
  }));
}

// Cleans up generations that were abandoned mid-render — the tab was closed,
// the phone died, the person walked away. Cancels them on fal.ai (so we stop
// paying for output nobody will collect) and refunds the credits.
//
// Called on workspace page load rather than from a cron, because Vercel's
// Hobby plan caps cron at one run per day. Safe to call often; it only touches
// jobs that have gone unpolled for a long time.
export async function reapAbandonedGenerations(): Promise<void> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;
  await reapStaleJobs(userData.user.id);
}

// Invoked directly from a Client Component (the Stop button on the live
// composer, same as runGeneration itself) — not a native form action — so it
// returns a result instead of calling redirect(). Just flips a flag; the
// still-running runGeneration call above is what actually notices it and
// stops, the next time it checks (see checkCancelled above).
export async function requestGenerationCancel(generationId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const { error } = await supabase
    .from("generations")
    .update({ cancel_requested: true })
    .eq("id", generationId)
    .eq("user_id", userData.user.id)
    .eq("status", "generating");

  if (error) {
    console.error("requestGenerationCancel failed:", error.message);
    return { error: "Couldn't stop this generation — try again." };
  }

  // Drive the cancel NOW rather than waiting for a poll. For a queued video the
  // client stops polling the instant Stop is pressed, so nothing else would run
  // advanceGeneration — and without it fal is never told to stop, so we keep
  // paying for a render nobody will collect until it finishes on its own. This
  // reads the job, tells fal to cancel, and finishes it user_cancelled; for a
  // non-queued generation there's no job row and it's a harmless no-op ("gone").
  // Awaited so the cancel actually reaches fal before we return — a Stop is
  // worth a second of latency. Best-effort: the cooperative cancel_requested
  // flag and the reaper remain as backstops if this can't reach fal.
  try {
    await advanceGeneration(generationId, userData.user.id);
  } catch (err) {
    console.error("requestGenerationCancel: advanceGeneration failed", err);
  }

  return { error: null };
}

// Cancellation is cooperative — it flips a flag the running job checks
// between steps (see requestGenerationCancel above), so a request whose
// provider call is already in flight finishes anyway and returns a real
// result. Reported as "the stop button is not working", 2026-08-10: from
// the outside that's exactly what it looked like, because the finished
// result was then rendered into the chat and saved to history as though
// nothing had been cancelled.
//
// This marks such a row failed and clears its result so it can't show up as
// a usable generation afterwards.
//
// Credits ARE refunded here (changed 2026-08-12). This used to deliberately
// keep the charge on the grounds that the provider call was genuinely
// billed — but the async cancel path (REFUNDS.user_cancelled in
// job-runner.ts) already refunds the identical situation, and the published
// Terms/FAQ now promise that only delivered, validated results consume the
// allowance. Charging one cancel path and refunding the other was the worse
// inconsistency; the provider cost of a rare cancel is the price of keeping
// the promise simple.
export async function discardStoppedGeneration(generationId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  // .select("id") so we know the update actually matched a row THIS user
  // owns — the refund below runs with the admin client, so gating it on
  // "no error" alone would let any signed-in user zero out someone else's
  // credits_used by guessing generation ids.
  //
  // The three filters after ownership are what make this a discard rather
  // than an undo button. Until 2026-08-17 there were none, and because a
  // "use server" export is a wire-callable endpoint, any signed-in user
  // could POST their own id for ANY generation — including one that had
  // succeeded weeks ago — and be refunded for it. They kept the picture
  // too: an image URL is a signed capability over the storage path and
  // never consults this row, so nulling result_url revokes nothing. That
  // made every plan, and the free trial, effectively unmetered.
  //
  //   status "generating"     — a finished generation is not discardable
  //   cancel_requested true   — the user must actually have pressed Stop
  //   started within the hour — a stop is a live gesture, not a claim made
  //                             days later about a row nobody is watching
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: updated, error } = await createAdminClient()
    .from("generations")
    .update({ status: "failed", result_url: null })
    .eq("id", generationId)
    .eq("user_id", userData.user.id)
    .eq("status", "generating")
    .eq("cancel_requested", true)
    .gte("created_at", oneHourAgo)
    .select("id");

  if (!error && updated?.length) await refundGenerationCosts(generationId);

  if (error) {
    console.error("discardStoppedGeneration failed:", error.message);
    return { error: "Couldn't discard the stopped generation." };
  }

  revalidatePath("/app/history");
  return { error: null };
}

// Thumbs up/down on a result, shown in the hover action bar under both the
// live Generate composer and the History detail page. A single nullable
// column (not two booleans) — like and dislike are mutually exclusive, and
// clicking an already-active one clears it back to no opinion.
export type GenerationFeedback = "like" | "dislike" | null;

export async function setGenerationFeedback(
  generationId: string,
  feedback: GenerationFeedback,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const { error } = await supabase
    .from("generations")
    .update({ feedback })
    .eq("id", generationId)
    .eq("user_id", userData.user.id);

  if (error) {
    console.error("setGenerationFeedback failed:", error.message);
    return { error: "Couldn't save that — try again." };
  }

  return { error: null };
}

export type MultiAngleResult =
  | { error: string }
  | {
      error: null;
      groupId: string;
      angles: {
        angleId: string;
        id: string;
        succeeded: boolean;
        attempts: AttemptLog[];
        finalPrompt: string;
        resultUrl: string | null;
        // Queued with fal.ai and still rendering — poll pollGeneration with
        // this angle's id until it reports a terminal state.
        //
        // Multi-angle is the feature that made the old design untenable:
        // four angles at six to ten minutes each could never fit inside one
        // 300s function, which is why it had never once completed. Now every
        // angle is submitted in parallel and polled independently, so total
        // wall time is roughly one render rather than four.
        pending?: boolean;
      }[];
    };

// Runs the same draft/review/generate/validate pipeline once per selected
// camera angle (each angle's hint is appended to the shared prompt before it
// enters the pipeline, so every angle gets its own independent reliability
// pass — retries included), then writes one generations row per angle up
// front (status "generating") so a crash never loses track of an angle, all
// tagged with a shared angle_group_id so the UI can group them back together.
export async function runMultiAngleGeneration(formData: FormData): Promise<MultiAngleResult> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const userInput = (formData.get("prompt") as string)?.trim();
  const characterId = formData.get("character_id") as string;
  // De-dup and keep only real angle presets: duplicate angles would insert (and
  // charge) two placeholder rows that collapse to one id — orphaning a paid fal
  // job — and unknown ids would fan out billed renders. Bounded by preset count.
  const angleIds = [...new Set((formData.getAll("angle") as string[]).filter(Boolean))].filter(
    (a) => getAnglePreset(a) !== undefined,
  );
  // Same idea as runGeneration's clientGenerationId — generated up front on
  // the client so the Stop button has something to cancel against before
  // this action has returned anything.
  const clientGroupId = (formData.get("angle_group_id") as string) || undefined;
  // Same attachment/anchor-photo priority as runGeneration — see the
  // comments there. Same SSRF guard too: only our own /api/media URLs are
  // accepted; anything else is discarded before it can reach a provider.
  // Role-aware since Send Receipt P4: when the composer sends the roles
  // list, only an identity-role photo may anchor — an outfit or scene photo
  // frozen into a multi-angle confirm can never become the face.
  const attachmentReferenceUrl = (() => {
    const rolesRaw = formData.get("attachment_roles");
    if (rolesRaw) {
      try {
        const parsed: unknown = JSON.parse(String(rolesRaw));
        if (Array.isArray(parsed)) {
          const identity = parsed.find(
            (x) =>
              x &&
              typeof (x as { url?: unknown }).url === "string" &&
              ((x as { url: string }).url).startsWith("/api/media/") &&
              !((x as { url: string }).url).includes("..") &&
              (x as { role?: unknown }).role === "identity",
          ) as { url: string } | undefined;
          return identity?.url ?? "";
        }
      } catch {
        // Malformed roles — fall through to the legacy field.
      }
    }
    const raw = (formData.get("attachment_reference_url") as string) || "";
    return raw.startsWith("/api/media/") ? raw : "";
  })();
  // The neutral "reference" attachment — the ONLY role current clients send.
  // Multi-angle used to read the identity role alone, so every attached
  // photo was silently discarded on this path while the receipt said it
  // rides (2026-08-31). Cited on Seedance beside the identity anchor,
  // vision-described into every angle's prompt elsewhere.
  const neutralAttachmentUrl = (() => {
    const rolesRaw = formData.get("attachment_roles");
    if (!rolesRaw) return "";
    try {
      const parsed: unknown = JSON.parse(String(rolesRaw));
      if (!Array.isArray(parsed)) return "";
      const neutral = parsed.find(
        (x) =>
          x &&
          typeof (x as { url?: unknown }).url === "string" &&
          ((x as { url: string }).url).startsWith("/api/media/") &&
          !((x as { url: string }).url).includes("..") &&
          (x as { role?: unknown }).role === "reference",
      ) as { url: string } | undefined;
      return neutral?.url ?? "";
    } catch {
      return "";
    }
  })();
  const requestedAnchorPhotoPath = (formData.get("anchor_photo_path") as string) || "";

  if (!userInput) return { error: "Describe what you want first." };
  if (userInput.length > MAX_PROMPT_LENGTH) {
    return { error: `Keep prompts under ${MAX_PROMPT_LENGTH} characters.` };
  }
  // Real incident, 2026-08-10: saying "Hey" into voice mode produced a
  // fully rendered room. Nothing downstream was broken — the pipeline's AI
  // refinement step (draft/review, see pipeline.ts) is designed to turn a
  // sparse prompt into a complete scene description, so given a greeting it
  // invents an entire scene from nothing. Guarding at the entry point
  // instead of trying to make the refiner refuse: this is cheap,
  // deterministic, and covers typed input too, whereas asking a model to
  // reliably decline is neither. Only fires when the input is ENTIRELY
  // greeting/filler, so short-but-real prompts still go through.
  if (isTrivialUtterance(userInput)) {
    return {
      error:
        "That didn't include anything to generate — describe what you want to see, like " +
        "\"a woman walking through a neon-lit street at night\".",
    };
  }
  if (!characterId) return { error: "Pick a character to generate with." };
  if (angleIds.length === 0) return { error: "Pick at least one angle." };

  const { data: character, error: characterError } = await supabase
    .from("character_profiles")
    .select("*")
    .eq("id", characterId)
    .eq("user_id", userData.user.id)
    .single();

  if (characterError || !character) {
    return { error: "Couldn't find that character." };
  }

  const [{ data: retrySetting }, { data: flag }, { data: videoModelSetting }, { data: userProfile }] =
    await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "max_retry_attempts").single(),
      supabase.from("feature_flags").select("enabled").eq("key", "real_ai_providers").single(),
      supabase.from("app_settings").select("value").eq("key", "video_model").single(),
      supabase.from("profiles").select("skip_ai_refinement").eq("id", userData.user.id).single(),
    ]);
  const maxAttempts = Number(retrySetting?.value) || undefined;
  const useRealProviders = flag?.enabled === true;
  // Same per-user preference as runGeneration (see the comment there).
  const skipRefinement = userProfile?.skip_ai_refinement === true;

  // Same per-generation model choice as runGeneration (see the comment
  // there) — one choice applies to every angle in this batch.
  const requestedVideoModelId = (formData.get("video_model_id") as string) || "";
  let videoModelId = VIDEO_MODELS.some((m) => m.id === requestedVideoModelId)
    ? requestedVideoModelId
    : (videoModelSetting?.value ?? "kling");
  const activeVideoModel = getVideoModel(videoModelId);

  const requestedDurationSeconds = Number(formData.get("video_duration_seconds"));
  let videoDurationSeconds = isValidDuration(activeVideoModel, requestedDurationSeconds)
    ? requestedDurationSeconds
    : getDefaultDurationSeconds(activeVideoModel);
  let creditWeight = getDurationCreditWeight(activeVideoModel, videoDurationSeconds);

  // Same resolution order as runGeneration (see the comment there): prompt
  // text beats the icon pick, which beats the 16:9 default.
  const requestedAspectRatio = (formData.get("video_aspect_ratio") as string) || "";
  const iconAspectRatio: VideoAspectRatio | null =
    requestedAspectRatio === "16:9" || requestedAspectRatio === "9:16" ? requestedAspectRatio : null;
  const promptAspectRatio = detectAspectRatioFromPrompt(userInput);
  const videoAspectRatio: VideoAspectRatio = promptAspectRatio ?? iconAspectRatio ?? "16:9";
  // Validated against the FINAL model below, after the circuit breaker.
  const requestedResolution = (formData.get("video_resolution") as string) || "";

  // Same circuit breaker as single generation — a model out of service must
  // not be reachable through multi-angle either, which would otherwise submit
  // several paid renders to a provider already known to be failing.
  const angleCandidates = VIDEO_MODELS_BY_PRICE.map((m) => ({ id: m.id, name: m.name }));
  const angleResolved = await resolveModel(videoModelId, angleCandidates);
  if (!angleResolved.ok) return { error: angleResolved.message };
  videoModelId = angleResolved.modelId;

  // Re-price for the substituted model, exactly as runGeneration does — the
  // weight above was the original model's, and every angle is charged and
  // saved at creditWeight, so a substitution would otherwise misprice the
  // whole multi-angle request by a factor of the angle count.
  if (angleResolved.substitutedFrom) {
    const substitutedModel = getVideoModel(videoModelId);
    if (!isValidDuration(substitutedModel, videoDurationSeconds)) {
      videoDurationSeconds = getDefaultDurationSeconds(substitutedModel);
    }
    creditWeight = getDurationCreditWeight(substitutedModel, videoDurationSeconds);
  }

  // Resolution, priced — same contract as runGeneration, and it matters MORE
  // here: every angle is charged and saved at creditWeight, so a resolution
  // surcharge that went unpriced would be undercharged once per angle, and
  // one resolved against the pre-substitution model would send a parameter
  // the new endpoint has never heard of, N times over.
  const videoResolution = resolveVideoResolution(videoModelId, requestedResolution);
  if (videoResolution) {
    const resolutionWeight = resolutionCreditWeight(
      videoModelId,
      videoResolution,
      videoDurationSeconds,
    );
    if (resolutionWeight !== null) creditWeight = resolutionWeight;
  }

  // Any frame-starting model (image/reference-to-video), checked on the
  // RESOLVED model so a substitution into one is caught — multi-angle has no
  // per-message attachment, so only the character's saved photo can satisfy it.
  if (requiresReferenceImage(getVideoModel(videoModelId)) && !character.reference_image_urls?.[0]) {
    return {
      error: `${getVideoModel(videoModelId).name} needs this character to have a reference photo — add one in Character settings, or pick a different model.`,
    };
  }

  // Multi-angle is not available on the free trial. The free allowance is
  // one generation per day, and one multi-angle request is several
  // generations at once — far more than the day's slot covers, and the
  // per-generation slot would undercount what it actually cost.
  //
  // Purchased top-up credits unlock it, same as the single-generation path's
  // isFreeTierAccount: multi-angle reserves angles × weight credits and every
  // row is charged at its real weight (free_generation_used is hardcoded
  // false below), so the daily trial slot can't undercount here — the whole
  // batch is drawn from the credits they bought.
  const { data: multiAngleProfile } = await supabase
    .from("profiles")
    .select("plan, bonus_credits, purchased_credits, role, status")
    .eq("id", userData.user.id)
    .single();
  // Same in-action suspension check as runGeneration (see the comment there)
  // — this entry point fans out several paid renders at once, so it matters
  // here even more.
  if (multiAngleProfile?.status === "suspended") {
    return { error: "This account is suspended." };
  }
  if (
    (multiAngleProfile?.plan ?? "none") === "none" &&
    (multiAngleProfile?.bonus_credits ?? 0) === 0 &&
    (multiAngleProfile?.purchased_credits ?? 0) === 0 &&
    multiAngleProfile?.role !== "admin"
  ) {
    return {
      error:
        "Multi-angle needs a plan or topped-up credits. Your daily free generation works for single images and videos.",
    };
  }

  const totalRequestedCredits = angleIds.length * creditWeight;
  let multiAllowance = await checkGenerationAllowance(
    supabase,
    userData.user.id,
    totalRequestedCredits,
  );
  if (multiAllowance.error) return { error: multiAllowance.error };
  const multiIsAdmin = multiAllowance.isAdmin;
  // Reassignable — the atomic group reservation below may lose the monthly race
  // and re-decide, exactly like the single-generation path.
  let consumePurchased = multiAllowance.consumePurchased;

  if (useRealProviders) {
    const missingKeys = missingRealProviderKeys("video");
    if (missingKeys.length > 0) {
      return {
        error:
          `Real AI providers are turned on but missing: ${missingKeys.join(", ")}. ` +
          `Add them to .env.local, or turn the flag off in Admin > Feature flags to use the mock pipeline.`,
      };
    }
  }

  const characterForPipeline = {
    name: character.name,
    traits: character.traits ?? {},
    motion_style: character.motion_style,
    voice_tone_tags: character.voice_tone_tags ?? [],
  };

  // Same baseline identity anchor as runGeneration — without this, multi-
  // angle video generation sends fal.ai nothing but a text description of
  // the character, same root cause as the single-generation consistency bug.
  let videoCharacterAnchorUrl: string | null = null;
  // The attachment's two lanes, resolved ONCE for the whole batch: the
  // photo itself on cited-image models, a description everywhere else —
  // described a single time here rather than once per angle, since the
  // description is identical and vision calls cost money.
  let anglePropImageUrl: string | null = null;
  let anglePropDescription: string | null = null;
  if (useRealProviders) {
    if (attachmentReferenceUrl) {
      // Absolutize — the value is a relative /api/media URL and fal.ai fetches
      // it over the open internet (same as the single-generation path). Without
      // this every angle fails at the provider and, with refunds off, is billed.
      videoCharacterAnchorUrl = absolutizeMediaUrl(attachmentReferenceUrl, await getOrigin());
    } else {
      const chosenPath =
        requestedAnchorPhotoPath && character.reference_image_urls?.includes(requestedAnchorPhotoPath)
          ? requestedAnchorPhotoPath
          : character.reference_image_urls?.[0];
      if (chosenPath) {
        const { data: signed } = await supabase.storage
          .from("character-references")
          .createSignedUrl(chosenPath, 60 * 10);
        videoCharacterAnchorUrl = signed?.signedUrl ?? null;
      }
    }

    if (neutralAttachmentUrl) {
      const absoluteNeutral = absolutizeMediaUrl(neutralAttachmentUrl, await getOrigin());
      if (videoModelId === "seedance" || videoModelId === "seedance-2") {
        anglePropImageUrl = absoluteNeutral;
      } else {
        try {
          anglePropDescription = await describeImageAsPrompt(absoluteNeutral, "standalone");
        } catch {
          // Best-effort, same as the single path: an undescribed photo
          // costs nothing and the render still runs.
        }
      }
    }
  }

  const groupId = clientGroupId ?? crypto.randomUUID();

  // angle_group_id is client-supplied (the Stop button needs it before this
  // action returns) and NOT unique in the table — reject a re-used one rather
  // than let a replayed id splice this batch into an old group. The
  // group-level writes below are all scoped to this batch's own row ids
  // anyway (see placeholderIds), so this is defense in depth for grouping
  // semantics (History cards, group cancel), not the primary guard.
  if (clientGroupId) {
    const { data: existingGroup } = await supabase
      .from("generations")
      .select("id")
      .eq("angle_group_id", clientGroupId)
      .eq("user_id", userData.user.id)
      .limit(1);
    if (existingGroup?.length) {
      return { error: "That request was already started — try again." };
    }
  }

  // Atomic group reservation — the whole angle group's MONTHLY portion is
  // checked and all N rows inserted under one advisory lock (reserve_generations,
  // same lock key as the single-generation path so the two serialize together).
  // The old bulk insert read usage and inserted separately, so a concurrent
  // burst could exceed the plan cap. On a lost race we re-decide against the
  // fresh usage (which may re-slice more onto purchased credits) and retry.
  const admin = createAdminClient();
  let placeholders: { id: string; angle: string }[] | null = null;
  for (let attempt = 0; attempt < 5 && !placeholders; attempt++) {
    if (attempt > 0) {
      const reAllowance = await checkGenerationAllowance(supabase, userData.user.id, totalRequestedCredits);
      if (reAllowance.error) return { error: reAllowance.error };
      multiAllowance = reAllowance;
      consumePurchased = reAllowance.consumePurchased;
    }

    const cp = consumePurchased ?? 0;
    const monthlyPortion = multiIsAdmin ? 0 : Math.max(0, totalRequestedCredits - cp);

    const rows = angleIds.map((angleId, angleIndex) => ({
      id: crypto.randomUUID(),
      character_profile_id: characterId,
      prompt_input: userInput,
      content_type: "video",
      status: "generating",
      attempts: 0,
      result_url: null,
      pipeline_log: [],
      angle_group_id: groupId,
      angle: angleId,
      video_model_id: videoModelId,
      // Same column, same reason as the single-render path above — multi-angle
      // is where per-model fidelity comparison is most useful, since every
      // angle in a group shares one compiled scene and differs only by camera.
      model_id: videoModelId,
      video_duration_seconds: videoDurationSeconds,
      video_aspect_ratio: videoAspectRatio,
      credits_used: creditWeight,
      // The purchased-credit overflow is a single group-level number; spread it
      // across the rows (base share everywhere, remainder on the first rows) so
      // a partial failure refunds a fair slice (see refundGenerationCosts).
      purchased_credits_used:
        Math.floor(cp / angleIds.length) + (angleIndex < cp % angleIds.length ? 1 : 0),
      free_generation_used: false,
    }));

    const { data: ids, error: reserveError } = await admin.rpc("reserve_generations", {
      p_user_id: userData.user.id,
      p_monthly_portion: monthlyPortion,
      p_limit: multiAllowance.monthlyLimit ?? 0,
      p_since: multiAllowance.periodStartIso ?? new Date(0).toISOString(),
      p_rows: rows,
    });
    if (reserveError) {
      console.error("reserve_generations failed:", reserveError);
      return { error: "Couldn't start these generations — try again." };
    }
    if (ids && (ids as string[]).length) {
      placeholders = (ids as string[]).map((id, i) => ({ id, angle: angleIds[i] }));
    }
    // else: another request took the monthly headroom — loop and re-decide.
  }

  if (!placeholders) {
    return { error: "You've used all the credits included in your plan this month." };
  }

  // The ids this reservation just created — every group-level write below is
  // keyed to THESE rows, never to angle_group_id alone. angle_group_id is
  // client-supplied and non-unique, so a write keyed on it (as the abort
  // below originally was) turned a spend-race abort into a meter-poisoning
  // primitive: replaying an old group id zeroed the credits_used of
  // historical, genuinely-charged rows. The status filter is belt-and-braces
  // on top — a row that already reached a terminal state is never touched.
  const placeholderIds = placeholders.map((p) => p.id);

  const purchasedOk = await consumePurchasedCredits(supabase, userData.user.id, consumePurchased ?? 0);
  if (!purchasedOk) {
    // Lost the race for the last purchased credits — nothing has run yet, so
    // release every angle's charge and stop before any paid provider call.
    // Scoped strictly to the rows reserved above (see placeholderIds).
    const { error: releaseError } = await createAdminClient()
      .from("generations")
      .update({ status: "failed", credits_used: 0, purchased_credits_used: 0, progress_stage: null })
      .in("id", placeholderIds)
      .eq("status", "generating")
      .eq("user_id", userData.user.id);
    // Same reasoning as the single-generation abort: a silent failure leaves
    // phantom usage on the meter, and the orphaned-generation reaper is the
    // backstop that eventually cleans a row stuck like this.
    if (releaseError) {
      console.error("Multi-angle spend-race abort couldn't release the placeholder charges:", {
        placeholderIds,
        error: releaseError.message,
      });
    }
    return { error: "You're out of credits — that request couldn't be covered." };
  }

  const placeholderByAngle = new Map(placeholders.map((p) => [p.angle as string, p.id as string]));

  // Promise.allSettled (not Promise.all) so one angle throwing can't strand
  // the others mid-flight — every angle's placeholder row above already
  // exists, so each one gets updated to its true final state below no matter
  // what happens to its siblings. Previously a shared Promise.all meant a
  // single failure could leave other angles' results uninserted-but-still-
  // running, invisible to the UI, and never cleaned up.
  // Read once, not once per angle — this is the same query with the same
  // result for every angle in the batch.
  const angleBrandRules = await loadBrandRules(supabase, userData.user.id);

  // ONE scene, compiled once, shared by every angle.
  //
  // This used to run the whole draft/review pipeline per angle, with the
  // angle hint appended to the user's raw prompt. That produced three
  // INDEPENDENT creative expansions of the same request, and two separate
  // drafts of "a woman in a Paris coffee shop" never furnish the room the
  // same way — confirmed on the first real multi-angle run, 2026-08-10, where
  // one angle got a round table and a white ceramic cup, another got a plain
  // table and a different background, and a third described the shirt
  // differently again. Same face, three unrelated shots.
  //
  // Consistency is the entire product promise, so the scene is now settled
  // before any angle is rendered, and each angle differs by its camera line
  // and nothing else. It's also cheaper: one Claude + OpenAI pass instead of
  // one per angle.
  // Wrapped in try/catch for the same reason runGeneration wraps its pipeline
  // call: runRealPipeline shouldn't throw (every provider call inside it is
  // caught and recorded as a failed attempt), but if something truly
  // unexpected does throw here, letting it reject the whole action would strand
  // all N placeholder rows — already inserted and already charged — at
  // "generating" forever, with no generation_jobs rows for the reaper to reach.
  // Falling back to null routes it into the "didn't compile → fail the group
  // and refund" branch below, which cleans up correctly.
  let sharedScene: Awaited<ReturnType<typeof runRealPipeline>> | null = null;
  if (useRealProviders) {
    try {
      sharedScene = await runRealPipeline(
        // SHARED_SCENE_INSTRUCTION is written for the COMPILER (Claude), not
        // the video model. With skip_ai_refinement on there is no compiler —
        // the pipeline sends the input verbatim to Kling — so appending it
        // there would ship meta-instructions ("Do not mention the camera
        // angle...") as literal prompt text in every angle's render. The
        // skip path gets the user's prompt untouched instead.
        skipRefinement ? userInput : `${userInput}\n\n${SHARED_SCENE_INSTRUCTION}`,
        characterForPipeline,
        {
          contentType: "video",
          videoModelId,
          videoCharacterAnchorUrl,
          videoDurationSeconds,
          videoAspectRatio,
          videoResolution,
          skipRefinement,
          brandRules: angleBrandRules,
          compileOnly: true,
        },
        maxAttempts,
        // Same cooperative Stop polling runGeneration's pipeline call gets —
        // without it, a Stop pressed during the compile was invisible until
        // AFTER every angle's paid render had already been submitted. Any row
        // of the group carries the flag (requestMultiAngleGenerationCancel
        // flips them all), so one indexed lookup answers for the batch.
        async () => {
          const { data } = await supabase
            .from("generations")
            .select("id")
            .in("id", placeholderIds)
            .eq("cancel_requested", true)
            .limit(1);
          return Boolean(data?.length);
        },
      );
    } catch (err) {
      console.error("Multi-angle shared-scene compile threw:", err);
      sharedScene = null;
    }
  }

  // Stop pressed while the scene was compiling: nothing has been submitted to
  // fal yet, so honour it cleanly — fail only this batch's reserved rows and
  // release what they charged — instead of falling through to submit N paid
  // renders the user already asked to stop.
  if (useRealProviders && sharedScene?.cancelled) {
    const stoppedLog: AttemptLog[] = sharedScene.attempts?.length
      ? sharedScene.attempts
      : [
          {
            attempt: 1,
            steps: [{ step: "generate", detail: "Stopped." }],
            passed: false,
            issues: ["cancelled"],
            compiledPrompt: "",
          },
        ];
    const { error: stopError } = await createAdminClient()
      .from("generations")
      .update({ status: "failed", pipeline_log: stoppedLog, progress_stage: null })
      .in("id", placeholderIds)
      .eq("status", "generating")
      .eq("user_id", userData.user.id);
    if (stopError) {
      console.error("Multi-angle stop couldn't fail the reserved rows:", stopError.message);
    }
    // Same refund treatment as the async user_cancelled path (job-runner's
    // REFUNDS table): a Stop honoured before any provider spend should give
    // everything back — still through the one flag-gated refund door.
    for (const p of placeholders) {
      await refundGenerationCosts(p.id);
    }
    return { error: "Stopped before any renders were submitted." };
  }

  // If the shared scene didn't compile, every angle would submit an empty or
  // half-formed prompt — three paid Kling renders of nothing. Fail the batch
  // here instead, refund the credits, and say so.
  if (useRealProviders && !sharedScene?.finalPrompt?.trim()) {
    const failureLog: AttemptLog[] = sharedScene?.attempts?.length
      ? sharedScene.attempts
      : [
          {
            attempt: 1,
            steps: [{ step: "generate", detail: "Couldn't build a scene description for these angles." }],
            passed: false,
            issues: ["provider_error"],
            compiledPrompt: "",
          },
        ];

    const { error: failError } = await createAdminClient()
      .from("generations")
      // NOTE: credits are NOT zeroed here — releasing the allowance is a refund
      // and must pass through the flag-gated refundGenerationCosts loop below,
      // exactly like finish(). Zeroing inline bypassed the automatic_refunds
      // switch and the daily cap.
      .update({ status: "failed", pipeline_log: failureLog, progress_stage: null })
      // Keyed to the rows THIS reservation created, never to angle_group_id —
      // the group id is client-supplied and not unique, so a replayed id would
      // otherwise flip unrelated historical rows to failed (see placeholderIds
      // above). user_id + the status filter are belt-and-braces on top.
      .in("id", placeholderIds)
      .eq("status", "generating")
      .eq("user_id", userData.user.id);
    if (failError) {
      console.error("Multi-angle compile-failure path couldn't fail the reserved rows:", failError.message);
    }

    // Whole group failed before any provider call — also give back the
    // purchased-credit slices recorded on each row.
    for (const p of placeholders) {
      await refundGenerationCosts(p.id as string);
    }

    return { error: "Couldn't build a scene for these angles — try rewording the prompt." };
  }

  const settled = await Promise.allSettled(
    angleIds.map(async (angleId) => {
      const preset = getAnglePreset(angleId);
      const angledInput = preset ? `${userInput}\n\n${preset.promptHint}` : userInput;
      const rowId = placeholderByAngle.get(angleId);

      let attempts: AttemptLog[];
      let succeeded: boolean;
      let finalPrompt: string;
      let resultUrl: string | null;

      if (useRealProviders) {
        // The shared scene plus this angle's camera line — the only thing
        // that differs between the angles in a batch.
        let anglePrompt = preset
          ? `${sharedScene!.finalPrompt}\n\n${preset.promptHint}`
          : sharedScene!.finalPrompt;
        if (anglePropDescription) {
          anglePrompt += `\n\nThe user attached an image; its contents (use as the prompt above describes): ${anglePropDescription}`;
        }

        const angleAttempts: AttemptLog[] = JSON.parse(JSON.stringify(sharedScene!.attempts));
        const lastAttempt = angleAttempts[angleAttempts.length - 1];
        if (lastAttempt) {
          lastAttempt.compiledPrompt = anglePrompt;
          lastAttempt.steps.push({
            step: "generate",
            detail: `Shared scene, ${preset?.label ?? angleId} camera angle.`,
          });
        }

        // Last look at the Stop flag before the money leaves — the compile
        // above can take tens of seconds, ample time for a Stop to land.
        // Honouring it here stops THIS angle's paid submit; scoped strictly
        // to this angle's own reserved row, with the same clean bookkeeping
        // as the group-level stop above.
        if (rowId) {
          const { data: cancelRow } = await createAdminClient()
            .from("generations")
            .select("cancel_requested")
            .eq("id", rowId)
            .maybeSingle<{ cancel_requested: boolean }>();
          if (cancelRow?.cancel_requested) {
            const stoppedAttempts: AttemptLog[] = angleAttempts.length
              ? angleAttempts
              : [
                  {
                    attempt: 1,
                    steps: [],
                    passed: false,
                    issues: ["cancelled"],
                    compiledPrompt: anglePrompt,
                  },
                ];
            stoppedAttempts[stoppedAttempts.length - 1]?.steps.push({
              step: "generate",
              detail: "Stopped before this angle was submitted.",
            });
            const { error: stopError } = await createAdminClient()
              .from("generations")
              .update({ status: "failed", pipeline_log: stoppedAttempts, progress_stage: null })
              .eq("id", rowId)
              .eq("status", "generating");
            if (stopError) {
              console.error("Multi-angle per-angle stop couldn't fail the row:", stopError.message);
            }
            await refundGenerationCosts(rowId);
            return {
              angleId,
              id: rowId,
              succeeded: false,
              attempts: stoppedAttempts,
              finalPrompt: anglePrompt,
              resultUrl: null,
            };
          }
        }

        const result = {
          attempts: angleAttempts,
          succeeded: false,
          finalPrompt: anglePrompt,
          resultUrl: null as string | null,
          pendingVideoJob: await submitVideoJob(anglePrompt, videoModelId, {
            characterAnchorImageUrl: videoCharacterAnchorUrl,
            // The attached photo, cited beside the identity anchor on
            // Seedance — fal.ts's own budget guard keeps the list legal.
            propImageUrl: anglePropImageUrl,
            durationSeconds: videoDurationSeconds,
            aspectRatio: videoAspectRatio ?? undefined,
            generateNativeAudio: true,
          }),
        };
        // Queued, not finished. Record the handle and leave this angle's row
        // at "generating" — the client polls it from here. Returning early
        // skips the status update below, which would otherwise write "failed"
        // for a render that is merely still in progress.
        if (result.pendingVideoJob && rowId) {
          try {
            await saveVideoJob({
              generationId: rowId,
              userId: userData.user!.id,
              job: result.pendingVideoJob,
              attempts: result.attempts,
            });
          } catch (err) {
            // The render is already in fal's queue but we couldn't record its
            // handle — nothing on our side will ever collect it, so stop the
            // billing before the crash handler below fails and refunds this
            // angle's row. Best-effort; cancelQueuedJob never throws.
            await cancelQueuedJob(result.pendingVideoJob);
            throw err;
          }
          await createAdminClient()
            .from("generations")
            .update({ attempts: result.attempts.length, pipeline_log: result.attempts })
            .eq("id", rowId);

          return {
            angleId,
            id: rowId,
            succeeded: false,
            attempts: result.attempts,
            finalPrompt: result.finalPrompt,
            resultUrl: null,
            pending: true,
          };
        }

        ({ attempts, succeeded, finalPrompt, resultUrl } = result);
      } else {
        const result = runPipeline(angledInput, characterForPipeline, maxAttempts, "video");
        ({ attempts, succeeded, finalPrompt, resultUrl } = result);
      }

      if (rowId) {
        // Same status guard as the single-render write and finish(): a row
        // the person already stopped and had refunded must not be
        // resurrected by this late write (2026-08-31).
        const { count } = await createAdminClient()
          .from("generations")
          .update(
            {
              status: succeeded ? "succeeded" : "failed",
              attempts: attempts.length,
              result_url: resultUrl,
              pipeline_log: attempts,
            },
            { count: "exact" },
          )
          .eq("id", rowId)
          .eq("status", "generating");
        if (!succeeded && count !== 0) {
          await refundGenerationCosts(rowId);
          await autoReportFailedGeneration(rowId, userData.user!.id, attempts);
        }
      }

      return { angleId, id: rowId ?? "", succeeded, attempts, finalPrompt, resultUrl };
    }),
  );

  const results = await Promise.all(
    settled.map(async (outcome, idx) => {
      if (outcome.status === "fulfilled") return outcome.value;

      const angleId = angleIds[idx];
      const rowId = placeholderByAngle.get(angleId);
      const message =
        outcome.reason instanceof Error ? outcome.reason.message : "This angle failed unexpectedly.";
      const crashLog: AttemptLog[] = [
        {
          attempt: 1,
          steps: [{ step: "generate", detail: message }],
          passed: false,
          issues: ["unexpected_error"],
          compiledPrompt: "",
        },
      ];
      if (rowId) {
        await createAdminClient()
          .from("generations")
          .update({ status: "failed", pipeline_log: crashLog })
          .eq("id", rowId);
        // Refund this angle's slice of the credits (see the placeholder
        // insert above for how the purchased overflow was distributed).
        await refundGenerationCosts(rowId);
        await autoReportFailedGeneration(rowId, userData.user!.id, crashLog);
      }
      return { angleId, id: rowId ?? "", succeeded: false, attempts: [], finalPrompt: "", resultUrl: null };
    }),
  );

  revalidatePath("/app/generate");
  revalidatePath("/app/history");
  revalidatePath("/app/videos");

  return {
    error: null,
    groupId,
    angles: results.map((r) => ({
      angleId: r.angleId,
      id: r.id,
      succeeded: r.succeeded,
      attempts: r.attempts,
      finalPrompt: r.finalPrompt,
      resultUrl: r.resultUrl,
    })),
  };
}

// Same idea as requestGenerationCancel, but flips the flag on every row in
// the angle group at once — one Stop click on a multi-angle request should
// stop all of its still-running angles, not just one.
export async function requestMultiAngleGenerationCancel(
  groupId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const { data: cancelled, error } = await supabase
    .from("generations")
    .update({ cancel_requested: true })
    .eq("angle_group_id", groupId)
    .eq("user_id", userData.user.id)
    .eq("status", "generating")
    .select("id");

  if (error) {
    console.error("requestMultiAngleGenerationCancel failed:", error.message);
    return { error: "Couldn't stop these generations — try again." };
  }

  // Drive each angle's cancel server-side now — the client stops polling on
  // Stop, so otherwise fal is never told to stop any of the queued angle
  // renders and we keep paying for all of them. Each call tells fal to cancel
  // that angle's job and finishes it user_cancelled; angles with no job row are
  // harmless no-ops. Best-effort, per the single-generation cancel above.
  await Promise.allSettled(
    (cancelled ?? []).map((row) => advanceGeneration(row.id as string, userData.user!.id)),
  );

  return { error: null };
}

// Pulls the Storage object path back out of a result_url created by
// persistGeneratedImage. Handles BOTH formats a row can hold: the current
// capability URL "/api/media/<bucket>/<userId>/<uuid>.png?v=..." (mediaUrl,
// see lib/media/url.ts) AND the legacy signed URL
// ".../object/sign/<bucket>/<userId>/<uuid>.png?token=...". The signed-only
// version silently returned null for every image made since the stable-media-
// URL migration, so "deleted" images were never actually removed from Storage
// and stayed fetchable through their never-expiring capability URL. Video
// results live on fal.ai's CDN and were never in our Storage, so this only
// ever matches image generations.
function extractStoragePath(url: string | null, bucket: string): string | null {
  if (!url) return null;
  for (const marker of [`/api/media/${bucket}/`, `/object/sign/${bucket}/`]) {
    const idx = url.indexOf(marker);
    if (idx === -1) continue;
    const raw = url.slice(idx + marker.length).split("?")[0];
    if (!raw) return null;
    // Path segments are percent-encoded individually (mediaUrl) — decode each.
    return raw
      .split("/")
      .map((seg) => {
        try {
          return decodeURIComponent(seg);
        } catch {
          return seg;
        }
      })
      .join("/");
  }
  return null;
}

// Client-invoked (see the note on saveCharacterProfile above for why this
// returns a result instead of calling redirect()) so it can be triggered from
// a hover-reveal button in a list without navigating away from wherever the
// user currently is. Multi-angle requests share an angle_group_id and are
// always shown together as one card in History, so deleting one deletes the
// whole group rather than leaving orphaned siblings behind.
export async function deleteGeneration(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const id = formData.get("id") as string;
  if (!id) return { error: "Missing generation id." };

  const { data: row } = await supabase
    .from("generations")
    .select("id, angle_group_id, content_type, result_url, attachments")
    .eq("id", id)
    .eq("user_id", userData.user.id)
    .single();

  if (!row) return { error: "Couldn't find that generation." };

  const { data: group } = row.angle_group_id
    ? await supabase
        .from("generations")
        .select("id, content_type, result_url, attachments")
        .eq("angle_group_id", row.angle_group_id)
        .eq("user_id", userData.user.id)
    : { data: null };

  const rows = group && group.length > 0 ? group : [row];

  // Soft delete, not DELETE.
  //
  // The monthly meter is SUM(credits_used) over the rows that exist, so
  // removing a row refunded the generation in full — a succeeded, downloaded
  // one included — with no refund code involved at all. It also reset the
  // 3-second cooldown (which reads the newest row) and the API's
  // requests-per-minute counter (which counts rows in the last minute). One
  // "delete" button quietly undid the charge and both rate limits.
  //
  // The row now stays and keeps counting; every user-facing query filters on
  // deleted_at. The files still go, below — this is about the ledger, not
  // about keeping pictures the user asked to be rid of.
  const { error } = await supabase
    .from("generations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", userData.user.id)
    .is("deleted_at", null)
    .in(
      "id",
      rows.map((r) => r.id),
    );

  if (error) {
    console.error("deleteGeneration failed:", error.message);
    return { error: "Couldn't delete this — try again." };
  }

  // Un-share what is being deleted. The soft delete means the ON DELETE
  // CASCADE on community_posts never fires, so a shared render stayed on the
  // public feed forever — pointing at a storage object the next lines
  // remove, i.e. a permanently dead public image (2026-08-31 inspection).
  const { error: unshareError } = await supabase
    .from("community_posts")
    .delete()
    .eq("user_id", userData.user.id)
    .in(
      "generation_id",
      rows.map((r) => r.id),
    );
  if (unshareError) {
    // The delete itself succeeded; log loudly rather than fail the action.
    console.error("deleteGeneration couldn't remove community posts:", unshareError.message);
  }

  // The chat attachments this send carried (recorded on the row since
  // 2026-08-31) go with it — scoped to the caller's own folder as a final
  // guard, since the column is data a past request wrote.
  const attachmentPaths = rows
    .flatMap((r) => ((r as { attachments?: unknown }).attachments as string[] | null) ?? [])
    .filter((p) => typeof p === "string" && p.startsWith(`${userData.user!.id}/`) && !p.includes(".."));
  if (attachmentPaths.length) {
    const { error: attachmentRemoveError } = await supabase.storage
      .from("chat-attachments")
      .remove(attachmentPaths);
    if (attachmentRemoveError) {
      console.error("deleteGeneration couldn't remove attachments:", attachmentRemoveError.message);
    }
  }

  const imagePaths = rows
    .filter((r) => r.content_type === "image")
    .map((r) => extractStoragePath(r.result_url as string | null, "generated-images"))
    .filter((p): p is string => Boolean(p));

  if (imagePaths.length > 0) {
    await supabase.storage.from("generated-images").remove(imagePaths);
  }

  revalidatePath("/app", "layout");
  revalidatePath("/app/history");
  revalidatePath("/app/images");
  revalidatePath("/app/videos");

  return { error: null };
}

export type HistoryTurn = {
  id: string;
  prompt: string;
  contentType: ContentType;
  attempts: AttemptLog[];
  succeeded: boolean;
  finalPrompt: string;
  resultUrl: string | null;
  createdAt: string;
  // 0-100 identity-match score from the post-generation vision check
  // (characters v2); null/absent when the generation wasn't scored.
  matchScore?: number | null;
  /** chat-attachments storage paths this send carried (recorded 2026-08-31). */
  attachmentPaths?: string[];
};

export type HistoryAngleClip = {
  angleId: string;
  id: string;
  succeeded: boolean;
  attempts: AttemptLog[];
  finalPrompt: string;
  resultUrl: string | null;
};

export type HistoryMultiAngleGroup = {
  groupId: string;
  prompt: string;
  createdAt: string;
  angles: HistoryAngleClip[];
};

// Mirrors the shape the Generate composer already builds live (ChatItem in
// generate-form.tsx) — a flat list mixing single generations and grouped
// multi-angle requests, ordered like a real conversation instead of the
// History page's plain list.
export type ChatHistoryItem =
  | ({ kind: "single" } & HistoryTurn)
  | ({ kind: "multi" } & HistoryMultiAngleGroup);

// Loads exactly ONE saved history entry — a single generation, or, if it was
// part of a multi-angle request, its whole angle group — so the Generate
// screen can resume it as a fresh thread. Used by the "Continue chat" action
// on the History pages (see history/[id]/page.tsx and history/page.tsx).
//
// Deliberately scoped to just this one entry, not "everything this character
// has ever generated": each History card is its own separate conversation
// (real incident, 2026-08-07 — an earlier version of this loaded a
// character's ENTIRE history into one thread, silently merging unrelated
// chats together, which is not what "continue THIS chat" means). Multi-angle
// requests still get reconstructed as one grouped item (same shape the live
// composer already renders) rather than N duplicate flat bubbles for what
// was really one request.
export async function getGenerationThread(generationId: string): Promise<ChatHistoryItem | null> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user || !generationId) return null;

  const columns =
    "id, prompt_input, content_type, status, result_url, pipeline_log, created_at, angle_group_id, angle, match_score, attachments";

  const { data: row } = await supabase
    .from("generations")
    .select(columns)
    .eq("id", generationId)
    .eq("user_id", userData.user.id)
    .single();

  if (!row) return null;

  if (row.angle_group_id) {
    const { data: siblings } = await supabase
      .from("generations")
      .select(columns)
      .eq("angle_group_id", row.angle_group_id)
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: true });

    const rows = siblings && siblings.length > 0 ? siblings : [row];
    const sorted = rows
      .slice()
      .sort((a, b) => angleSortIndex(a.angle as string | null) - angleSortIndex(b.angle as string | null));
    const earliest = rows.reduce(
      (min, r) => ((r.created_at as string) < min ? (r.created_at as string) : min),
      rows[0].created_at as string,
    );
    return {
      kind: "multi",
      groupId: row.angle_group_id as string,
      prompt: sorted[0].prompt_input as string,
      createdAt: earliest,
      angles: sorted.map((r) => {
        const attempts = (r.pipeline_log ?? []) as AttemptLog[];
        return {
          angleId: r.angle as string,
          id: r.id as string,
          succeeded: r.status === "succeeded",
          attempts,
          finalPrompt: attempts[attempts.length - 1]?.compiledPrompt ?? "",
          resultUrl: toMediaUrl(r.result_url as string | null),
        };
      }),
    };
  }

  const attempts = (row.pipeline_log ?? []) as AttemptLog[];
  return {
    kind: "single",
    id: row.id as string,
    prompt: row.prompt_input as string,
    contentType: row.content_type as ContentType,
    attempts,
    succeeded: row.status === "succeeded",
    finalPrompt: attempts[attempts.length - 1]?.compiledPrompt ?? "",
    resultUrl: toMediaUrl(row.result_url as string | null),
    createdAt: row.created_at as string,
    matchScore: (row.match_score ?? null) as number | null,
    // Reloaded threads used to come back with the attachment chips missing —
    // the paths were never stored anywhere to reload (2026-08-31).
    attachmentPaths: ((row.attachments as string[] | null) ?? []).filter(
      (p) => typeof p === "string",
    ),
  };
}

export async function getReliabilityStats(_userId: string) {
  // Derive the account from the verified session rather than trusting the
  // argument — this only ever shows the caller their own dashboard.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { firstTryRate: null, avgAttempts: null, total: 0 };
  const { data } = await supabase
    .from("generations")
    .select("attempts, status")
    .in("status", ["succeeded", "failed"])
    .eq("user_id", user.id);

  const rows = data ?? [];
  const total = rows.length;
  if (total === 0) {
    return { firstTryRate: null, avgAttempts: null, total: 0 };
  }

  const firstTry = rows.filter((r) => r.attempts === 1 && r.status === "succeeded").length;
  const avgAttempts = rows.reduce((sum, r) => sum + (r.attempts ?? 0), 0) / total;

  return {
    firstTryRate: Math.round((firstTry / total) * 100),
    avgAttempts: Math.round(avgAttempts * 10) / 10,
    total,
  };
}

// Real billing cycles arrive with Stripe (Task #6). Until then, "this
// billing period" is approximated as the current calendar month.
//
// Sums credits_used rather than counting rows — pricier models (Kling O3)
// cost more than 1 credit per video (see creditWeight in video-models.ts),
// so two O3 videos should read as "used 4" against the plan limit, not "used
// 2". credits_used is stored on each row at generation time (not looked up
// live from the current catalog), so this stays accurate even if a model's
// weight changes later — past usage doesn't retroactively shift.
//
// periodStart anchors the window to the caller's real Stripe billing cycle
// (profiles.current_period_start) when they have one — both call sites fetch
// it alongside plan/bonus_credits and pass it straight through. Falls back
// to calendar-month start (the original, only behavior before billing-cycle
// tracking existed) whenever it's null: a "none"-plan/bonus-only user with
// no subscription, or an existing subscriber whose profile hasn't been
// backfilled with real Stripe dates yet. That fallback is deliberate, not
// just a placeholder — it's what keeps allowance enforcement working
// exactly as it always has for every profile this doesn't apply to yet.

// Unchanged signature for the pages that display a usage number — the logic
// itself now lives in core.ts so the API shares exactly one implementation.
export async function getMonthlyUsage(userId: string, periodStart?: string | null) {
  const supabase = await createClient();
  // Must be signed in. Another account's usage is readable only by an admin
  // (the /admin user page passes a different id); otherwise the argument is
  // ignored in favour of the caller's own — no trusting a raw id.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;
  let target = user.id;
  if (userId !== user.id) {
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "admin") return 0;
    target = userId;
  }
  return getMonthlyUsageWith(supabase, target, periodStart);
}
