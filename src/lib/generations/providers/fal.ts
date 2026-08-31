import { getVideoModel } from "@/lib/generations/providers/video-models";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { canExtractFrameFrom, IDENTITY_FRAME_TYPE } from "@/lib/generations/providers/frame-url";
import type { VideoResolution } from "@/lib/generations/providers/video-resolution";
import type { VideoAspectRatio } from "@/lib/generations/aspect-ratio";

// Generate step — sends the compiled prompt to the selected video model on
// fal.ai and returns a URL to the finished clip. fal.ai fronts many
// providers (Kling, Veo, and others) behind one API key, which is what
// makes the model switcher in Admin > AI Providers a one-line change
// instead of a new integration each time.

export type VideoGenerationOptions = {
  // "Multi-image reference" — send several of the character's reference
  // photos at once so the model has more to anchor identity to than one
  // photo + a text rulebook. Kling-specific (the "elements" endpoint), so
  // this only applies when the active model resolves to Kling — callers are
  // expected to have already checked that (see actions.ts).
  referenceImageUrls?: string[];
  // "Storyboard" — an optional first frame and/or last frame for the shot.
  // Also Kling-specific (image-to-video with a tail image), same caveat.
  startImageUrl?: string | null;
  endImageUrl?: string | null;
  // Baseline identity anchor — the character's own first reference photo.
  // Used automatically (every plan) whenever the caller hasn't already
  // supplied multi-image or storyboard options — see the 2026-08-07
  // incident notes below for why this exists and why it shares the
  // "elements" endpoint rather than image-to-video.
  characterAnchorImageUrl?: string | null;
  // Clip continuation (2026-08-21, verified live before wiring): a prior
  // finished clip passed as a VIDEO reference — Seedance's @Video citation
  // makes the new shot pick up that clip's world (setting, light, wardrobe)
  // instead of reinventing it. Seedance-only.
  //
  // BILLING (corrected 2026-08-31 — this comment used to claim continuation
  // "improves margin"; fal's ledger proved the opposite, twice): fal bills
  // the SOURCE clip's seconds as well as the output's, at 0.6x the normal
  // rate — "charged for both input and output videos", their words. The
  // surcharge lives in continuationExtraCredits (video-models.ts) and is
  // charged in actions.ts before the reservation.
  continueFromVideoUrl?: string | null;
  // Outfit-on-the-character (2026-08-24): a signed URL of the character's
  // saved outfit photo — a clothing shot with NO person in it. Seedance-only:
  // its reference-to-video takes several cited images, so the outfit rides as
  // an extra @ImageN after the identity references. Every other endpoint here
  // takes person references only (Kling's elements, image-to-video's start
  // frame) — a clothing photo in those slots would BE the identity, the exact
  // failure this feature exists to prevent — so the builders below simply
  // ignore this field; those models get the outfit through the drafted
  // prompt's description instead (see outfit_reference_description in
  // pipeline.ts).
  outfitImageUrl?: string | null;
  // Prop-role attachment (Send Receipt P5): a THING that should appear —
  // Seedance-only, cited as its own @ImageN after identity and outfit, same
  // mechanics and same 4-image budget as the outfit lane.
  propImageUrl?: string | null;
  // Storyboard (Kling O3 Pro only): 2-6 shots for the endpoint's
  // multi_prompt, each with its own prompt and 1-15s duration — one
  // coherent multi-shot video out. Mutually exclusive with `prompt` on
  // fal's side; the builder below sends one or the other, never both.
  storyboardShots?: { prompt: string; seconds: number }[] | null;
  // Kling O3 only: whether to request O3's own native audio generation
  // (speech + ambient sound baked into the render itself, no separate TTS
  // call). Real incident, 2026-08-07: this defaults to off on fal.ai's side
  // — omitting it entirely (as the first O3 integration did) produces a
  // silent video even when the prompt describes a character speaking.
  // Defaults to true here; the caller sets it to false when the separate
  // ElevenLabs/Sync Labs dialogue pipeline is already going to run on this
  // same video, so we're not paying for two competing audio tracks (Sync
  // Labs' lipsync step re-renders the video with its own audio anyway,
  // which would just throw away whatever O3 generated).
  generateNativeAudio?: boolean;
  // Clip length in seconds. Every video endpoint wired up here (Kling 1.6's
  // three tiers, the storyboard endpoint, O3) defaults to a fixed 5s if this
  // is omitted — real incident, 2026-08-07: nothing ever set this, so every
  // video rendered at 5 seconds regardless of what the user asked for. The
  // caller (pipeline.ts) is responsible for only sending values actually
  // valid for the selected model (see video-models.ts's durations list,
  // enforced server-side in actions.ts) — this function just formats
  // whatever it's given.
  durationSeconds?: number;
  // Real incident, 2026-08-07: a character's reference photo wasn't 16:9,
  // and a Kling O3 video anchored to it came out in that photo's native
  // shape (black bars, ignored the prompt entirely) — O3's endpoint has no
  // aspect_ratio parameter, so there was nothing to set. Resolved server-side
  // in actions.ts (prompt text > composer icon pick > 16:9 default) before
  // it gets here. Defaults to 16:9 if omitted.
  aspectRatio?: VideoAspectRatio | null;
  // An explicit output resolution, when the person asked for one. Only ever
  // set to a resolution the provider bills at the SAME rate as its default
  // (see freeHighResolution in video-models.ts) — resolveVideoResolution has
  // already rejected anything else server-side. null/undefined means send no
  // resolution parameter at all, leaving the endpoint on its own default,
  // which is what every render did before this existed.
  resolution?: VideoResolution | null;
};

