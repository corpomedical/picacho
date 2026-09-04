// BytePlus ModelArk — the direct route to Seedance, replacing the fal resale.
//
// WHY THIS EXISTS (2026-09-03). Seedance reaches us today through fal, which
// charges exactly 2.00x ByteDance's list: $14.00/M tokens against ModelArk's
// $7.00 for Seedance 2.0, $21.40 against $10.70 for 2.5. The same call, twice
// the price. Separately, fal's reference-to-video schema has no field for the
// asset ids ByteDance's consented-likeness route requires, so the feature our
// customers actually want is not reachable through it at any price.
//
// WHAT THIS DOES NOT FIX. The likeness fence follows us here: ModelArk answers
// a real face in an input image with 400 InputImageSensitiveContentDetected,
// which is the same refusal fal reports as content_policy_violation. Moving
// the lane halves the bill; it does not put a customer's face on screen. That
// still needs the private real-human asset library, which as of today does not
// appear in this account's API list at all — see docs/BYTEPLUS_ENQUIRY.md.
//
// SHAPES ARE READ FROM THE VENDOR'S OWN DOCS, NOT GUESSED. Everything below
// was transcribed from the ModelArk API reference on 2026-09-03, including
// the reference-to-video request example that supplies the content-array
// part shapes. Where the docs are silent the code says so rather than
// inventing a field — see the model ids and the failed-task error shape.

import type { QueuedJobState } from "@/lib/generations/providers/fal";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";

// Verified: the Bearer-token inference host, not the signed AK/SK OpenAPI
// plane the management calls (ListModelRateLimit, GetApiKey) live on.
const ARK_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const TASKS_PATH = "/contents/generations/tasks";

// RESOLVED 2026-09-04, from ModelArk's own Model list page. The create call
// takes a VERSION-SUFFIXED model id; the bare family names this block used to
// carry ("dreamina-seedance-2-0") are FoundationModelNames from
// ListModelRateLimit, and would have failed on the first send. The open
// question that stood here — bare name or suffixed id — is answered: suffixed.
//
// The full roster on that page, with the limits that matter to us:
//
//   dreamina-seedance-2-5-260628   480p / 720p / 1080p(10-bit), 24fps,
//                                  duration 4-30s, .mp4/.mov
//   dreamina-seedance-2-0-260128   480p / 720p / 1080p / 4K, 24fps,
//                                  duration 4-15s, .mp4
//   dreamina-seedance-2-0-fast-...  480p / 720p only, 4-15s
//   dreamina-seedance-2-0-mini-...  480p / 720p only, 4-15s
//
// So our catalogue's ladders both fit: 2.0 offers 5/10/15 against a 4-15
// ceiling, and 2.5 offers 5/10/15/20/30 against 4-30. The "Seedance accepts
// 4-15" note this file used to carry was the 2.0 limit applied to both.
//
// FLEX IS NOT AVAILABLE HERE. The same page lists "flex: Not supported" for
// every Dreamina model, so the offline-inference discount this file once
// hoped to price is not a lever on this lane, however async the product is.
// service_tier does exist as a request field (default "default"), which the
// API reference confirms — it is simply not honoured by these models.
//
// The fast and mini variants are the same family at a fraction of the price
// (their promotional 720p rates on 2026-09-04 were ~$0.09/s and ~$0.03/s
// against fal's $0.3024/s for 2.0) but they are DIFFERENT MODELS, not tiers,
// and nobody here has looked at their output. They are recorded, not wired.
export const ARK_MODELS = {
  /** Our "seedance" — Seedance 2.5. */
  seedance: "dreamina-seedance-2-5-260628",
  /** Our "seedance-2" — Seedance 2.0. */
  "seedance-2": "dreamina-seedance-2-0-260128",
} as const;

/** Same family, far cheaper, unevaluated. Not reachable from the catalogue. */
export const ARK_MODELS_UNEVALUATED = {
  "seedance-2-fast": "dreamina-seedance-2-0-fast-260128",
  "seedance-2-mini": "dreamina-seedance-2-0-mini-260615",
} as const;

