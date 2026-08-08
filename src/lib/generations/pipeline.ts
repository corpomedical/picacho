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
import type { VideoAspectRatio } from "@/lib/generations/aspect-ratio";

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
  // True only when a checkCancelled callback reported a stop request — lets
  // the caller (and eventually the UI) show "Stopped" instead of a generic
  // failure message.
  cancelled?: boolean;
};

// Polled between attempts (and once per attempt, right before the slow
// generate call) so a user hitting "Stop" doesn't have to wait for the
// entire configured attempt budget to run out before it takes effect. This
// can't reach into a fetch that's already in flight to a provider — there's
// no cheap way to hard-abort a request already sent to Claude/OpenAI/fal.ai
// from here — but it does stop the NEXT attempt or the generate step of the
// current one from ever starting, which is where almost all of the time and
// cost in a multi-attempt run actually goes.
export type CheckCancelled = () => Promise<boolean>;

const DEFAULT_MAX_ATTEMPTS = 3;

function requiredElements(
  character: CharacterForPipeline,
  contentType: ContentType = "video",
): { label: string; value: string }[] {
  const elements: { label: string; value: string }[] = [];
  if (character.traits.hair) elements.push({ label: "hair", value: character.traits.hair });
  if (character.traits.outfit) elements.push({ label: "outfit", value: character.traits.outfit });
  if (character.traits.personality)
    elements.push({ label: "personality", value: character.traits.personality });
  if (character.traits.distinguishing_features)
    elements.push({ label: "distinguishing features", value: character.traits.distinguishing_features });
  // Motion only means anything for video — requiring it in a still-image
  // prompt was causing every image generation to fail validation forever
  // (a well-formed image prompt correctly has no motion description to
  // match against), burning real generation calls for nothing. Found via
  // a real end-to-end test run, 2026-08-07.
  if (contentType === "video" && character.motion_style)
    elements.push({ label: "motion style", value: character.motion_style });
  if (character.voice_tone_tags?.length)
    elements.push({ label: "tone", value: character.voice_tone_tags.join(", ") });
  return elements;
}

// Word-level presence check instead of requiring the trait's exact phrase
// verbatim. The draft/review models paraphrase constantly and correctly
// (e.g. a character's outfit trait saved as "white v shirt" becomes, quite
// reasonably, "white V-neck shirt" in the actual prompt) — matching on the
// literal substring flagged those as "missing" even though the trait was
// clearly present, discarding perfectly good — and already paid-for —
// generations. Requiring most of a trait's significant words to appear
// somewhere in the prompt is far more forgiving of real paraphrasing while
// still catching genuinely missing elements.
function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

// A single typo in a character's own saved trait data (e.g. "freckels" for
// "freckles") should never be able to permanently block every generation for
// that character — no AI is ever going to reproduce a misspelling back at
// us, so an exact/substring match against it can never pass, no matter how
// many attempts or retries run. This is a real incident, not a hypothetical:
// it silently burned through several paid attempts on 2026-08-07 before
// being traced to one misspelled word. Levenshtein distance catches close
// spelling variants (typos, transpositions) without being so loose that
// unrelated words start matching.
function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, (_, i) => [
    i,
    ...Array(cols - 1).fill(0),
  ]);
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[rows - 1][cols - 1];
}

function wordsAreCloseEnough(a: string, b: string): boolean {
  if (a === b) return true;
  // Tighter tolerance for short words (so e.g. "red" doesn't loosely match
  // "bed") and a bit more slack as words get longer.
  const maxDistance = a.length <= 4 ? 1 : a.length <= 8 ? 2 : 3;
  return levenshteinDistance(a, b) <= maxDistance;
}

