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

// And a ceiling for everyone together (2026-09-22, before the launch posts
// link here). The per-IP limit stops one person; nothing stopped a thousand.
// This call spends from the same OpenAI balance both content gates read
// from, and those gates fail closed, so a checker flood would not just cost
// money: it would refuse every generation on the site once the balance ran
// dry (it ran dry on 15 and 19 Sept without any help).
//
// THE MONEY, at OpenAI's gpt-5.4-mini prices read 2026-09-22 ($0.75 per 1M
// input tokens, $4.50 per 1M output): two images at about 1,100 tokens each
// (look-people.ts measured a 1024-px picture) plus ~400 of instructions is
// ~2,600 input = $0.00195; the answer's ceiling is 2,000 tokens = $0.009.
// So one check costs at most about $0.011, and 2,000 checks a day at most
// about $22. The typical check writes far fewer than 2,000 tokens; that
// number is unmeasured. Rolling 24 hours, not a calendar day.
const GLOBAL_WINDOW_SECONDS = 24 * 60 * 60;
const GLOBAL_MAX_PER_DAY = 2000;
// One shared bucket: a fixed key in the limiter's uuid-typed column.
const GLOBAL_KEY = "00000000-0000-4000-8000-1dc4ec000001";

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
      // The honest combined cap is the platform's, not ours: Vercel rejects
      // request bodies over ~4.5MB before this route runs, so "under 4MB
      // each" was a promise the pair could not keep. The web tool downscales
      // client-side; this copy is for direct API callers.
      { error: "Both files must be a JPEG, PNG or WebP — under 4MB each and about 4MB combined." },
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
  if (await rateLimited(GLOBAL_KEY, "identity-check-global", GLOBAL_WINDOW_SECONDS, GLOBAL_MAX_PER_DAY)) {
    return NextResponse.json(
      { error: "The checker is busy today. Try again tomorrow." },
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
    faceVisible: verdict.faceVisible,
  });
}
