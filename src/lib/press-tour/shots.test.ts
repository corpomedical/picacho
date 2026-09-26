import { describe, expect, it } from "vitest";
import {
  MAX_REFILMS_PER_SHOT,
  canRefilm,
  chosenTake,
  closeOpenTakes,
  cutList,
  filmCreditsHeld,
  firstDecision,
  initialShots,
  momentDetailFrom,
  momentFace,
  momentProduct,
  needsDecision,
  parseShots,
  retryDue,
  settleForCut,
  shotViews,
  tagCornerFor,
  takeWorst,
  withCut,
  withKeep,
  withTakeChecked,
  withTakeFailed,
  withTakeFilmed,
  withTakeReserved,
  withTakeSubmitted,
  withTakesRefunded,
  type ShotContext,
  type ShotState,
  type TakeCheckResult,
} from "./shots";

// The press wall's pure rules (Cut 4): a miss starts nothing on its own,
// "Not readable" and "Not checked" are never a miss, a re-filmed shot waits
// for the person's pick, the cut takes what was kept, a cut shot is free.

const T = "2026-09-26T10:00:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const JOB = { requestId: "r1", statusUrl: "https://queue.fal.run/x/status", responseUrl: "https://queue.fal.run/x", cancelUrl: "https://queue.fal.run/x/cancel", label: "Kling O3" };
const HERO: ShotContext = { productExpected: true, star: true };

const check = (over: Partial<TakeCheckResult> = {}): TakeCheckResult => ({
  face: "match",
  product: "match",
  reason: null,
  moments: [
    { atSeconds: 0.4, face: "match", product: "match", reason: null },
    { atSeconds: 2.5, face: "match", product: "match", reason: null },
    { atSeconds: 4.6, face: "match", product: "match", reason: null },
  ],
  escalations: 0,
  corner: "left",
  ...over,
});

/** A shot filmed and checked: take 1 with this check. */
function checkedShot(c: Partial<TakeCheckResult> = {}, shot = 1): ShotState[] {
  let shots = initialShots(3);
  shots = withTakeReserved(shots, shot, { rowId: id(shot), kind: "film", credits: 2 }, T)!;
  shots = withTakeSubmitted(shots, shot, 1, JOB, T);
  shots = withTakeFilmed(shots, shot, 1, { video: `/api/media/generated-videos/u/${shot}.mp4?v=s`, seconds: 5 }, T);
  return withTakeChecked(shots, shot, 1, check(c), T);
}