// Confirmed directly against fal.ai's published API docs (not guessed):
// - Elements: https://fal.ai/models/fal-ai/kling-video/v1.6/standard/elements/api
//   (prompt, input_image_urls[] — up to 4 images, aspect_ratio, no stated minimum on the list)
// - Storyboard (start/end frame): https://fal.ai/docs/model-api-reference/video-generation-api/kling-video-v2.1-pro
//   (prompt, image_url required, tail_image_url optional — no aspect_ratio param)
// - Kling O3 Standard (image-to-video): https://fal.ai/models/fal-ai/kling-video/o3/standard/image-to-video/api
//   (image_url required, prompt, end_image_url optional, duration, generate_audio —
//   note it's `image_url`/`end_image_url`, not `start_image_url`/`tail_image_url`
//   like the endpoints above; fal.ai's own docs flag this as a common mixup)
// - Reframe (image-to-image, used only to fix O3's missing aspect_ratio
//   param — see reframeImage below): https://fal.ai/models/fal-ai/image-editing/reframe/api
//   (image_url required, aspect_ratio — 16:9/9:16/others — "intelligently
//   adjusts an image's aspect ratio while preserving the main subject's
//   position, composition, pose, and perspective"; ~$0.04/image per fal.ai's
//   published pricing)
const KLING_ELEMENTS_ENDPOINT = "fal-ai/kling-video/v1.6/standard/elements";
const KLING_STORYBOARD_ENDPOINT = "fal-ai/kling-video/v2.1/pro/image-to-video";
const KLING_O3_STANDARD_ENDPOINT = "fal-ai/kling-video/o3/standard/image-to-video";
const REFRAME_ENDPOINT = "fal-ai/image-editing/reframe";
const EXTRACT_FRAME_ENDPOINT = "fal-ai/ffmpeg-api/extract-frame";

const DEFAULT_DURATION_SECONDS = 5;
const DEFAULT_ASPECT_RATIO: VideoAspectRatio = "16:9";

// Kling O3 Standard's image-to-video endpoint (confirmed against fal.ai's
// docs, 2026-08-07) has no aspect_ratio parameter at all — unlike the
// elements/text-to-video endpoints below, it simply inherits whatever shape
// the input image already has. Real incident: a character's reference photo
// wasn't 16:9, so every O3 video came out pillarboxed in that photo's native
// shape no matter what the prompt asked for — there was no parameter
// anywhere in the request that could have fixed it. This reframes the
// reference photo itself to the target ratio first, using fal.ai's own tool
// built for exactly this ("preserving the main subject's position,
// composition, pose, and perspective" — not a plain crop, so it shouldn't
// undermine the character-consistency point of sending a reference photo in
// the first place). Costs an extra ~$0.04/generation; absorbed into the
// existing O3 credit weight rather than charged separately, same as any
// other cost of making a model actually work as advertised.
async function reframeImage(
  imageUrl: string,
  aspectRatio: VideoAspectRatio,
  apiKey: string,
): Promise<string> {
  const res = await fetchWithTimeout(
    `https://fal.run/${REFRAME_ENDPOINT}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({
        image_url: imageUrl,
        aspect_ratio: aspectRatio,
        // The endpoint's safety filter defaults to "2" — strict enough that
        // it was rejecting perfectly legitimate photoreal character photos
        // (the most likely trigger of the 2026-08-19 pillarbox incident:
        // reframe rejects the face, the silent catch at the call sites falls
        // back to the un-reframed photo, and the video comes out in that
        // photo's native shape). safety_tolerance is a real parameter on
        // this endpoint (confirmed against fal.ai's docs, 2026-08-19);
        // "5" is the most permissive value short of the maximum.
        safety_tolerance: "5",
      }),
    },
    60_000,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal.ai (reframe) error (${res.status}): ${text.slice(0, 800)}`);
  }

  const data = (await res.json()) as { images?: { url?: string }[] };
  const url = data.images?.[0]?.url;
  if (!url) throw new Error("fal.ai (reframe) response didn't include an image URL.");
  return url;
}

// Pulls ONE still out of a finished video so the identity scorer — which
// only takes images — can be pointed at a clip (2026-08-30).
//
// Which frame, and why the URL is checked first, both live in frame-url.ts
// with their reasoning and their tests. The short version: MIDDLE frame,
// because several lanes pass the identity photo in as frame one.
//
// Best-effort by contract: every caller treats null as "unscored", exactly
// as the image lane already treats a scorer hiccup. A frame we cannot pull
// must never affect a render someone paid for.
//
// Cost is negligible — fal bills this at $0.0002 per second of input, so a
// 5s clip is $0.001, about a third of one percent of the cheapest render.
export async function extractVideoFrame(videoUrl: string): Promise<string | null> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) return null;
  if (!canExtractFrameFrom(videoUrl)) return null;
  try {
    const res = await fetchWithTimeout(
      `https://fal.run/${EXTRACT_FRAME_ENDPOINT}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Key ${apiKey}`,
        },
        body: JSON.stringify({ video_url: videoUrl, frame_type: IDENTITY_FRAME_TYPE }),
      },
      // Deliberately tight. This runs inside finish(), which the fal webhook
      // and the poll loop both await, so the ceiling here is latency added
      // to every completed video. A frame grab that hasn't returned in 25s
      // is not worth making someone wait for.
      25_000,
    );
    if (!res.ok) {
      console.warn("Frame extraction failed; video will stay unscored.", {
        status: res.status,
        body: (await res.text()).slice(0, 300),
      });
      return null;
    }
    const data = (await res.json()) as { images?: { url?: string }[] };
    return data.images?.[0]?.url ?? null;
  } catch (err) {
    console.warn("Frame extraction threw; video will stay unscored.", err);
    return null;
  }
}

// Confirmed directly against fal.ai's docs, 2026-08-07 (O3 Pro reference
// re-confirmed 2026-08-19): every Kling endpoint used here (1.6
// text-to-video/elements, storyboard, O3, O3 Pro reference) wants
// duration as a bare numeric string ("5", "10"). Veo 3.1 is the one
// exception — its schema wants an "s" suffix ("4s", "6s", "8s"); sending it
// the bare number is a documented common mistake (fal.ai's own docs call
// this out) and would just be silently ignored/rejected.
function formatDuration(modelId: string, seconds: number): string {
  return modelId === "veo" ? `${seconds}s` : String(seconds);
}

function extractVideoUrl(data: unknown): string | undefined {
  const d = data as Record<string, unknown> | undefined;
  const video = d?.video as Record<string, unknown> | undefined;
  const output = d?.output as Record<string, unknown> | undefined;
  const outputVideo = output?.video as Record<string, unknown> | undefined;
  return (
    (video?.url as string | undefined) ??
    (d?.video_url as string | undefined) ??
    (outputVideo?.url as string | undefined) ??
    (d?.url as string | undefined)
  );
}

