// The output gate: the platform content policy applied to the PICTURE.
//
// The prompt gate (content-policy.ts) judges words. Words are a guess about
// what will be made. The operator's rule, 2026-09-09: "The engine won't
// generate prohibited pictures and that is that." This is where that
// becomes literally true — a rendered image, or a video's frame, is judged
// before anything is marked succeeded, shown, or stored as a result.
//
// TWO READERS, GOOD AT DIFFERENT THINGS. Neither alone is trustworthy, and
// tonight's measurements say why:
//
//   * The moderation endpoint (omni-moderation-latest) is purpose-built for
//     nudity and cannot be talked out of it. It returns a calibrated
//     `sexual` score on the image. It cannot tell a marble statue from a
//     person, and it has no image reading for minors at all — that category
//     is text-only, and returns 0 for every picture. Probed live: a benign
//     screenshot scores 0.0000136.
//
//   * A vision model reads CONTEXT — it knows a life-drawing class from a
//     bedroom, a nude figure study on an easel from the subject being nude —
//     and it is the only reader that can answer the minors question on an
//     image. It also hedges, and is not deterministic at threshold edges.
//
// Agreement decides. Disagreement is resolved by which reader is competent
// for the case: an artwork the model identifies overrides a moderation flag;
// a moderation flag the model merely hedges on is refused, because on this
// side of the render the picture EXISTS, and a wrong allow ships it. That
// asymmetry is the whole difference between this gate and the prompt gate.
//
// THE GATES INFORM EACH OTHER. A prompt that scored MEDIUM on a category —
// allowed, but borderline — has its image scrutinised one band harder on
// that category. And a prompt that scored NEGLIGIBLE everywhere whose image
// is refused is the PROVIDER going off-script: refunded, and logged as a
// fact about that model, not that customer.
//
// TERMINAL. A refused output is never a second attempt. Re-rendering until
// the picture passes is the soften-and-retry ladder in a new coat.
//
// FAILS CLOSED. Both readers unreachable, after one retry: refuse, refund.
// The render is billed to us and not delivered; we absorb that rather than
// show a picture nothing has looked at.

// Providers are imported inside the functions that call them, not here:
// vitest cannot resolve the "@/…" alias, and the pure halves of this file —
// parseVision and decideOutput — must stay unit-testable without dragging in
// the provider clients. Same shape as content-policy.ts. The type import is
// erased at compile time and is fine.
import type { Band, Scores } from "@/lib/generations/content-policy";

const BAND_ORDER: Band[] = ["NEGLIGIBLE", "LOW", "MEDIUM", "HIGH"];
const bv = (b: Band) => BAND_ORDER.indexOf(b);
const raise = (b: Band, n = 1): Band => BAND_ORDER[Math.min(3, bv(b) + n)];

export type OutputReason = "sexual" | "minors" | "unavailable";

export class OutputPolicyRefusal extends Error {
  readonly reason: OutputReason;
  readonly userMessage: string;
  /** Both readings, for the log and for explaining the refusal. */
  readonly readings: OutputReadings;

  constructor(reason: OutputReason, userMessage: string, readings: OutputReadings) {
    super(`Output policy: ${reason}`);
    this.name = "OutputPolicyRefusal";
    this.reason = reason;
    this.userMessage = userMessage;
    this.readings = readings;
  }
}

/** What the moderation endpoint said about the image. */
export type ModerationReading = {
  /**
   * The endpoint's own calibrated verdict ON THE SEXUAL CATEGORIES — never
   * its overall `flagged`, which is the union of every category it scores.
   * Measured 2026-09-10: a "red-haired warrior on a battlefield" video was
   * refused as sexual with a sexual score of 0.0000, because the overall
   * flag had fired on violence. This gate's remit is sexual content and
   * minors; what the endpoint thinks about violence, harassment or
   * self-harm is not a verdict it may borrow.
   */
  flagged: boolean;
  /** 0..1 — kept for measurement and for the log; bands are derived below. */
  sexual: number;
};

/** What the vision model said about the image. */
export type VisionReading = {
  sexual_nudity: Band;
  sexual_act: Band;
  suggestive_framing: Band;
  minor_sexualized: Band;
  /** Where any nudity or suggestiveness actually sits in the frame. */
  depicted_subject: "person" | "artwork" | "none";
};

