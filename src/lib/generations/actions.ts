"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runPipeline,
  runRealPipeline,
  missingRealProviderKeys,
  type AttemptLog,
  type ContentType,
} from "@/lib/generations/pipeline";
import { getAnglePreset, angleSortIndex } from "@/lib/generations/angles";
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/plans";
import {
  getVideoModel,
  getDefaultDurationSeconds,
  getDurationCreditWeight,
  isValidDuration,
  VIDEO_MODELS,
} from "@/lib/generations/providers/video-models";
import { detectAspectRatioFromPrompt, type VideoAspectRatio } from "@/lib/generations/aspect-ratio";
import { autoReportFailedGeneration } from "@/lib/generations/reports";
import { isTrivialUtterance } from "@/lib/voice/agent";

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
    };

// Long enough for a genuinely detailed request, short enough that a stray
// giant paste can't turn into an oversized (and costly) AI call.
const MAX_PROMPT_LENGTH = 2000;

// A spoken line, not a scene description — kept much shorter than the main
// prompt. Also roughly bounds ElevenLabs TTS cost per generation.
const MAX_DIALOGUE_LENGTH = 500;

// Blocks a direct, scripted call to this action from firing faster than a
// real person could ever click — independent of the monthly plan cap below.
const COOLDOWN_MS = 3000;

async function persistGeneratedImage(
  supabase: SupabaseClient,
  userId: string,
  base64: string,
): Promise<string> {
  const bytes = Buffer.from(base64, "base64");
  const path = `${userId}/${crypto.randomUUID()}.png`;

  const { error } = await supabase.storage
    .from("generated-images")
    .upload(path, bytes, { contentType: "image/png" });
  if (error) throw new Error(`Couldn't save the generated image: ${error.message}`);

  const { data, error: signError } = await supabase.storage
    .from("generated-images")
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signError || !data?.signedUrl) {
    throw new Error("Generated the image but couldn't create a link to it.");
  }
  return data.signedUrl;
}

// Storyboard/multi-reference slots (see runGeneration below) can now come
// from either a character's own saved reference-photo bucket path (needs
// signing here, as before) or a photo freshly uploaded through the composer,
// which the client already has a ready, pre-signed URL for (see
// uploadChatAttachment in attachments/actions.ts) — passed straight through
// with no extra signing needed. A signed URL always starts with "http"; a
// character-references storage path never does, so that's a simple, reliable
// way to tell the two apart without a second formData field per slot.
async function resolveMaybeSignedUrl(
  supabase: SupabaseClient,
  pathOrUrl: string,
): Promise<string | null> {
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
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
): Promise<void> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return;
    const bytes = Buffer.from(await res.arrayBuffer());
    const path = `${userId}/${crypto.randomUUID()}-generated.png`;

    const { error: uploadError } = await supabase.storage
      .from("character-references")
      .upload(path, bytes, { contentType: "image/png" });
    if (uploadError) return;

    const { data: current } = await supabase
      .from("character_profiles")
      .select("reference_image_urls")
      .eq("id", characterId)
      .single();
    const existing: string[] = current?.reference_image_urls ?? [];

    await supabase
      .from("character_profiles")
      .update({
        reference_image_urls: existing.length === 0 ? [path] : [...existing, path],
      })
      .eq("id", characterId);
  } catch {
    // Best-effort enhancement — never let this take down an already-
    // succeeded generation.
  }
}

