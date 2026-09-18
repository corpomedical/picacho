import { describe, expect, it } from "vitest";
import {
  EXPRESSION_BUILD_ORDER,
  EXPRESSION_SET_LIKENESS_FLOOR,
  EXPRESSION_SLOTS,
  EXPRESSION_SLOT_GROUPS,
  FACE_LINE_INSTRUCTION,
  MAX_SET_PICTURES,
  chainsFromTeeth,
  isUsable,
  normaliseExpressionSet,
  parseFaceLine,
  pickSetForShot,
  slotPrompt,
  takeFaceLine,
  usableSlots,
  type ExpressionSlot,
} from "./expression-set";

// The expression set (2026-09-18). What the tests hold is what the three
// rounds of the identity test taught: separate close-ups, never one sheet;
// the teeth made once and every smile made from them; profiles named by
// where the nose points; the stored set trusted only through one door;
// and a shot matched by what the request means.

const OWNER = "11111111-1111-4111-8111-111111111111";
const ALL = [...EXPRESSION_SLOTS];

describe("the slots", () => {
  it("are nine, each shown once on the page and made once in the build", () => {
    expect(EXPRESSION_SLOTS).toHaveLength(9);
    const shown = EXPRESSION_SLOT_GROUPS.flatMap((g) => g.slots);
    expect([...shown].sort()).toEqual([...EXPRESSION_SLOTS].sort());
    expect([...EXPRESSION_BUILD_ORDER].sort()).toEqual([...EXPRESSION_SLOTS].sort());
  });

  it("makes the teeth before anything that smiles, and the smiles from the teeth", () => {
    const at = (s: ExpressionSlot) => EXPRESSION_BUILD_ORDER.indexOf(s);
    for (const slot of EXPRESSION_SLOTS.filter(chainsFromTeeth)) expect(at("teeth")).toBeLessThan(at(slot));
    expect(EXPRESSION_SLOTS.filter(chainsFromTeeth)).toEqual(["smile", "laugh"]);
    expect(slotPrompt("smile", { withTeeth: true })).toContain("exactly those in the close-up of their mouth");
    // Without a teeth close-up there is nothing to point at, so nothing is said.
    expect(slotPrompt("smile", { withTeeth: false })).not.toContain("close-up of their mouth");
    // A close-up that does not smile never mentions the teeth close-up.
    expect(slotPrompt("profile-left", { withTeeth: true })).not.toContain("close-up of their mouth");
  });

  it("names each profile by where the nose points, so the two cannot come out the same", () => {
    expect(slotPrompt("profile-left", { withTeeth: false })).toContain("their nose points to the LEFT edge of the picture");
    expect(slotPrompt("profile-right", { withTeeth: false })).toContain("their nose points to the RIGHT edge of the picture");
    expect(slotPrompt("three-quarter-left", { withTeeth: false })).toContain("toward the left edge");
    expect(slotPrompt("three-quarter-right", { withTeeth: false })).toContain("toward the right edge");
  });

  it("keeps every feature in every close-up", () => {
    for (const slot of EXPRESSION_SLOTS) {
      expect(slotPrompt(slot, { withTeeth: true }), slot).toContain("Keep every feature exactly as it is in the photos");
      expect(slotPrompt(slot, { withTeeth: true }), slot).toContain("this exact person");
    }
  });
});

describe("the stored set", () => {
  const entry = (path: string, extra: Record<string, unknown> = {}) => ({ path, source: "made", likeness: 91, at: "2026-09-18T20:00:00Z", ...extra });

  it("keeps what is well formed and inside the owner's folder", () => {
    const set = normaliseExpressionSet({ smile: entry(`${OWNER}/face-smile.png`), teeth: entry(`${OWNER}/face-teeth.png`, { source: "upload", likeness: null }) }, OWNER);
    expect(set.smile).toEqual({ path: `${OWNER}/face-smile.png`, source: "made", likeness: 91, at: "2026-09-18T20:00:00Z" });
    expect(set.teeth?.source).toBe("upload");
    expect(set.teeth?.likeness).toBeNull();
  });

  it("drops another person's path, a climb out of the folder, an unknown slot and anything malformed", () => {
    const set = normaliseExpressionSet(
      {
        smile: entry("22222222-2222-4222-8222-222222222222/theirs.png"),
        laugh: entry(`${OWNER}/../escape.png`),
        grin: entry(`${OWNER}/grin.png`),
        eyes: { path: `${OWNER}/eyes.png`, source: "stolen" },
        neutral: "not an object",
        teeth: entry(`${OWNER}/t.png`, { likeness: 400 }),
      },
      OWNER,
    );
    expect(Object.keys(set)).toEqual(["teeth"]);
    expect(set.teeth?.likeness).toBeNull();
    expect(normaliseExpressionSet(null, OWNER)).toEqual({});
    expect(normaliseExpressionSet([entry(`${OWNER}/a.png`)], OWNER)).toEqual({});
    expect(normaliseExpressionSet({ smile: entry(`${OWNER}/a.png`) }, "")).toEqual({});
  });

  it("uses an upload always, a made close-up at the floor or above, an unread one too", () => {
    const at = (likeness: number | null, source: "made" | "upload" = "made") => ({ path: `${OWNER}/x.png`, source, likeness, at: "" });
    expect(isUsable(at(EXPRESSION_SET_LIKENESS_FLOOR))).toBe(true);
    expect(isUsable(at(EXPRESSION_SET_LIKENESS_FLOOR - 0.5))).toBe(false);
    expect(isUsable(at(12, "upload"))).toBe(true);
    expect(isUsable(at(null))).toBe(true);
    expect(isUsable(undefined)).toBe(false);
    expect(usableSlots({ smile: at(91), laugh: at(60), teeth: at(12, "upload") })).toEqual(["teeth", "smile"]);
  });

  it("sets the floor under every close-up measured on 2026-09-18, and well above a drifted one", () => {
    // Round 2's eight close-ups read 86.5–95.5 against the held-out photo.
    expect(EXPRESSION_SET_LIKENESS_FLOOR).toBeLessThanOrEqual(86.5 - 5);
    expect(EXPRESSION_SET_LIKENESS_FLOOR).toBeGreaterThanOrEqual(75);
  });
});

