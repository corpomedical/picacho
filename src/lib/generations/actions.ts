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
import { getAnglePreset } from "@/lib/generations/angles";
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/plans";

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

// Shared cost/abuse guardrail for both single and multi-angle generation.
// Enforced here, server-side — previously the plan limits were only ever
// used to *display* a number in Settings, never checked before a generation
// actually ran, so any account (or a direct script bypassing the UI) could
// call the paid pipeline without limit. Admins are exempt so testing and
// support work is never blocked by a customer-facing quota.
async function checkGenerationAllowance(
  supabase: SupabaseClient,
  userId: string,
  requestedCount: number,
): Promise<{ error: string | null; plan: PlanId; isAdmin: boolean }> {
  const [{ data: profile }, { data: recent }] = await Promise.all([
    supabase.from("profiles").select("plan, role").eq("id", userId).single(),
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

  const limit = PLAN_LIMITS[plan] ?? 0;
  const used = await getMonthlyUsage(userId);

  if (used + requestedCount > limit) {
    if (plan === "none") {
      return {
        error:
          "Your account doesn't have an active plan yet, so generations aren't available yet. Reach out and we'll get you set up.",
        plan,
        isAdmin,
      };
    }
    const remaining = Math.max(limit - used, 0);
    return {
      error:
        requestedCount > 1
          ? `That would use ${requestedCount} generations, but you only have ${remaining} left on your ${PLAN_LABELS[plan]} plan this month.`
          : `You've used all ${limit} generations included in your ${PLAN_LABELS[plan]} plan this month.`,
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

  // Dialogue — a spoken line the character says, lip-synced onto the video.
  // Available on every plan (no Elite-style gate), but does need the
  // character to have a voice assigned first (see Character settings).
  const dialogueText = (formData.get("dialogue") as string)?.trim() || "";
  const wantsDialogue = contentType === "video" && dialogueText.length > 0;

  if (!userInput) return { error: "Describe what you want first." };
  if (userInput.length > MAX_PROMPT_LENGTH) {
    return { error: `Keep prompts under ${MAX_PROMPT_LENGTH} characters.` };
  }
  if (!characterId) return { error: "Pick a character to generate with." };
  if (referencePhotoPaths.length > 0 && referencePhotoPaths.length < 2) {
    return { error: "Pick at least 2 reference photos, or none, for multi-image reference." };
  }
  if (referencePhotoPaths.length > 4) {
    return { error: "Multi-image reference supports up to 4 photos." };
  }
  if (dialogueText.length > MAX_DIALOGUE_LENGTH) {
    return { error: `Keep dialogue under ${MAX_DIALOGUE_LENGTH} characters.` };
  }

  const { data: character, error: characterError } = await supabase
    .from("character_profiles")
    .select("*")
    .eq("id", characterId)
    .single();

  if (characterError || !character) {
    return { error: "Couldn't find that character." };
  }

  // Resolve the character's assigned voice (if any) to a real ElevenLabs
  // voice_id before spending a generation attempt on a dialogue request that
  // can't actually produce speech.
  let dialogueVoiceId: string | null = null;
  if (wantsDialogue) {
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

  const {
    error: allowanceError,
    plan: userPlan,
    isAdmin,
  } = await checkGenerationAllowance(supabase, userData.user.id, 1);
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

  const [{ data: retrySetting }, { data: flag }, { data: videoModelSetting }, { data: imageModelSetting }] =
    await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "max_retry_attempts").single(),
      supabase.from("feature_flags").select("enabled").eq("key", "real_ai_providers").single(),
      supabase.from("app_settings").select("value").eq("key", "video_model").single(),
      supabase.from("app_settings").select("value").eq("key", "image_model").single(),
    ]);
  const maxAttempts = Number(retrySetting?.value) || undefined;
  const useRealProviders = flag?.enabled === true;
  const imageModelId = imageModelSetting?.value ?? "gpt-image";
  const videoModelId = videoModelSetting?.value ?? "kling";

  // Multi-image reference and storyboard are Kling-specific — Veo has no
  // equivalent on fal.ai. Catch this before spending a generation attempt,
  // not after a wasted paid call that silently ignores the options.
  if (wantsAdvancedVideoOptions && videoModelId !== "kling") {
    return {
      error:
        "Multi-image reference and storyboard need Kling as the active video model — " +
        "ask an admin to switch it in Admin > AI Providers, or turn these options off.",
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

  const characterForPipeline = {
    name: character.name,
    traits: character.traits ?? {},
    motion_style: character.motion_style,
    voice_tone_tags: character.voice_tone_tags ?? [],
  };

  // Save an "in progress" row up front. Previously nothing was written to the
  // database until the whole pipeline finished, so a crash or timeout partway
  // through left zero trace anywhere — not in history, not in the admin
  // dashboard. Now there's always a record, even if this never gets past
  // "generating".
  const { data: placeholder, error: placeholderError } = await supabase
    .from("generations")
    .insert({
      user_id: userData.user.id,
      character_profile_id: characterId,
      prompt_input: userInput,
      content_type: contentType,
      status: "generating",
      attempts: 0,
      result_url: null,
      pipeline_log: [],
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
      // For image scenes, anchor to the character's first saved reference
      // photo (if they have one) so the result actually looks like them.
      let referenceImageUrl: string | null = null;
      if (contentType === "image" && character.reference_image_urls?.[0]) {
        const { data: signed } = await supabase.storage
          .from("character-references")
          .createSignedUrl(character.reference_image_urls[0], 60 * 10);
        referenceImageUrl = signed?.signedUrl ?? null;
      }

      // Resolve advanced-option storage paths to short-lived signed URLs —
      // fal.ai needs to be able to fetch these over the open internet, and
      // the character-references bucket is private. A sign failure on one
      // photo just drops that photo rather than failing the whole request;
      // multi-reference still needs 2+ to survive that filter to be useful.
      let videoReferenceImageUrls: string[] | undefined;
      let videoStartImageUrl: string | null = null;
      let videoEndImageUrl: string | null = null;

      if (wantsAdvancedVideoOptions) {
        if (referencePhotoPaths.length >= 2) {
          const signedUrls = await Promise.all(
            referencePhotoPaths.map(async (path) => {
              const { data: signed } = await supabase.storage
                .from("character-references")
                .createSignedUrl(path, 60 * 10);
              return signed?.signedUrl ?? null;
            }),
          );
          videoReferenceImageUrls = signedUrls.filter((u): u is string => Boolean(u));
          if (videoReferenceImageUrls.length < 2) videoReferenceImageUrls = undefined;
        } else {
          if (storyboardStartPath) {
            const { data: signed } = await supabase.storage
              .from("character-references")
              .createSignedUrl(storyboardStartPath, 60 * 10);
            videoStartImageUrl = signed?.signedUrl ?? null;
          }
          if (storyboardEndPath) {
            const { data: signed } = await supabase.storage
              .from("character-references")
              .createSignedUrl(storyboardEndPath, 60 * 10);
            videoEndImageUrl = signed?.signedUrl ?? null;
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
          videoReferenceImageUrls,
          videoStartImageUrl,
          videoEndImageUrl,
          dialogueText: wantsDialogue ? dialogueText : undefined,
          dialogueVoiceId: wantsDialogue ? dialogueVoiceId : undefined,
          persistImage: (base64) => persistGeneratedImage(supabase, userData.user!.id, base64),
        },
        maxAttempts,
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
    await supabase
      .from("generations")
      .update({
        status: "failed",
        pipeline_log: [
          {
            attempt: 1,
            steps: [{ step: "generate", detail: message }],
            passed: false,
            issues: ["unexpected_error"],
            compiledPrompt: "",
          },
        ],
      })
      .eq("id", placeholder.id);
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

  if (!userInput) return { error: "Describe what you want first." };
  if (userInput.length > MAX_PROMPT_LENGTH) {
    return { error: `Keep prompts under ${MAX_PROMPT_LENGTH} characters.` };
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

  const { error: allowanceError } = await checkGenerationAllowance(
    supabase,
    userData.user.id,
    angleIds.length,
  );
  if (allowanceError) return { error: allowanceError };

  const [{ data: retrySetting }, { data: flag }, { data: videoModelSetting }] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "max_retry_attempts").single(),
    supabase.from("feature_flags").select("enabled").eq("key", "real_ai_providers").single(),
    supabase.from("app_settings").select("value").eq("key", "video_model").single(),
  ]);
  const maxAttempts = Number(retrySetting?.value) || undefined;
  const useRealProviders = flag?.enabled === true;

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

  const groupId = crypto.randomUUID();

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
          { contentType: "video", videoModelId: videoModelSetting?.value ?? "kling" },
          maxAttempts,
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
      if (rowId) {
        await supabase
          .from("generations")
          .update({
            status: "failed",
            pipeline_log: [
              {
                attempt: 1,
                steps: [{ step: "generate", detail: message }],
                passed: false,
                issues: ["unexpected_error"],
                compiledPrompt: "",
              },
            ],
          })
          .eq("id", rowId);
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

// Loads a character's past generations so the Generate screen can resume as
// an ongoing thread instead of starting blank every visit.
export async function getGenerationHistory(
  characterId: string,
  contentType: ContentType,
): Promise<HistoryTurn[]> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user || !characterId) return [];

  const { data, error } = await supabase
    .from("generations")
    .select("id, prompt_input, status, result_url, pipeline_log, created_at")
    .eq("character_profile_id", characterId)
    .eq("content_type", contentType)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error || !data) return [];

  return data.map((g) => {
    const attempts = (g.pipeline_log ?? []) as AttemptLog[];
    return {
      id: g.id,
      prompt: g.prompt_input as string,
      contentType,
      attempts,
      succeeded: g.status === "succeeded",
      finalPrompt: attempts[attempts.length - 1]?.compiledPrompt ?? "",
      resultUrl: g.result_url as string | null,
      createdAt: g.created_at as string,
    };
  });
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
export async function getMonthlyUsage(userId: string) {
  const supabase = await createClient();

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("generations")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfMonth.toISOString());

  return count ?? 0;
}