function isElementPresent(prompt: string, value: string): boolean {
  const words = normalizeWords(value);
  if (words.length === 0) return true;
  const promptWords = normalizeWords(prompt);
  const matched = words.filter((w) =>
    promptWords.some((pw) => wordsAreCloseEnough(w, pw)),
  ).length;
  return matched / words.length >= 0.6;
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

// overriddenLabels excludes rulebook items the user's own request explicitly
// asked to change for this one generation (see splitOverrides below) — e.g.
// asking for a character to wear a suit instead of their usual saved outfit.
// Real incident, 2026-08-08: without this, a request to put Adam in a suit
// came back wearing his default leather jacket instead — the review step,
// with no way to know the outfit change was intentional, "corrected" the
// draft back to match the rulebook, silently overriding the user's actual
// ask. Empty by default so every existing call site (including the mock
// runPipeline, which never computes overrides) behaves exactly as before.
function validate(
  prompt: string,
  character: CharacterForPipeline,
  contentType: ContentType = "video",
  overriddenLabels: Set<string> = new Set(),
) {
  const required = requiredElements(character, contentType).filter(
    (el) => !overriddenLabels.has(el.label.toLowerCase()),
  );
  const missing = required.filter((el) => !isElementPresent(prompt, el.value));
  return { passed: missing.length === 0, missing };
}

// One character's block of the rulebook text sent to Claude/OpenAI —
// labeled with the character's name and, for a multi-character generation,
// their role in the scene, so the AI can write each one in individually
// instead of blending their traits together into one description. Takes an
// already-computed element list (rather than the character itself) so the
// caller can pass either the full list (for the draft step, which needs to
// see everything to decide what's being intentionally overridden) or an
// override-filtered list (for review/validate, which should only enforce
// what the user didn't just ask to change).
function characterRulebookBlock(
  characterName: string,
  elements: { label: string; value: string }[],
  role?: string,
): string {
  const lines = elements.map((el) => `- ${el.label}: ${el.value}`);
  const header = role ? `${characterName} (${role}):` : `${characterName}:`;
  return [header, ...(lines.length ? lines : ["- (no fixed traits set yet)"])].join("\n");
}

// Drops any rulebook element whose label the user's request intentionally
// overrides for this generation, so review/validate stop fighting to force
// a trait back in that the person explicitly asked to change.
function excludeOverridden(
  elements: { label: string; value: string }[],
  overriddenLabels: Set<string>,
): { label: string; value: string }[] {
  if (overriddenLabels.size === 0) return elements;
  return elements.filter((el) => !overriddenLabels.has(el.label.toLowerCase()));
}

// The draft step is asked to end its response with a line naming any
// rulebook labels this specific request overrides (see the prompt text in
// runRealPipeline below) — this splits that line back off, so the rest of
// the pipeline gets a clean prompt plus a plain Set of overridden labels.
// Falls back to "no overrides" (the old, fully-enforced behavior) if Claude
// doesn't follow the format for some reason, rather than throwing — a
// missed override just means one attempt over-enforces a trait, which is
// the same behavior this code had before this fix existed.
function splitOverrides(rawResponse: string): { promptText: string; overrides: Set<string> } {
  const response = rawResponse.trim();
  const match = response.match(/\n\s*OVERRIDES:\s*(.+)\s*$/i);
  if (!match) return { promptText: response, overrides: new Set() };
  const promptText = response.slice(0, match.index).trim();
  const listPart = match[1].trim().replace(/\.$/, "");
  if (!listPart || /^none$/i.test(listPart)) return { promptText, overrides: new Set() };
  const overrides = new Set(
    listPart
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return { promptText, overrides };
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

    const draftCheck = validate(draftedPrompt, character, contentType);
    const reviewedPrompt = review(draftedPrompt, draftCheck.missing);
    steps.push({ step: "review", detail: reviewedPrompt });

    steps.push({
      step: "generate",
      detail: `Mock ${contentType} generation from compiled prompt (no provider connected yet).`,
    });

    const finalCheck = validate(reviewedPrompt, character, contentType);
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

// 404/401/403 from a provider mean the request itself is fundamentally
// broken — a wrong endpoint path, a bad or missing API key — not a flaky
// network blip. No number of retries with the same (or even a freshly
// redrafted) prompt will ever turn a 404 into a 200, so retrying on these
// only burns extra Claude/OpenAI calls and stretches a failure that could
// surface in one request out to minutes. Real incident, 2026-08-07: a
// hardcoded Kling endpoint that didn't exist 404'd on every single one of
// 3 attempts x 2 generate-retries before finally giving up. 400s are
// deliberately NOT included here — production data shows OpenAI's
// content-safety check can 400 transiently and succeed on the very next
// retry, so blocking all 400s would throw that real recovery away.
const NON_RETRYABLE_STATUS_CODES = new Set([401, 403, 404]);

function isNonRetryableProviderError(message: string): boolean {
  const match = message.match(/\((\d{3})\)/);
  if (match && NON_RETRYABLE_STATUS_CODES.has(Number(match[1]))) return true;
  // A video generation that never finished within generateVideo's own
  // (generous, ~10 minute) wait ceiling gets explicitly cancelled there —
  // but "cancelled" isn't the same as "confirmed dead." fal.ai's own docs
  // are explicit that a cancel signal doesn't always stop an in-progress
  // job, so there's no way to be certain the original request won't still
  // complete and bill. Firing a brand-new paid attempt on top of that
  // uncertainty is exactly the kind of compounding cost this whole
  // classifier exists to prevent — real incident, 2026-08-07: three full
  // attempts each timing out (the old, shorter timeout) burned real money
  // on jobs that likely kept running after we walked away from them.
  if (/didn't finish within .* minutes/.test(message)) return true;
  return false;
}

export type RealPipelineOptions = {
  contentType: ContentType;
  videoModelId?: string;
  imageModelId?: string;
  referenceImageUrl?: string | null;
  // Multi-character images only — one reference photo per selected
  // character (primary first, then companions), routed to OpenAI's
  // multi-image edit endpoint instead of the single-image one. Set by the
  // caller only when companions below is also set; referenceImageUrl
  // (singular) keeps handling every ordinary single-character image exactly
  // as before.
  referenceImageUrls?: string[];
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
  // The character's own first reference photo, signed and resolved by the
  // caller — used as a baseline identity anchor for video (see fal.ts) any
  // time the options above aren't set. Unlike those, this applies on every
  // plan: it's the same "look like the saved character" behavior image
  // generation already gets automatically, not an Elite-exclusive extra.
  videoCharacterAnchorUrl?: string | null;
  // Character dialogue — a spoken line for the character to say, lip-synced
  // onto the finished video. dialogueVoiceId is the character's assigned
  // ElevenLabs voice_id (already resolved by the caller from voice_presets),
  // not our own internal preset id. Available on every plan, no model
  // restriction (unlike the Kling-only options above).
  dialogueText?: string;
  dialogueVoiceId?: string | null;
  // Requested clip length in seconds — the caller (actions.ts) is
  // responsible for validating this against the selected model's real
  // duration options (see video-models.ts) before it gets here.
  videoDurationSeconds?: number;
  // Resolved aspect ratio (prompt text > composer icon pick > 16:9 default —
  // see actions.ts and aspect-ratio.ts). Kling O3 has no native parameter
  // for this; fal.ts works around that by reframing the reference photo
  // itself before the request goes out.
  videoAspectRatio?: VideoAspectRatio | null;
  // Per-user preference (profiles.skip_ai_refinement, toggled from the
  // sidebar settings menu / Settings page) — when true, skips the paid
  // Claude draft + OpenAI review calls entirely and sends the user's typed
  // prompt straight to the generator. Since there's no AI rewrite to check,
  // the rulebook validation gate below is skipped too when this is on (see
  // the `finalCheck` calc) — character identity still comes through the
  // reference-photo anchor (videoCharacterAnchorUrl/referenceImageUrl), not
  // the text prompt, so this doesn't leave generations un-anchored.
  skipRefinement?: boolean;
  // Other DIFFERENT characters composited into this same generation
  // alongside the primary `character` parameter (see the multi-character
  // picker in generate-form.tsx). Fed into the draft/review rulebook below
  // so the AI knows to write each one into the prompt by name — that's the
  // only channel available for this: fal.ai's elements/edit endpoints take a
  // flat array of reference images with no per-image field pairing a photo
  // to a specific character's name. The deterministic validate() gate below
  // deliberately still only checks the PRIMARY character's traits, not
  // every companion's — requiring every trait of every character to survive
  // paraphrasing would make an already-probabilistic check fail much more
  // often, for traits that are "nice to include" rather than the one
  // character this generation is fundamentally about.
  companions?: CharacterForPipeline[];
};

export async function runRealPipeline(
  userInput: string,
  character: CharacterForPipeline,
  options: RealPipelineOptions,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  checkCancelled?: CheckCancelled,
): Promise<PipelineResult> {
  const attempts: AttemptLog[] = [];
  let finalPrompt = "";
  const hasCompanions = Boolean(options.companions?.length);
  const primaryElements = requiredElements(character, options.contentType);
  const companionElementSets = (options.companions ?? []).map((c) => ({
    name: c.name,
    elements: requiredElements(c, options.contentType),
  }));

  // Builds the rulebook text shown to the AI from a given (possibly
  // override-filtered) set of elements — used twice per attempt: once with
  // the FULL element lists for the draft step (so it knows the whole
  // baseline sheet and can judge what this request is intentionally
  // changing), and again with the override-filtered lists for the review
  // step and the deterministic validate() gate (so neither one fights to
  // restore a trait the user just asked to change).
  function buildRulebook(
    primary: { label: string; value: string }[],
    companions: { name: string; elements: { label: string; value: string }[] }[],
  ): string {
    if (!hasCompanions) {
      return primary.length
        ? primary.map((el) => `- ${el.label}: ${el.value}`).join("\n")
        : "(no fixed traits set on this character yet)";
    }
    return [
      characterRulebookBlock(character.name, primary, "primary character"),
      ...companions.map((c) => characterRulebookBlock(c.name, c.elements, "also appears in this scene")),
    ].join("\n\n");
  }

  const fullRulebook = buildRulebook(primaryElements, companionElementSets);

  // Extra instruction only needed once multiple distinct characters are in
  // play — without it, a draft model tends to average several characters'
  // traits into one blended description instead of writing each one in as
  // their own distinct presence.
  const castInstruction = hasCompanions
    ? "\n\nThis scene has multiple distinct characters — describe each one by name with their own " +
      "appearance, don't blend their traits into a single description."
    : "";

  // The exact rulebook labels the draft step is allowed to report as
  // overridden — kept in sync with requiredElements' label strings so a
  // typo here can't silently break override detection.
  const overridableLabels = "hair, outfit, personality, distinguishing features, motion style, tone";

  const mediumLabel = options.contentType === "video" ? "video" : "image";

  // A bare provider/network failure on the generate step (not a prompt-quality
  // miss) gets a couple of quick retries reusing the SAME reviewed prompt,
  // instead of paying for a brand-new draft+review pass. Keeps worst-case
  // cost down when e.g. fal.ai has a transient hiccup.
  const GENERATE_RETRIES = 2;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    // Checked before starting a brand-new attempt — including the very
    // first one, in case Stop gets hit the instant a request goes out. This
    // is where most of a stop request's savings come from, since it skips
    // an entire draft+review+generate cycle rather than just cutting off
    // one already in flight.
    if (await checkCancelled?.()) {
      attempts.push({
        attempt: attemptNumber,
        steps: [],
        passed: false,
        issues: ["cancelled"],
        compiledPrompt: finalPrompt,
      });
      return { attempts, succeeded: false, finalPrompt, resultUrl: null, cancelled: true };
    }

    const steps: PipelineStepLog[] = [];
    const previousIssues = attempts[attempts.length - 1]?.issues ?? [];
    // Recomputed fresh every attempt from that attempt's own draft response —
    // see splitOverrides. Declared here (not inside the try block) so the
    // validate() call further down, outside this if/else, can read whatever
    // the draft step decided this attempt (stays empty when skipRefinement
    // is on, matching validate() being skipped entirely in that case too).
    let overriddenLabels = new Set<string>();

    // Drafting/reviewing can fail too (provider hiccup, rate limit, timeout) —
    // record it as a failed attempt and move on to the next one instead of
    // throwing and taking down the whole request with no trace of what
    // happened.
    let reviewedPrompt: string;
    if (options.skipRefinement) {
      // Opted out — send the prompt exactly as typed, no Claude/OpenAI calls.
      reviewedPrompt = userInput;
      steps.push({ step: "draft", detail: "Skipped — using your prompt as typed (draft/review turned off)." });
    } else {
      let draftedPrompt: string;
      // Drafting/reviewing can fail too (provider hiccup, rate limit, timeout) —
      // record it as a failed attempt and move on to the next one instead of
      // throwing and taking down the whole request with no trace of what
      // happened.
      try {
        const rawDraftResponse = await draftWithClaude(
          `You are a prompt engineer for an AI ${mediumLabel} generator. Expand this ` +
            `plain-language request into one detailed, vivid text-to-${mediumLabel} prompt — ` +
            `2 to 4 sentences, no preamble, no markdown, just the prompt itself.\n\n` +
            `Character rulebook (every item must be reflected in the prompt UNLESS this specific ` +
            `request explicitly asks to change it for this one generation — e.g. asking for a ` +
            `different outfit than the rulebook's is an intentional change, not a mistake to fix):\n` +
            `${fullRulebook}\n\n` +
            `User request: ${userInput}` +
            castInstruction +
            (previousIssues.length
              ? `\n\nA previous attempt was missing: ${previousIssues.join(", ")}. Make sure this one includes them.`
              : "") +
            `\n\nAfter the prompt, on its own new line, write exactly "OVERRIDES:" followed by a ` +
            `comma-separated list of rulebook labels (only from: ${overridableLabels}) that THIS ` +
            `request explicitly changes for this one generation. Write "OVERRIDES: none" if it ` +
            `doesn't change any of them.`,
        );
        const split = splitOverrides(rawDraftResponse);
        draftedPrompt = split.promptText;
        overriddenLabels = split.overrides;
        steps.push({ step: "draft", detail: draftedPrompt });

        // Enforces only what this request DIDN'T just ask to change — the
        // fix for the incident described above: review's job is to restore
        // traits the draft accidentally dropped, not to overrule a trait the
        // person explicitly asked to swap out for this one generation.
        const enforcedRulebook = buildRulebook(
          excludeOverridden(primaryElements, overriddenLabels),
          companionElementSets.map((c) => ({
            name: c.name,
            elements: excludeOverridden(c.elements, overriddenLabels),
          })),
        );

        reviewedPrompt = await reviewWithOpenAI(
          `Tighten this AI ${mediumLabel} generation prompt so it definitely reflects every ` +
            `item in the rulebook below. Return only the improved prompt text, nothing else.\n\n` +
            `Rulebook:\n${enforcedRulebook}\n\nPrompt to review:\n${draftedPrompt}`,
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
        // Same reasoning as the generate step below — a 404/401/403 here means
        // a bad API key or wrong model id, not a fluke. Retrying with a new
        // draft changes nothing about whether the key or endpoint works.
        if (isNonRetryableProviderError(message)) break;
        continue;
      }
    }

    // Draft/review are quick; generate (especially video) is the slow, costly
    // part — worth one more check right here so a stop clicked while this
    // attempt was still drafting/reviewing skips the expensive call entirely
    // instead of only taking effect on some future attempt.
    if (await checkCancelled?.()) {
      attempts.push({
        attempt: attemptNumber,
        steps,
        passed: false,
        issues: ["cancelled"],
        compiledPrompt: reviewedPrompt,
      });
      return { attempts, succeeded: false, finalPrompt: reviewedPrompt, resultUrl: null, cancelled: true };
    }

    let resultUrl: string | null = null;
    let generateFailed = false;
    let nonRetryableFailure = false;
    for (let genTry = 1; genTry <= GENERATE_RETRIES; genTry++) {
      try {
        if (options.contentType === "video") {
          const usingMultiRef = (options.videoReferenceImageUrls?.length ?? 0) >= 2;
          const usingStoryboard =
            !usingMultiRef && Boolean(options.videoStartImageUrl || options.videoEndImageUrl);
          const usingCharacterAnchor =
            !usingMultiRef && !usingStoryboard && Boolean(options.videoCharacterAnchorUrl);
          // Kling O3's own native audio only makes sense when nothing else is
          // going to generate audio for this video — if the character has an
          // assigned voice and dialogue text, the ElevenLabs/Sync Labs step
          // further down runs after this and re-renders the video with its
          // own audio anyway, so asking O3 to also generate audio would just
          // be paying for a track that gets thrown away.
          const usingSeparateDialoguePipeline = Boolean(
            options.dialogueText?.trim() && options.dialogueVoiceId,
          );
          resultUrl = await generateVideo(
            reviewedPrompt,
            options.videoModelId ?? "kling",
            {
              referenceImageUrls: options.videoReferenceImageUrls,
              startImageUrl: options.videoStartImageUrl,
              endImageUrl: options.videoEndImageUrl,
              characterAnchorImageUrl: options.videoCharacterAnchorUrl,
              generateNativeAudio: !usingSeparateDialoguePipeline,
              durationSeconds: options.videoDurationSeconds,
              aspectRatio: options.videoAspectRatio,
            },
            checkCancelled,
          );
          const modeNote = usingMultiRef
            ? " (multi-image reference)"
            : usingStoryboard
              ? " (storyboard)"
              : usingCharacterAnchor
                ? " (character reference)"
                : "";
          const durationNote = options.videoDurationSeconds ? `, ${options.videoDurationSeconds}s` : "";
          const aspectNote = options.videoAspectRatio ? `, ${options.videoAspectRatio}` : "";
          steps.push({
            step: "generate",
            detail: `Generated via ${getVideoModel(options.videoModelId ?? "kling").name}${modeNote}${durationNote}${aspectNote}${
              genTry > 1 ? ` (recovered after a retry).` : "."
            }`,
          });
        } else {
          if (!options.persistImage) throw new Error("Image persistence handler missing.");
          const imageModelId = options.imageModelId ?? "gpt-image";
          const usingMultiCharacterImages = (options.referenceImageUrls?.length ?? 0) >= 2;
          resultUrl = await generateImage(
            imageModelId,
            reviewedPrompt,
            usingMultiCharacterImages ? options.referenceImageUrls! : options.referenceImageUrl,
            options.persistImage,
          );
          steps.push({
            step: "generate",
            detail: `Generated via ${getImageModel(imageModelId).name}${
              usingMultiCharacterImages
                ? " (multiple characters)"
                : options.referenceImageUrl
                  ? " (anchored to reference photo)"
                  : ""
            }${genTry > 1 ? " (recovered after a retry)" : ""}.`,
          });
        }
        generateFailed = false;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : `${mediumLabel} generation failed.`;

        // A user-initiated stop mid-render — generateVideo already told
        // fal.ai to cancel the job before throwing this. Treat it exactly
        // like the checkCancelled checkpoints elsewhere: stop everything,
        // no "Retrying...", no further attempts.
        if (message === "__cancelled__") {
          attempts.push({
            attempt: attemptNumber,
            steps,
            passed: false,
            issues: ["cancelled"],
            compiledPrompt: reviewedPrompt,
          });
          return { attempts, succeeded: false, finalPrompt: reviewedPrompt, resultUrl: null, cancelled: true };
        }

        generateFailed = true;
        nonRetryableFailure = isNonRetryableProviderError(message);
        steps.push({
          step: "generate",
          detail:
            !nonRetryableFailure && genTry < GENERATE_RETRIES ? `${message} Retrying...` : message,
        });
        if (nonRetryableFailure) break;
      }
    }

    // Validation is still the deterministic rulebook text-check for now —
    // scoring the actual generated video/image with a vision model is a
    // further step beyond this pass. See project notes. Skipped entirely
    // when skipRefinement is on: this check exists to confirm the AI
    // rewrite kept every trait, and there's no AI rewrite happening to
    // check — gating success on it would just fail an unchanging raw
    // prompt identically on every attempt, burning real paid generate
    // calls for a check that isn't testing anything real anymore.
    const finalCheck = options.skipRefinement
      ? { passed: true, missing: [] as { label: string; value: string }[] }
      : validate(reviewedPrompt, character, options.contentType, overriddenLabels);
    steps.push({
      step: "validate",
      detail: options.skipRefinement
        ? "Skipped — no rulebook check when draft/review is off."
        : finalCheck.passed
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

    // A 404/401/403 means the request is broken at the config level, not
    // the prompt — redrafting and trying again would just hit the exact
    // same wall, at the cost of another Claude + OpenAI call. Stop here
    // instead of burning the rest of maxAttempts on a foregone conclusion.
    if (nonRetryableFailure) break;

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