describe("reading the face a shot needs", () => {
  it("asks by meaning, from fixed words, never a word list over the request", () => {
    expect(FACE_LINE_INSTRUCTION).toContain('"FACE:"');
    expect(FACE_LINE_INSTRUCTION).toContain("from what the request means, not from the words it happens to use");
  });

  it("reads the line in any case, with or without punctuation", () => {
    expect(parseFaceLine("laugh three-quarter")).toEqual({ expression: "laugh", angle: "three-quarter" });
    expect(parseFaceLine("Smile, Front.")).toEqual({ expression: "smile", angle: "front" });
    expect(parseFaceLine("other unseen")).toEqual({ expression: "other", angle: "unseen" });
    expect(parseFaceLine("grinning sideways")).toBeNull();
    expect(parseFaceLine("")).toBeNull();
  });

  it("takes the line out of the answer wherever the drafter put it", () => {
    const before = takeFaceLine("A woman laughs at a café.\nFACE: laugh three-quarter\nOVERRIDES: none");
    expect(before).toEqual({ text: "A woman laughs at a café.\nOVERRIDES: none", face: { expression: "laugh", angle: "three-quarter" } });
    const after = takeFaceLine("A woman laughs at a café.\nOVERRIDES: none\nFACE: laugh three-quarter");
    expect(after.text).toBe("A woman laughs at a café.\nOVERRIDES: none");
    expect(after.face?.expression).toBe("laugh");
    expect(takeFaceLine("No face line here.")).toEqual({ text: "No face line here.", face: null });
  });

  it("takes it off the end of a prompt line too, but never cuts prose that merely says face", () => {
    expect(takeFaceLine("A woman laughs at a café. FACE: laugh front\nOVERRIDES: none")).toEqual({
      text: "A woman laughs at a café.\nOVERRIDES: none",
      face: { expression: "laugh", angle: "front" },
    });
    expect(takeFaceLine("Face: smile profile")).toEqual({ text: "", face: { expression: "smile", angle: "profile" } });
    const prose = "Her face: calm and bright, lit from the window.";
    expect(takeFaceLine(prose)).toEqual({ text: prose, face: null });
    // Capitals but not a read: left alone.
    expect(takeFaceLine("A poster that says FACE: THE MUSIC.")).toEqual({ text: "A poster that says FACE: THE MUSIC.", face: null });
  });
});

describe("which close-ups ride with photo 1", () => {
  it("sends the laugh and its teeth for a laugh, the smile and its teeth for a smile", () => {
    expect(pickSetForShot(ALL, { expression: "laugh", angle: "front" })).toEqual(["laugh", "teeth", "neutral"]);
    expect(pickSetForShot(ALL, { expression: "smile", angle: "front" })).toEqual(["smile", "teeth", "neutral"]);
  });

  it("sends both profiles for a profile and both three-quarters for a three-quarter", () => {
    expect(pickSetForShot(ALL, { expression: "neutral", angle: "profile" })).toEqual(["profile-left", "profile-right", "neutral"]);
    expect(pickSetForShot(ALL, { expression: "serious", angle: "three-quarter" })).toEqual(["three-quarter-left", "three-quarter-right", "neutral"]);
  });

  it("puts the expression before the angle when there is not room for both", () => {
    expect(pickSetForShot(ALL, { expression: "laugh", angle: "profile" })).toEqual(["laugh", "teeth", "profile-left"]);
    for (const expression of ["neutral", "smile", "laugh", "serious", "other"] as const) {
      for (const angle of ["front", "three-quarter", "profile"] as const) {
        expect(pickSetForShot(ALL, { expression, angle }).length).toBeLessThanOrEqual(MAX_SET_PICTURES);
      }
    }
  });

  it("sends nothing when no face is in the picture, and the face at rest and the teeth when nothing was read", () => {
    expect(pickSetForShot(ALL, { expression: "other", angle: "unseen" })).toEqual([]);
    expect(pickSetForShot(ALL, { expression: "smile", angle: "back" })).toEqual([]);
    expect(pickSetForShot(ALL, null)).toEqual(["neutral", "teeth"]);
  });

  it("only ever sends what the set has, and never a slot twice", () => {
    expect(pickSetForShot(["neutral"], { expression: "laugh", angle: "profile" })).toEqual(["neutral"]);
    expect(pickSetForShot([], { expression: "laugh", angle: "front" })).toEqual([]);
    const picked = pickSetForShot(ALL, { expression: "other", angle: "front" });
    expect(new Set(picked).size).toBe(picked.length);
  });
});