// Real incident, 2026-08-07: this used to be one blocking POST to
// https://fal.run/{endpoint} with a 180s client-side timeout. Kling's own
// docs estimate ~6 minutes for a standard-tier text-to-video render, so that
// 180s timeout was aborting our side of the connection on every single
// generation — but aborting our fetch does NOT tell fal.ai's runner to stop;
// the job likely kept running (and billing) on their side while we silently
// threw the result away and immediately started a brand-new paid attempt.
// Three attempts of that in a row is exactly how a single request turns into
// several dollars of real charges for zero usable output.
//
// Switched to fal.ai's queue API (their own recommended pattern for
// anything long-running, confirmed against fal.ai's docs — not guessed):
// submit returns immediately with a request_id and status/cancel URLs, we
// poll status every few seconds instead of holding one connection open, and
// — critically — we can now actually tell fal.ai to cancel a job (via
// cancel_url) instead of just walking away from it. That's also what makes
// the Stop button's cancellation real for video instead of best-effort.
const POLL_INTERVAL_MS = 4_000;
const MAX_WAIT_MS = 10 * 60_000; // 10 minutes — comfortably above fal's own ~6m estimate

type QueueSubmitResponse = {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url: string;
};

type QueueStatusResponse = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  error?: string;
};

async function cancelQueueRequest(cancelUrl: string, apiKey: string): Promise<void> {
  try {
    // Short hard timeout — this sits on the user-facing Stop path
    // (requestGenerationCancel awaits it so the cancel actually reaches fal
    // before returning), and a bare fetch with no timeout could hang that
    // Stop click for as long as the platform allows. A cancel is a single
    // tiny PUT; if fal can't take it in a few seconds, the cooperative
    // cancel flag and the reaper are the backstops anyway.
    await fetchWithTimeout(
      cancelUrl,
      { method: "PUT", headers: { authorization: `Key ${apiKey}` } },
      5_000,
    );
  } catch {
    // Best effort — if this fails there's nothing more we can do from here,
    // and it must never mask whatever error/timeout triggered the cancel.
  }
}

function requireApiKey(): string {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }
  return apiKey;
}

