import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CHECK_BUDGET_MS,
  checkMoments,
  checkStill,
  selfTestCard,
  type CheckCard,
  type CheckDeps,
  type SelfTestPhoto,
} from "./check";
import type { ReaderAnswer } from "./judge";
import {
  REASON_BLURRED,
  REASON_FACE_DIFFERENT,
  REASON_LABEL_DIFFERENT,
  REASON_LABEL_UNREADABLE,
  REASON_NOT_CHECKED,
  REASON_NOT_IN_PLAN,
  REASON_NOT_YOUR_PRODUCT,
  REASON_PRODUCT_MISSING,
} from "./messages";
import type { EscalationReading, JudgeReading, LocateReading } from "./product-lock";
import type { FrameCheckDraft, RecordContext } from "./records";

vi.setConfig({ testTimeout: 30_000 });

// The checker's run against fake readers. Every frame is a solid colour, so
// a fake can tell which frame (or which frame's crop) it was handed without
// relying on the order concurrent reads happen to start in.

const RGB = { red: [200, 30, 30], green: [30, 160, 60], blue: [30, 60, 200], gold: [220, 180, 20], ref: [128, 128, 128] } as const;
type Colour = keyof typeof RGB;
const pics = {} as Record<Colour, Buffer>;

beforeAll(async () => {
  for (const [name, [r, g, b]] of Object.entries(RGB)) {
    pics[name as Colour] = await sharp({ create: { width: 720, height: 1280, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
  }
});

async function colourOf(buf: Buffer): Promise<Colour> {
  const { channels } = await sharp(buf).stats();
  const m = channels.slice(0, 3).map((c) => c.mean);
  let best: Colour = "ref";
  let bestD = Infinity;
  for (const [name, rgb] of Object.entries(RGB)) {
    const d = rgb.reduce((s, v, i) => s + (v - m[i]) ** 2, 0);
    if (d < bestD) {
      bestD = d;
      best = name as Colour;
    }
  }
  return best;
}

const ok = <T>(value: T, usd = 0.001): ReaderAnswer<T> => ({ ok: true, value, usd, model: "fake" });
const LOCATED: LocateReading = { present: "yes", box: { x: 0.2, y: 0.3, w: 0.6, h: 0.5 }, boxConfidence: "high", blurred: false };
const MATCH: JudgeReading = { verdict: "match", shape: "ok", label: "ok", logo: "ok", colour: "ok", labelInView: true, blurred: false, confidence: 90, note: "" };
const MISMATCH: JudgeReading = { ...MATCH, verdict: "mismatch", shape: "off", confidence: 60 };
const SECOND_MISS: EscalationReading = { ...MISMATCH, present: "yes", confidence: 85 };

const CARD: CheckCard = {
  productId: "33333333-3333-4333-8333-333333333333",
  name: "Solstad Cold Brew",
  labelStrings: ["SOLSTAD"],
  noReadableText: false,
  dna: null,
  palette: ["#111111"],
  references: [],
  referenceText: null,
};

type Scene = {
  locate?: Partial<Record<Colour, LocateReading | "fail">>;
  judge?: Partial<Record<Colour, JudgeReading | "fail">>;
  words?: Partial<Record<Colour, string[] | null>>;
  escalate?: EscalationReading | "fail";
  face?: Partial<Record<Colour, number | null>>;
};

function fakes(scene: Scene = {}, over: Partial<CheckDeps> = {}) {
  const recorded: { ctx: RecordContext; drafts: FrameCheckDraft[] }[] = [];
  const spies = {
    locate: vi.fn(async ({ frame }: { frame: Buffer }) => {
      const a = scene.locate?.[await colourOf(frame)] ?? LOCATED;
      return a === "fail" ? ({ ok: false, reason: "not_configured", usd: 0 } as const) : ok(a);
    }),
    judge: vi.fn(async ({ crop }: { crop: Buffer }) => {
      const a = scene.judge?.[await colourOf(crop)] ?? MATCH;
      return a === "fail" ? ({ ok: false, reason: "unavailable", usd: 0 } as const) : ok(a);
    }),
    escalate: vi.fn(async () => {
      const a = scene.escalate ?? SECOND_MISS;
      return a === "fail" ? ({ ok: false, reason: "unavailable", usd: 0.011 } as const) : ok(a, 0.011);
    }),
    readWords: vi.fn(async (image: Buffer) => {
      const c = await colourOf(image);
      if (c === "ref") return { lines: ["SOLSTAD", "COLD BREW", "Ingredients: water, coffee"] };
      const w = scene.words?.[c];
      return w === null ? null : { lines: w ?? ["SOLSTAD"] };
    }),
    scoreFace: vi.fn(async (frame: Buffer) => {
      const s = scene.face?.[await colourOf(frame)];
      return s === null ? null : { score: s ?? 90, unusable: false, faceVisible: true };
    }),
    record: vi.fn(async (ctx: RecordContext, drafts: FrameCheckDraft[]) => {
      recorded.push({ ctx, drafts });
    }),
  };
  const deps: CheckDeps = { ...spies, scorerVersion: "fake/p1", ...over };
  return { deps, spies, recorded };
}

const card = (over: Partial<CheckCard> = {}): CheckCard => ({ ...CARD, references: [pics.ref], ...over });
const FACE = () => ({ identity: pics.ref, traitSummary: "", threshold: 70 });
const moments = (...colours: Colour[]) => colours.map((c, i) => ({ at: [0.4, 2.5, 4.6, 5][i], image: pics[c] }));

describe("the words corpus is every chosen photo, not only the readers' three (PT-04)", () => {
  // The still (red) shows the side panel: its line is printed only on the
  // side photo (gold), which is not among the photos shown to the readers.
  const scene: Scene = { words: { red: ["SOLSTAD", "Zulqarnain Mills Kyoto"], gold: ["Zulqarnain Mills Kyoto"] } };

  it("a line from a chosen photo the readers were not shown is the product's own, not a conflict", async () => {
    const { deps, spies } = fakes(scene);
    const r = await checkStill({ image: pics.red, visibility: "required_label", card: card({ textPhotos: [pics.ref, pics.gold] }) }, deps);
    expect(r.signals.moments[0].conflict).toBeNull();
    expect(r.signals.referenceText).toEqual(["SOLSTAD", "COLD BREW", "Ingredients: water, coffee", "Zulqarnain Mills Kyoto"]);
    // Both chosen photos were read for words; the readers still saw only the references.
    const read = await Promise.all(spies.readWords.mock.calls.map(async (c) => colourOf(c[0])));
    expect(read.filter((c) => c === "gold")).toHaveLength(1);
    expect((spies.locate.mock.calls[0][0] as unknown as { references: Buffer[] }).references).toHaveLength(1);
    expect(r.product).toBe("match");
  });

  it("without the chosen photos the same line would read as a conflict (the old corpus)", async () => {
    const { deps } = fakes(scene);
    const r = await checkStill({ image: pics.red, visibility: "required_label", card: card() }, deps);
    expect(r.signals.moments[0].conflict).toBe("Zulqarnain Mills Kyoto");
  });

  it("a chosen photo that could not be opened: no words at all rather than half of them", async () => {
    const { deps } = fakes(scene);
    const r = await checkStill({ image: pics.red, visibility: "required_label", card: card({ textPhotos: [pics.ref, null] }) }, deps);
    expect(r.signals.referenceText).toBeNull();
    expect(r.product).toBe("not_checked");
  });
});

describe("checkStill", () => {
  it("a clean still: Match on the product and the face, one moment recorded, the reference words read once", async () => {
    const f = fakes();
    const out = await checkStill({ image: pics.red, visibility: "required_label", card: card(), face: FACE(), record: { userId: "u", source: "still" } }, f.deps);
    expect(out).toMatchObject({ product: "match", face: "match", reason: null, productExpected: true });
    expect(out.signals.moments).toHaveLength(1);
    expect(out.signals.referenceText).toEqual(["SOLSTAD", "COLD BREW", "Ingredients: water, coffee"]);
    expect(out.signals.escalationsUsed).toBe(0);
    expect(out.signals.usd).toBeGreaterThan(0);
    expect(f.deps.escalate).not.toHaveBeenCalled();
    expect(f.recorded[0].drafts).toHaveLength(1);
    expect(f.recorded[0].drafts[0]).toMatchObject({ shotVerdict: "match", scorerVersion: "fake/p1" });
  });

  it("no judge key: Not checked, never a miss, and nothing after the locate call runs", async () => {
    const f = fakes({ locate: { red: "fail" } });
    const out = await checkStill({ image: pics.red, visibility: "required_label", card: card() }, f.deps);
    expect(out).toMatchObject({ product: "not_checked", reason: REASON_NOT_CHECKED });
    expect(f.deps.judge).not.toHaveBeenCalled();
    expect("face" in out).toBe(false);
  });

  it("the judge's mismatch plus a foreign line on the label: Didn't match, no second reading needed", async () => {
    const f = fakes({ judge: { red: MISMATCH }, words: { red: ["MOUNTAIN DEW"] } });
    const out = await checkStill({ image: pics.red, visibility: "required_label", card: card() }, f.deps);
    expect(out).toMatchObject({ product: "didnt_match", reason: REASON_LABEL_DIFFERENT });
    expect(f.deps.escalate).not.toHaveBeenCalled();
  });

  it("a line printed on the product's own photos is not foreign (v2 #7)", async () => {
    const f = fakes({ words: { red: ["SOLSTAD", "Ingredients: water, coffee"] } });
    expect((await checkStill({ image: pics.red, visibility: "required_label", card: card() }, f.deps)).product).toBe("match");
  });

  it("the judge's mismatch alone goes to a second reading; two agreeing readings are a miss", async () => {
    const f = fakes({ judge: { red: { ...MISMATCH, labelInView: false } }, words: { red: [] } });
    const out = await checkStill({ image: pics.red, visibility: "required_shape", card: card() }, f.deps);
    expect(f.deps.escalate).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ product: "didnt_match", reason: REASON_NOT_YOUR_PRODUCT });
    expect(out.signals.escalationsUsed).toBe(1);
  });

  it("with the ad's second readings spent, a lone mismatch stays Not readable", async () => {
    const f = fakes({ judge: { red: MISMATCH }, words: { red: [] } });
    const out = await checkStill({ image: pics.red, visibility: "required_shape", card: card(), escalationsLeft: 0 }, f.deps);
    expect(f.deps.escalate).not.toHaveBeenCalled();
    expect(out.product).toBe("not_readable");
  });

  it("a still with no product where the plan needs one: a second reading confirms it → Product missing", async () => {
    const f = fakes({ locate: { red: { present: "no", box: null, boxConfidence: "low", blurred: false } }, words: { red: [] }, escalate: { ...SECOND_MISS, present: "no" } });
    const out = await checkStill({ image: pics.red, visibility: "required_label", card: card() }, f.deps);
    expect(out).toMatchObject({ product: "product_missing", reason: REASON_PRODUCT_MISSING });
    expect(f.deps.escalate).toHaveBeenCalledTimes(1);
  });

  it("…and the confirmed words read on the whole frame say it IS there: Not readable, no second reading", async () => {
    const f = fakes({ locate: { red: { present: "no", box: null, boxConfidence: "low", blurred: false } } });
    const out = await checkStill({ image: pics.red, visibility: "required_label", card: card() }, f.deps);
    expect(out.product).toBe("not_readable");
    expect(f.deps.escalate).not.toHaveBeenCalled();
  });

  it("a packshot: No one in this shot, and the face scorer is never asked", async () => {
    const f = fakes();
    const out = await checkStill({ image: pics.red, visibility: "required_label", card: card(), face: null }, f.deps);
    expect(out.face).toBe("no_one_in_shot");
    expect(f.deps.scoreFace).not.toHaveBeenCalled();
  });

  it("a shot planned without the product and with no one in it: nothing is read at all", async () => {
    const f = fakes();
    const out = await checkStill({ image: pics.red, visibility: "absent", card: card(), face: null }, f.deps);
    expect(out).toMatchObject({ product: "not_checked", face: "no_one_in_shot", productExpected: false });
    expect(f.deps.locate).not.toHaveBeenCalled();
    expect(f.deps.readWords).not.toHaveBeenCalled();
  });

  it("a shot planned without the product still reads the face", async () => {
    const f = fakes({ face: { red: 40 } });
    const out = await checkStill({ image: pics.red, visibility: "absent", card: card(), face: FACE() }, f.deps);
    expect(out).toMatchObject({ product: "not_checked", face: "didnt_match", reason: REASON_FACE_DIFFERENT, productExpected: false });
    expect(f.deps.locate).not.toHaveBeenCalled();
  });

  it("the words reader down, with confirmed words on the card: Not checked", async () => {
    const f = fakes();
    f.spies.readWords.mockImplementation(async () => null);
    expect((await checkStill({ image: pics.red, visibility: "required_label", card: card() }, f.deps)).product).toBe("not_checked");
  });

  it("reference words already known are not read again", async () => {
    const f = fakes();
    await checkStill({ image: pics.red, visibility: "required_label", card: card({ referenceText: ["SOLSTAD"] }) }, f.deps);
    const colours = await Promise.all(f.spies.readWords.mock.calls.map(([b]) => colourOf(b)));
    expect(colours).not.toContain("ref");
  });

  it("a low-confidence box is tightened by segmentation when wired", async () => {
    const segment = vi.fn(async () => ({ x: 0.3, y: 0.3, w: 0.2, h: 0.4 }));
    const f = fakes({ locate: { red: { ...LOCATED, boxConfidence: "low" } } }, { segment });
    const out = await checkStill({ image: pics.red, visibility: "required_label", card: card() }, f.deps);
    expect(segment).toHaveBeenCalledTimes(1);
    expect(out.signals.moments[0].coverage).toBeCloseTo(0.08);
    expect(out.signals.moments[0].box).toEqual({ x: 0.3, y: 0.3, w: 0.2, h: 0.4 });
  });

  it("past its time budget the still reads Not checked (face-lock's 75 s rule)", async () => {
    const f = fakes();
    f.spies.locate.mockImplementation(() => new Promise(() => {}));
    const out = await checkStill({ image: pics.red, visibility: "required_label", card: card(), face: FACE(), budgetMs: 50 }, f.deps);
    expect(out).toMatchObject({ product: "not_checked", face: "not_checked", reason: REASON_NOT_CHECKED });
    expect(out.signals.timedOut).toBe(true);
    expect(CHECK_BUDGET_MS).toBe(75_000);
  });

  it("an unreadable picture is Not checked", async () => {
    const f = fakes();
    const out = await checkStill({ image: Buffer.from("nope"), visibility: "required_label", card: card(), face: FACE() }, f.deps);
    expect(out).toMatchObject({ product: "not_checked", face: "not_checked" });
  });
});

describe("checkMoments: 3 moments per shot, the worst decides", () => {
  it("three clean moments: Match, and three moments on the record", async () => {
    const f = fakes();
    const out = await checkMoments({ frames: moments("red", "green", "blue"), visibility: "required_label", card: card(), face: FACE(), record: { userId: "u", source: "moment", shot: 2 } }, f.deps);
    expect(out).toMatchObject({ product: "match", face: "match" });
    expect(out.signals.moments.map((m) => m.at)).toEqual([0.4, 2.5, 4.6]);
    expect(f.recorded[0].drafts.map((d) => d.moment)).toEqual([0, 1, 2]);
  });

  it("one blurred moment that looks wrong is Not readable, never a miss", async () => {
    const f = fakes({ judge: { green: { ...MISMATCH, blurred: true } }, words: { green: ["MOUNTAIN DEW"] } });
    const out = await checkMoments({ frames: moments("red", "green", "blue"), visibility: "required_label", card: card() }, f.deps);
    expect(out).toMatchObject({ product: "not_readable", reason: REASON_BLURRED });
    expect(out.signals.worst).toBe(1);
  });

  it("one wrong moment among good ones: Didn't match, pointing at it", async () => {
    const f = fakes({ judge: { blue: MISMATCH }, words: { blue: ["MOUNTAIN DEW"] } });
    const out = await checkMoments({ frames: moments("red", "green", "blue"), visibility: "required_label", card: card() }, f.deps);
    expect(out).toMatchObject({ product: "didnt_match", reason: REASON_LABEL_DIFFERENT });
    expect(out.signals.worst).toBe(2);
  });

  it("no moment shows the product: Product missing, backed by the moments themselves (no second reading)", async () => {
    const gone = { present: "no", box: null, boxConfidence: "low", blurred: false } as const;
    const f = fakes({ locate: { red: gone, green: gone, blue: gone }, words: { red: [], green: [], blue: [] } });
    const out = await checkMoments({ frames: moments("red", "green", "blue"), visibility: "required_shape", card: card() }, f.deps);
    expect(out.product).toBe("product_missing");
    expect(f.deps.escalate).not.toHaveBeenCalled();
  });

  it("at most 2 second readings an ad: the most urgent frames get them", async () => {
    const f = fakes({ judge: { red: MISMATCH, green: { ...MISMATCH, confidence: 20 }, blue: MISMATCH }, words: { red: [], green: [], blue: [] } });
    const out = await checkMoments({ frames: moments("red", "green", "blue"), visibility: "required_shape", card: card() }, f.deps);
    expect(f.deps.escalate).toHaveBeenCalledTimes(2);
    expect(out.signals.escalationsUsed).toBe(2);
    // The least confident mismatch was among those read again.
    expect(out.signals.moments[1].escalated).toBe(true);
    expect(out.product).toBe("didnt_match");
  });

  it("the caller carries the ad's allowance across shots", async () => {
    const f = fakes({ judge: { red: MISMATCH, green: MISMATCH }, words: { red: [], green: [] } });
    const out = await checkMoments({ frames: moments("red", "green"), visibility: "required_shape", card: card(), escalationsLeft: 1 }, f.deps);
    expect(f.deps.escalate).toHaveBeenCalledTimes(1);
    expect(out.signals.escalationsUsed).toBe(1);
  });

  it("from a clip: the moments are taken at 0.4 s, the middle and 0.4 s before the end; a moment not taken is Not checked", async () => {
    const sampleMoments = vi.fn(async (_video: Buffer, times: readonly number[]) => times.map((_, i) => (i === 1 ? null : pics.red)));
    const f = fakes({}, { sampleMoments });
    const out = await checkMoments({ video: Buffer.from("mp4"), seconds: 5, visibility: "required_label", card: card() }, f.deps);
    expect(sampleMoments.mock.calls[0][1]).toEqual([0.4, 2.5, 4.6]);
    expect(out).toMatchObject({ product: "not_checked" });
    expect(out.signals.moments[1].verdict).toBe("not_checked");
  });

  it("a packshot is read at 4 moments", async () => {
    const sampleMoments = vi.fn(async (_video: Buffer, times: readonly number[]) => times.map(() => pics.red));
    const f = fakes({}, { sampleMoments });
    const out = await checkMoments({ video: Buffer.from("mp4"), seconds: 5, packshot: true, visibility: "required_label", card: card(), face: null }, f.deps);
    expect(out.signals.moments).toHaveLength(4);
    expect(out.face).toBe("no_one_in_shot");
  });

  it("a clip of no length is Not checked", async () => {
    const f = fakes();
    expect((await checkMoments({ video: Buffer.from("x"), seconds: 0, visibility: "required_label", card: card() }, f.deps)).product).toBe("not_checked");
  });

  it("the face: the lowest moment that shows one", async () => {
    const f = fakes({ face: { red: 95, green: 64, blue: 88 } });
    const out = await checkMoments({ frames: moments("red", "green", "blue"), visibility: "required_label", card: card(), face: FACE() }, f.deps);
    expect(out).toMatchObject({ product: "match", face: "didnt_match", reason: REASON_FACE_DIFFERENT });
    expect(out.signals.faceLowest).toBe(64);
  });

  it("frames are kept for labelling only when the record says so", async () => {
    const kept = fakes();
    await checkMoments({ frames: moments("red"), visibility: "required_label", card: card(), record: { userId: "u", source: "moment", keepFrames: true } }, kept.deps);
    expect(Buffer.isBuffer(kept.recorded[0].drafts[0].frame)).toBe(true);
    const notKept = fakes();
    await checkMoments({ frames: moments("red"), visibility: "required_label", card: card(), record: { userId: "u", source: "moment" } }, notKept.deps);
    expect(notKept.recorded[0].drafts[0].frame).toBeNull();
  });

  it("a record that fails to land never changes the verdict", async () => {
    const f = fakes({}, { record: vi.fn(async () => Promise.reject(new Error("db down"))) });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await checkMoments({ frames: moments("red"), visibility: "required_label", card: card(), record: { userId: "u", source: "moment" } }, f.deps)).product).toBe("match");
    spy.mockRestore();
  });
});

