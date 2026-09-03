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
// was transcribed from the ModelArk API reference on 2026-09-03. The one
// function still missing is submitVideoJob, because the request body of
// CreateContentsGenerationsTasks has not been read yet — and a money path
// built on a guessed request shape is how you bill someone for a call that
// was never going to work. It throws until that is filled in.

import type { QueuedJobState } from "@/lib/generations/providers/fal";

// Verified: the Bearer-token inference host, not the signed AK/SK OpenAPI
// plane the management calls (ListModelRateLimit, GetApiKey) live on.
const ARK_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const TASKS_PATH = "/contents/generations/tasks";

// Confirmed present and unrestricted on this account (ListModelRateLimit,
// 2026-09-03): 10 concurrent requests, 600 CreateTask RPM each. The
// "dreamina-" family is the line ByteDance attaches portrait rights to — its
// pricing page quotes dreamina-seedance-2-0-260128 and the rights document is
// titled "Dreamina Seedance Advanced Creation Rights".
//
// NOTE THE VERSION SUFFIX. ListModelRateLimit reports bare family names, but
// CreateContentsGenerationsTasks wants a VERSIONED id — ByteDance's own
// example passes seedance-1-0-pro-250528. Their pricing page quotes
// dreamina-seedance-2-0-260128, so the suffix below is read from that; the
// 2.5 suffix has not been seen yet and must be confirmed before a call is
// made, which is why it is marked rather than invented.
export const ARK_MODELS = {
  /** Our "seedance" — Seedance 2.5. SUFFIX UNCONFIRMED. */
  seedance: "dreamina-seedance-2-5",
  /** Our "seedance-2" — Seedance 2.0. */
  "seedance-2": "dreamina-seedance-2-0-260128",
} as const;

// "flex" is ByteDance's offline inference mode. Worth pricing before use:
// this product is already fire-and-poll with a push notification at the end,
// so it has no interactive latency to protect and could take the cheaper tier
// wholesale — a lever a competitor selling real-time generation cannot pull.
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
  error?: { code?: string; message?: string };
};

function apiKey(): string {
  const key = process.env.BYTEPLUS_ARK_API_KEY;
  if (!key) throw new Error("BytePlus ModelArk is not configured (BYTEPLUS_ARK_API_KEY is missing).");
  return key;
}

async function arkFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${ARK_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
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

export function isArkContentRefusal(message: string): boolean {
  return ARK_CONTENT_REFUSALS.some((code) => message.includes(code));
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

  const params = new URLSearchParams({ page_num: "1", page_size: String(Math.min(taskIds.length, 500)) });
  for (const id of taskIds) params.append("filter.task_ids", id);

  const res = await arkFetch(`${TASKS_PATH}?${params.toString()}`, { method: "GET" }, 30_000);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BytePlus ModelArk error (${res.status}): ${text.slice(0, 800)}`);
  }

  const body = (await res.json()) as { items?: ArkTask[] };
  for (const task of body.items ?? []) {
    out.set(task.id, taskState(task));
  }
  // A task the list does not return is gone — cancelled more than 24 hours
  // ago, or deleted. Terminal, not pending: leaving it pending is how a job
  // runner polls forever.
  for (const id of taskIds) {
    if (!out.has(id)) out.set(id, { state: "failed", error: "BytePlus ModelArk: task no longer exists." });
  }
  return out;
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
      const code = task.error?.code ?? "unknown";
      const message = task.error?.message ?? "no message";
      return { state: "failed", error: `BytePlus ModelArk error (${code}): ${message}` };
    }
  }
}

/** The finished file. Only meaningful once checkArkTasks reports completed. */
export async function fetchArkVideoUrl(taskId: string): Promise<string> {
  const res = await arkFetch(`${TASKS_PATH}/${encodeURIComponent(taskId)}`, { method: "GET" }, 30_000);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BytePlus ModelArk error (${res.status}): ${text.slice(0, 800)}`);
  }
  const task = (await res.json()) as ArkTask;
  const url = task.content?.video_url;
  if (!url) throw new Error("BytePlus ModelArk returned no video_url for a finished task.");
  return url;
}

export async function cancelArkTask(taskId: string): Promise<void> {
  await arkFetch(`${TASKS_PATH}/${encodeURIComponent(taskId)}`, { method: "DELETE" }, 15_000);
}

/** One part of the multimodal `content` array. */
type ArkContentPart = { type: "text"; text: string };

export type ArkSubmitOptions = {
  /** Versioned model id, e.g. "dreamina-seedance-2-0-260128". See ARK_MODELS. */
  model: string;
  prompt: string;
  /** Whole seconds. Seedance accepts 4-15. */
  durationSeconds: number;
  /** e.g. "16:9", "9:16", "1:1". */
  ratio: string;
  /** ByteDance stamps a visible mark when true. Off in their own example. */
  watermark?: boolean;
  serviceTier?: ArkServiceTier;
  /**
   * Reference images for identity work. NOT SENT YET — see the throw below.
   * Kept in the signature so the call sites that will need it are typed now.
   */
  referenceImageUrls?: string[];
};

/**
 * Create a video generation task.
 *
 * The envelope is verified against ByteDance's own request example: `model`
 * is a VERSIONED model id (their sample uses seedance-1-0-pro-250528), not an
 * inference endpoint id; `content` is an OpenAI-style array of typed parts;
 * ratio, duration and watermark sit alongside it at the top level.
 *
 * REFERENCE IMAGES ARE REFUSED HERE ON PURPOSE. The documented example is
 * text-to-video only, and the part shape for an image is not something to
 * infer — every plausible guess (an image_url part, a bare url, an asset
 * reference) is a request that costs money to discover is wrong. Picacho's
 * whole Seedance use is identity work, so until the content array's allowed
 * part types are read from the reference, this path is honest about being
 * unfinished rather than expensively optimistic.
 */
export async function submitArkVideoJob(options: ArkSubmitOptions): Promise<string> {
  if (options.referenceImageUrls?.length) {
    throw new Error(
      "BytePlus ModelArk: reference images are not wired yet — the content array's image part shape is undocumented here.",
    );
  }

  const content: ArkContentPart[] = [{ type: "text", text: options.prompt }];
  const body: Record<string, unknown> = {
    model: options.model,
    content,
    ratio: options.ratio,
    duration: options.durationSeconds,
    watermark: options.watermark ?? false,
    ...(options.serviceTier ? { service_tier: options.serviceTier } : {}),
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
