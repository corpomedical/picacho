import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { scoreIdentityMatch } from "@/lib/generations/providers/openai";
import { rateLimited } from "@/lib/rate-limit";

// The free public identity checker (2026-08-30).
//
// Two images in, a 0-100 identity match out. No account, no credits, no
// storage — and deliberately no restriction on where the second image came
// from, because the whole point is that it works on OTHER tools' output.
// Someone fighting character drift in Kling or Midjourney can measure their
// problem here, and the thing that measured it is the thing that fixes it.
//
// This is the one capability Picacho has that nobody else ships: across
// roughly thirty products surveyed, not one shows a per-generation identity
// score. Keeping it locked inside the paid product means no stranger ever
// experiences it.

export const runtime = "nodejs";
// Never cache: every request is a different pair of images, and a cached
// score on someone else's photos would be both wrong and a privacy leak.
export const dynamic = "force-dynamic";

// Data URLs are sent straight to the vision model — nothing is written to
// storage, which is the honest version of "we don't keep your photos" and
// removes a whole class of retention question. It also caps how big a
// request can be: OpenAI rejects oversized payloads, and so do we, first.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Per-IP, not per-user: there is no user. Ten checks an hour is generous for
// anyone genuinely evaluating their own character and tight enough that the
// endpoint cannot become free vision-model access for a script.
const WINDOW_SECONDS = 60 * 60;
const MAX_PER_WINDOW = 10;

/**
 * A stable UUID for an IP, so the existing per-user limiter can key on it
 * without a new table or a new SQL function.
 *
 * Hashed, not stored raw: this ends up in api_rate_hits, and a table of bare
 * visitor IPs is personal data we have no reason to hold. The hash is salted
 * with a server-only secret so the table cannot be reversed by guessing IPs.
 */
function ipKey(request: NextRequest): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "picacho";
  const h = createHash("sha256").update(`identity-check:${salt}:${ip}`).digest("hex");
  // Format as a UUID so the uuid-typed RPC accepts it.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function toDataUrl(file: File): Promise<string | null> {
  if (!ALLOWED_TYPES.has(file.type)) return null;
  if (file.size > MAX_IMAGE_BYTES) return null;
  const buf = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${buf.toString("base64")}`;
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const reference = form?.get("reference");
  const candidate = form?.get("candidate");

  if (!(reference instanceof File) || !(candidate instanceof File)) {
    return NextResponse.json({ error: "Upload two images." }, { status: 400 });
  }

  const [referenceUrl, candidateUrl] = await Promise.all([
    toDataUrl(reference),
    toDataUrl(candidate),
  ]);
  if (!referenceUrl || !candidateUrl) {
    return NextResponse.json(
      { error: "Both files must be a JPEG, PNG or WebP under 4MB." },
      { status: 400 },
    );
  }

  // Checked AFTER validation so a malformed request doesn't consume someone's
  // allowance, and BEFORE the paid vision call so a script cannot.
  if (await rateLimited(ipKey(request), "identity-check", WINDOW_SECONDS, MAX_PER_WINDOW)) {
    return NextResponse.json(
      { error: "That's a lot of checks. Try again in an hour." },
      { status: 429 },
    );
  }

  // The same scorer the product runs on every image it generates — not a
  // demo version of it. Whatever number this returns is the number a paying
  // customer would see.
  const verdict = await scoreIdentityMatch(candidateUrl, referenceUrl, "");
  if (!verdict) {
    return NextResponse.json(
      { error: "Couldn't read one of those images. Try a clearer photo." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    score: verdict.score,
    notes: verdict.notes,
    unusable: verdict.unusable,
  });
}