export type OutputReadings = {
  moderation: ModerationReading | null;
  vision: VisionReading | null;
};

const MSG_SEXUAL =
  "The picture that came back didn't pass our check, so it wasn't shown. Your request was " +
  "fine — the credit is back.";
const MSG_MINORS =
  "The picture that came back didn't pass our check and wasn't shown. The credit is back.";
const MSG_UNAVAILABLE =
  "We couldn't check the picture that came back, so it wasn't shown. The credit is back — " +
  "please try again in a moment.";

// ---------------------------------------------------------------------------
// The picture itself
// ---------------------------------------------------------------------------

// Both readers are handed the BYTES, as a data URL — never a URL to fetch.
// The first measurement (2026-09-10) came back with thirty of sixty real
// renders "unavailable", and the only evidence was OpenAI's "Could not
// download file from URL provided" — which says nothing about why. Fetched
// here instead, the reason was a status code: 404, files deleted in the
// previous day's purge while their rows still read "succeeded". The point
// of doing the download ourselves is exactly that: a picture that cannot be
// read fails HERE, with its status in the log, and never as a third party's
// opaque refusal that reads the same as a policy verdict. We download once,
// shrink to what the readers look at anyway (the vision read is
// detail:"low"; the moderation scores in the eval were measured on this
// same path), and send the one picture to both. A fal frame URL and a
// provider CDN URL take the same route, so nothing depends on which host
// served the file or how.
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const READER_WIDTH = 1024;