// Works out which fal.ai endpoint and request body a given set of options maps
// to, without submitting anything.
//
// Split out of generateVideo so the blocking path and the queued
// fire-and-poll path (submitVideoJob) share ONE definition of this routing.
// The branches below encode a lot of hard-won detail — which endpoints accept
// aspect_ratio, which need a reframed reference photo instead, which one
// blends a likeness into a new scene versus merely animating the input photo —
// and every one of those was a real bug at some point. Duplicating it for the
// queued path would guarantee the two drift.
async function buildVideoRequest(
  prompt: string,
  modelId: string,
  options: VideoGenerationOptions,
  apiKey: string,
): Promise<{ endpoint: string; body: Record<string, unknown>; label: string }> {
  const referenceImageUrls = (options.referenceImageUrls ?? []).filter(Boolean);
  const resolvedAspectRatio: VideoAspectRatio = options.aspectRatio ?? DEFAULT_ASPECT_RATIO;

  let endpoint: string;
  let body: Record<string, unknown>;
  let label: string;

  // Real incident, 2026-08-07, part 2: the first fix routed the baseline
  // single-photo case through Kling's plain image-to-video endpoint.
  // That endpoint has no aspect_ratio parameter at all — Kling just animates
  // the literal input photo, inheriting whatever shape and background that
  // photo already has — which is exactly why the result ignored the
  // requested 16:9 framing and the described makeup-station scene, and just
  // made the reference selfie itself move. The "elements" endpoint below
  // (already used for the 2-4 photo advanced multi-reference feature) is
  // built for the opposite job: blend a person's likeness into a NEW scene
  // described by the prompt, and it does take an aspect_ratio parameter
  // (default 16:9). fal.ai's own schema places no minimum on input_image_urls
  // beyond "required" — 1 image works the same way 2-4 do — so the baseline
  // single-photo anchor now shares this same endpoint instead of a
  // different one, just with a shorter image list.
  // The single-photo character anchor promotes into the reference list for
  // every model whose endpoint takes identity references: kling (elements),
  // seedance (reference-to-video), and kling-o3-pro (O3 Pro
  // reference-to-video, whose `elements` are the same idea under a different
  // name). Seedance was missing from this
  // condition from the day it shipped (2026-08-11) until 2026-08-19: the
  // composer only ever sets characterAnchorImageUrl on the single-character
  // path, so every "character reference" Seedance render went out with NO
  // image_urls at all — ByteDance 422'd the referenceless request, and even
  // a referenceless success would have silently skipped the entire
  // identity-anchoring feature the model was chosen for.
  const anchorImages =
    referenceImageUrls.length > 0
      ? referenceImageUrls.slice(0, 4)
      : options.characterAnchorImageUrl &&
          (modelId === "kling" || modelId === "seedance" || modelId === "seedance-2" || modelId === "kling-o3-pro")
        ? [options.characterAnchorImageUrl]
        : [];

  if (modelId === "seedance" || modelId === "seedance-2") {
    // Seedance reference-to-video, both generations. The important
    // difference from every other endpoint here: image_urls are IDENTITY
    // references, cited in the prompt as @Image1, not the opening frame.
    // That's what stops the clip starting frozen in the pose the photo was
    // taken in — and what lets several camera angles actually differ from
    // frame one.
    //
    // One builder for both on purpose: 2.0's schema is a compatible
    // superset of what we send (verified live 2026-08-21 — aspect_ratio,
    // generate_audio, string durations all accepted). Only the endpoint and
    // the likeness policy differ: 2.5 rejects photoreal people
    // (mascot/illustrated lane), 2.0 accepts them (see video-models.ts).
    //
    // Schema confirmed against fal's own docs, 2026-08-11 (2.5) and
    // 2026-08-21 (2.0).
    const references = anchorImages.length > 0 ? anchorImages : [];
    const continuation = options.continueFromVideoUrl ?? null;
    // The outfit photo needs an identity reference beside it — alone it would
    // be the only @Image and the model would treat the clothing as the
    // subject — and the combined list has to stay inside the same 4-image
    // budget anchorImages is sliced to. actions.ts already enforces both;
    // the guard here is the provider-level backstop.
    const outfit =
      references.length > 0 && references.length < 4 ? (options.outfitImageUrl ?? null) : null;
    const prop =
      references.length > 0 && references.length + (outfit ? 1 : 0) < 4
        ? (options.propImageUrl ?? null)
        : null;
    endpoint =
      modelId === "seedance"
        ? "bytedance/seedance-2.5/reference-to-video"
        : "bytedance/seedance-2.0/reference-to-video";
    // Citations have to appear in the PROMPT for the model to bind to them —
    // passing image_urls/video_urls alone does nothing. Continuation cites
    // the prior clip as @Video1 alongside the identity's @Image1; the outfit
    // photo, when present, is appended after the identity references and
    // cited by its own index.
    const citationLines = [
      continuation
        ? "The video continues directly from the final moment of @Video1 — same setting, same light, no cut back."
        : null,
      references.length
        ? "The person in this video is @Image1 — match their face, hair, and features exactly, but do not copy the pose or framing of that photo."
        : null,
      outfit
        ? `@Image${references.length + 1} shows only an outfit laid out, never a person — the person wears exactly that outfit: reproduce its design, colours, logos, and stitching.`
        : null,
      prop
        ? // Mirrors the identity line above: anchor to the image without
          // copying its composition. "match its contents faithfully" (the old
          // ending) made "same set, new angle" prompts return near-copies of
          // the attached shot — 2026-08-26 incident, see pipeline.ts.
          `@Image${references.length + (outfit ? 1 : 0) + 1} is an image the user attached — the prompt above says how to use it; do not copy its framing or composition unless the prompt asks for that.`
        : null,
    ].filter(Boolean);
    body = {
      prompt: citationLines.length ? `${prompt}\n\n${citationLines.join(" ")}` : prompt,
      ...(references.length
        ? { image_urls: [...references, ...(outfit ? [outfit] : []), ...(prop ? [prop] : [])] }
        : {}),
      ...(continuation ? { video_urls: [continuation] } : {}),
      // 480p is deliberately not offered — see video-models.ts.
      resolution: "720p",
      duration: String(options.durationSeconds ?? DEFAULT_DURATION_SECONDS),
      aspect_ratio: resolvedAspectRatio,
      generate_audio: options.generateNativeAudio ?? true,
    };
    label = modelId === "seedance" ? "Seedance 2.5" : "Seedance 2.0";
  } else if (modelId === "kling-o3-pro") {
    // Kling O3 Pro reference-to-video — Kling's own identity-reference
    // endpoint, same job as Seedance above: the photos anchor WHO is in the
    // clip, not what frame one looks like.
    //
    // Schema confirmed against fal's own docs, 2026-08-19
    // (fal.ai/models/fal-ai/kling-video/o3/pro/reference-to-video/api):
    // `elements` is an array of { frontal_image_url, reference_image_urls? },
    // cited in the prompt as @Element1/@Element2; an optional flat
    // `image_urls` (non-identity scene references) can ride along, but
    // elements + image_urls are capped at 4 images COMBINED — one element
    // with up to 3 extra reference shots stays inside that cap, and
    // anchorImages is already sliced to 4 above. The endpoint also takes an
    // optional start_image_url, deliberately NOT sent: a first-frame lock is
    // exactly what this model exists to escape. Unlike O3 standard it has a
    // real aspect_ratio parameter (16:9/9:16/1:1), so no reframe workaround
    // here. Output is { video: { url } }, same as every other Kling endpoint.
    if (anchorImages.length === 0) {
      // actions.ts already rejects a reference-less request before spending
      // any credits (requiresReferenceImage) — this is just a backstop, same
      // as O3 standard below.
      throw new Error(
        "Kling O3 Pro needs a reference photo — add one to this character, attach a photo, or switch to Kling 1.6.",
      );
    }
    endpoint = "fal-ai/kling-video/o3/pro/reference-to-video";
    const storyboard = options.storyboardShots ?? null;
    body = {
      // The @Element1 citation has to appear in the PROMPT for the model to
      // bind to it — same contract as Seedance's @Image1 above. For a
      // storyboard the citation rides EVERY shot, and per-shot durations are
      // STRING literals "1".."15" — live-fired 2026-08-21: integers 422.
      // multi_prompt and prompt are mutually exclusive on fal's side.
      ...(storyboard && storyboard.length >= 2
        ? {
            multi_prompt: storyboard.map((shot) => ({
              prompt: `${shot.prompt}\n\nThe person in this shot is @Element1 — match their face, hair, and features exactly.`,
              duration: String(shot.seconds),
            })),
          }
        : {
            prompt: `${prompt}\n\nThe person in this video is @Element1 — match their face, hair, and features exactly, but do not copy the pose or framing of that photo.`,
            duration: formatDuration(modelId, options.durationSeconds ?? DEFAULT_DURATION_SECONDS),
          }),
      elements: [
        {
          frontal_image_url: anchorImages[0],
          // NOT optional, despite the docs page marking it so — production
          // 422, 2026-08-19: "Either frontal_image_url and reference_image_urls
          // or video_url must be provided" came back for an element carrying
          // only frontal_image_url. The validator wants the PAIR, so a
          // single-photo character sends the same photo in both slots (an
          // extra reference angle that happens to be identical is semantically
          // harmless), and multi-photo characters send the real extras.
          reference_image_urls:
            anchorImages.length > 1 ? anchorImages.slice(1) : [anchorImages[0]],
        },
      ],
      aspect_ratio: resolvedAspectRatio,
      // (duration lives in the prompt/multi_prompt spread above — a single
      // clip sends the flat duration, a storyboard sends per-shot ones.)
      // Same default-on native audio as O3 standard (see the 2026-08-07
      // incident note on generateNativeAudio above) — the caller turns it
      // off when the ElevenLabs/Sync Labs dialogue pipeline is going to
      // re-render this video's audio anyway.
      generate_audio: options.generateNativeAudio ?? true,
      // Same anti-frozen-frame terms as the elements/2.5 branches — identity
      // references make the frozen open less likely, not impossible.
      negative_prompt:
        "blur, distort, and low quality, static posed portrait, frozen first frame, " +
        "motionless opening shot, subject standing still facing camera",
    };
    label = storyboard && storyboard.length >= 2 ? `Kling O3 Pro (storyboard, ${storyboard.length} shots)` : "Kling O3 Pro";
  } else if (modelId === "kling-2.5") {
    // Kling 2.5 Turbo Pro. First-frame image-to-video, so image_url is
    // required and the clip does open on that photo — this model is the
    // quality/price upgrade over 1.6, not the fix for the pose problem
    // (that's Seedance above).
    if (!options.characterAnchorImageUrl && anchorImages.length === 0) {
      throw new Error(
        "Kling 2.5 needs a reference photo — add one to this character, attach a photo, or switch to Kling 1.6.",
      );
    }
    // No aspect_ratio parameter on this endpoint (same gap as O3), so the
    // only lever is the shape of the input image. Best-effort: a failed
    // reframe falls back to the original photo rather than failing the whole
    // generation over framing.
    let startImage = options.characterAnchorImageUrl ?? anchorImages[0];
    try {
      startImage = await reframeImage(startImage, resolvedAspectRatio, apiKey);
    } catch (err) {
      // Original photo it is — but say so. This fallback was completely
      // silent until 2026-08-19, which is what made the pillarbox incident
      // (reframe's safety filter rejecting a photoreal face, the video then
      // inheriting the photo's native shape) undiagnosable from the logs.
      console.warn(
        `fal.ai reframe failed for Kling 2.5 Turbo Pro — falling back to the original reference photo, so the video may come out in its shape instead of ${resolvedAspectRatio}:`,
        err,
      );
    }
    endpoint = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
    body = {
      prompt,
      image_url: startImage,
      duration: formatDuration(modelId, options.durationSeconds ?? DEFAULT_DURATION_SECONDS),
      negative_prompt:
        "blur, distort, and low quality, static posed portrait, frozen first frame, " +
        "motionless opening shot, subject standing still facing camera",
      ...(options.endImageUrl ? { tail_image_url: options.endImageUrl } : {}),
    };
    label = "Kling 2.5 Turbo Pro";
  } else if (modelId === "kling-o3") {
    // O3 Standard's image-to-video endpoint has no text-to-video sibling
    // wired up here — image_url is required by fal.ai, no fallback. A
    // character with zero reference photos can't use this model; actions.ts
    // checks that before spending any credits, this is just a backstop.
    if (!options.characterAnchorImageUrl) {
      throw new Error(
        "Kling O3 needs the character to have a reference photo — add one in Character settings, or switch to Kling 1.6.",
      );
    }
    // O3 has no aspect_ratio parameter (see reframeImage above) — the only
    // lever available is the shape of the input image itself, so reframe the
    // reference photo to the resolved ratio before sending it. Best-effort:
    // if the reframe call itself fails, fall back to the original photo
    // rather than failing the whole video generation over a framing nicety.
    let o3ImageUrl = options.characterAnchorImageUrl;
    try {
      o3ImageUrl = await reframeImage(options.characterAnchorImageUrl, resolvedAspectRatio, apiKey);
    } catch (err) {
      // Original photo it is — same behavior as before this fix existed, but
      // no longer silent (see the identical note on the 2.5 call site above:
      // the 2026-08-19 pillarbox incident hid behind exactly this catch).
      console.warn(
        `fal.ai reframe failed for Kling O3 — falling back to the original reference photo, so the video may come out in its shape instead of ${resolvedAspectRatio}:`,
        err,
      );
    }
    endpoint = KLING_O3_STANDARD_ENDPOINT;
    body = {
      prompt,
      image_url: o3ImageUrl,
      generate_audio: options.generateNativeAudio ?? true,
      duration: formatDuration(modelId, options.durationSeconds ?? DEFAULT_DURATION_SECONDS),
      // Same anti-frozen-frame terms as the elements/2.5 branches. This
      // endpoint documents negative_prompt now (confirmed against fal.ai's
      // docs, 2026-08-19 — it wasn't in the parameter table when this branch
      // was written), and a clip whose frame one IS the posed reference
      // photo is exactly the case those terms exist for.
      negative_prompt:
        "blur, distort, and low quality, static posed portrait, frozen first frame, " +
        "motionless opening shot, subject standing still facing camera",
      ...(options.endImageUrl ? { end_image_url: options.endImageUrl } : {}),
    };
    label = "Kling O3";
  } else if (options.startImageUrl || options.endImageUrl) {
    // Storyboard — image-to-video requires a start frame; if only an end
    // frame was supplied, use it as the start frame too rather than failing
    // outright (still gives Kling something concrete to anchor the scene to).
    // Explicit user choice (Elite-only advanced option), so it takes
    // priority over the automatic baseline anchor below.
    //
    // Note: this endpoint (v2.1 pro image-to-video) has no aspect_ratio
    // parameter either — same class of gap as O3, just not fixed here.
    // Not reframing the start/end frames the way O3's reference photo is
    // reframed above, since this path always uses photos the user picked
    // specifically as a start/end frame — silently altering their framing
    // felt like the wrong default. Worth revisiting if this becomes a
    // real complaint the way O3's did.
    endpoint = KLING_STORYBOARD_ENDPOINT;
    body = {
      prompt,
      image_url: options.startImageUrl ?? options.endImageUrl,
      duration: formatDuration(modelId, options.durationSeconds ?? DEFAULT_DURATION_SECONDS),
      ...(options.endImageUrl ? { tail_image_url: options.endImageUrl } : {}),
    };
    label = "Kling (storyboard)";
  } else if (anchorImages.length > 0) {
    // Multi-image reference (2-4, Elite advanced option) and the baseline
    // single-photo identity anchor (every plan, automatic) both land here —
    // same endpoint, same behavior, just a different-length image list.
    endpoint = KLING_ELEMENTS_ENDPOINT;
    body = {
      prompt,
      input_image_urls: anchorImages,
      aspect_ratio: resolvedAspectRatio,
      duration: formatDuration(modelId, options.durationSeconds ?? DEFAULT_DURATION_SECONDS),
      // Pushes back on the clip opening as a frozen copy of the reference
      // photo before anything happens.
      //
      // This endpoint is Elements IMAGE-TO-VIDEO: fal's own description says
      // the input images are supplied "in the order they should appear in the
      // video". With a single photo that photo is literally frame one, so
      // every clip began with the character held in exactly the pose they were
      // photographed in, and only then started moving. In multi-angle it was
      // worse — three angles sharing one first frame all opened identically,
      // because a camera instruction can't apply to a frame that's already
      // decided.
      //
      // The endpoint's default is "blur, distort, and low quality"; those are
      // kept and the static-opening terms added. This softens the effect
      // rather than removing it — the only complete fix is to stop handing
      // the raw photo in as frame one (see MOBILE_APP-style notes in the
      // pipeline, and the per-angle start frame idea).
      negative_prompt:
        "blur, distort, and low quality, static posed portrait, frozen first frame, " +
        "motionless opening shot, subject standing still facing camera",
    };
    label = anchorImages.length > 1 ? "Kling (multi-image reference)" : "Kling (character reference)";
  } else if (modelId === "veo" && options.characterAnchorImageUrl) {
    // VEO GETS A FACE (2026-08-30).
    //
    // Until today Veo was the one model in the catalogue that structurally
    // could not honour "the same face in every single frame": its capability
    // row read mechanism "none", max 0, and every Veo render went out as
    // blind text-to-video with the character described only in adjectives.
    // That is not a Veo limitation — it is which ENDPOINT we were calling.
    // fal-ai/veo3.1 is text-to-video only (schema confirmed 2026-08-30: no
    // image_url, no reference images, no ingredients), but the sibling
    // fal-ai/veo3.1/image-to-video takes an image_url.
    //
    // Same price, verbatim from fal's own page 2026-08-30: "For every second
    // of video you generate you will be charged $0.20 without audio or $0.40
    // with audio for 720p or 1080p." Identical to the text-to-video rate the
    // credit weights were already built on, so no weight changes and no
    // pricingAudit drift.
    //
    // Mechanism note, and it is a real trade: image-to-video means the photo
    // becomes the OPENING FRAME, exactly like Kling O3 and 2.5. Veo stops
    // inventing a stranger, but it also opens on that photo's pose and
    // framing. That is why this only fires when a character photo exists —
    // a characterless Veo render still takes the text-to-video branch below
    // and keeps its full compositional freedom, which is precisely what the
    // composer recommends Veo for when nobody is cast.
    //
    // Only ONE image: this endpoint takes a single image_url and no
    // reference array (schema confirmed), which is why baselineIdentityReferences
    // returns [] for veo and the multi-photo path never reaches here.
    endpoint = "fal-ai/veo3.1/image-to-video";
    body = {
      prompt,
      image_url: options.characterAnchorImageUrl,
      aspect_ratio: resolvedAspectRatio,
      duration: formatDuration(modelId, options.durationSeconds ?? DEFAULT_DURATION_SECONDS),
      generate_audio: options.generateNativeAudio ?? true,
      // Same price at 720p and 1080p on this endpoint, so this is free
      // quality when asked for. Omitted entirely when not asked for, which
      // leaves fal on its 720p default.
      ...(options.resolution ? { resolution: options.resolution } : {}),
    };
    label = options.resolution
      ? `Veo 3.1 (character reference, ${options.resolution})`
      : "Veo 3.1 (character reference)";
  } else {
    // No character photo available at all (character has none saved) —
    // falls back to blind text-to-video, same as before this fix existed.
    // Both Kling 1.6 text-to-video and Veo 3.1 (the only two models that can
    // land here) have their own real aspect_ratio parameter, confirmed
    // against fal.ai's docs — unlike O3/storyboard above, no workaround
    // needed for this path.
    const model = getVideoModel(modelId);
    endpoint = model.falEndpoint;
    body = {
      prompt,
      aspect_ratio: resolvedAspectRatio,
      duration: formatDuration(modelId, options.durationSeconds ?? DEFAULT_DURATION_SECONDS),
      // Veo 3.1 has a real generate_audio parameter (confirmed against
      // fal.ai's docs, 2026-08-19) and bills by it: $0.40/sec with audio,
      // $0.20/sec without. This branch used to omit it entirely, so every
      // Veo render paid for audio — including dialogue runs, where the
      // ElevenLabs/Sync Labs pipeline replaces the audio track anyway (the
      // caller sets generateNativeAudio false for exactly that case, see
      // pipeline.ts). Kling 1.6 text-to-video, the only other model that can
      // land in this branch, has no such parameter, so it's Veo-only.
      ...(modelId === "veo" ? { generate_audio: options.generateNativeAudio ?? true } : {}),
      // Veo-only, same free-1080p reasoning as the image-to-video branch
      // above. Kling 1.6 text-to-video is the only other model that lands
      // here and has no resolution parameter, so this stays gated on veo.
      ...(modelId === "veo" && options.resolution ? { resolution: options.resolution } : {}),
    };
    label = modelId === "veo" && options.resolution ? `${model.name} (${options.resolution})` : model.name;
  }

  return { endpoint, body, label };
}