describe("a take's life", () => {
  it("reserved -> filming -> filmed -> checked; the lane handle is dropped once filmed; a second write is a no-op", () => {
    let shots = withTakeReserved(initialShots(1), 1, { rowId: id(1), kind: "film", credits: 2 }, T)!;
    expect(shots[0].takes[0]).toMatchObject({ n: 1, status: "reserved", credits: 2, kind: "film" });
    shots = withTakeSubmitted(shots, 1, 1, JOB, T);
    expect(shots[0].takes[0]).toMatchObject({ status: "filming", job: JOB, submittedAt: T });
    expect(withTakeSubmitted(shots, 1, 1, { ...JOB, requestId: "other" }, T)[0].takes[0].job?.requestId).toBe("r1");
    shots = withTakeFilmed(shots, 1, 1, { video: "/api/media/generated-videos/u/1.mp4?v=s", seconds: 5 }, T);
    expect(shots[0].takes[0]).toMatchObject({ status: "filmed", job: null, seconds: 5 });
    shots = withTakeChecked(shots, 1, 1, check(), T);
    expect(shots[0].takes[0]).toMatchObject({ status: "checked", face: "match", product: "match" });
  });

  it("a shot holds one take in flight at a time, and a row id only once", () => {
    const shots = withTakeReserved(initialShots(2), 1, { rowId: id(1), kind: "film", credits: 2 }, T)!;
    expect(withTakeReserved(shots, 1, { rowId: id(2), kind: "retry", credits: 0 }, T)).toBeNull();
    expect(withTakeReserved(shots, 2, { rowId: id(1), kind: "film", credits: 2 }, T)).toBeNull();
  });

  it("a failed take whose credits went back holds none; its retry is due once per paid filming", () => {
    let shots = withTakeReserved(initialShots(1), 1, { rowId: id(1), kind: "film", credits: 2 }, T)!;
    shots = withTakeFailed(shots, 1, 1, { error: "lane", cause: "provider", refunded: true }, T);
    expect(shots[0].takes[0]).toMatchObject({ status: "failed", credits: 0, cause: "provider" });
    expect(retryDue(shots[0], shots[0].takes[0])).toBe(true);
    shots = withTakeReserved(shots, 1, { rowId: id(2), kind: "retry", credits: 2 }, T)!;
    expect(retryDue(shots[0], shots[0].takes[0])).toBe(false);
    expect(retryDue(shots[0], shots[0].takes[1])).toBe(false);
  });

  it("the parser keeps only well-formed takes, and only the lane's own https links", () => {
    const parsed = parseShots(
      [
        {
          shot: 1,
          takes: [
            { n: 1, rowId: id(1), kind: "film", status: "filming", credits: 2, job: { ...JOB, statusUrl: "http://evil/status" }, at: T },
            { n: 2, rowId: "nope", kind: "film", status: "filming", credits: 2 },
          ],
          decision: "sideways",
        },
      ],
      2,
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0].takes).toHaveLength(1);
    expect(parsed[0].takes[0].job).toBeNull();
    expect(parsed[0].decision).toBe("pending");
    expect(parsed[1]).toEqual({ shot: 2, takes: [], chosen: null, decision: "pending" });
  });
});

describe("what waits on the person", () => {
  it("a clean take goes into the cut as it is", () => {
    const shots = checkedShot();
    expect(needsDecision(shots[0], HERO)).toBe(false);
  });

  it("a product that didn't match, or is missing, waits; so does a face that didn't match", () => {
    expect(needsDecision(checkedShot({ product: "didnt_match" })[0], HERO)).toBe(true);
    expect(needsDecision(checkedShot({ product: "product_missing" })[0], HERO)).toBe(true);
    expect(needsDecision(checkedShot({ face: "didnt_match" })[0], HERO)).toBe(true);
  });

  it("'Not readable' and 'Not checked' are never a miss", () => {
    expect(needsDecision(checkedShot({ product: "not_readable" })[0], HERO)).toBe(false);
    expect(needsDecision(checkedShot({ product: "not_checked", face: "not_checked" })[0], HERO)).toBe(false);
  });

  it("a product miss on a shot planned without the product is not a miss", () => {
    expect(needsDecision(checkedShot({ product: "didnt_match" })[0], { productExpected: false, star: true })).toBe(false);
  });

  it("a shot with no usable take waits (its filming failed twice)", () => {
    let shots = withTakeReserved(initialShots(1), 1, { rowId: id(1), kind: "film", credits: 2 }, T)!;
    shots = withTakeFailed(shots, 1, 1, { error: "lane", cause: "provider", refunded: true }, T);
    expect(needsDecision(shots[0], HERO)).toBe(true);
    expect(chosenTake(shots[0], HERO)).toBeNull();
  });

  it("nothing waits while we are still filming or checking it", () => {
    let shots = withTakeReserved(initialShots(1), 1, { rowId: id(1), kind: "film", credits: 2 }, T)!;
    expect(needsDecision(shots[0], HERO)).toBe(false);
    shots = withTakeFilmed(withTakeSubmitted(shots, 1, 1, JOB, T), 1, 1, { video: "v", seconds: 5 }, T);
    expect(needsDecision(shots[0], HERO)).toBe(false);
  });

  it("the first shot waiting names the blocker", () => {
    let shots = checkedShot();
    shots = withTakeChecked(withTakeFilmed(withTakeSubmitted(withTakeReserved(shots, 2, { rowId: id(2), kind: "film", credits: 2 }, T)!, 2, 1, JOB, T), 2, 1, { video: "v2", seconds: 5 }, T), 2, 1, check({ product: "didnt_match" }), T);
    expect(firstDecision(shots.slice(0, 2), () => HERO)).toBe(2);
  });
});

