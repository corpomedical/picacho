import { describe, expect, it } from "vitest";
import { quoteSend, type SendQuoteInput } from "./quote";
import {
  getVideoModel,
  getDefaultDurationSeconds,
  getDurationCreditWeight,
  getDialogueCreditWeight,
  storyboardCreditCost,
  storyboardFrameExtraCredits,
  continuationExtraCredits,
  FREE_TIER_GENERATION_CREDITS,
  VIDEO_MODELS,
} from "./providers/video-models";
import { videoResolutionOffers } from "./providers/video-resolution";
import { FREE_TIER_VIDEO_MODEL_ID } from "../plans";

// The incident matrix. Every case here is a misquote that actually shipped
// while the quote and the charge were two hand-synced blocks of arithmetic
// (see quote.ts) — these tests pin the one shared function against each,
// with expected values DERIVED from the catalog helpers so a deliberate
// price change doesn't break them, only a drift in the conditions does.

const seedance = getVideoModel("seedance");
const seedanceSecs = getDefaultDurationSeconds(seedance);
const seedanceWeight = getDurationCreditWeight(seedance, seedanceSecs);

const base = (over: Partial<SendQuoteInput> = {}): SendQuoteInput => ({
  contentType: "video",
  videoModelId: "seedance",
  videoDurationSeconds: seedanceSecs,
  videoResolution: null,
  storyboardTotalSeconds: null,
  referencePhotoCount: 0,
  framePicked: false,
  continuationSourceSeconds: null,
  dialoguePresent: false,
  renderCount: 1,
  ...over,
});

describe("quoteSend: plain sends", () => {
  it("prices a plain video send at the model's duration weight", () => {
    const q = quoteSend(base());
    expect(q.perRenderCredits).toBe(seedanceWeight);
    expect(q.totalCredits).toBe(seedanceWeight);
    expect(q.renderCount).toBe(1);
  });

  it("prices an image send at 1 credit, always one render", () => {
    // renderCount is a video concept — an image send fanning out would be a
    // client bug, and must not multiply the price.
    const q = quoteSend(base({ contentType: "image", renderCount: 5, dialoguePresent: true }));
    expect(q).toMatchObject({ perRenderCredits: 1, renderCount: 1, totalCredits: 1 });
  });

  it("normalizes a degenerate render count to 1", () => {
    expect(quoteSend(base({ renderCount: 0 })).totalCredits).toBe(seedanceWeight);
    expect(quoteSend(base({ renderCount: 2.9 })).renderCount).toBe(2);
  });
});

describe("quoteSend: the 9-quoted-45-charged fan-out (2026-08-31)", () => {
  it("a five-angle batch costs five renders, not one", () => {
    const q = quoteSend(base({ renderCount: 5 }));
    expect(q.perRenderCredits).toBe(seedanceWeight);
    expect(q.totalCredits).toBe(5 * seedanceWeight);
  });

  it("a six-shot scene is the larger fan-out, priced in full", () => {
    expect(quoteSend(base({ renderCount: 6 })).totalCredits).toBe(6 * seedanceWeight);
  });
});

describe("quoteSend: the dialogue surcharge the TOTAL omitted (2026-09-05)", () => {
  const surcharge = getDialogueCreditWeight(seedanceSecs);

  it("a dialogue line adds the lipsync surcharge to the total", () => {
    expect(surcharge).toBeGreaterThan(0);
    expect(quoteSend(base({ dialoguePresent: true })).totalCredits).toBe(
      seedanceWeight + surcharge,
    );
  });

  it("fan-outs carry no dialogue — the surcharge never multiplies", () => {
    expect(quoteSend(base({ dialoguePresent: true, renderCount: 5 })).totalCredits).toBe(
      5 * seedanceWeight,
    );
  });

  it("storyboards reject dialogue — no surcharge on the storyboard price", () => {
    const q = quoteSend(
      base({
        videoModelId: "kling-o3-pro",
        videoDurationSeconds: 10,
        storyboardTotalSeconds: 10,
        dialoguePresent: true,
      }),
    );
    expect(q.totalCredits).toBe(storyboardCreditCost("kling-o3-pro", 10));
  });
});