// ---------------------------------------------------------------------------
// Queue primitives
//
// These exist so a caller can start a job and walk away. The blocking helpers
// further down (generateVideo, generateSpeech, lipSyncVideo) are written on
// top of them and keep their original behaviour, but the orchestrator in
// lib/generations/job-runner.ts uses these directly: it submits, stores the
// returned handle in generation_jobs, and returns. Later polls each do a
// single fast status check.
//
// This is what removes the 300s ceiling. Nothing has to stay alive for the
// ten-plus minutes a Kling render with dialogue can take, because fal.ai is
// holding the work and we're only ever asking "done yet?".
// ---------------------------------------------------------------------------

export type QueuedJob = {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
  label: string;
};

export type QueuedJobState =
  | { state: "pending" }
  | { state: "completed" }
  | { state: "failed"; error: string };

// Where fal should POST when a job finishes, if we can work out a public URL.
//
// This is what makes completion independent of anyone's browser. Polling still
// runs while someone is watching (it updates the UI faster than a webhook
// round trip), but the webhook is the thing that guarantees a finished render
// is actually collected — including at 3am with every tab closed.
//
// Returns null in local development, where fal can't reach localhost. Polling
// covers that case, which is why this is best-effort rather than required.
function webhookUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base || base.includes("localhost") || base.includes("127.0.0.1")) return null;
  return `${base.replace(/\/$/, "")}/api/webhooks/fal`;
}