async function loadImage(url: string): Promise<string | null> {
  try {
    const { fetchWithTimeout } = await import("@/lib/generations/providers/fetch-with-timeout");
    const res = await fetchWithTimeout(url, { method: "GET" }, 20_000);
    if (!res.ok) {
      console.warn(`[output-policy] image fetch ${res.status} for ${url.slice(0, 120)}`);
      return null;
    }
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.length === 0 || raw.length > MAX_IMAGE_BYTES) {
      console.warn(`[output-policy] image is ${raw.length} bytes; not judged`);
      return null;
    }
    try {
      const { default: sharp } = await import("sharp");
      const jpeg = await sharp(raw, { limitInputPixels: 50_000_000 })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize({ width: READER_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    } catch {
      // sharp is a native module and may be absent; the original bytes are
      // a slower but equally valid picture.
      const type = res.headers.get("content-type")?.split(";")[0] || "image/png";
      return `data:${type};base64,${raw.toString("base64")}`;
    }
  } catch (err) {
    console.warn("[output-policy] image fetch threw:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reader A — the moderation endpoint
// ---------------------------------------------------------------------------

// The `sexual` score, banded — for the log and the eval; the verdict itself
// uses the endpoint's own calibrated `flagged`. Measured 2026-09-10 with
// scripts/output-policy-eval.mjs on the reviewer's eleven renders and sixty
// real ones: the ordinary pictures score at most 0.021 (p95 0.003), the two
// boudoir posters 0.010 and 0.065, the one nude 0.930. So LOW starts above
// everything ordinary, the slip-dress-on-a-bed picture lands in LOW, and
// nothing real sits anywhere near the MEDIUM/HIGH lines.
export const MODERATION_BANDS = { low: 0.05, medium: 0.25, high: 0.6 } as const;

export function moderationBand(sexual: number): Band {
  if (sexual >= MODERATION_BANDS.high) return "HIGH";
  if (sexual >= MODERATION_BANDS.medium) return "MEDIUM";
  if (sexual >= MODERATION_BANDS.low) return "LOW";
  return "NEGLIGIBLE";
}

async function readModeration(image: string): Promise<ModerationReading | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const { fetchWithTimeout } = await import("@/lib/generations/providers/fetch-with-timeout");
    const res = await fetchWithTimeout(
      "https://api.openai.com/v1/moderations",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: [{ type: "image_url", image_url: { url: image } }],
        }),
      },
      20_000,
    );
    if (!res.ok) {
      console.warn(`[output-policy] moderation endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    return parseModeration(await res.json());
  } catch {
    return null;
  }
}

/** Exported for the test suite: the category rule above, with no network. */
export function parseModeration(data: unknown): ModerationReading | null {
  const r = (data as { results?: Array<Record<string, unknown>> } | null)?.results?.[0];
  const scores = (r?.category_scores ?? {}) as Record<string, unknown>;
  const cats = (r?.categories ?? {}) as Record<string, unknown>;
  const sexual = Number(scores.sexual);
  if (!Number.isFinite(sexual)) return null;
  return { flagged: cats.sexual === true || cats["sexual/minors"] === true, sexual };
}

// ---------------------------------------------------------------------------
// Reader B — the vision model
// ---------------------------------------------------------------------------

const VISION_INSTRUCTIONS =
  `You are the output-side content gate for an AI character photography product distributed ` +
  `on Google Play. You are looking at a picture the product just rendered and deciding what ` +
  `is IN it. You do not decide whether to block; a policy layer does that from your scores.\n\n` +
  `Score each NEGLIGIBLE, LOW, MEDIUM or HIGH:\n\n` +
  `sexual_nudity — a person in the frame is nude, effectively nude, or in clothing that would ` +
  `not be acceptable in an appropriate public context, presented sexually. Swimwear at a ` +
  `beach, a towel in a spa, dancewear on a stage are NEGLIGIBLE to LOW.\n` +
  `sexual_act — a sex act, or genitalia as the subject.\n` +
  `suggestive_framing — posing, cropping, or emphasis that makes a sexual reading the point ` +
  `of the picture.\n` +
  `minor_sexualized — a person who is, or reads as, under 18 is the SUBJECT of a sexual ` +
  `reading. A child present in an ordinary scene is NEGLIGIBLE. This scores only when the ` +
  `sexual reading is about the minor, and then it scores HIGH.\n\n` +
  `depicted_subject — where any nudity or suggestiveness actually sits: "person" if it is on ` +
  `a photographic person in the scene; "artwork" if it is a statue, painting, sculpture, ` +
  `figure study or other depicted object; "none" if there is none.\n\n` +
  `Judge the picture, not a caption. Reply with ONLY a JSON object:\n` +
  `{"sexual_nudity":"...","sexual_act":"...","suggestive_framing":"...","minor_sexualized":"...",` +
  `"depicted_subject":"person"|"artwork"|"none"}`;

const isBand = (v: unknown): v is Band => typeof v === "string" && (BAND_ORDER as string[]).includes(v);

/** Exported for the test suite: every null is a fail-closed path. */
export function parseVision(raw: string): VisionReading | null {
  const matches = raw.trim().match(/\{[^{}]*\}/g);
  if (!matches?.length) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(matches[matches.length - 1]);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  for (const k of ["sexual_nudity", "sexual_act", "suggestive_framing", "minor_sexualized"]) {
    if (!isBand(o[k])) return null;
  }
  const subj = o.depicted_subject;
  if (subj !== "person" && subj !== "artwork" && subj !== "none") return null;
  return {
    sexual_nudity: o.sexual_nudity as Band,
    sexual_act: o.sexual_act as Band,
    suggestive_framing: o.suggestive_framing as Band,
    minor_sexualized: o.minor_sexualized as Band,
    depicted_subject: subj,
  };
}

async function readVision(image: string): Promise<VisionReading | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const { fetchWithTimeout } = await import("@/lib/generations/providers/fetch-with-timeout");
    const res = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
          messages: [
            { role: "system", content: VISION_INSTRUCTIONS },
            {
              role: "user",
              content: [
                { type: "text", text: "Score this picture." },
                { type: "image_url", image_url: { url: image, detail: "low" } },
              ],
            },
          ],
          max_completion_tokens: 2000,
          temperature: 0,
        }),
      },
      25_000,
    );
    if (!res.ok) {
      console.warn(`[output-policy] vision model ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    return parseVision(String(data?.choices?.[0]?.message?.content ?? ""));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The decision — pure, and where every rule above lives
// ---------------------------------------------------------------------------

export type OutputContext = {
  /** The prompt gate's bands for this request, if it ran. */
  promptScores?: Scores | null;
  /** Refusals this account has drawn recently — raises every threshold. */
  sessionPriorHits?: number;
  /**
   * A real person's photograph was edited — the prompt gate's strict lane,
   * carried through to the picture. Nudity and framing are read one band
   * higher, so the unflagged line of HIGH becomes MEDIUM: the same line the
   * prompt gate draws, for the same reason. Operator's call (2026-09-10,
   * after reading Play's policy and its enforcement record): every case
   * Google has acted on publicly is a real photo made less clothed.
   */
  strictLane?: boolean;
};

/**
 * Decide from the two readings. Exported so the eval harness and the tests
 * exercise every branch without a network call.
 *
 * Returns the reason to refuse, or null to allow. Returns "unavailable" when
 * neither reader answered — the caller refuses on that too.
 */
export function decideOutput(readings: OutputReadings, ctx: OutputContext = {}): OutputReason | null {
  const { moderation: mod, vision: vis } = readings;
  if (!mod && !vis) return "unavailable";

  // A recent refusal on this account raises every non-NEGLIGIBLE reading by
  // ONE band — the same bounded prior the prompt gate applies, and for the
  // same reason: a count must not turn into a verdict on its own.
  const bump = (ctx.sessionPriorHits ?? 0) > 0 ? (b: Band) => (b === "NEGLIGIBLE" ? b : raise(b, 1)) : (b: Band) => b;

  // THE PROMPT INFORMS THE PICTURE. A category the prompt gate scored MEDIUM
  // was allowed as borderline; its image is judged one band harder. The
  // threshold LOWERS, which is the same as the reading being raised.
  const ps = ctx.promptScores;
  const harder = (cat: keyof Scores) => (ps && ps[cat] === "MEDIUM" ? 1 : 0);

  // THE LANE (see OutputContext.strictLane): nudity and framing one band
  // higher when a real person's photo was edited. Not the act axis, which
  // already refuses at its lowest useful band, and not minors, which is
  // zero tolerance in every lane.
  const lane = (cat: keyof Scores) =>
    ctx.strictLane === true && (cat === "sexual_nudity" || cat === "suggestive_framing") ? 1 : 0;

  // The reading the rules below see: the model's band, raised by the
  // bounded priors. The session prior and the lane do NOT stack: one band
  // between them, or a strict-lane render by an account with one refusal in
  // the last hour would be judged at LOW — the rule that was measured on
  // 2026-09-10 and rejected (it refused a woman in a hijab at the gym).
  // NEGLIGIBLE is immune to the session prior only — a count must not
  // manufacture a reading — but not to the lane or the prompt, which are
  // facts about THIS request.
  const sessionShift = (band: Band) => (bv(bump(band)) - bv(band));
  const eff = (cat: keyof Scores, band: Band, extra = 0) =>
    raise(band, Math.max(sessionShift(band), lane(cat), extra) + harder(cat));

  // Minors: the vision model is the only reader that can see it, and it is
  // zero tolerance. The moderation endpoint's image reading for this
  // category is always 0 by design, so it is never consulted here.
  if (vis && bv(bump(vis.minor_sexualized)) >= bv("LOW")) return "minors";

  if (mod && vis) {
    const nudity = eff("sexual_nudity", vis.sexual_nudity);
    const act = eff("sexual_act", vis.sexual_act);
    const framing = eff("suggestive_framing", vis.suggestive_framing);

    if (mod.flagged) {
      // Both readers see it: refuse.
      if (bv(nudity) >= bv("MEDIUM") || bv(act) >= bv("LOW")) return "sexual";
      // The one disagreement the model is competent to win: the nudity the
      // endpoint saw is a depicted artwork, and the model is confident there
      // is nothing on a person. In the strict lane the raised readings mean
      // this survives only when the model sees nothing at all — a real
      // person rendered as a nude statue is still that person undressed.
      if (vis.depicted_subject === "artwork" && bv(nudity) <= bv("LOW") && bv(framing) <= bv("LOW")) return null;
      // The endpoint flagged and the model merely hedged. On the output side
      // the picture exists; a wrong allow ships it. Refuse, refund.
      return "sexual";
    }
    // The endpoint did not flag. The model can still catch what a
    // calibrated nudity score misses — an act, or framing — but only when it
    // is sure.
    if (bv(act) >= bv("MEDIUM") || bv(nudity) >= bv("HIGH") || bv(framing) >= bv("HIGH")) return "sexual";
    return null;
  }

  if (mod) {
    // Vision unreachable: the endpoint's own verdict stands.
    return mod.flagged ? "sexual" : null;
  }

  // Moderation unreachable: the model alone, one band stricter on nudity
  // and the act than when it has a second opinion to lean on. That extra
  // band and the lane's are the SAME band, not two: an outage must not turn
  // the strict lane into strict-at-LOW (Math.max inside eff).
  const nudity = eff("sexual_nudity", vis!.sexual_nudity, 1);
  const act = eff("sexual_act", vis!.sexual_act, 1);
  const framing = eff("suggestive_framing", vis!.suggestive_framing);
  if (bv(nudity) >= bv("HIGH") || bv(act) >= bv("MEDIUM") || bv(framing) >= bv("HIGH")) return "sexual";
  return null;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export type OutputVerdict = {
  allowed: true;
  readings: OutputReadings;
};

/**
 * Judge a rendered image (or a video's extracted frame) before it is shown.
 *
 * `imageUrl` may be a stored relative /api/media path or an absolute
 * provider URL; it is absolutised for the readers. Throws
 * {@link OutputPolicyRefusal}; the caller must fail the attempt TERMINALLY —
 * never re-render — and refund. Returns the readings on allow so the caller
 * can log them beside the result.
 */
export async function assertOutputAllowed(input: {
  imageUrl: string;
  promptScores?: Scores | null;
  sessionPriorHits?: number;
  strictLane?: boolean;
}): Promise<OutputVerdict> {
  const { providerDownloadUrl } = await import("@/lib/generations/providers/provider-url");
  const url = providerDownloadUrl(input.imageUrl);
  const ctx: OutputContext = {
    promptScores: input.promptScores ?? null,
    sessionPriorHits: input.sessionPriorHits ?? 0,
    strictLane: input.strictLane === true,
  };

  let readings: OutputReadings = { moderation: null, vision: null };
  for (let attempt = 0; attempt < 2; attempt++) {
    const image = await loadImage(url);
    if (image) {
      const [moderation, vision] = await Promise.all([readModeration(image), readVision(image)]);
      readings = { moderation, vision };
      if (moderation || vision) break;
    }
    // Nothing read: one retry, then fail closed below.
    await new Promise((r) => setTimeout(r, 1500));
  }

  const reason = decideOutput(readings, ctx);
  if (reason === null) return { allowed: true, readings };
  if (reason === "unavailable") {
    console.warn("[output-policy] both readers unreachable; refusing closed");
    throw new OutputPolicyRefusal("unavailable", MSG_UNAVAILABLE, readings);
  }
  throw new OutputPolicyRefusal(reason, reason === "minors" ? MSG_MINORS : MSG_SEXUAL, readings);
}

export type RenderVerdict = OutputVerdict & {
  /**
   * For a video: the frame that was judged (an absolute provider URL), so
   * the caller can reuse it for the poster and the identity score instead
   * of extracting twice. Null for an image.
   */
  frameUrl: string | null;
};

/**
 * Judge a finished render of either kind before it is shown. For a video
 * the judged picture is its extracted middle frame — the same one the
 * poster and the identity score use — and a frame that cannot be extracted
 * is a refusal ("unavailable"): nothing unvetted ships.
 *
 * KNOWN LIMIT: one frame stands for the clip. A 5–10s render from one
 * prompt does not change what its subject is wearing halfway through, so
 * the middle frame is representative; sampling more frames is the obvious
 * tightening if a measurement ever shows otherwise.
 */
export async function judgeRender(input: {
  url: string;
  kind: "image" | "video";
  promptScores?: Scores | null;
  sessionPriorHits?: number;
  strictLane?: boolean;
}): Promise<RenderVerdict> {
  let judged = input.url;
  let frameUrl: string | null = null;
  if (input.kind === "video") {
    const { extractVideoFrame } = await import("@/lib/generations/providers/fal");
    const { providerDownloadUrl } = await import("@/lib/generations/providers/provider-url");
    frameUrl = await extractVideoFrame(providerDownloadUrl(input.url));
    if (!frameUrl) {
      console.warn("[output-policy] no frame could be extracted from the video; refusing closed");
      throw new OutputPolicyRefusal("unavailable", MSG_UNAVAILABLE, { moderation: null, vision: null });
    }
    judged = frameUrl;
  }
  const verdict = await assertOutputAllowed({
    imageUrl: judged,
    promptScores: input.promptScores,
    sessionPriorHits: input.sessionPriorHits,
    strictLane: input.strictLane,
  });
  return { ...verdict, frameUrl };
}
