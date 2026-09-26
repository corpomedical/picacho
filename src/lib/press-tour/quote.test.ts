import { describe, expect, it } from "vitest";
import { quoteSend } from "../generations/quote";
import { getDurationCreditWeight, getVideoModel } from "../generations/providers/video-models";
import { imageRenderCreditWeight } from "../generations/providers/image-resolution";
import {
  FILM_LANE,
  PRESS_POLICY,
  PRESS_QUOTE_VERSION,
  STILL_LANE,
  buildPressQuote,
  parsePressQuote,
  quotePriceChanged,
  repaintCredits,
  shotCredits,
  stillCredits,
} from "./quote";
import { beatsFor, SHOT_SECONDS } from "./planner";

// N3: one money grammar, from the weights in code. The numbers below are
// the spec's (v2 §3.3: 10 s = 6, 15 s = 9, 30 s = 18 credits) and each is
// re-derived from the catalogue rows here, so a weight edited there fails
// this file instead of silently re-pricing every ad.

const shots = (length: 10 | 15 | 30) => beatsFor(length).map(() => ({ seconds: SHOT_SECONDS }));
const base = { balanceNow: 96, paintPaid: false, animatePaid: false, trial: false, charged: true };

describe("the prices come from the catalogue", () => {
  it("a still is the picture lane's weight at `high` (1 credit)", () => {
    expect(STILL_LANE).toEqual({ modelId: "gpt-image", quality: "high" });
    expect(stillCredits()).toBe(imageRenderCreditWeight("gpt-image", null, "high"));
    expect(stillCredits()).toBe(1);
  });

  it("a 5 s shot is kling-o3's 5 s row (2 credits), silent, with no frame surcharge", () => {
    expect(FILM_LANE.modelId).toBe("kling-o3");
    expect(shotCredits(5)).toBe(getDurationCreditWeight(getVideoModel("kling-o3"), 5));
    expect(shotCredits(5)).toBe(2);
    expect(shotCredits(10)).toBe(4);
    // Dialogue would add a surcharge; the ad is silent in v1 (critique #18).
    const spoken = quoteSend({
      contentType: "video",
      videoModelId: "kling-o3",
      videoDurationSeconds: 5,
      videoResolution: null,
      storyboardTotalSeconds: null,
      referencePhotoCount: 0,
      framePicked: false,
      continuationSourceSeconds: null,
      dialoguePresent: true,
      renderCount: 1,
    }).totalCredits;
    expect(spoken).toBeGreaterThan(shotCredits(5));
  });

  it("a person's repaint is one still's price (N4: always 1 credit)", () => {
    expect(repaintCredits()).toBe(stillCredits());
  });
});

describe("the ad's quote", () => {
  it.each([
    [10, 2, 4, 6],
    [15, 3, 6, 9],
    [30, 6, 12, 18],
  ] as const)("%s s: stills %s + filming %s = %s", (length, paint, animate, total) => {
    const q = buildPressQuote({ ...base, shots: shots(length) });
    expect(q).toMatchObject({ version: PRESS_QUOTE_VERSION, paint, animate, total, trial: false });
    expect(q.rows.map((r) => [r.key, r.credits, r.paid])).toEqual([
      ["stills", paint, false],
      ["film", animate, false],
      ["checks", 0, false],
      ["posting", 0, false],
    ]);
  });

  it("prints the launch policy: no re-shoot, no refund (operator, 2026-09-26)", () => {
    const q = buildPressQuote({ ...base, shots: shots(15) });
    expect(q.policy).toEqual({ reshoot: "off", refund: false });
    expect(PRESS_POLICY).toEqual({ reshoot: "off", refund: false });
    // A copy, so no caller can edit the shared policy through a quote.
    q.policy.refund = true;
    expect(PRESS_POLICY.refund).toBe(false);
  });

  it("the balance after is the next press's spend: stills first, then filming", () => {
    expect(buildPressQuote({ ...base, shots: shots(15) }).balanceAfterNextStep).toBe(93);
    expect(buildPressQuote({ ...base, shots: shots(15), paintPaid: true }).balanceAfterNextStep).toBe(90);
    expect(buildPressQuote({ ...base, shots: shots(15), paintPaid: true, animatePaid: true }).balanceAfterNextStep).toBe(96);
    expect(buildPressQuote({ ...base, shots: shots(15), balanceNow: 2 }).balanceAfterNextStep).toBe(0);
  });

  it("an account whose credits never move (admins) keeps its balance", () => {
    expect(buildPressQuote({ ...base, shots: shots(15), charged: false }).balanceAfterNextStep).toBe(96);
  });

  it("the trial charges nothing", () => {
    const q = buildPressQuote({ ...base, shots: shots(15), trial: true });
    expect(q).toMatchObject({ paint: 0, animate: 0, total: 0, trial: true, balanceAfterNextStep: 96 });
  });

  it("a bad balance reads as 0, never as a negative or a fraction", () => {
    expect(buildPressQuote({ ...base, shots: shots(15), balanceNow: Number.NaN }).balanceNow).toBe(0);
    expect(buildPressQuote({ ...base, shots: shots(15), balanceNow: -4 }).balanceNow).toBe(0);
    expect(buildPressQuote({ ...base, shots: shots(15), balanceNow: 7.9 }).balanceNow).toBe(7);
  });
});

describe("a stored quote", () => {
  it("round-trips", () => {
    const q = buildPressQuote({ ...base, shots: shots(15) });
    expect(parsePressQuote(JSON.parse(JSON.stringify(q)))).toEqual(q);
  });

  it("refuses anything that is not one (a stale or tampered row is re-quoted)", () => {
    const q = buildPressQuote({ ...base, shots: shots(15) });
    expect(parsePressQuote(null)).toBeNull();
    expect(parsePressQuote({ ...q, total: 99 })).toBeNull();
    expect(parsePressQuote({ ...q, paint: -1 })).toBeNull();
    expect(parsePressQuote({ ...q, policy: { reshoot: "free", refund: false } })).toBeNull();
    expect(parsePressQuote({ ...q, rows: [{ key: "tip", credits: 1, paid: false }] })).toBeNull();
  });

  it("the price changed when the version, the paint or the filming did; never for the balance lines", () => {
    const q = buildPressQuote({ ...base, shots: shots(15) });
    expect(quotePriceChanged(q, { ...q, balanceNow: 3, balanceAfterNextStep: 0 })).toBe(false);
    expect(quotePriceChanged(q, { ...q, paint: 6, total: 12 })).toBe(true);
    expect(quotePriceChanged(q, { ...q, version: q.version + 1 })).toBe(true);
    expect(quotePriceChanged(null, q)).toBe(true);
  });
});