// The tier a task ran under, as reported by the list endpoint's
// filter.service_tier. "flex" is ByteDance's offline inference mode, and it
// is worth pricing: this product is already fire-and-poll with a push at the
// end, so it has no interactive latency to protect and could take the
// cheaper tier wholesale — a lever a competitor selling real-time generation
// cannot pull. Read-only for now; see the note in submitArkVideoJob for why
// nothing sets it yet.
export type ArkServiceTier = "default" | "flex";

// Verified enum from the task list reference. Cancelled rows are queryable
// for 24 hours and then deleted, so a poller must treat "gone" as terminal
// rather than retrying forever.
type ArkTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type ArkTask = {
  id: string;
  model: string;
  status: ArkTaskStatus;
  created_at: string;
  updated_at: string;
  content?: { video_url?: string };
  usage?: { completion_tokens?: number };
};

// A 200 carrying HTML (a gateway error page, a captive portal) would
// otherwise surface as a bare SyntaxError with no provider name in it,
// which reads as an application bug rather than a provider one.
async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`BytePlus ModelArk returned a non-JSON body: ${text.slice(0, 300)}`);
  }
}

function apiKey(): string {
  const key = process.env.BYTEPLUS_ARK_API_KEY;
  if (!key) throw new Error("BytePlus ModelArk is not configured (BYTEPLUS_ARK_API_KEY is missing).");
  return key;
}

