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

export type OutputReason = "sexual" | "minors" | "self_harm" | "unavailable";

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
  /** Self-harm or suicide shown approvingly, or as the subject (2026-09-11). */
  self_harm: Band;
  /** Where any nudity or suggestiveness actually sits in the frame. */
  depicted_subject: "person" | "artwork" | "none";
};

export type OutputReadings = {
  moderation: ModerationReading | null;
  vision: VisionReading | null;
  /**
   * Present when the verdict went to a vote: every reading that took part,
   * in order — primary, the other family, then the larger model — for the
   * log. Two entries means the two disagreed and the third was unreachable
   * (the verdict is then "unavailable").
   */
  votes?: VisionReading[];
};

const MSG_SEXUAL =
  "The picture that came back didn't pass our check, so it wasn't shown. Your request was " +
  "fine — the credit is back.";
const MSG_MINORS =
  "The picture that came back didn't pass our check and wasn't shown. The credit is back.";
const MSG_UNAVAILABLE =
  "We couldn't check the picture that came back, so it wasn't shown. The credit is back — " +
  "please try again in a moment.";

/**
 * Exported for the test suite, which holds every language to them. Read in
 * four languages: the server only ever says the English above, and
 * lib/i18n/server-text.ts swaps in the catalog's sentence where a person
 * reads it. Rewording one here fails truth-contracts.test.ts until that map
 * and the four catalogs follow. `minors` is the self-harm refusal's sentence
 * too: a picture refusal names no category.
 */
export const outputRefusalMessages = {
  sexual: MSG_SEXUAL,
  minors: MSG_MINORS,
  unavailable: MSG_UNAVAILABLE,
} as const;

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

const INLINE_IMAGE = /^data:(image\/(?:jpeg|png|webp));base64,/;

/**
 * A picture judged before it is stored (a Set's photo, 2026-09-11): its
 * bytes are already here, so they are read from the data URL rather than
 * fetched. Null for anything else — an http(s) or /api/media URL takes the
 * fetch below exactly as before. Pure; exported for the tests.
 */
export function inlineImageBytes(url: string): { bytes: Buffer; type: string } | null {
  const m = INLINE_IMAGE.exec(url);
  if (!m) return null;
  return { bytes: Buffer.from(url.slice(m[0].length), "base64"), type: m[1] };
}

async function loadImage(url: string): Promise<string | null> {
  try {
    // Bytes already in hand are never sent through fetch: Next's patched
    // fetch copies the whole URL into its tracing span.
    const inline = inlineImageBytes(url);
    let raw: Buffer;
    let fetchedType: string | null = null;
    if (inline) {
      raw = inline.bytes;
      fetchedType = inline.type;
    } else {
      const { fetchWithTimeout } = await import("@/lib/generations/providers/fetch-with-timeout");
      const res = await fetchWithTimeout(url, { method: "GET" }, 20_000);
      if (!res.ok) {
        console.warn(`[output-policy] image fetch ${res.status} for ${url.slice(0, 120)}`);
        return null;
      }
      raw = Buffer.from(await res.arrayBuffer());
      fetchedType = res.headers.get("content-type")?.split(";")[0] || null;
    }
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
      const type = fetchedType || "image/png";
      return `data:${type};base64,${raw.toString("base64")}`;
    }
  } catch (err) {
    console.warn("[output-policy] image fetch threw:", err instanceof Error ? err.message : err);
    return null;
  }
}

