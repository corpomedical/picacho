// Seedream v4 edit through fal's queue: C's composed route (design §6.5).
//
// Seedream is not a product lane. The product calls it in one place, the
// Angle Stage's guided re-render (src/lib/generations/angle-stage.ts), a
// "use server" module that reads the database, so the runner cannot load
// it. Its queue protocol is mirrored here instead, the same three steps:
// POST the input to queue.fal.run/<endpoint>, poll the status URL fal hands
// back until COMPLETED (or FAILED / CANCELLED), then read the response URL.
// Only queue.fal.run is called, which the net guard allows; the picture
// comes back as a fal.media URL that the caller downloads with a GET.
//
// The endpoint is the Angle Stage's (checked against angle-stage.ts at run
// start: pipeline-strings.mts). image_size is SEEDREAM_SQUARE, fal's square
// option: `c --probe` checks that it comes back 1024 × 1024 (design §10.3),
// so until a probe has run that is unverified, and the probe says so.
//
// Pure over an injected fetch: the tests drive it with a scripted queue.

import { fetchWithTimeout } from "../../../src/lib/generations/providers/fetch-with-timeout.ts";
import { isRecord, sleep as realSleep } from "./util.mts";

export const SEEDREAM_EDIT_ENDPOINT = "fal-ai/bytedance/seedream/v4/edit";
/** fal's square image_size option; `c --probe` checks the size it returns. */
export const SEEDREAM_SQUARE = "square_hd";

// angle-stage.ts QUEUE_URL_RE: a poll target is refetched only when it is
// provably fal's own queue host talking about one request.
const QUEUE_URL_RE = /^https:\/\/queue\.fal\.run\/[a-z0-9._\-/]+\/requests\/[a-z0-9-]+(\/status)?$/i;

export type SeedreamInput = { prompt: string; imageUrls: string[]; imageSize: string };
export type SeedreamResult =
  | { ok: true; url: string; requestId: string }
  | { ok: false; stage: "config" | "submit" | "poll" | "result" | "timeout"; status: number | null; detail: string };

type Fetch = (url: string, init: RequestInit, timeoutMs: number) => Promise<Response>;

/** Where a queue answer failed: status and the first 300 characters of the body (fal's error JSON; no key, no prompt). */
async function failure(stage: "submit" | "poll" | "result", res: Response): Promise<SeedreamResult> {
  const text = await res.text().catch(() => "");
  return { ok: false, stage, status: res.status, detail: `fal.ai (Seedream) error (${res.status}): ${text.slice(0, 300)}` };
}

export async function runSeedream(
  input: SeedreamInput,
  o: { apiKey?: string; fetch?: Fetch; sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number } = {},
): Promise<SeedreamResult> {
  const apiKey = o.apiKey ?? process.env.FAL_KEY;
  if (!apiKey) return { ok: false, stage: "config", status: null, detail: "FAL_KEY is not set" };
  const send = o.fetch ?? fetchWithTimeout;
  const wait = o.sleep ?? realSleep;
  const auth = { authorization: `Key ${apiKey}` };

  let submitted: Response;
  try {
    submitted = await send(
      `https://queue.fal.run/${SEEDREAM_EDIT_ENDPOINT}`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ prompt: input.prompt, image_urls: input.imageUrls, image_size: input.imageSize }),
      },
      30_000,
    );
  } catch (e) {
    // Sent, no answer: the job may exist. The caller books it as a render.
    return { ok: false, stage: "submit", status: -1, detail: `no answer to the submit (${e instanceof Error ? e.name : "error"})` };
  }
  if (!submitted.ok) return failure("submit", submitted);
  const job = (await submitted.json().catch(() => null)) as unknown;
  const requestId = isRecord(job) && typeof job.request_id === "string" ? job.request_id : "";
  const statusUrl = isRecord(job) && typeof job.status_url === "string" ? job.status_url : "";
  const responseUrl = isRecord(job) && typeof job.response_url === "string" ? job.response_url : "";
  if (!requestId || !QUEUE_URL_RE.test(statusUrl) || !QUEUE_URL_RE.test(responseUrl)) {
    return { ok: false, stage: "submit", status: submitted.status, detail: "the queue's answer carried no usable request id or status URL" };
  }

  // The Angle Stage's page polls every few seconds; a Seedream edit takes about 30 s.
  const deadline = Date.now() + (o.timeoutMs ?? 300_000);
  for (;;) {
    await wait(o.pollMs ?? 3000);
    if (Date.now() > deadline) return { ok: false, stage: "timeout", status: null, detail: `no result after ${Math.round((o.timeoutMs ?? 300_000) / 1000)} s` };
    let status: Response;
    try {
      status = await send(statusUrl, { headers: auth }, 15_000);
    } catch {
      continue; // a dropped poll is "still working", as angle-stage.ts reads it
    }
    if (!status.ok) continue;
    const s = (await status.json().catch(() => null)) as unknown;
    const state = isRecord(s) && typeof s.status === "string" ? s.status : "";
    if (state === "FAILED" || state === "CANCELLED") return { ok: false, stage: "poll", status: status.status, detail: `the queue says ${state}` };
    if (state !== "COMPLETED") continue;
    const res = await send(responseUrl, { headers: auth }, 20_000).catch(() => null);
    if (!res) return { ok: false, stage: "result", status: -1, detail: "no answer reading the result" };
    if (!res.ok) return failure("result", res);
    const body = (await res.json().catch(() => null)) as unknown;
    const images = isRecord(body) && Array.isArray(body.images) ? body.images : [];
    const url = isRecord(images[0]) && typeof images[0].url === "string" ? images[0].url : "";
    if (!url) return { ok: false, stage: "result", status: res.status, detail: "the result carried no image URL" };
    return { ok: true, url, requestId };
  }
}