// The shared helper, not a hand-rolled AbortController: it converts an abort
// into FetchTimeoutError, and job-runner's isTransportError matches on that
// name to decide whether a failure is retryable. A local controller throws a
// raw AbortError instead, which falls through to the legacy message regex —
// the exact prose coupling that helper exists to have removed.
async function arkFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetchWithTimeout(
    `${ARK_BASE}${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
        ...(init.headers ?? {}),
      },
    },
    timeoutMs,
  );
}

// The refusals worth naming, from the reference's error table. The three
// sensitive-content codes are ModelArk's spelling of the fence that has been
// failing our Seedance sends at fal all along; classifying them correctly is
// what lets refund-rules treat them as the provably-unbilled rejections they
// are, rather than as a provider outage that should trip the model breaker.
export const ARK_CONTENT_REFUSALS = [
  "InputImageSensitiveContentDetected",
  "InputTextSensitiveContentDetected",
  "OutputVideoSensitiveContentDetected",
] as const;

// Deliberately a substring test over whatever text is available — an HTTP
// error body, or a whole serialized task. The failed-task payload's error
// shape is NOT documented (the reference's response example covers only the
// success fields), so keying this on a specific field name would fail
// silently the day the guess is wrong: a content refusal would read as an
// unclassifiable outage, trip the model breaker, and skip the refund.
export function isArkContentRefusal(text: string): boolean {
  return ARK_CONTENT_REFUSALS.some((code) => text.includes(code));
}

/**
 * One task's state, in the shape the job runner already speaks.
 *
 * Uses the list endpoint rather than the single-task GET so several in-flight
 * renders can be polled in one request: filter.task_ids repeats once per id.
 */
export async function checkArkTasks(taskIds: string[]): Promise<Map<string, QueuedJobState>> {
  const out = new Map<string, QueuedJobState>();
  if (taskIds.length === 0) return out;

  // Chunked, and paged within each chunk. The list endpoint bounds page_size
  // at 500 and reports `total`, so a single unpaged request silently
  // truncates — and the missing-means-gone rule below would then declare
  // every id the page could not fit permanently failed, killing live renders
  // and refunding nothing. Batch is well under the bound because these ids
  // ride in the query string, which has its own length limit.
  const BATCH = 50;
  for (let i = 0; i < taskIds.length; i += BATCH) {
    const batch = taskIds.slice(i, i + BATCH);
    const seen = await listTaskPage(batch);
    for (const [id, state] of seen) out.set(id, state);
    // Only an id absent from a COMPLETE answer for its own batch is gone:
    // cancelled more than 24 hours ago, or deleted. Terminal, not pending —
    // leaving it pending is how a job runner polls forever.
    for (const id of batch) {
      if (!out.has(id)) {
        out.set(id, { state: "failed", error: "BytePlus ModelArk: task no longer exists." });
      }
    }
  }
  return out;
}

/** Every page of one batch, so `total` is honoured rather than assumed. */
async function listTaskPage(batch: string[]): Promise<Map<string, QueuedJobState>> {
  const found = new Map<string, QueuedJobState>();
  const pageSize = Math.min(batch.length, 500);
  let page = 1;
  let total = Infinity;
  let fetched = 0;

  while (fetched < total && page <= 500) {
    const params = new URLSearchParams({ page_num: String(page), page_size: String(pageSize) });
    for (const id of batch) params.append("filter.task_ids", id);

    const res = await arkFetch(`${TASKS_PATH}?${params.toString()}`, { method: "GET" }, 30_000);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`BytePlus ModelArk error (${res.status}): ${text.slice(0, 800)}`);
    }
    const body = await parseJson<{ items?: ArkTask[]; total?: number }>(res);
    const items = body.items ?? [];
    for (const task of items) found.set(task.id, taskState(task));

    total = typeof body.total === "number" ? body.total : items.length;
    fetched += items.length;
    // A page that returns nothing cannot advance the count; stop rather than
    // spin against a server that disagrees with its own `total`.
    if (items.length === 0) break;
    page += 1;
  }
  return found;
}

function taskState(task: ArkTask): QueuedJobState {
  switch (task.status) {
    case "queued":
    case "running":
      return { state: "pending" };
    case "succeeded":
      return task.content?.video_url
        ? { state: "completed" }
        : { state: "failed", error: "BytePlus ModelArk reported success with no video_url." };
    case "cancelled":
      return { state: "failed", error: "BytePlus ModelArk: task was cancelled." };
    case "failed":
    default: {
      // The whole task is serialized into the message because its failure
      // shape is undocumented: this way a refusal code survives into the
      // attempt log wherever ByteDance chose to put it, and
      // isArkContentRefusal can find it without knowing the field name.
      return {
        state: "failed",
        error: `BytePlus ModelArk task failed: ${JSON.stringify(task).slice(0, 800)}`,
      };
    }
  }
}

/**
 * The finished file, and what it cost.
 *
 * completion_tokens comes back too because ByteDance bills per million
 * tokens — it is the only quantity that turns a render into a number, and
 * the entire case for this module is a price comparison. Returning the URL
 * alone would leave the 2x saving asserted from a list price rather than
 * checkable against an invoice.
 */
export async function fetchArkVideo(taskId: string): Promise<{ url: string; completionTokens: number | null }> {
  const res = await arkFetch(`${TASKS_PATH}/${encodeURIComponent(taskId)}`, { method: "GET" }, 30_000);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BytePlus ModelArk error (${res.status}): ${text.slice(0, 800)}`);
  }
  const task = await parseJson<ArkTask>(res);
  const url = task.content?.video_url;
  if (!url) throw new Error("BytePlus ModelArk returned no video_url for a finished task.");
  return { url, completionTokens: task.usage?.completion_tokens ?? null };
}

/**
 * DeleteContentsGenerationsTasks. Named for what the API calls it: whether
 * deleting an in-flight task also stops the billing clock is not documented,
 * so calling this "cancel" would promise a refund path it may not provide.
 */