async function submitToQueue(
  endpoint: string,
  body: Record<string, unknown>,
  label: string,
  apiKey: string,
): Promise<QueuedJob> {
  const hook = webhookUrl();
  const submitUrl = hook
    ? `https://queue.fal.run/${endpoint}?fal_webhook=${encodeURIComponent(hook)}`
    : `https://queue.fal.run/${endpoint}`;

  const submitRes = await fetchWithTimeout(
    submitUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Key ${apiKey}` },
      body: JSON.stringify(body),
    },
    30_000, // just queuing the job — this itself should be fast
  );

  if (!submitRes.ok) {
    const text = await submitRes.text();
    throw new Error(`fal.ai (${label}) error (${submitRes.status}): ${text.slice(0, 800)}`);
  }

  const submitted = (await submitRes.json()) as QueueSubmitResponse;
  if (!submitted.status_url || !submitted.response_url) {
    throw new Error(`fal.ai (${label}) queue response was missing status/result URLs.`);
  }

  return {
    requestId: submitted.request_id,
    statusUrl: submitted.status_url,
    responseUrl: submitted.response_url,
    cancelUrl: submitted.cancel_url,
    label,
  };
}

export async function submitVideoJob(
  prompt: string,
  modelId: string,
  options: VideoGenerationOptions = {},
): Promise<QueuedJob> {
  const apiKey = requireApiKey();
  const { endpoint, body, label } = await buildVideoRequest(prompt, modelId, options, apiKey);
  return submitToQueue(endpoint, body, label, apiKey);
}

export async function submitSpeechJob(text: string, elevenLabsVoiceId: string): Promise<QueuedJob> {
  return submitToQueue(
    ELEVENLABS_TTS_ENDPOINT,
    { text, voice: elevenLabsVoiceId },
    "ElevenLabs TTS",
    requireApiKey(),
  );
}

export async function submitLipSyncJob(videoUrl: string, audioUrl: string): Promise<QueuedJob> {
  return submitToQueue(
    SYNC_LIPSYNC_ENDPOINT,
    { video_url: videoUrl, audio_url: audioUrl },
    "Sync Lipsync",
    requireApiKey(),
  );
}

// One status check. Never throws on a job-level failure — a job that failed on
// fal's side comes back as { state: "failed" } so the caller can record a real
// error against the generation. Only genuine transport problems throw, because
// those are worth retrying on the next poll rather than failing the job.
export async function checkQueuedJob(job: QueuedJob): Promise<QueuedJobState> {
  const apiKey = requireApiKey();
  const res = await fetchWithTimeout(
    job.statusUrl,
    { headers: { authorization: `Key ${apiKey}` } },
    15_000,
  );

  if (!res.ok) {
    const text = await res.text();
    // Only 404/410 are terminal: the request id genuinely does not exist any
    // more, and that won't heal. Everything else on a STATUS READ is
    // transient and throws so the next poll retries — the old rule treated
    // EVERY 4xx as "job lost", and production disproved it on 2026-08-25: a
    // 403 "User is locked. Reason: Exhausted balance." A poll rate limit
    // (429), an expired key (401), or an account lock (403) says nothing
    // about the job, which fal may still be running and billing; writing it
    // off terminally paid for a render nobody would ever collect. A status
    // read is free to retry, and the reaper's absolute deadline is the real
    // backstop for a job that is genuinely gone.
    if (res.status === 404 || res.status === 410) {
      return {
        state: "failed",
        error: `fal.ai (${job.label}) lost track of this job (${res.status}): ${text.slice(0, 200)}`,
      };
    }
    throw new Error(`fal.ai (${job.label}) status check error (${res.status}): ${text.slice(0, 800)}`);
  }

  const data = (await res.json()) as QueueStatusResponse;
  if (data.status === "COMPLETED") return { state: "completed" };
  if (data.error) return { state: "failed", error: `fal.ai (${job.label}): ${data.error}` };
  return { state: "pending" };
}

async function fetchQueuedResult(job: QueuedJob): Promise<unknown> {
  const apiKey = requireApiKey();
  const res = await fetchWithTimeout(
    job.responseUrl,
    { headers: { authorization: `Key ${apiKey}` } },
    30_000,
  );
  // Text first, JSON second — and the order is load-bearing. A gateway 502
  // answers with an HTML body, and `res.json()` on that throws a bare
  // SyntaxError carrying no "(NNN)" status. isTransportError classifies by
  // that embedded status, so the SyntaxError read as terminal and a render
  // fal had FINISHED AND BILLED was written off as failed (2026-08-31
  // inspection). Parsed this way, every non-ok response throws the formatted
  // message whatever its body looks like, and a 5xx retries like it should.
  const text = await res.text();
  if (!res.ok) {
    let errorMessage: string | undefined;
    try {
      errorMessage = (JSON.parse(text) as { error?: string } | null)?.error;
    } catch {
      // HTML or plain-text body — the raw slice is the best detail we have.
    }
    throw new Error(
      `fal.ai (${job.label}) error (${res.status}): ${errorMessage ?? text.slice(0, 800)}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A 200 whose body isn't JSON is the same gateway hiccup wearing a
    // success code — still transient, still worth another poll.
    throw new Error(`fal.ai (${job.label}) error (502): non-JSON response body`);
  }
}