// Shared cost/abuse guardrail for both single and multi-angle generation.
// Enforced here, server-side — previously the plan limits were only ever
// used to *display* a number in Settings, never checked before a generation
// actually ran, so any account (or a direct script bypassing the UI) could
// call the paid pipeline without limit. Admins are exempt so testing and
// support work is never blocked by a customer-facing quota.
//
// requestedCredits, not a raw generation count: pricier models (e.g. Kling
// O3) consume more than 1 credit per video (see creditWeight in
// video-models.ts), so a single video can request >1 here, and a 3-angle
// multi-angle request on a premium model requests angles × weight.
async function checkGenerationAllowance(
  supabase: SupabaseClient,
  userId: string,
  requestedCredits: number,
): Promise<{ error: string | null; plan: PlanId; isAdmin: boolean }> {
  const [{ data: profile }, { data: recent }] = await Promise.all([
    supabase
      .from("profiles")
      .select("plan, role, bonus_credits, current_period_start")
      .eq("id", userId)
      .single(),
    supabase
      .from("generations")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const plan = (profile?.plan ?? "none") as PlanId;
  const isAdmin = profile?.role === "admin";

  if (isAdmin) return { error: null, plan, isAdmin };

  const lastCreatedAt = recent?.[0]?.created_at as string | undefined;
  if (lastCreatedAt && Date.now() - new Date(lastCreatedAt).getTime() < COOLDOWN_MS) {
    return {
      error: "You're generating a bit fast — wait a few seconds and try again.",
      plan,
      isAdmin,
    };
  }

  // Bonus credits (admin-granted, see setBonusCredits) stack on top of the
  // plan's normal allowance rather than replacing it.
  const limit = (PLAN_LIMITS[plan] ?? 0) + (profile?.bonus_credits ?? 0);
  const used = await getMonthlyUsage(userId, profile?.current_period_start as string | null | undefined);

  if (used + requestedCredits > limit) {
    // Only the true zero-allowance case (no plan, and no bonus credits
    // covering them either) gets the "no plan yet" message — a "none" plan
    // user who's been granted bonus credits and used all of those should see
    // the normal "used them all" message instead, not be told they have no
    // plan when they clearly did have some allowance a moment ago.
    if (plan === "none" && limit === 0) {
      return {
        error:
          "Your account doesn't have an active plan yet, so generations aren't available yet. Reach out and we'll get you set up.",
        plan,
        isAdmin,
      };
    }
    const remaining = Math.max(limit - used, 0);
    const planOrBonusLabel = plan === "none" ? "bonus" : PLAN_LABELS[plan];
    return {
      error:
        requestedCredits > 1
          ? `That would use ${requestedCredits} credits (some models cost more than 1 per video), but you only have ${remaining} left${plan === "none" ? "" : ` on your ${planOrBonusLabel} plan`} this month.`
          : `You've used all ${limit} credits${plan === "none" ? " you've been given" : ` included in your ${planOrBonusLabel} plan`} this month.`,
      plan,
      isAdmin,
    };
  }

  return { error: null, plan, isAdmin };
}

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
  // signed, fal.ai-fetchable URL from uploadChatAttachment, so no further
  // signing is needed here. When present, this is what the person actually
  // wants used for this one generation, ahead of the character's saved
  // default photo (see the anchor-resolution block below).
  const attachmentReferenceUrl = (formData.get("attachment_reference_url") as string) || "";

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
    ? await supabase.from("character_profiles").select("*").eq("id", characterId).single()
    : { data: null, error: null };
  const character = characterQuery.data;
  type CharacterRow = NonNullable<typeof character>;

  if (characterId && (characterQuery.error || !character)) {
    return { error: "Couldn't find that character." };
  }

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
    supabase.from("profiles").select("skip_ai_refinement").eq("id", userData.user.id).single(),
  ]);
  const maxAttempts = Number(retrySetting?.value) || undefined;
  const useRealProviders = flag?.enabled === true;
  const imageModelId = imageModelSetting?.value ?? "gpt-image";
  // Per-user preference (see setSkipAiRefinement in profile/actions.ts) —
  // skips the paid Claude draft + OpenAI review steps for THIS account's
  // generations only, not everyone's. See pipeline.ts's skipRefinement
  // option for what actually changes.
  const skipRefinement = userProfile?.skip_ai_refinement === true;

  // Multi-character images need OpenAI's real multi-image edit endpoint —
  // Flux's fal.ai endpoint only ever accepts one reference image, with no
  // way to composite several distinct characters into one picture. Caught
  // here against whatever the admin has the account's image model set to,
  // rather than silently generating with only one of the selected characters
  // actually represented.
  if (wantsMultiCharacter && contentType === "image" && imageModelId !== "gpt-image") {
    return {
      error:
        "Combining multiple characters in one image needs GPT Image 2 as the image model — " +
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
  const videoModelId =
    contentType === "video" && VIDEO_MODELS.some((m) => m.id === requestedVideoModelId)
      ? requestedVideoModelId
      : adminDefaultVideoModelId;
  const activeVideoModel = getVideoModel(videoModelId);

  // Duration is a per-generation choice too (see generate-form.tsx), same
  // pattern as the model picker — but never trust the raw number a form
  // could send: only accept it if it's actually one of this model's real
  // fal.ai duration options, otherwise fall back to that model's default
  // rather than silently sending fal.ai a value it might reject.
  const requestedDurationSeconds = Number(formData.get("video_duration_seconds"));
  const videoDurationSeconds =
    contentType === "video" && isValidDuration(activeVideoModel, requestedDurationSeconds)
      ? requestedDurationSeconds
      : getDefaultDurationSeconds(activeVideoModel);

  // Pricier models — and longer durations within a model — cost more of the
  // user's monthly plan allowance than the 5s baseline. Resolved once here
  // so both the allowance check below and the row we save afterward agree
  // on the same number.
  const creditWeight =
    contentType === "video" ? getDurationCreditWeight(activeVideoModel, videoDurationSeconds) : 1;

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

  // Kling O3 Standard's image-to-video endpoint requires a start frame —
  // there's no text-to-video fallback wired up for it (see fal.ts). That
  // frame can come from either the character's own saved reference photo or
  // a photo attached directly to this message (see attachmentReferenceUrl
  // above) — either satisfies it. Catch having neither before spending any
  // credits, not after the provider call fails.
  if (
    contentType === "video" &&
    videoModelId === "kling-o3" &&
    !attachmentReferenceUrl &&
    !character?.reference_image_urls?.[0]
  ) {
    return {
      error:
        "Kling O3 needs a reference photo — add one to this character, attach a photo to this message, or switch to Kling 1.6.",
    };
  }

  const {
    error: allowanceError,
    plan: userPlan,
    isAdmin,
  } = await checkGenerationAllowance(supabase, userData.user.id, creditWeight);
  if (allowanceError) return { error: allowanceError };

  // Multi-image reference and storyboard are Elite-exclusive. Checked here,
  // server-side, so this can't be bypassed by a direct call even though the
  // UI already hides the toggle for non-Elite accounts.
  if (wantsAdvancedVideoOptions && userPlan !== "elite" && !isAdmin) {
    return {
      error:
        "Multi-image reference and storyboard are exclusive to the Elite plan. Upgrade to use them, or turn these options off.",
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

  // The empty-name placeholder is what tells pipeline.ts "no character was
  // selected" — draft()/buildRulebook() there both special-case an empty
  // name rather than writing an awkward "Character: ." into the prompt.
  const characterForPipeline = character
    ? {
        name: character.name,
        traits: character.traits ?? {},
        motion_style: character.motion_style,
        voice_tone_tags: character.voice_tone_tags ?? [],
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

  // Save an "in progress" row up front. Previously nothing was written to the
  // database until the whole pipeline finished, so a crash or timeout partway
  // through left zero trace anywhere — not in history, not in the admin
  // dashboard. Now there's always a record, even if this never gets past
  // "generating".
  const { data: placeholder, error: placeholderError } = await supabase
    .from("generations")
    .insert({
      ...(clientGenerationId ? { id: clientGenerationId } : {}),
      user_id: userData.user.id,
      // Nullable — an empty string isn't a valid uuid, so "no character"
      // has to be a real null here, not "".
      character_profile_id: characterId || null,
      character_profile_ids: wantsMultiCharacter ? [characterId, ...companionCharacterIds] : [],
      prompt_input: userInput,
      content_type: contentType,
      status: "generating",
      attempts: 0,
      result_url: null,
      pipeline_log: [],
      video_model_id: contentType === "video" ? videoModelId : null,
      video_duration_seconds: contentType === "video" ? videoDurationSeconds : null,
      video_aspect_ratio: contentType === "video" ? videoAspectRatio : null,
      credits_used: creditWeight,
    })
    .select("id")
    .single();

  if (placeholderError || !placeholder) {
    return { error: "Couldn't start this generation — try again." };
  }

  let attempts: AttemptLog[] = [];
  let succeeded = false;
  let finalPrompt = "";
  let resultUrl: string | null = null;

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
          anchorUrl = attachmentReferenceUrl;
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

      const result = await runRealPipeline(
        userInput,
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
          companions: wantsMultiCharacter ? companionsForPipeline : undefined,
          dialogueText: wantsDialogue ? dialogueText : undefined,
          dialogueVoiceId: wantsDialogue ? dialogueVoiceId : undefined,
          videoDurationSeconds: contentType === "video" ? videoDurationSeconds : undefined,
          videoAspectRatio: contentType === "video" ? videoAspectRatio : undefined,
          skipRefinement,
          persistImage: (base64) => persistGeneratedImage(supabase, userData.user!.id, base64),
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
      ({ attempts, succeeded, finalPrompt, resultUrl } = result);
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
    await supabase
      .from("generations")
      .update({ status: "failed", pipeline_log: crashLog })
      .eq("id", placeholder.id);
    await autoReportFailedGeneration(placeholder.id, userData.user.id, crashLog);
    return { error: message };
  }

  const { error: updateError } = await supabase
    .from("generations")
    .update({
      status: succeeded ? "succeeded" : "failed",
      attempts: attempts.length,
      result_url: resultUrl,
      pipeline_log: attempts,
    })
    .eq("id", placeholder.id);

  if (updateError) {
    return { error: "Finished, but couldn't save the result — try refreshing History in a moment." };
  }

  if (!succeeded) {
    await autoReportFailedGeneration(placeholder.id, userData.user.id, attempts);
  }

  // Nothing to add this to when the generation wasn't tied to any character
  // in the first place — a plain upload/no-character image just isn't saved
  // anywhere but History.
  if (succeeded && contentType === "image" && characterId && resultUrl?.startsWith("http")) {
    await addGeneratedImageAsReference(supabase, userData.user.id, characterId, resultUrl);
    revalidatePath("/app/character");
    revalidatePath(`/app/character/${characterId}`);
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
  };
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
// a usable generation afterwards. Deliberately does NOT clear credits_used
// or delete the row: the provider call really was made and really was
// billed, so the credit genuinely was spent — quietly zeroing it here would
// just move the inaccuracy somewhere harder to notice.
export async function discardStoppedGeneration(generationId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const { error } = await supabase
    .from("generations")
    .update({ status: "failed", result_url: null })
    .eq("id", generationId)
    .eq("user_id", userData.user.id);

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
  const angleIds = (formData.getAll("angle") as string[]).filter(Boolean);
  // Same idea as runGeneration's clientGenerationId — generated up front on
  // the client so the Stop button has something to cancel against before
  // this action has returned anything.
  const clientGroupId = (formData.get("angle_group_id") as string) || undefined;
  // Same attachment/anchor-photo priority as runGeneration — see the
  // comments there.
  const attachmentReferenceUrl = (formData.get("attachment_reference_url") as string) || "";
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
  const videoModelId = VIDEO_MODELS.some((m) => m.id === requestedVideoModelId)
    ? requestedVideoModelId
    : (videoModelSetting?.value ?? "kling");
  const activeVideoModel = getVideoModel(videoModelId);

  const requestedDurationSeconds = Number(formData.get("video_duration_seconds"));
  const videoDurationSeconds = isValidDuration(activeVideoModel, requestedDurationSeconds)
    ? requestedDurationSeconds
    : getDefaultDurationSeconds(activeVideoModel);
  const creditWeight = getDurationCreditWeight(activeVideoModel, videoDurationSeconds);

  // Same resolution order as runGeneration (see the comment there): prompt
  // text beats the icon pick, which beats the 16:9 default.
  const requestedAspectRatio = (formData.get("video_aspect_ratio") as string) || "";
  const iconAspectRatio: VideoAspectRatio | null =
    requestedAspectRatio === "16:9" || requestedAspectRatio === "9:16" ? requestedAspectRatio : null;
  const promptAspectRatio = detectAspectRatioFromPrompt(userInput);
  const videoAspectRatio: VideoAspectRatio = promptAspectRatio ?? iconAspectRatio ?? "16:9";

  if (videoModelId === "kling-o3" && !character.reference_image_urls?.[0]) {
    return {
      error:
        "Kling O3 needs this character to have a reference photo — add one in Character settings, or switch to Kling 1.6.",
    };
  }

  const { error: allowanceError } = await checkGenerationAllowance(
    supabase,
    userData.user.id,
    angleIds.length * creditWeight,
  );
  if (allowanceError) return { error: allowanceError };

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
  if (useRealProviders) {
    if (attachmentReferenceUrl) {
      videoCharacterAnchorUrl = attachmentReferenceUrl;
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
  }

  const groupId = clientGroupId ?? crypto.randomUUID();

  const { data: placeholders, error: placeholderError } = await supabase
    .from("generations")
    .insert(
      angleIds.map((angleId) => ({
        user_id: userData.user!.id,
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
        video_duration_seconds: videoDurationSeconds,
        video_aspect_ratio: videoAspectRatio,
        credits_used: creditWeight,
      })),
    )
    .select("id, angle");

  if (placeholderError || !placeholders) {
    return { error: "Couldn't start these generations — try again." };
  }

  const placeholderByAngle = new Map(placeholders.map((p) => [p.angle as string, p.id as string]));

  // Promise.allSettled (not Promise.all) so one angle throwing can't strand
  // the others mid-flight — every angle's placeholder row above already
  // exists, so each one gets updated to its true final state below no matter
  // what happens to its siblings. Previously a shared Promise.all meant a
  // single failure could leave other angles' results uninserted-but-still-
  // running, invisible to the UI, and never cleaned up.
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
        const result = await runRealPipeline(
          angledInput,
          characterForPipeline,
          {
            contentType: "video",
            videoModelId,
            videoCharacterAnchorUrl,
            videoDurationSeconds,
            videoAspectRatio,
            skipRefinement,
          },
          maxAttempts,
          // Every angle shares one cancel_requested flag via angle_group_id
          // (set in bulk by requestMultiAngleGenerationCancel), but each
          // angle checks its own row so one angle finishing/failing first
          // doesn't affect how the others notice the stop request.
          rowId
            ? async () => {
                const { data } = await supabase
                  .from("generations")
                  .select("cancel_requested")
                  .eq("id", rowId)
                  .single();
                return data?.cancel_requested === true;
              }
            : undefined,
        );
        ({ attempts, succeeded, finalPrompt, resultUrl } = result);
      } else {
        const result = runPipeline(angledInput, characterForPipeline, maxAttempts, "video");
        ({ attempts, succeeded, finalPrompt, resultUrl } = result);
      }

      if (rowId) {
        await supabase
          .from("generations")
          .update({
            status: succeeded ? "succeeded" : "failed",
            attempts: attempts.length,
            result_url: resultUrl,
            pipeline_log: attempts,
          })
          .eq("id", rowId);
        if (!succeeded) {
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
        await supabase
          .from("generations")
          .update({ status: "failed", pipeline_log: crashLog })
          .eq("id", rowId);
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

  const { error } = await supabase
    .from("generations")
    .update({ cancel_requested: true })
    .eq("angle_group_id", groupId)
    .eq("user_id", userData.user.id)
    .eq("status", "generating");

  if (error) {
    console.error("requestMultiAngleGenerationCancel failed:", error.message);
    return { error: "Couldn't stop these generations — try again." };
  }

  return { error: null };
}

// Pulls the Storage object path back out of a signed URL created by
// persistGeneratedImage, e.g.
// ".../object/sign/generated-images/<userId>/<uuid>.png?token=..." ->
// "<userId>/<uuid>.png". Video results are hosted externally on fal.ai's CDN
// and were never uploaded to our own Storage, so this only ever applies to
// image generations.
function extractStoragePath(url: string | null, bucket: string): string | null {
  if (!url) return null;
  const marker = `/object/sign/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = url.slice(idx + marker.length).split("?")[0];
  return path ? decodeURIComponent(path) : null;
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
    .select("id, angle_group_id, content_type, result_url")
    .eq("id", id)
    .eq("user_id", userData.user.id)
    .single();

  if (!row) return { error: "Couldn't find that generation." };

  const { data: group } = row.angle_group_id
    ? await supabase
        .from("generations")
        .select("id, content_type, result_url")
        .eq("angle_group_id", row.angle_group_id)
        .eq("user_id", userData.user.id)
    : { data: null };

  const rows = group && group.length > 0 ? group : [row];

  const { error } = await supabase
    .from("generations")
    .delete()
    .eq("user_id", userData.user.id)
    .in(
      "id",
      rows.map((r) => r.id),
    );

  if (error) {
    console.error("deleteGeneration failed:", error.message);
    return { error: "Couldn't delete this — try again." };
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

  const columns = "id, prompt_input, content_type, status, result_url, pipeline_log, created_at, angle_group_id, angle";

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
          resultUrl: r.result_url as string | null,
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
    resultUrl: row.result_url as string | null,
    createdAt: row.created_at as string,
  };
}

export async function getReliabilityStats(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("generations")
    .select("attempts, status")
    .in("status", ["succeeded", "failed"])
    .eq("user_id", userId);

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
export async function getMonthlyUsage(userId: string, periodStart?: string | null) {
  const supabase = await createClient();

  const start = periodStart ? new Date(periodStart) : (() => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    return startOfMonth;
  })();

  const { data } = await supabase
    .from("generations")
    .select("credits_used")
    .eq("user_id", userId)
    .gte("created_at", start.toISOString());

  return (data ?? []).reduce((sum, row) => sum + (Number(row.credits_used) || 1), 0);
}
