// The compiler pipeline. runPipeline() is the original all-mock version
// (kept as-is — it's the safe default and needs no API keys). runRealPipeline()
// does the same job using real providers: Claude drafts, OpenAI reviews, and
// either a video model (fal.ai — Kling by default) or an image model
// (GPT Image 2 by default, Flux alternative) generates the result. Which one
// runs is decided by the 'real_ai_providers' feature flag, checked by the
// caller in src/lib/generations/actions.ts.

import { draftWithClaude } from "@/lib/generations/providers/anthropic";
import { reviewWithOpenAI } from "@/lib/generations/providers/openai";
import { generateVideo, generateSpeech, lipSyncVideo } from "@/lib/generations/providers/fal";
import { getVideoModel } from "@/lib/generations/providers/video-models";
import { generateImage } from "@/lib/generations/providers/image";
import { getImageModel } from "@/lib/generations/providers/image-models";

export type ContentType = "video" | "image";

export type CharacterTraits = {
  hair?: string;
  outfit?: string;
  personality?: string;
  distinguishing_features?: string;
};

export type CharacterForPipeline = {
  name: string;
  traits: CharacterTraits;
  motion_style?: string | null;
  voice_tone_tags?: string[];
};

export type PipelineStepLog = {
  step: "draft" | "review" | "generate" | "validate" | "speech" | "lipsync";
  detail: string;
};

export const STEP_LABELS: Record<PipelineStepLog["step"], string> = {
  draft: "Drafted",
  review: "Reviewed",
  generate: "Generating",
  validate: "Validated",
  speech: "Voice generated",
  lipsync: "Lip-synced",
};

export type AttemptLog = {
  attempt: number;
  steps: PipelineStepLog[];
  passed: boolean;
  issues: string[];
  compiledPrompt: string;
};

export type PipelineResult = {
  attempts: AttemptLog[];
  succeeded: boolean;
  finalPrompt: string;
  resultUrl: string | null;
};

const DEFAULT_MAX_ATTEMPTS = 3;

function requiredElements(character: CharacterForPipeline): { label: string; value: string }[] {
  const elements: { label: string; value: string }[] = [];
  if (character.traits.hair) elements.push({ label: "hair", value: character.traits.hair });
  if (character.traits.outfit) elements.push({ label: "outfit", value: character.traits.outfit });
  if (character.traits.personality)
    elements.push({ label: "personality", value: character.traits.personality });
  if (character.traits.distinguishing_features)
    elements.push({ label: "distinguishing features", value: character.traits.distinguishing_features });
  if (character.motion_style) elements.push({ label: "motion style", value: character.motion_style });
  if (character.voice_tone_tags?.length)
    elements.push({ label: "tone", value: character.voice_tone_tags.join(", ") });
  return elements;
}

function draft(userInput: string, character: CharacterForPipeline, omitMotion: boolean) {
  const parts = [
    `Character: ${character.name}.`,
    character.traits.hair && `Hair: ${character.traits.hair}.`,
    character.traits.outfit && `Outfit: ${character.traits.outfit}.`,
    character.traits.personality && `Personality: ${character.traits.personality}.`,
    character.traits.distinguishing_features &&
      `Distinguishing features: ${character.traits.distinguishing_features}.`,
    !omitMotion && character.motion_style && `Motion style: ${character.motion_style}.`,
    character.voice_tone_tags?.length && `Tone: ${character.voice_tone_tags.join(", ")}.`,
    `Request: ${userInput}`,
  ].filter(Boolean);
  return parts.join(" ");
}

function review(prompt: string, missing: { label: string; value: string }[]) {
  if (missing.length === 0) return prompt;
  const additions = missing.map((m) => `${m.label}: ${m.value}.`).join(" ");
  return `${prompt} ${additions}`;
}

function validate(prompt: string, character: CharacterForPipeline) {
  const required = requiredElements(character);
  const missing = required.filter((el) => !prompt.toLowerCase().includes(el.value.toLowerCase()));
  return { passed: missing.length === 0, missing };
}

