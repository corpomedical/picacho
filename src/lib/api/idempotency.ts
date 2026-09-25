// Relative imports on purpose: the test loads this module, and vitest has no
// "@/" alias configured (the repo's standing gotcha).
import { createHmac } from "node:crypto";
import type { FollowOutcome } from "../generations/repeat-send";
import { absolutizeMediaUrl } from "../media/url";

// ONE REQUEST, CHARGED ONCE (Press Tour cut 0, 2026-09-25). generate_image
// over MCP, and POST /api/v1/generations behind it, minted a fresh row id on
// every call. An MCP host that retries a tools/call whose answer it never saw
// (a dropped connection, its own timeout on a 20-60 s render) therefore
// reserved, charged and rendered a SECOND image, and the person paid twice
// for one request. The composer fixed the same shape for the browser's
// silent resend in repeat-send.ts; this is that fix for the API.
//
// The caller names the request (idempotency_key), and the row's primary key is
// made from that name. A second delivery of the same request meets the same
// id: before anything is gated, charged or rendered it finds the row, follows
// the first delivery's take to its end, and answers with it. Two deliveries
// racing both reach reserve_generation, and the second meets the primary key
// (23505) and follows the first instead. Neither path can charge twice,
// because the id is the row's primary key.
//
// Keyed by (user, key) through an HMAC, for two reasons the critique named:
// a model picks low-entropy keys ("img-1"), so two people sending the same key
// must never meet one row, and nobody who can choose a row id elsewhere (the
// composer takes its id from the client) can predict another person's id and
// take it first.
//
// The same key sent with a DIFFERENT prompt or character is refused, not
// followed: a model that reuses "img-1" for its next picture must not be
// handed the previous one as if it were new. That is Stripe's rule for the
// same mistake.

/** Longest key accepted. Stripe's own ceiling; any uuid or random string fits. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export const IDEMPOTENCY_KEY_NOT_A_STRING = "idempotency_key must be a string.";
export const IDEMPOTENCY_KEY_TOO_LONG = `idempotency_key must be ${IDEMPOTENCY_KEY_MAX_LENGTH} characters or fewer.`;
export const IDEMPOTENCY_KEY_REUSED =
  "That idempotency_key was already used for a different request, so nothing new was made or charged. Use a new key for a new image.";
export const IDEMPOTENT_TAKE_DELETED =
  "The image made for that idempotency_key has been deleted, so nothing new was made or charged. Use a new key to make another.";

/**
 * The key as the caller sent it, or why it can't be used.
 *
 * Absent, null and blank all mean "no key": a host that fills every optional
 * string field with "" must not have every call refused. A key is trimmed, so
 * "abc" and "abc " name the same request.
 */
export function parseIdempotencyKey(
  value: unknown,
): { key: string | null; error: null } | { key: null; error: string } {
  if (value === undefined || value === null) return { key: null, error: null };
  if (typeof value !== "string") return { key: null, error: IDEMPOTENCY_KEY_NOT_A_STRING };
  const key = value.trim();
  if (!key) return { key: null, error: null };
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) return { key: null, error: IDEMPOTENCY_KEY_TOO_LONG };
  return { key, error: null };
}

/**
 * The generation row id for one user's idempotency key.
 *
 * HMAC-SHA-256 over (purpose, user, key), JSON-encoded so no two inputs can
 * concatenate to the same bytes, stamped as a version-8 UUID (RFC 9562's
 * version for ids made by a rule of one's own, as recast/repeat.ts does). The
 * same user and key always give the same id; a different user or key never
 * does, and nobody without the server's secret can compute it.
 */
export function idempotentGenerationId(input: { userId: string; key: string }, secret: string): string {
  if (!secret) throw new Error("idempotentGenerationId needs a secret.");
  const bytes = createHmac("sha256", secret)
    .update(JSON.stringify(["api-generate-image", input.userId, input.key]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The first delivery's row, as far as deciding whether this is the same request. */
export type KeyedRow = {
  prompt_input: string | null;
  character_profile_id: string | null;
  deleted_at: string | null;
  credits_used: number | null;
};

/**
 * Whether a keyed row was made by THIS request: the same prompt and the same
 * character (or none, both times). Anything else is a key reused for a
 * different request.
 *
 * The character is compared without case: Postgres hands a uuid back in
 * lowercase, while a model may write the id it was given in capitals, and
 * character_profiles matches either. Compared as written, the retry of a
 * request made with "3F2A…" was refused as a different request, and the
 * image the retry existed to fetch was never returned (review F8).
 */
export function isSameRequest(row: KeyedRow, request: { prompt: string; characterId: string | null }): boolean {
  const stored = row.character_profile_id ? row.character_profile_id.toLowerCase() : null;
  const asked = request.characterId ? request.characterId.toLowerCase() : null;
  return (row.prompt_input ?? "") === request.prompt && stored === asked;
}

/**
 * runApiImageGeneration's answer for a repeat: the first delivery's take, in
 * the shape the first delivery answers with. Null when this is not a repeat.
 *
 * A take still rendering inside the first delivery when the follower's clock
 * runs out comes back as "generating" with its id, never as a failure: it
 * exists and is charged, and get_generation fetches it when it lands. Saying
 * it failed would invite the very retry this exists to stop.
 *
 * creditsUsed is the row's own figure, read after the take settled: 0 once a
 * refund released it, as the first delivery reports.
 */
export function apiRepeatAnswer(
  outcome: FollowOutcome,
  creditsUsed: number | null,
  origin: string,
):
  | null
  | {
      error: null;
      id: string;
      status: "succeeded" | "failed" | "generating";
      prompt: string;
      imageUrl: string | null;
      matchScore: number | null;
      creditsUsed: number;
    } {
  if (outcome.kind === "none") return null;
  if (outcome.kind === "running") {
    const id = outcome.ids[0];
    if (!id) return null;
    return { error: null, id, status: "generating", prompt: "", imageUrl: null, matchScore: null, creditsUsed: creditsUsed ?? 1 };
  }
  const take = outcome.takes[0];
  if (!take) return null;
  if (take.pending) {
    return { error: null, id: take.id, status: "generating", prompt: take.finalPrompt, imageUrl: null, matchScore: null, creditsUsed: creditsUsed ?? 1 };
  }
  return {
    error: null,
    id: take.id,
    status: take.succeeded ? "succeeded" : "failed",
    prompt: take.finalPrompt,
    imageUrl: take.succeeded && take.resultUrl ? absolutizeMediaUrl(take.resultUrl, origin) : null,
    matchScore: take.matchScore,
    creditsUsed: creditsUsed ?? (take.succeeded ? 1 : 0),
  };
}