export async function deleteArkTask(taskId: string): Promise<void> {
  const res = await arkFetch(`${TASKS_PATH}/${encodeURIComponent(taskId)}`, { method: "DELETE" }, 15_000);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BytePlus ModelArk error (${res.status}): ${text.slice(0, 400)}`);
  }
}

// The multimodal `content` array, verified against ByteDance's reference-to-
// video example. Every reference rides as its own part with a `role`, and the
// PROMPT cites it in prose — their sample writes "The first frame is Image 1"
// and "the fruit tea from Image 2". That is NOT the "@Image1" form our fal
// Seedance path uses; the citation lines have to be rewritten for this lane
// rather than reused, or the model is handed references it was never told to
// bind to.
//
// Documented combinations: text alone; text + image; text + video; and those
// two plus audio, in any pairing. There is also a "sample task id" mode that
// conditions on a previously generated Seedance video, which is worth a look
// for continuation work later.
type ArkContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; role: "reference_image" }
  | { type: "video_url"; video_url: { url: string }; role: "reference_video" };

export type ArkSubmitOptions = {
  /** Versioned model id, e.g. "dreamina-seedance-2-0-260128". See ARK_MODELS. */
  model: string;
  prompt: string;
  /** Whole seconds. 2.0 accepts 4-15; 2.5 accepts 4-30. */
  durationSeconds: number;
  /** e.g. "16:9", "9:16", "1:1". */
  ratio: string;
  /**
   * "480p" | "720p" | "1080p" (2.0 also does 4K). SEND IT. The API reference
   * lists no default for this field, and the one time this product let a
   * provider pick the resolution it billed at more than double the rate the
   * credit weights were built for (see the MiniMax H3 note in
   * video-models.ts). fal's Seedance body pins "720p"; so does this.
   */
  resolution: string;
  /**
   * Defaults to TRUE at ModelArk — the API reference says so explicitly —
   * which is the same default fal's branch applies, so passing the caller's
   * choice through keeps the two providers delivering the same thing.
   */
  generateAudio?: boolean;
  /** ByteDance stamps a visible mark when true. Off in their own example. */
  watermark?: boolean;
  /**
   * Identity references, in citation order — the caller is responsible for
   * the cap (our catalogue budgets Seedance at 4 images) and for writing a
   * prompt that actually refers to them as "Image 1", "Image 2" and so on.
   */
  referenceImageUrls?: string[];
  /** A clip to continue from, cited in the prompt as "Video 1". */
  referenceVideoUrl?: string;
};

/**
 * Create a video generation task.
 *
 * The envelope is verified against ByteDance's own request example: `content`
 * is an OpenAI-style array of typed parts, and ratio, duration and watermark
 * sit alongside it at the top level. `model` takes EITHER a model id (their
 * sample passes the versioned seedance-1-0-pro-250528) or an inference
 * endpoint id — worth remembering, because per-endpoint configuration is a
 * plausible route to the consented-likeness setup this file exists to reach.
 *
 * Identity references ride as image_url parts carrying role
 * "reference_image", and a continuation clip as a video_url part with role
 * "reference_video" — both read from ByteDance's own reference-to-video
 * sample, not inferred.
 */
export async function submitArkVideoJob(options: ArkSubmitOptions): Promise<string> {
  const content: ArkContentPart[] = [{ type: "text", text: options.prompt }];
  for (const url of options.referenceImageUrls ?? []) {
    content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
  }
  if (options.referenceVideoUrl) {
    content.push({
      type: "video_url",
      video_url: { url: options.referenceVideoUrl },
      role: "reference_video",
    });
  }
  const body: Record<string, unknown> = {
    model: options.model,
    content,
    resolution: options.resolution,
    ratio: options.ratio,
    // Integer here, unlike fal's branch, which sends the same number as a
    // string. Both are what the respective reference asks for.
    duration: options.durationSeconds,
    generate_audio: options.generateAudio ?? true,
    watermark: options.watermark ?? false,
    // NO service_tier. It turned out to be a real request field, defaulting
    // to "default" — but the Model list marks flex "Not supported" on every
    // Dreamina model, so there is nothing to switch to. Revisit only if that
    // line changes.
  };

  const res = await arkFetch(
    TASKS_PATH,
    { method: "POST", body: JSON.stringify(body) },
    30_000, // queueing only; the render itself is polled
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BytePlus ModelArk error (${res.status}): ${text.slice(0, 800)}`);
  }

  const created = (await res.json()) as { id?: string };
  if (!created.id) throw new Error("BytePlus ModelArk accepted the task but returned no id.");
  return created.id;
}