export function runPipeline(
  userInput: string,
  character: CharacterForPipeline,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  contentType: ContentType = "video",
): PipelineResult {
  const attempts: AttemptLog[] = [];
  let finalPrompt = "";

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    // Simulate a realistic first draft that sometimes leaves out the motion
    // style — this is exactly the kind of miss the review/validate steps
    // exist to catch before the user ever sees a bad result.
    const omitMotion = attemptNumber === 1 && Boolean(character.motion_style);

    const draftedPrompt = draft(userInput, character, omitMotion);
    const steps: PipelineStepLog[] = [
      { step: "draft", detail: draftedPrompt },
    ];

    const draftCheck = validate(draftedPrompt, character);
    const reviewedPrompt = review(draftedPrompt, draftCheck.missing);
    steps.push({ step: "review", detail: reviewedPrompt });

    steps.push({
      step: "generate",
      detail: `Mock ${contentType} generation from compiled prompt (no provider connected yet).`,
    });

    const finalCheck = validate(reviewedPrompt, character);
    steps.push({
      step: "validate",
      detail: finalCheck.passed
        ? "All rulebook elements present."
        : `Missing: ${finalCheck.missing.map((m) => m.label).join(", ")}.`,
    });

    attempts.push({
      attempt: attemptNumber,
      steps,
      passed: finalCheck.passed,
      issues: finalCheck.missing.map((m) => m.label),
      compiledPrompt: reviewedPrompt,
    });

    finalPrompt = reviewedPrompt;

    if (finalCheck.passed) {
      return { attempts, succeeded: true, finalPrompt, resultUrl: "mock://generated-result" };
    }
  }

  return { attempts, succeeded: false, finalPrompt, resultUrl: null };
}

export function missingRealProviderKeys(contentType: ContentType, imageModelId?: string): string[] {
  const missing: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (contentType === "video" && !process.env.FAL_KEY) missing.push("FAL_KEY");
  if (contentType === "image") {
    const model = getImageModel(imageModelId ?? "gpt-image");
    if (model.provider === "fal" && !process.env.FAL_KEY) missing.push("FAL_KEY");
  }
  return missing;
}

export type RealPipelineOptions = {
  contentType: ContentType;
  videoModelId?: string;
  imageModelId?: string;
  referenceImageUrl?: string | null;
  // Only needed for image generation with OpenAI, which returns raw image
  // bytes rather than a hosted URL — the caller (which owns the Supabase
  // client) persists it and hands back a durable link.
  persistImage?: (base64: string) => Promise<string>;
  // Kling-specific advanced video options (see fal.ts) — the caller is
  // responsible for only setting these when the active video model is
  // actually Kling, and for resolving character reference photos to signed
  // URLs before they get here.
  videoReferenceImageUrls?: string[];
  videoStartImageUrl?: string | null;
  videoEndImageUrl?: string | null;
  // Character dialogue — a spoken line for the character to say, lip-synced
  // onto the finished video. dialogueVoiceId is the character's assigned
  // ElevenLabs voice_id (already resolved by the caller from voice_presets),
  // not our own internal preset id. Available on every plan, no model
  // restriction (unlike the Kling-only options above).
  dialogueText?: string;
  dialogueVoiceId?: string | null;
};