export async function fetchQueuedVideoUrl(job: QueuedJob): Promise<string> {
  const url = extractVideoUrl(await fetchQueuedResult(job));
  if (!url) throw new Error(`fal.ai (${job.label}) response didn't include a video URL.`);
  return url;
}

export async function fetchQueuedAudioUrl(job: QueuedJob): Promise<string> {
  const url = extractAudioUrl(await fetchQueuedResult(job));
  if (!url) throw new Error(`fal.ai (${job.label}) response didn't include an audio URL.`);
  return url;
}

// Best effort, and deliberately never throws — this is called from cancel and
// cleanup paths where failing to reach fal must not mask the original reason
// we were cancelling.
export async function cancelQueuedJob(job: Pick<QueuedJob, "cancelUrl">): Promise<void> {
  if (!job.cancelUrl) return;
  await cancelQueueRequest(job.cancelUrl, process.env.FAL_KEY ?? "");
}

// Blocking video generation — submit, then hold the connection open polling
// until it finishes.
//
// Retained for the paths that genuinely are short and synchronous, and as a
// fallback, but note this is the shape that caused the original problem: it
// can run for ten minutes, which no serverless function is allowed to do on
// the Hobby plan. New code should use submitVideoJob + checkQueuedJob.
export async function generateVideo(
  prompt: string,
  modelId: string,
  options: VideoGenerationOptions = {},
  checkCancelled?: () => Promise<boolean>,
): Promise<string> {
  const job = await submitVideoJob(prompt, modelId, options);
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      await cancelQueuedJob(job);
      throw new Error(
        `fal.ai (${job.label}) didn't finish within ${Math.round(MAX_WAIT_MS / 60_000)} minutes — cancelled it.`,
      );
    }

    if (await checkCancelled?.()) {
      await cancelQueuedJob(job);
      throw new Error("__cancelled__");
    }

    const state = await checkQueuedJob(job);
    if (state.state === "completed") break;
    if (state.state === "failed") throw new Error(state.error);

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return fetchQueuedVideoUrl(job);
}

