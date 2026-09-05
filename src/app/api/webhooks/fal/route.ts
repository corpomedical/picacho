import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { advanceGeneration } from "@/lib/generations/job-runner";

// fal.ai calls this when a queued render finishes.
//
// This is what finally makes a generation independent of anyone's browser.
// Polling still runs while someone is watching — it updates the UI faster than
// a webhook round trip — but the webhook is what guarantees a finished render
// is collected at all. Three separate incidents on 2026-08-10 came down to the
// same root cause: the render was fine, and the thing responsible for
// COLLECTING it went away. A completed job at 3am with every tab closed now
// still lands in History.
//
// Node runtime, not edge: signature verification needs node:crypto's ED25519.
export const runtime = "nodejs";

const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
// fal's docs are explicit that these keys rotate and must not be cached longer
// than 24 hours.
const JWKS_TTL_MS = 6 * 60 * 60_000;
// ±5 minutes, per fal's documented leeway. Rejecting outside that window is
// what stops a captured request being replayed later.
const MAX_CLOCK_SKEW_SECONDS = 300;

let jwksCache: { keys: { x?: string }[]; fetchedAt: number } | null = null;

// Log the missing-pin warning once per process, not once per webhook.
let warnedNoAccountPin = false;

async function fetchJwks(): Promise<{ x?: string }[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;

  const res = await fetch(JWKS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const keys = ((await res.json())?.keys ?? []) as { x?: string }[];
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

// Verifies the ED25519 signature exactly as fal specifies: sign over
// requestId, userId, timestamp and the SHA-256 of the RAW body, newline
// separated, checked against every key in the JWKS.
//
// The raw bytes matter — hashing a re-serialised JSON object produces a
// different digest and every signature would fail.
async function isAuthentic(req: Request, rawBody: Buffer): Promise<boolean> {
  const requestId = req.headers.get("x-fal-webhook-request-id");
  const userId = req.headers.get("x-fal-webhook-user-id");
  const timestamp = req.headers.get("x-fal-webhook-timestamp");
  const signatureHex = req.headers.get("x-fal-webhook-signature");
  if (!requestId || !userId || !timestamp || !signatureHex) return false;

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > MAX_CLOCK_SKEW_SECONDS) return false;

  const message = Buffer.from(
    [requestId, userId, timestamp, createHash("sha256").update(rawBody).digest("hex")].join("\n"),
    "utf-8",
  );

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureHex, "hex");
  } catch {
    return false;
  }

  let keys: { x?: string }[];
  try {
    keys = await fetchJwks();
  } catch {
    // Can't verify, so can't accept. fal retries for two hours, and the
    // poller and reaper are still there as backstops.
    return false;
  }

  for (const key of keys) {
    if (!key.x) continue;
    try {
      // Node imports a raw ED25519 public key directly as a JWK, which avoids
      // pulling in libsodium just to unwrap 32 bytes.
      const publicKey = createPublicKey({
        key: { kty: "OKP", crv: "Ed25519", x: key.x },
        format: "jwk",
      });
      if (cryptoVerify(null, message, publicKey, signature)) return true;
    } catch {
      continue;
    }
  }

  return false;
}

export async function POST(req: Request) {
  const rawBody = Buffer.from(await req.arrayBuffer());

  if (!(await isAuthentic(req, rawBody))) {
    // 401, not 400 — this is authentication, and fal should retry a transient
    // JWKS failure on our side.
    return new Response("Invalid signature", { status: 401 });
  }

  // The signature above only proves the request came from fal's PLATFORM —
  // any fal customer can point their own jobs' webhooks at this URL and every
  // one of them signs valid. Pin the delivery to OUR fal account:
  // x-fal-webhook-user-id (part of the signed message, so it can't be forged
  // past the check above) must match FAL_ACCOUNT_ID when the operator has set
  // it. The blast radius today is small — advanceGeneration re-checks status
  // with fal and a foreign request_id matches no job row — but a foreign
  // customer could still burn our compute and probe timing, and any future
  // handler that trusts the payload more would inherit the hole. Unset keeps
  // current behavior (warn once) so this deploys safely before the env var
  // exists. Operator: FAL_ACCOUNT_ID = the user id fal sends in this header
  // (visible in fal's dashboard / one legitimate webhook's headers).
  const expectedAccountId = process.env.FAL_ACCOUNT_ID;
  const falAccountId = req.headers.get("x-fal-webhook-user-id");
  if (expectedAccountId) {
    if (falAccountId !== expectedAccountId) {
      // 403, not 401: authentication succeeded, this account just isn't ours.
      // A non-2xx makes fal retry a delivery that will never be accepted, but
      // that's fal's queue burning, not ours.
      return new Response("Not this account", { status: 403 });
    }
  } else if (!warnedNoAccountPin) {
    warnedNoAccountPin = true;
    console.warn(
      "FAL_ACCOUNT_ID is not set — the fal webhook accepts deliveries for ANY fal customer's jobs. " +
        `Set FAL_ACCOUNT_ID to pin it to our account (this delivery's account id: ${falAccountId}).`,
    );
  }

  let body: { request_id?: string; status?: string };
  try {
    body = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    return new Response("Malformed body", { status: 400 });
  }

  const requestId = body.request_id;
  if (!requestId) return new Response("Missing request_id", { status: 400 });

  const admin = createAdminClient();
  const { data: job, error: jobLookupError } = await admin
    .from("generation_jobs")
    .select("generation_id, user_id")
    .eq("provider_request_id", requestId)
    .maybeSingle<{ generation_id: string; user_id: string }>();

  // Error checked BEFORE the null check: a transient DB failure used to look
  // exactly like "already handled" and got a 200 — and fal stops retrying an
  // acked delivery, defeating this route's whole purpose (collecting a
  // finished render with no browser open). 500 lets fal retry, same as the
  // advanceGeneration throw below.
  if (jobLookupError) {
    console.error("fal webhook: job lookup failed", jobLookupError.message);
    return new Response("Retry", { status: 500 });
  }

  // No job row means this was already finished — by a poll, by the reaper, or
  // by an earlier delivery of this same webhook. fal retries up to ten times
  // over two hours, so duplicate deliveries are expected, not exceptional.
  // 200 so fal stops retrying something that's genuinely done.
  if (!job) return new Response("Already handled", { status: 200 });

  // Reuses the exact state machine the poller drives, rather than a parallel
  // completion path that could drift from it. It re-checks status with fal
  // instead of trusting the webhook payload's shape, which also means a
  // spoofed-but-somehow-valid body can't inject a result URL.
  try {
    await advanceGeneration(job.generation_id, job.user_id);
  } catch {
    // Let fal retry.
    return new Response("Retry", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
