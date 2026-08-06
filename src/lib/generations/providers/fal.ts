import { getVideoModel } from "@/lib/generations/providers/video-models";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";

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
};

// Confirmed directly against fal.ai's published API docs (not guessed):
// - Elements: https://fal.ai/docs/model-api-reference/video-generation-api/kling-video-v1.6-standard
//   (prompt, input_image_urls[] — up to 4 images)
// - Storyboard (start/end frame): https://fal.ai/docs/model-api-reference/video-generation-api/kling-video-v2.1-pro
//   (prompt, image_url required, tail_image_url optional)
const KLING_ELEMENTS_ENDPOINT = "fal-ai/kling-video/v1.6/standard/elements";
const KLING_STORYBOARD_ENDPOINT = "fal-ai/kling-video/v2.1/pro/image-to-video";

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

export async function generateVideo(
  prompt: string,
  modelId: string,
  options: VideoGenerationOptions = {},
): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  const referenceImageUrls = (options.referenceImageUrls ?? []).filter(Boolean);

  let endpoint: string;
  let body: Record<string, unknown>;
  let label: string;

  if (referenceImageUrls.length >= 2) {
    // Multi-image reference — Kling's "elements" endpoint takes a flat list
    // of up to 4 images and blends them into the scene it generates.
    endpoint = KLING_ELEMENTS_ENDPOINT;
    body = { prompt, input_image_urls: referenceImageUrls.slice(0, 4) };
    label = "Kling (multi-image reference)";
  } else if (options.startImageUrl || options.endImageUrl) {
    // Storyboard — image-to-video requires a start frame; if only an end
    // frame was supplied, use it as the start frame too rather than failing
    // outright (still gives Kling something concrete to anchor the scene to).
    endpoint = KLING_STORYBOARD_ENDPOINT;
    body = {
      prompt,
      image_url: options.startImageUrl ?? options.endImageUrl,
      ...(options.endImageUrl ? { tail_image_url: options.endImageUrl } : {}),
    };
    label = "Kling (storyboard)";
  } else {
    const model = getVideoModel(modelId);
    endpoint = model.falEndpoint;
    body = { prompt };
    label = model.name;
  }

  // Video generation is the slowest step in the pipeline by far — routinely
  // 30s to a few minutes — so it gets the longest timeout of any provider call.
  const res = await fetchWithTimeout(
    `https://fal.run/${endpoint}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    180_000,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal.ai (${label}) error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const url = extractVideoUrl(data);

  if (!url) throw new Error(`fal.ai (${label}) response didn't include a video URL.`);
  return url;
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
    throw new Error(`fal.ai (ElevenLabs TTS) error (${res.status}): ${errText.slice(0, 300)}`);
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
    throw new Error(`fal.ai (Sync Lipsync) error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const url = extractVideoUrl(data);
  if (!url) throw new Error("fal.ai (Sync Lipsync) response didn't include a video URL.");
  return url;
}
