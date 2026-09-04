import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { advanceGeneration } from "@/lib/generations/job-runner";
import { isTerminalArkStatus } from "@/lib/generations/providers/video-provider";

// BytePlus ModelArk calls this when a queued Seedance render changes state.
//
// Same job as the fal webhook next door, and for the same reason: polling only
// runs while somebody is watching, so without this a render that finishes at
// 3am with every tab closed is collected whenever that customer next opens the
// app — or never. That is not hypothetical here; the reaper that writes off
// stale jobs has exactly one caller, on /app/generate.
//
// TWO DIFFERENCES FROM FAL, both from ModelArk's own reference (2026-09-04).
//
// 1. THEY DO NOT SIGN. fal signs with ED25519 over a JWKS; ModelArk documents
//    no signature, no shared header, nothing. So the secret lives in the path,
//    which is the only channel a bare `callback_url` gives us, and it is
//    compared in constant time. The URL is only ever sent to ModelArk over
//    TLS. Set BYTEPLUS_WEBHOOK_SECRET to a long random string; without it
//    arkCallbackUrl returns null, no callback is requested, and this route
//    refuses everything.
//
// 2. THEY CALL ON EVERY TRANSITION — queued, running, succeeded, failed,
//    expired — and retry three times if we do not confirm within five
//    seconds. Intermediate pings are answered 200 and dropped; only terminal
//    ones do work.
//
// Like the fal route, the payload is NEVER trusted: the task id is looked up
// against our own job rows and advanceGeneration re-checks the real status
// with ModelArk using our own key. A forged body cannot inject a result URL,
// and the worst a leaked secret buys is an early poll of a job we own.
export const runtime = "nodejs";

let warnedNoSecret = false;

function secretMatches(provided: string): boolean {
  const expected = process.env.BYTEPLUS_WEBHOOK_SECRET;
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length through a 500 — so the lengths are compared first, and
  // the constant-time compare only runs when they match.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;

  if (!process.env.BYTEPLUS_WEBHOOK_SECRET) {
    if (!warnedNoSecret) {
      warnedNoSecret = true;
      console.warn(
        "BYTEPLUS_WEBHOOK_SECRET is not set — ModelArk callbacks are refused and Seedance renders " +
          "on the BytePlus lane are collected by polling only.",
      );
    }
    return new Response("Not configured", { status: 404 });
  }
  // 404 rather than 401: an address that does not authenticate should look
  // like an address that does not exist.
  if (!secretMatches(secret)) return new Response("Not found", { status: 404 });

  let body: { id?: string; status?: string };
  try {
    body = (await req.json()) as { id?: string; status?: string };
  } catch {
    return new Response("Malformed body", { status: 400 });
  }

  const taskId = body.id;
  if (!taskId) return new Response("Missing id", { status: 400 });

  // queued and running are progress pings. Answering them 200 costs one
  // request and stops the three-retry cycle; doing work on them would poll
  // ModelArk for a task we already know is unfinished.
  if (!isTerminalArkStatus(body.status)) return new Response("Noted", { status: 200 });

  const admin = createAdminClient();
  const { data: job } = await admin
    .from("generation_jobs")
    .select("generation_id, user_id")
    .eq("provider_request_id", taskId)
    .maybeSingle<{ generation_id: string; user_id: string }>();

  // No row means this was already finished — by a poll, by the reaper, or by
  // an earlier delivery of this same callback. 200 so ModelArk stops retrying
  // something genuinely done.
  if (!job) return new Response("Already handled", { status: 200 });

  try {
    await advanceGeneration(job.generation_id, job.user_id);
  } catch {
    // Non-2xx makes ModelArk retry, up to its documented three.
    return new Response("Retry", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