export async function runRealPipeline(
  userInput: string,
  character: CharacterForPipeline,
  options: RealPipelineOptions,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<PipelineResult> {
  const attempts: AttemptLog[] = [];
  let finalPrompt = "";
  const rulebook =
    requiredElements(character)
      .map((el) => `- ${el.label}: ${el.value}`)
      .join("\n") || "(no fixed traits set on this character yet)";

  const mediumLabel = options.contentType === "video" ? "video" : "image";

  // A bare provider/network failure on the generate step (not a prompt-quality
  // miss) gets a couple of quick retries reusing the SAME reviewed prompt,
  // instead of paying for a brand-new draft+review pass. Keeps worst-case
  // cost down when e.g. fal.ai has a transient hiccup.
  const GENERATE_RETRIES = 2;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    const steps: PipelineStepLog[] = [];
    const previousIssues = attempts[attempts.length - 1]?.issues ?? [];

    // Drafting/reviewing can fail too (provider hiccup, rate limit, timeout) —
    // record it as a failed attempt and move on to the next one instead of
    // throwing and taking down the whole request with no trace of what
    // happened.
    let draftedPrompt: string;
    let reviewedPrompt: string;
    try {
      draftedPrompt = await draftWithClaude(
        `You are a prompt engineer for an AI ${mediumLabel} generator. Expand this ` +
          `plain-language request into one detailed, vivid text-to-${mediumLabel} prompt — ` +
          `2 to 4 sentences, no preamble, no markdown, just the prompt itself.\n\n` +
          `Character rulebook (every item must be reflected in the prompt):\n${rulebook}\n\n` +
          `User request: ${userInput}` +
          (previousIssues.length
            ? `\n\nA previous attempt was missing: ${previousIssues.join(", ")}. Make sure this one includes them.`
            : ""),
      );
      steps.push({ step: "draft", detail: draftedPrompt });

      reviewedPrompt = await reviewWithOpenAI(
        `Tighten this AI ${mediumLabel} generation prompt so it definitely reflects every ` +
          `item in the rulebook below. Return only the improved prompt text, nothing else.\n\n` +
          `Rulebook:\n${rulebook}\n\nPrompt to review:\n${draftedPrompt}`,
      );
      steps.push({ step: "review", detail: reviewedPrompt });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Prompt preparation failed.";
      steps.push({ step: steps.length === 0 ? "draft" : "review", detail: message });
      attempts.push({
        attempt: attemptNumber,
        steps,
        passed: false,
        issues: ["provider_error"],
        compiledPrompt: finalPrompt,
      });
      continue;
    }

    let resultUrl: string | null = null;
    let generateFailed = false;
    for (let genTry = 1; genTry <= GENERATE_RETRIES; genTry++) {
      try {
        if (options.contentType === "video") {
          const usingMultiRef = (options.videoReferenceImageUrls?.length ?? 0) >= 2;
          const usingStoryboard =
            !usingMultiRef && Boolean(options.videoStartImageUrl || options.videoEndImageUrl);
          resultUrl = await generateVideo(reviewedPrompt, options.videoModelId ?? "kling", {
            referenceImageUrls: options.videoReferenceImageUrls,
            startImageUrl: options.videoStartImageUrl,
            endImageUrl: options.videoEndImageUrl,
          });
          const modeNote = usingMultiRef
            ? " (multi-image reference)"
            : usingStoryboard
              ? " (storyboard)"
              : "";
          steps.push({
            step: "generate",
            detail: `Generated via ${getVideoModel(options.videoModelId ?? "kling").name}${modeNote}${
              genTry > 1 ? ` (recovered after a retry).` : "."
            }`,
          });
        } else {
          if (!options.persistImage) throw new Error("Image persistence handler missing.");
          const imageModelId = options.imageModelId ?? "gpt-image";
          resultUrl = await generateImage(
            imageModelId,
            reviewedPrompt,
            options.referenceImageUrl,
            options.persistImage,
          );
          steps.push({
            step: "generate",
            detail: `Generated via ${getImageModel(imageModelId).name}${
              options.referenceImageUrl ? " (anchored to reference photo)" : ""
            }${genTry > 1 ? " (recovered after a retry)" : ""}.`,
          });
        }
        generateFailed = false;
        break;
      } catch (err) {
        generateFailed = true;
        const message = err instanceof Error ? err.message : `${mediumLabel} generation failed.`;
        steps.push({
          step: "generate",
          detail: genTry < GENERATE_RETRIES ? `${message} Retrying...` : message,
        });
      }
    }

    // Validation is still the deterministic rulebook text-check for now —
    // scoring the actual generated video/image with a vision model is a
    // further step beyond this pass. See project notes.
    const finalCheck = validate(reviewedPrompt, character);
    steps.push({
      step: "validate",
      detail: finalCheck.passed
        ? "All rulebook elements present in the compiled prompt."
        : `Missing: ${finalCheck.missing.map((m) => m.label).join(", ")}.`,
    });

    const passed = finalCheck.passed && Boolean(resultUrl);

    attempts.push({
      attempt: attemptNumber,
      steps,
      passed,
      issues: [
        ...finalCheck.missing.map((m) => m.label),
        ...(generateFailed && !resultUrl ? ["provider_error"] : []),
      ],
      compiledPrompt: reviewedPrompt,
    });

    finalPrompt = reviewedPrompt;

    if (passed) {
      // Dialogue is a post-processing enhancement on an already-successful
      // video, not part of the retry loop above — a voice or lip-sync
      // hiccup here must never throw away a video that already generated
      // and validated correctly. Any failure just logs a note and hands
      // back the silent video instead.
      if (
        options.contentType === "video" &&
        options.dialogueText?.trim() &&
        options.dialogueVoiceId &&
        resultUrl
      ) {
        try {
          const audioUrl = await generateSpeech(options.dialogueText.trim(), options.dialogueVoiceId);
          steps.push({ step: "speech", detail: "Generated dialogue audio via ElevenLabs." });

          const syncedUrl = await lipSyncVideo(resultUrl, audioUrl);
          steps.push({ step: "lipsync", detail: "Synced the character's mouth to the dialogue via Sync Labs." });
          resultUrl = syncedUrl;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Dialogue voice generation failed.";
          steps.push({ step: "speech", detail: `${message} Showing the video without dialogue.` });
        }
      }

      return { attempts, succeeded: true, finalPrompt, resultUrl };
    }
  }

  return { attempts, succeeded: false, finalPrompt, resultUrl: null };
}