describe("the person's presses", () => {
  it("Keep take 1: kept, and nothing waits any more", () => {
    const shots = checkedShot({ product: "didnt_match" });
    const kept = withKeep(shots, 1, 1);
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.shots[0]).toMatchObject({ decision: "kept", chosen: 1 });
    expect(needsDecision(kept.shots[0], HERO)).toBe(false);
  });

  it("Keep refuses a take that isn't there or isn't checked, and a shot not filmed", () => {
    expect(withKeep(checkedShot(), 1, 2)).toEqual({ ok: false, reason: "take" });
    expect(withKeep(checkedShot(), 9, 1)).toEqual({ ok: false, reason: "shot" });
    expect(withKeep(checkedShot(), 2, 1)).toEqual({ ok: false, reason: "notFilmed" });
    let shots = withTakeReserved(initialShots(1), 1, { rowId: id(1), kind: "film", credits: 2 }, T)!;
    shots = withTakeFailed(shots, 1, 1, { error: "lane", cause: "provider", refunded: true }, T);
    expect(withKeep(shots, 1, 1)).toEqual({ ok: false, reason: "notReady" });
  });

  it("Cut this shot is free and leaves the others; the last shot can't be cut", () => {
    let shots = checkedShot({ product: "didnt_match" });
    shots = withTakeChecked(withTakeFilmed(withTakeSubmitted(withTakeReserved(shots, 2, { rowId: id(2), kind: "film", credits: 2 }, T)!, 2, 1, JOB, T), 2, 1, { video: "v2", seconds: 5 }, T), 2, 1, check(), T);
    const cut = withCut(shots, 1);
    expect(cut.ok).toBe(true);
    if (!cut.ok) return;
    expect(cut.shots[0].decision).toBe("cut");
    expect(needsDecision(cut.shots[0], HERO)).toBe(false);
    const two = withCut(cut.shots, 2);
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(withCut(two.shots, 3)).toEqual({ ok: false, reason: "notFilmed" });
    const only = [{ shot: 1, takes: shots[0].takes, chosen: null, decision: "pending" as const }];
    expect(withCut(only, 1)).toEqual({ ok: false, reason: "last" });
  });

  it("a re-film puts the shot in 'refilming'; once the new take is checked the person picks the take", () => {
    let shots = checkedShot({ product: "didnt_match" });
    expect(canRefilm(shots[0])).toBe(true);
    shots = withTakeReserved(shots, 1, { rowId: id(9), kind: "refilm", credits: 2 }, T)!;
    expect(shots[0].decision).toBe("refilming");
    expect(canRefilm(shots[0])).toBe(false);
    shots = withTakeChecked(withTakeFilmed(withTakeSubmitted(shots, 1, 2, JOB, T), 1, 2, { video: "v", seconds: 5 }, T), 1, 2, check(), T);
    expect(shots[0].decision).toBe("pending");
    // Take 2 matched: it is the default choice, and the person still picks.
    expect(chosenTake(shots[0], HERO)?.n).toBe(2);
    expect(needsDecision(shots[0], HERO)).toBe(true);
  });

  it("a shot can be filmed again at most MAX_REFILMS_PER_SHOT times", () => {
    let shots = checkedShot({ product: "didnt_match" });
    for (let i = 0; i < MAX_REFILMS_PER_SHOT; i++) {
      const n = shots[0].takes.length + 1;
      shots = withTakeReserved(shots, 1, { rowId: id(20 + i), kind: "refilm", credits: 2 }, T)!;
      shots = withTakeChecked(withTakeFilmed(withTakeSubmitted(shots, 1, n, JOB, T), 1, n, { video: "v", seconds: 5 }, T), 1, n, check({ product: "didnt_match" }), T);
    }
    expect(canRefilm(shots[0])).toBe(false);
  });
});