// A 429 is a queue, not an answer: every reader here fails closed on an
// unreadable reply, so a rate-limit blip under a burst of renders would turn
// into "unavailable" refusals. Wait what the server asks (capped) and ask
// once more.
async function sendWithOneRetry(send: () => Promise<Response>): Promise<Response> {
  let res = await send();
  if (res.status === 429) {
    const ms = Number(res.headers.get("retry-after-ms"));
    const sec = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(ms) && ms > 0 ? Math.min(ms, 5000) : Number.isFinite(sec) && sec > 0 ? Math.min(sec * 1000, 5000) : 1500;
    await new Promise((r) => setTimeout(r, wait));
    res = await send();
  }
  return res;
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
    const res = await sendWithOneRetry(() =>
      fetchWithTimeout(
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
      ),
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
  `of the picture. A pose or crop whose POINT is a body part — cleavage, a low neckline or a ` +
  `bare midriff presented as the subject — is MEDIUM; the same garment in an ordinary pose ` +
  `with the face as the subject is LOW. An activity is not an emphasis: exercise, sport, ` +
  `dance or work seen from any angle, in fitness wear or swimwear in its setting, is ` +
  `NEGLIGIBLE to LOW however much of the body it shows.\n` +
  `minor_sexualized — a person who is, or reads as, under 18 is the SUBJECT of a sexual ` +
  `reading. A child present in an ordinary scene is NEGLIGIBLE. This scores only when the ` +
  `sexual reading is about the minor, and then it scores HIGH.\n` +
  `self_harm — self-harm, suicide or an eating disorder shown approvingly, romanticised, or ` +
  `as the subject of the picture: fresh self-inflicted wounds presented as beautiful, the act ` +
  `itself, a method. Healed scars, a memorial, a clinical or recovery setting are NEGLIGIBLE ` +
  `to LOW.\n\n` +
  `depicted_subject — where any nudity or suggestiveness actually sits: "person" if it is on ` +
  `a photographic person in the scene; "artwork" if it is a statue, painting, sculpture, ` +
  `figure study or other depicted object; "none" if there is none.\n\n` +
  `Judge the picture, not a caption. First, in two or three plain sentences, say what is ` +
  `actually in the frame: who is there, what they wear, how they are posed, and what the ` +
  `picture is evidently for. Then, on the last line, give ONLY the JSON object:\n` +
  `{"sexual_nudity":"...","sexual_act":"...","suggestive_framing":"...","minor_sexualized":"...",` +
  `"self_harm":"...","depicted_subject":"person"|"artwork"|"none"}`;

// A band is read case-insensitively: claude-sonnet-5 answers "negligible"
// where the instructions say NEGLIGIBLE (measured 2026-09-11: twenty valid
// readings thrown away over three runs), and a reader lost to letter case
// is a reader lost for nothing.
const asBand = (v: unknown): Band | null => {
  if (typeof v !== "string") return null;
  const u = v.trim().toUpperCase();
  // "NONE" is NEGLIGIBLE said another way (gpt-5.4-mini wrote it twice in a
  // measured run); anything else outside the four bands is not a reading.
  if (u === "NONE") return "NEGLIGIBLE";
  return (BAND_ORDER as string[]).includes(u) ? (u as Band) : null;
};

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
  const bands: Partial<Record<"sexual_nudity" | "sexual_act" | "suggestive_framing" | "minor_sexualized" | "self_harm", Band>> = {};
  for (const k of ["sexual_nudity", "sexual_act", "suggestive_framing", "minor_sexualized", "self_harm"] as const) {
    const b = asBand(o[k]);
    if (!b) return null;
    bands[k] = b;
  }
  const subj = typeof o.depicted_subject === "string" ? o.depicted_subject.trim().toLowerCase() : "";
  if (subj !== "person" && subj !== "artwork" && subj !== "none") return null;
  return {
    sexual_nudity: bands.sexual_nudity as Band,
    sexual_act: bands.sexual_act as Band,
    suggestive_framing: bands.suggestive_framing as Band,
    minor_sexualized: bands.minor_sexualized as Band,
    self_harm: bands.self_harm as Band,
    depicted_subject: subj,
  };
}

const VISION_SEED = 7;

async function readVision(image: string, model?: string): Promise<VisionReading | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const which = model || (await import("@/lib/generations/providers/openai-model")).utilityModel();
  try {
    const { fetchWithTimeout } = await import("@/lib/generations/providers/fetch-with-timeout");
    const res = await sendWithOneRetry(() => fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: which,
          messages: [
            { role: "system", content: VISION_INSTRUCTIONS },
            {
              role: "user",
              content: [
                { type: "text", text: "Score this picture." },
                // Full detail: the 1024px copy is read as it is, not as a
                // 512px thumbnail. The difference is a few hundred tokens
                // and it is what "look at the picture" means.
                { type: "image_url", image_url: { url: image, detail: "high" } },
              ],
            },
          ],
          max_completion_tokens: 2000,
          temperature: 0,
          seed: VISION_SEED,
        }),
      },
      25_000,
    ));
    if (!res.ok) {
      console.warn(`[output-policy] vision model ${which} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "");
    const parsed = parseVision(text);
    if (!parsed) console.warn(`[output-policy] vision model ${which} reply unreadable: ${text.replace(/\s+/g, " ").slice(-160)}`);
    return parsed;
  } catch (err) {
    console.warn(`[output-policy] vision model ${which} threw:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// The arbiter from the other model family: claude-sonnet-5 reads the same
// picture with the same instructions. Only ever asked as part of a vote.
async function readVisionClaude(image: string): Promise<VisionReading | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(image);
  if (!m) return null;
  try {
    const { fetchWithTimeout } = await import("@/lib/generations/providers/fetch-with-timeout");
    const call = (withThinkingParam: boolean) =>
      fetchWithTimeout(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-sonnet-5",
            max_tokens: 1500,
            // No `temperature`: this model rejects it as deprecated (400,
            // measured 2026-09-11).
            ...(withThinkingParam ? { thinking: { type: "disabled" } } : {}),
            system: VISION_INSTRUCTIONS,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
                  { type: "text", text: "Score this picture." },
                ],
              },
            ],
          }),
        },
        25_000,
      );
    let res = await sendWithOneRetry(() => call(true));
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400 && text.includes("thinking")) res = await sendWithOneRetry(() => call(false));
      else {
        console.warn(`[output-policy] arbiter ${res.status}: ${text.slice(0, 200)}`);
        return null;
      }
      if (!res.ok) {
        console.warn(`[output-policy] arbiter ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };
    const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    const parsed = parseVision(text);
    if (!parsed) console.warn(`[output-policy] arbiter reply unreadable (stop ${data.stop_reason ?? "?"}): ${text.replace(/\s+/g, " ").slice(-160)}`);
    return parsed;
  } catch (err) {
    console.warn("[output-policy] arbiter threw:", err instanceof Error ? err.message : err);
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
  // Self-harm shown approvingly: the vision model's call, at MEDIUM, in
  // every lane — the moderation endpoint's self-harm categories are text
  // signals and are not consulted for a picture. Not raised by the session
  // prior, which is about sexual escalation.
  if (vis && bv(vis.self_harm) >= bv("MEDIUM")) return "self_harm";

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
    // No vision reading: the picture has NOT been judged. The endpoint's
    // score is calibrated for nudity and says nothing about a minor, a
    // self-harm depiction, or an act it does not flag — and the gate asked
    // two vision readers before arriving here. Closed, and said so.
    return "unavailable";
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
// The edge, and the vote
// ---------------------------------------------------------------------------

const VISION_BANDS: (keyof Omit<VisionReading, "depicted_subject">)[] = [
  "sexual_nudity",
  "sexual_act",
  "suggestive_framing",
  "minor_sexualized",
  "self_harm",
];

/**
 * True when moving any ONE vision category by ONE band — or reading the
 * subject as the other kind of thing — would flip the verdict.
 *
 * Temperature 0 is not determinism: measured 2026-09-10, the same picture
 * read framing LOW in three runs and MEDIUM in the fourth, and the verdict
 * flipped with it. Readings on the line are the only ones that can flip, so
 * those — and only those — are decided by a majority of three independent
 * readers (assertOutputAllowed). Pure; exported for the tests.
 */
export function isVisionEdge(readings: OutputReadings, ctx: OutputContext = {}): boolean {
  const vis = readings.vision;
  if (!vis) return false;
  const verdict = (v: VisionReading) => Boolean(decideOutput({ ...readings, vision: v }, ctx));
  const base = verdict(vis);
  for (const cat of VISION_BANDS) {
    // A NEGLIGIBLE reading is the model saying there is nothing there; the
    // vote is for a model hedging between two bands of something it DID
    // see (the same rule as the prompt gate's isEdge, for the same reason:
    // minors refuses at LOW, so every all-clear picture would otherwise be
    // an edge).
    if (vis[cat] === "NEGLIGIBLE") continue;
    for (const step of [-1, 1]) {
      const shifted = BAND_ORDER[bv(vis[cat]) + step];
      if (!shifted) continue;
      if (verdict({ ...vis, [cat]: shifted }) !== base) return true;
    }
  }
  for (const subject of ["person", "artwork", "none"] as const) {
    if (subject !== vis.depicted_subject && verdict({ ...vis, depicted_subject: subject }) !== base) return true;
  }
  return false;
}

/**
 * The majority. Per category the median band of the readings; with three
 * readers a single outlier, up or down, cannot decide. With only two (an
 * arbiter down) the STRICTER band is taken — this is the output side, and a
 * wrong allow ships the picture. The subject is the majority kind; a
 * three-way split reads as "person", the kind the rules are strictest on.
 * Pure; exported for the tests.
 */
/**
 * A MINORS FINDING NEEDS TWO READERS — the same rule as the prompt gate,
 * for the same reason: it is the gravest accusation the gate can make and
 * it refuses at LOW, so one reader's hedge is never the whole of it. Pure.
 */
export function withMinorsMajorityVision(reading: VisionReading, panel: VisionReading[]): VisionReading {
  if (bv(reading.minor_sexualized) < bv("LOW")) return reading;
  const seen = panel.filter((r) => bv(r.minor_sexualized) >= bv("LOW")).length;
  return seen >= 2 ? reading : { ...reading, minor_sexualized: "NEGLIGIBLE" };
}

export function voteVision(readings: VisionReading[], base?: OutputReadings, ctx: OutputContext = {}): VisionReading {
  const pick = (cat: (typeof VISION_BANDS)[number]): Band => {
    const sorted = readings.map((r) => bv(r[cat])).sort((a, b) => a - b);
    return BAND_ORDER[sorted[Math.floor(sorted.length / 2)]];
  };
  // The subject: the majority kind; a tie goes to the kind the rules are
  // strictest on — a person, then "none" (a flagged picture with nothing
  // on a person is refused), then an artwork (the one kind with an override).
  const strictness: VisionReading["depicted_subject"][] = ["person", "none", "artwork"];
  const counts = new Map<VisionReading["depicted_subject"], number>();
  for (const r of readings) counts.set(r.depicted_subject, (counts.get(r.depicted_subject) ?? 0) + 1);
  const best = Math.max(...counts.values());
  const subject = strictness.find((k) => counts.get(k) === best) ?? "person";
  const median: VisionReading = {
    sexual_nudity: pick("sexual_nudity"),
    sexual_act: pick("sexual_act"),
    suggestive_framing: pick("suggestive_framing"),
    minor_sexualized: pick("minor_sexualized"),
    self_harm: pick("self_harm"),
    depicted_subject: subject,
  };
  if (!base) return median;

  // A vote on VERDICTS. Each reading is decided on its own beside the same
  // moderation reading; more refusals than allows refuses, and with two
  // readings one refusal is enough (the output side: a wrong allow ships
  // the picture). When the median's own verdict disagrees with that side,
  // the winning-side reading nearest the median stands in — two readers
  // refusing on two different categories is two refusals (2026-09-11
  // review).
  const verdict = (v: VisionReading) => {
    const r = decideOutput({ ...base, vision: v }, ctx);
    return r !== null && r !== "unavailable";
  };
  const verdicts = readings.map(verdict);
  const refusing = verdicts.filter(Boolean).length;
  const majorityRefuses = refusing * 2 >= readings.length && refusing > 0;
  if (verdict(median) === majorityRefuses) return median;
  const distance = (a: VisionReading) => VISION_BANDS.reduce((d, cat) => d + Math.abs(bv(a[cat]) - bv(median[cat])), 0);
  return readings
    .filter((_, i) => verdicts[i] === majorityRefuses)
    .sort((a, b) => distance(a) - distance(b))[0];
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

  // TWO VISION READERS ALWAYS, A THIRD WHEN NEEDED (2026-09-11) — the same
  // shape as the prompt gate. The moderation endpoint and both model
  // families read the picture in parallel. When the two vision verdicts
  // agree and neither reading sits on the line, the primary's reading
  // stands; no single sample can allow or refuse alone. When they
  // disagree, or either is an edge, the larger model reads too and the
  // majority of verdicts decides. Disagreement with no third reader is
  // "unavailable": not shown, credit back, nobody accused.
  let readings: OutputReadings = { moderation: null, vision: null };
  let image: string | null = null;
  let other: VisionReading | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    image = await loadImage(url);
    if (image) {
      const [moderation, vision, claude] = await Promise.all([readModeration(image), readVision(image), readVisionClaude(image)]);
      other = claude;
      readings = { moderation, vision: vision ?? claude };
      // A vision reading ends the loop; the endpoint alone does not, because
      // without a vision reading the picture is not judged (2026-09-11
      // review: a transient double failure was terminal on the first try).
      if (vision || claude) break;
    }
    // Nothing read: one retry, then fail closed below.
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (image && readings.vision) {
    const first = readings.vision;
    const verdictOf = (v: VisionReading) => {
      const r = decideOutput({ ...readings, vision: v }, ctx);
      return r !== null && r !== "unavailable";
    };
    const edgeOf = (v: VisionReading) => isVisionEdge({ ...readings, vision: v }, ctx);
    const mini = first === other ? null : first; // when the primary was down, `first` IS the other family's reading
    const twoUp = mini !== null && other !== null;
    if (!twoUp) console.warn("[output-policy] one vision reader down; the other stands");
    const agree = mini && other ? verdictOf(mini) === verdictOf(other) : true;
    const needThird = !agree || edgeOf(first) || (other ? edgeOf(other) : false);

    if (!needThird && mini && other) {
      readings = { ...readings, vision: withMinorsMajorityVision(first, [mini, other]) };
    }

    if (needThird) {
      // ON THE LINE, THE STRONG READERS DECIDE. Measured 2026-09-11 on the
      // one picture that still flipped: the small primary read the deciding
      // category LOW three runs out of five and MEDIUM the other two, under
      // a fixed seed, while claude-sonnet-5 and gpt-5.4 read it identically
      // every time. A verdict the small model casts is a coin; at an edge it
      // never casts one. The two strong readers agreeing is the verdict.
      // When they split, this side REFUSES: a wrong allow ships the picture,
      // a wrong refusal costs a refunded re-render. With only one strong
      // reader reachable, that reader and the primary decide as a pair (one
      // refusal wins, as everywhere on this side); with neither, the picture
      // is "unavailable" — not shown, credit back, nobody accused.
      // The unseeded reader is sampled three times here and its own median
      // stands for it — one reader's coin is not a strong reader.
      const primaryModel = (await import("@/lib/generations/providers/openai-model")).utilityModel();
      const [larger, more] = await Promise.all([
        readVision(image, primaryModel === "gpt-5.4" ? "gpt-5.4-mini" : "gpt-5.4"),
        other ? Promise.all([readVisionClaude(image), readVisionClaude(image)]) : Promise.resolve([null, null]),
      ]);
      const claudeSamples = [other, ...more].filter((v): v is VisionReading => v !== null);
      const claude = claudeSamples.length ? voteVision(claudeSamples) : null;
      const strong = [claude, larger].filter((v): v is VisionReading => v !== null);
      if (strong.length === 0) {
        console.warn("[output-policy] on the line with no strong reader reachable; unavailable");
        throw new OutputPolicyRefusal("unavailable", MSG_UNAVAILABLE, { ...readings, votes: [mini].filter((v): v is VisionReading => v !== null) });
      }
      // ANY REFUSING SAMPLE DECIDES. Every sample that read this picture —
      // the primary, each of the unseeded reader's three, the larger model
      // — is decided on its own; if any one of them refuses, the picture is
      // refused, and the reading kept is that refusing sample nearest the
      // panel's median. This is the side rule this gate already takes on a
      // tie, applied to the whole panel: measured 2026-09-11, a low-cut
      // sweater on a real person's photo split one strong reader's own
      // samples half and half, and a majority of a coin is a coin. A
      // picture on which any reader saw the line crossed is not shown; a
      // wrong refusal costs a refunded re-render. A minors finding still
      // needs two samples (withMinorsMajorityVision).
      const samples = [mini, ...claudeSamples, larger].filter((v): v is VisionReading => v !== null);
      const median = voteVision(samples);
      const refusing = samples.filter((v) => verdictOf(withMinorsMajorityVision(v, samples)));
      const distance = (a: VisionReading) => VISION_BANDS.reduce((d, cat) => d + Math.abs(bv(a[cat]) - bv(median[cat])), 0);
      const voted = refusing.length
        ? withMinorsMajorityVision(refusing.sort((a, b) => distance(a) - distance(b))[0], samples)
        : withMinorsMajorityVision(median, samples);
      readings = { ...readings, vision: voted, votes: [mini, claude, larger].filter((v): v is VisionReading => v !== null) };
      console.info("[output-policy] vote", { mini, claude, larger, samples: samples.length, refusing: refusing.length, voted });
    }
  }

  const reason = decideOutput(readings, ctx);
  if (reason === null) return { allowed: true, readings };
  if (reason === "unavailable") {
    console.warn("[output-policy] both readers unreachable; refusing closed");
    throw new OutputPolicyRefusal("unavailable", MSG_UNAVAILABLE, readings);
  }
  throw new OutputPolicyRefusal(reason, reason === "sexual" ? MSG_SEXUAL : MSG_MINORS, readings);
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