// Character dialogue — speech generation + lip-sync. Both run on the same
// FAL_KEY as everything else above (fal.ai fronts ElevenLabs and Sync Labs
// too), so this needed no new vendor account or secret.
//
// Confirmed directly against fal.ai's published schemas, not guessed:
// - TTS: https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3/api
//   (text, voice — voice is an ElevenLabs voice_id string; returns { audio: { url } })
// - Lipsync: https://fal.ai/models/fal-ai/sync-lipsync/v2/pro/api
//   (video_url, audio_url; returns { video: { url } })
const ELEVENLABS_TTS_ENDPOINT = "fal-ai/elevenlabs/tts/eleven-v3";
const SYNC_LIPSYNC_ENDPOINT = "fal-ai/sync-lipsync/v2/pro";

function extractAudioUrl(data: unknown): string | undefined {
  const d = data as Record<string, unknown> | undefined;
  const audio = d?.audio as Record<string, unknown> | undefined;
  return (audio?.url as string | undefined) ?? (d?.audio_url as string | undefined);
}

// Generates spoken audio for a character's dialogue line using a specific,
// admin-picked ElevenLabs voice_id (see voice_presets table — never a named
// "default" voice, those are being retired by ElevenLabs at the end of 2026).
export async function generateSpeech(text: string, elevenLabsVoiceId: string): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  const res = await fetchWithTimeout(
    `https://fal.run/${ELEVENLABS_TTS_ENDPOINT}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({ text, voice: elevenLabsVoiceId }),
    },
    60_000,
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fal.ai (ElevenLabs TTS) error (${res.status}): ${errText.slice(0, 800)}`);
  }

  const data = await res.json();
  const url = extractAudioUrl(data);
  if (!url) throw new Error("fal.ai (ElevenLabs TTS) response didn't include an audio URL.");
  return url;
}

// Merges the generated speech audio into the generated video so the
// character's mouth actually matches what they're saying, rather than the
// audio just playing underneath a silent clip.
export async function lipSyncVideo(videoUrl: string, audioUrl: string): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  const res = await fetchWithTimeout(
    `https://fal.run/${SYNC_LIPSYNC_ENDPOINT}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl }),
    },
    120_000,
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fal.ai (Sync Lipsync) error (${res.status}): ${errText.slice(0, 800)}`);
  }

  const data = await res.json();
  const url = extractVideoUrl(data);
  if (!url) throw new Error("fal.ai (Sync Lipsync) response didn't include a video URL.");
  return url;
}

// Account balance — for the "AI provider funds" card on Admin > Stats.
// Confirmed against fal.ai's published Platform API docs
// (https://fal.ai/docs/platform-apis/v1/account/billing, 2026-08-09):
// GET https://api.fal.ai/v1/account/billing?expand=credits, same
// `authorization: Key <key>` header style as every other call in this file.
// One real wrinkle: that endpoint's docs list its security scheme as
// "adminApiKey" specifically — fal.ai lets a key be scoped to admin/account
// access or not when it's created in their dashboard, separate from whether
// it can run models. FAL_KEY here is whatever key was set up for generation
// calls, so this may 401/403 if that particular key wasn't given admin
// scope — that's a real, expected outcome (not a bug), surfaced to the
// caller as `ok: false` with a reason rather than thrown, so a scope
// mismatch on one provider never breaks the whole stats page. Never throws.
export type FalAccountBalance =
  | { ok: true; balance: number; currency: string }
  | { ok: false; reason: string };

export async function getFalAccountBalance(): Promise<FalAccountBalance> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    return { ok: false, reason: "FAL_KEY is not set." };
  }

  try {
    const res = await fetchWithTimeout(
      "https://api.fal.ai/v1/account/billing?expand=credits",
      { headers: { authorization: `Key ${apiKey}` } },
      8_000,
    );

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          reason: "This key isn't scoped for account/billing access on fal.ai.",
        };
      }
      const errText = await res.text();
      return { ok: false, reason: `fal.ai billing API error (${res.status}): ${errText.slice(0, 200)}` };
    }

    const data = await res.json();
    const balance = data?.credits?.current_balance;
    const currency = data?.credits?.currency;
    if (typeof balance !== "number" || typeof currency !== "string") {
      return { ok: false, reason: "fal.ai billing response didn't include a credit balance." };
    }
    return { ok: true, balance, currency };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Request failed." };
  }
}