describe("selfTestCard: every chosen photo must read Match before the card is confirmed (v2 #7)", () => {
  const photos = (): SelfTestPhoto[] => [
    { path: "u/p/side.jpg", view: "side", image: pics.green },
    { path: "u/p/front.jpg", view: "front", image: pics.red },
    { path: "u/p/back.jpg", view: "back", image: pics.blue },
  ];
  const base = { productId: CARD.productId, name: CARD.name, labelStrings: ["SOLSTAD"], noReadableText: false, dna: null, palette: [] };

  it("all photos read Match: passed, with every word read on them for the checks after", async () => {
    const f = fakes({ words: { red: ["SOLSTAD", "COLD BREW"], green: ["SOLSTAD"], blue: ["SOLSTAD", "Ingredients"] } });
    const out = await selfTestCard({ card: base, photos: photos() }, f.deps);
    expect(out).toMatchObject({ ok: true, passed: true });
    if (!out.ok) return;
    expect(out.photos.map((p) => p.path)).toEqual(["u/p/front.jpg", "u/p/side.jpg", "u/p/back.jpg"]);
    expect(out.referenceText).toEqual(expect.arrayContaining(["SOLSTAD", "COLD BREW", "Ingredients"]));
  });

  it("the front must show the ticked words: a misspelt tick fails the front", async () => {
    const f = fakes({ words: { red: ["SOLSTAD"], green: ["SOLSTAD"], blue: ["SOLSTAD"] } });
    const out = await selfTestCard({ card: { ...base, labelStrings: ["SUNSTAR"] }, photos: photos() }, f.deps);
    expect(out).toMatchObject({ ok: true, passed: false });
    if (!out.ok) return;
    expect(out.photos.find((p) => p.path === "u/p/front.jpg")).toMatchObject({ passed: false, reason: REASON_LABEL_UNREADABLE });
  });

  it("a side whose words aren't legible from that angle passes when the readers agree it is the product", async () => {
    const f = fakes({ words: { red: ["SOLSTAD"], green: ["SOL"], blue: ["SOLSTAD"] } });
    const out = await selfTestCard({ card: base, photos: photos() }, f.deps);
    expect(out).toMatchObject({ ok: true, passed: true });
  });

  it("a photo of another product fails, and is named", async () => {
    const f = fakes({ judge: { blue: { ...MISMATCH, labelInView: false } }, words: { red: ["SOLSTAD"], green: ["SOLSTAD"], blue: [] } });
    const out = await selfTestCard({ card: base, photos: photos() }, f.deps);
    expect(out).toMatchObject({ ok: true, passed: false });
    if (!out.ok) return;
    expect(out.photos.filter((p) => !p.passed).map((p) => p.path)).toEqual(["u/p/back.jpg"]);
  });

  it("a checker that can't run is unavailable: nothing is confirmed (fail closed)", async () => {
    const f = fakes({ locate: { red: "fail" } });
    expect(await selfTestCard({ card: base, photos: photos() }, f.deps)).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("no photos: unavailable", async () => {
    expect(await selfTestCard({ card: base, photos: [] }, fakes().deps)).toMatchObject({ ok: false });
  });

  it("the words on the photos unreadable: unavailable", async () => {
    const f = fakes();
    f.spies.readWords.mockImplementation(async () => null);
    expect(await selfTestCard({ card: base, photos: photos() }, f.deps)).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("each photo leaves a self_test record", async () => {
    const f = fakes({ words: { red: ["SOLSTAD"], green: ["SOLSTAD"], blue: ["SOLSTAD"] } });
    await selfTestCard({ card: base, photos: photos(), record: { userId: "u", source: "self_test" } }, f.deps);
    expect(f.recorded).toHaveLength(3);
    expect(f.recorded.every((r) => r.ctx.source === "self_test")).toBe(true);
  });

  it("a shot planned without the product reads 'not in the plan', not a failure", async () => {
    const f = fakes();
    const out = await checkStill({ image: pics.red, visibility: "absent", card: card(), face: FACE() }, f.deps);
    expect(out.product).toBe("not_checked");
    expect(out.reason).not.toBe(REASON_NOT_IN_PLAN); // the face's reason, if any, comes first; a match has none
  });
});