describe("the cut", () => {
  it("settles every shot left in onto its chosen take, in shot order, skipping a cut shot", () => {
    let shots = checkedShot();
    shots = withTakeChecked(withTakeFilmed(withTakeSubmitted(withTakeReserved(shots, 2, { rowId: id(2), kind: "film", credits: 2 }, T)!, 2, 1, JOB, T), 2, 1, { video: "v2", seconds: 5 }, T), 2, 1, check({ product: "didnt_match" }), T);
    shots = withTakeChecked(withTakeFilmed(withTakeSubmitted(withTakeReserved(shots, 3, { rowId: id(3), kind: "film", credits: 2 }, T)!, 3, 1, JOB, T), 3, 1, { video: "v3", seconds: 5 }, T), 3, 1, check(), T);
    const cut = withCut(shots, 2);
    if (!cut.ok) throw new Error("cut");
    const settled = settleForCut(cut.shots, () => HERO)!;
    expect(settled.map((s) => [s.shot, s.decision, s.chosen])).toEqual([
      [1, "kept", 1],
      [2, "cut", null],
      [3, "kept", 1],
    ]);
    expect(cutList(settled).map((c) => c.shot)).toEqual([1, 3]);
  });

  it("nothing to cut when no shot has a usable take", () => {
    let shots = withTakeReserved(initialShots(1), 1, { rowId: id(1), kind: "film", credits: 2 }, T)!;
    shots = withTakeFailed(shots, 1, 1, { error: "x", cause: "provider", refunded: false }, T);
    expect(settleForCut(shots, () => HERO)).toBeNull();
  });

  it("the filming credits still held, and closing open takes (the 24 h rule's inputs)", () => {
    let shots = checkedShot();
    shots = withTakeReserved(shots, 2, { rowId: id(2), kind: "film", credits: 2 }, T)!;
    expect(filmCreditsHeld(shots)).toEqual([
      { rowId: id(1), credits: 2 },
      { rowId: id(2), credits: 2 },
    ]);
    const closed = closeOpenTakes(shots, "late", T);
    expect(closed[1].takes[0].status).toBe("failed");
    expect(closed[0].takes[0].status).toBe("checked");
    expect(filmCreditsHeld(withTakesRefunded(shots, [id(1)]))).toEqual([{ rowId: id(2), credits: 2 }]);
  });
});

describe("the checker's words", () => {
  it("a moment's product word from the frame verdict; nothing for a shot without the product", () => {
    expect(momentProduct("match", true)).toBe("match");
    expect(momentProduct("didnt_match", true)).toBe("didnt_match");
    expect(momentProduct("excluded", true)).toBe("not_readable");
    expect(momentProduct("absent", true)).toBe("product_missing");
    expect(momentProduct("not_checked", true)).toBe("not_checked");
    expect(momentProduct("match", false)).toBe("not_checked");
  });

  it("a moment's face word: the bar of 0 is off (not checked), a packshot has no one", () => {
    expect(momentFace(80, 70, true)).toBe("match");
    expect(momentFace(60, 70, true)).toBe("didnt_match");
    expect(momentFace(60, 0, true)).toBe("not_checked");
    expect(momentFace(null, 70, true)).toBe("not_checked");
    expect(momentFace(90, 70, false)).toBe("no_one_in_shot");
  });

  it("the take's worst verdict is the worse of the checks that apply", () => {
    const t = checkedShot({ face: "not_readable", product: "match" })[0].takes[0];
    expect(takeWorst(t, HERO)).toBe("not_readable");
    expect(takeWorst(t, { productExpected: true, star: false })).toBe("match");
  });

  it("the tag goes in the bottom corner away from the product; bottom-left when unknown", () => {
    expect(tagCornerFor([])).toBe("left");
    expect(tagCornerFor([null, null])).toBe("left");
    expect(tagCornerFor([{ x: 0.05, y: 0.7, w: 0.3, h: 0.28 }])).toBe("right");
    expect(tagCornerFor([{ x: 0.65, y: 0.75, w: 0.3, h: 0.24 }])).toBe("left");
  });
});

