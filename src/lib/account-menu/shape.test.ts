import { describe, expect, it } from "vitest";
import { SEGMENT_COUNT, creditSegments, menuInitial, menuStatus, rendersFor } from "./shape";

const count = (segs: string[], kind: string) => segs.filter((s) => s === kind).length;

describe("creditSegments", () => {
  it("always draws the full row", () => {
    for (const [l, lim, x] of [
      [184, 280, 40],
      [0, 0, 0],
      [0, 280, 0],
      [3, 10_000, 3],
      [10_000, 10_000, 0],
      [0, 0, 500],
    ]) {
      expect(creditSegments(l, lim, x)).toHaveLength(SEGMENT_COUNT);
    }
  });

  it("puts plan left, then spent, then extra, in proportion", () => {
    const segs = creditSegments(184, 280, 40);
    expect(segs.join(",")).toMatch(/^(plan,)+(used,)+(extra,?)+$/);
    // 184/320 of 16 ≈ 9.2, 96/320 ≈ 4.8, 40/320 = 2
    expect(count(segs, "plan")).toBe(9);
    expect(count(segs, "used")).toBe(5);
    expect(count(segs, "extra")).toBe(2);
  });

  it("keeps a sliver for any part that isn't zero", () => {
    const segs = creditSegments(3, 10_000, 3);
    expect(count(segs, "plan")).toBe(1);
    expect(count(segs, "extra")).toBe(1);
    expect(count(segs, "used")).toBe(SEGMENT_COUNT - 2);
  });

  it("an empty account is an empty track", () => {
    expect(new Set(creditSegments(0, 0, 0))).toEqual(new Set(["used"]));
    expect(new Set(creditSegments(0, 280, 0))).toEqual(new Set(["used"]));
  });

  it("extra credits alone fill the row", () => {
    expect(new Set(creditSegments(0, 0, 500))).toEqual(new Set(["extra"]));
  });
});

describe("rendersFor", () => {
  it("counts whole renders", () => {
    expect(rendersFor(224, 14)).toBe(16);
    expect(rendersFor(224, 27)).toBe(8);
    expect(rendersFor(0, 1)).toBe(0);
  });
  it("is null for a render not on offer", () => {
    expect(rendersFor(224, null)).toBeNull();
    expect(rendersFor(224, 0)).toBeNull();
  });
});

describe("menuStatus and menuInitial", () => {
  it("reads the plan's standing", () => {
    expect(menuStatus("none", null)).toBe("none");
    expect(menuStatus("starter", "active")).toBe("active");
    expect(menuStatus("starter", "past_due")).toBe("pastDue");
    expect(menuStatus("starter", "canceled")).toBe("ended");
    expect(menuStatus("growth", null)).toBe("granted");
  });
  it("takes the first letter", () => {
    expect(menuInitial(" wigly")).toBe("W");
    expect(menuInitial("")).toBe("?");
    expect(menuInitial(null)).toBe("?");
  });
});
