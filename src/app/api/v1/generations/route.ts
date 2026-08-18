import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { API_RATE_LIMIT_PER_MINUTE, authenticateApiRequest } from "@/lib/api/keys";
import { runApiImageGeneration } from "@/lib/api/generate";
import { getOrigin } from "@/lib/origin";

// POST /api/v1/generations — make an image.
//
// Synchronous on purpose. An image takes roughly 20-60 seconds, which fits
// comfortably inside a request, and "call this, get your picture" is a far
// smaller thing for a customer to integrate than a queue they have to poll.
// If a client times out anyway, the work still finishes server-side and the
// result is retrievable from GET /api/v1/generations/{id} — which is why that
// endpoint exists as well as this one.

export const runtime = "nodejs";
// Images are well inside this; the ceiling is here so a slow provider gets
// cut off by us rather than by the platform mid-write.
export const maxDuration = 300;

const MAX_PROMPT_LENGTH = 2000;

export async function POST(request: Request) {
  // Service client: an API key is the credential, there is no session. Every
  // query behind this point filters by the authenticated user id explicitly.
  const supabase = createAdminClient();

  const { caller, error: authError } = await authenticateApiRequest(
    supabase,
    request.headers.get("authorization"),
  );
  if (!caller) {
    return NextResponse.json(
      { error: { code: authError.code, message: authError.message } },
      { status: authError.status },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Body must be valid JSON." } },
      { status: 400 },
    );
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const characterId = typeof payload.character_id === "string" ? payload.character_id : null;

  if (!prompt) {
    return NextResponse.json(
      { error: { code: "missing_prompt", message: "A prompt is required." } },
      { status: 400 },
    );
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      {
        error: {
          code: "prompt_too_long",
          message: `Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.`,
        },
      },
      { status: 400 },
    );
  }

  // Atomic per-user rate limit (public.api_rate_check): serializes per user with
  // an advisory lock and only records a hit when under the cap. The old version
  // counted rows then acted — two statements, no atomicity — so N concurrent
  // requests all read the same pre-insert count and all passed, letting a burst
  // fire unbounded paid generations. Credits remain the real limit; this bounds
  // a runaway loop.
  const { data: rateAllowed, error: rateError } = await supabase.rpc("api_rate_check", {
    p_user_id: caller.userId,
    p_window_seconds: 60,
    p_max: API_RATE_LIMIT_PER_MINUTE,
  });
  if (rateError) {
    return NextResponse.json(
      { error: { code: "internal_error", message: "Couldn't process that request." } },
      { status: 500 },
    );
  }
  if (rateAllowed !== true) {
    return NextResponse.json(
      {
        error: {
          code: "rate_limited",
          message: `Too many requests — the limit is ${API_RATE_LIMIT_PER_MINUTE} generations per minute.`,
        },
      },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

  const result = await runApiImageGeneration({
    supabase,
    userId: caller.userId,
    prompt,
    characterId,
    origin: await getOrigin(),
  });

  if (result.error !== null) {
    const code =
      result.status === 402
        ? "insufficient_credits"
        : result.status === 404
          ? "not_found"
          : result.status === 503
            ? "unavailable"
            : "generation_failed";
    return NextResponse.json(
      { error: { code, message: result.error } },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      id: result.id,
      status: result.status,
      image_url: result.imageUrl,
      // The prompt that actually ran, after Picacho's own drafting step —
      // worth returning, because it's usually the thing a developer wants to
      // tune against.
      final_prompt: result.prompt,
      match_score: result.matchScore,
      credits_used: result.creditsUsed,
    },
    { status: result.status === "succeeded" ? 201 : 200 },
  );
}