describe("the press wall view", () => {
  it("no shots before filming; after, every planned shot with its takes, never a row id, lane or score", () => {
    const planned = [1, 2, 3].map((shot) => ({ shot, role: "costar" as const, productExpected: true, star: true }));
    expect(shotViews(planned, initialShots(3), { videoUrl: (v) => v, refilmCredits: () => 2 })).toEqual([]);
    const views = shotViews(planned, checkedShot({ product: "didnt_match", reason: "The words on the label came out different." }), { videoUrl: (v) => `${v}#view`, refilmCredits: () => 2 });
    expect(views).toHaveLength(3);
    expect(views[0]).toMatchObject({ shot: 1, chosenTake: 1, decision: "pending", needsDecision: true, refilmCredits: 2, canRefilm: true });
    expect(views[0].takes[0]).toMatchObject({ take: 1, state: "checked", worst: "didnt_match", product: "didnt_match", reason: "The words on the label came out different." });
    expect(views[0].takes[0].moments).toHaveLength(3);
    expect(views[1].takes).toEqual([]);
    const text = JSON.stringify(views);
    expect(text).not.toContain(id(1));
    expect(text).not.toMatch(/fal|kling|requestId|statusUrl|score/i);
  });
});

describe("both readings of a moment (the press wall's why panel)", () => {
  const aspects = { label: "off" as const, logo: "ok" as const, shape: "ok" as const, colour: "unseen" as const };

  it("carries the words read, the label's word and the four parts only when both readings are there", () => {
    expect(momentDetailFrom({ conflict: " SOLSTAO ", labelExpected: "SOLSTAD", judge: { aspects } })).toEqual({
      read: "SOLSTAO",
      expected: "SOLSTAD",
      label: "didnt_match",
      logo: "match",
      shape: "match",
      colour: "not_readable",
    });
    expect(momentDetailFrom({ conflict: null, labelExpected: "SOLSTAD", judge: { aspects } })).toBeNull();
    expect(momentDetailFrom({ conflict: "SOLSTAO", labelExpected: null, judge: { aspects } })).toBeNull();
    expect(momentDetailFrom({ conflict: "SOLSTAO", labelExpected: "SOLSTAD", judge: null })).toBeNull();
    expect(momentDetailFrom({ conflict: "SOLSTAO", labelExpected: "SOLSTAD", judge: {} })).toBeNull();
    expect(momentDetailFrom({ conflict: "SOLSTAO", labelExpected: "SOLSTAD", judge: { aspects: { ...aspects, logo: "maybe" as never } } })).toBeNull();
  });

  it("keeps them through the stored column, and drops a half-written one", () => {
    const take = (detail: unknown) => ({
      n: 1,
      rowId: "33333333-3333-4333-8333-333333333333",
      kind: "film",
      status: "checked",
      credits: 2,
      moments: [{ atSeconds: 2.2, face: "match", product: "didnt_match", reason: null, detail }],
      at: "2026-09-26T10:00:00Z",
    });
    const kept = parseShots([{ shot: 1, takes: [take({ read: "SOLSTAO", expected: "SOLSTAD", label: "didnt_match", logo: "match", shape: "match", colour: "not_readable" })] }], 1);
    expect(kept[0].takes[0].moments[0].detail).toEqual({ read: "SOLSTAO", expected: "SOLSTAD", label: "didnt_match", logo: "match", shape: "match", colour: "not_readable" });
    const half = parseShots([{ shot: 1, takes: [take({ read: "SOLSTAO", label: "didnt_match" })] }], 1);
    expect(half[0].takes[0].moments[0]).not.toHaveProperty("detail");
    const odd = parseShots([{ shot: 1, takes: [take({ read: "SOLSTAO", expected: "SOLSTAD", label: "no_one_in_shot", logo: "match", shape: "match", colour: "match" })] }], 1);
    expect(odd[0].takes[0].moments[0]).not.toHaveProperty("detail");
  });
});