describe("quoteSend: the frame surcharge and the lingering multiref picks (2026-08-31)", () => {
  const kling = getVideoModel("kling");
  const klingSecs = getDefaultDurationSeconds(kling);
  const klingWeight = getDurationCreditWeight(kling, klingSecs);
  const frameExtra = storyboardFrameExtraCredits("kling", klingSecs);
  const klingBase = (over: Partial<SendQuoteInput> = {}) =>
    base({ videoModelId: "kling", videoDurationSeconds: klingSecs, ...over });

  it("a start/end frame that rides moves Kling to the pricier endpoint's weight", () => {
    expect(frameExtra).toBeGreaterThan(0);
    expect(quoteSend(klingBase({ framePicked: true })).totalCredits).toBe(
      klingWeight + frameExtra,
    );
  });

  it("2+ reference photos riding means the frame endpoint is not used — no surcharge", () => {
    expect(
      quoteSend(klingBase({ framePicked: true, referencePhotoCount: 2 })).totalCredits,
    ).toBe(klingWeight);
  });

  it("a frame that will NOT be sent (framePicked false) never surcharges — whatever lingers in state", () => {
    expect(quoteSend(klingBase({ framePicked: false })).totalCredits).toBe(klingWeight);
  });
});

describe("quoteSend: continuation re-prices over both clips (2026-08-31)", () => {
  const s2 = getVideoModel("seedance-2");
  const s2Secs = getDefaultDurationSeconds(s2);
  const s2Weight = getDurationCreditWeight(s2, s2Secs);
  const extra = continuationExtraCredits("seedance-2", s2Secs, 15);

  it("continuing from a 15s source adds the with-video-input reprice", () => {
    expect(extra).toBeGreaterThan(0);
    expect(
      quoteSend(
        base({
          videoModelId: "seedance-2",
          videoDurationSeconds: s2Secs,
          continuationSourceSeconds: 15,
        }),
      ).totalCredits,
    ).toBe(s2Weight + extra);
  });

  it("a fan-out never carries the continuation surcharge — no path sends continueFromId", () => {
    expect(
      quoteSend(
        base({
          videoModelId: "seedance-2",
          videoDurationSeconds: s2Secs,
          continuationSourceSeconds: 15,
          renderCount: 2,
        }),
      ).totalCredits,
    ).toBe(2 * s2Weight);
  });
});

describe("quoteSend: resolution and storyboard weights", () => {
  it("a paid resolution's real weight replaces the duration weight", () => {
    // Found from the catalog rather than hardcoded: the first offer that
    // actually carries per-duration weights.
    const offered = VIDEO_MODELS.flatMap((m) =>
      videoResolutionOffers(m.id).flatMap((o) =>
        Object.entries(o.weights ?? {}).map(([s, w]) => ({
          id: m.id,
          res: o.value,
          secs: Number(s),
          weight: w as number,
        })),
      ),
    )[0];
    expect(offered, "no resolution in the catalog carries weights any more — update this test").toBeDefined();
    expect(
      quoteSend(
        base({
          videoModelId: offered!.id,
          videoDurationSeconds: offered!.secs,
          videoResolution: offered!.res,
        }),
      ).totalCredits,
    ).toBe(offered!.weight);
  });

  it("a storyboard is priced from its shot total at the model's real rate", () => {
    const q = quoteSend(
      base({
        videoModelId: "kling-o3-pro",
        videoDurationSeconds: 24,
        storyboardTotalSeconds: 24,
        // A storyboard send ignores resolution picks and lingering frames —
        // the endpoint takes neither.
        framePicked: true,
      }),
    );
    expect(q.totalCredits).toBe(storyboardCreditCost("kling-o3-pro", 24));
  });
});

describe("quoteSend: the daily free slot promise", () => {
  const freeModel = getVideoModel(FREE_TIER_VIDEO_MODEL_ID);
  const freeSecs = getDefaultDurationSeconds(freeModel);

  it("the trial's own pinned shape is eligible", () => {
    const q = quoteSend(
      base({ videoModelId: FREE_TIER_VIDEO_MODEL_ID, videoDurationSeconds: freeSecs }),
    );
    expect(q.totalCredits).toBe(FREE_TIER_GENERATION_CREDITS);
    expect(q.freeSlotEligible).toBe(true);
  });

  it("anything above the pinned cost is not — the pill must not promise free", () => {
    const q = quoteSend(
      base({
        videoModelId: FREE_TIER_VIDEO_MODEL_ID,
        videoDurationSeconds: freeSecs,
        dialoguePresent: true,
      }),
    );
    expect(q.freeSlotEligible).toBe(false);
  });
});
