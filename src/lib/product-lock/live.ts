// The product checker's real providers, wired (server-only). check.ts takes
// every provider as a dependency so it can be tested alias-free; this file
// is where they are the real ones:
//
//   locate / judge   judge.ts, Gemini 3.1 Flash-Lite, GEMINI_API_KEY
//   escalate         escalate.ts, claude-sonnet-5 through the Anthropic SDK
//                    (ANTHROPIC_API_KEY), at most 2 an ad
//   readWords        press-tour/ocr.ts (the label reader the card uses),
//                    GOOGLE_VISION_API_KEY
//   segment          providers/fal-segment.ts segmentObject (SAM 2, FAL_KEY),
//                    only for a low-confidence box; a failed cut keeps the
//                    reader's box
//   scoreFace        providers/openai.ts scoreIdentityMatch, the existing
//                    identity scorer
//   sampleMoments    frames.ts (ffmpeg-static)
//   record           records.ts → product_frame_checks, service role
//
// A missing key is never an error here: that reader answers
// "not_configured" and the frame reads "Not checked". Press Tour cannot be
// switched on without every one of these keys anyway
// (press-tour/enabled.ts PRESS_TOUR_REQUIRED_KEYS).

import Anthropic from "@anthropic-ai/sdk";
import { scoreIdentityMatch } from "@/lib/generations/providers/openai";
import { segmentObject } from "@/lib/generations/providers/fal-segment";
import { productScorerVersion } from "@/lib/generations/scorer-version";
import { readLabelText } from "@/lib/press-tour/ocr";
import type { CardSelfTest } from "@/lib/press-tour/card-service";
import { createAdminClient } from "@/lib/supabase/server";
import { selfTestCard, type CheckDeps } from "./check";
import { boxFromMask, boxToPixels, jpegDataUrl } from "./crop";
import { ESCALATION_MODEL, escalateFrame, type MessagesClient } from "./escalate";
import { sampleMoments } from "./frames";
import { judgeModel, judgeProduct, locateProduct } from "./judge";
import { writeFrameChecks } from "./records";

/** SAM 2 waits at most this long for a fallback cut (its own ceiling is 30 s). */
const SEGMENT_TIMEOUT_MS = 15_000;

let anthropic: MessagesClient | null | undefined;
function escalationClient(): MessagesClient | null {
  if (anthropic !== undefined) return anthropic;
  anthropic = process.env.ANTHROPIC_API_KEY ? (new Anthropic() as unknown as MessagesClient) : null;
  return anthropic;
}

/** Whether every reader the checker needs has its key (the checker still runs without them: it reads "Not checked"). */
export function productCheckerConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GEMINI_API_KEY && env.GOOGLE_VISION_API_KEY && env.ANTHROPIC_API_KEY);
}

/** The real providers. */
export function productCheckDeps(): CheckDeps {
  return {
    locate: (input) => locateProduct(input),
    judge: (input) => judgeProduct(input),
    escalate: (input) => escalateFrame(input, { client: escalationClient() }),
    readWords: async (image) => {
      const read = await readLabelText([image]);
      if (!read.configured || !read.ok) return null;
      return { lines: read.lines[0] ?? [] };
    },
    segment: async (frame, box) => {
      const px = boxToPixels(box, frame.width, frame.height);
      const cut = await segmentObject(
        frame.bytes,
        { x_min: px.left, y_min: px.top, x_max: px.left + px.width, y_max: px.top + px.height },
        { x: px.left + Math.floor(px.width / 2), y: px.top + Math.floor(px.height / 2) },
        { timeoutMs: SEGMENT_TIMEOUT_MS },
      );
      return cut ? boxFromMask(cut) : null;
    },
    scoreFace: async (frame, identity, traitSummary) => {
      const verdict = await scoreIdentityMatch(jpegDataUrl(frame), jpegDataUrl(identity), traitSummary);
      return verdict ? { score: verdict.score, unusable: verdict.unusable, faceVisible: verdict.faceVisible } : null;
    },
    sampleMoments: (video, times) => sampleMoments(video, times),
    record: (ctx, drafts) => writeFrameChecks(createAdminClient(), ctx, drafts),
    scorerVersion: productScorerVersion(judgeModel(), ESCALATION_MODEL),
  };
}

/**
 * The card self-test for card-service.ts confirmProductCard (the seam):
 * every chosen photo through the checker. An admin's own photos keep their
 * pictures for labelling (records.ts); anyone else's keep their numbers only.
 */
export const cardSelfTest: CardSelfTest = async ({ caller, card, photos }) => {
  const result = await selfTestCard(
    {
      card: {
        productId: card.id,
        name: card.name,
        labelStrings: card.labelStrings,
        noReadableText: card.noReadableText,
        dna: card.dna,
        palette: card.palette,
      },
      photos: photos.map((p) => ({ path: p.path, view: p.view, image: p.bytes })),
      record: { userId: caller.userId, productId: card.id, source: "self_test", keepFrames: caller.via === "admin" },
    },
    productCheckDeps(),
  );
  if (!result.ok) return { status: "unavailable" };
  if (result.passed) return { status: "passed" };
  return { status: "failed", photos: result.photos.filter((p) => !p.passed).map((p) => p.path) };
};
