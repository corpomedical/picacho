import { describe, expect, it } from "vitest";
import { mean, median, nearestRank, p95 } from "./stats.mts";

describe("stats", () => {
  it("median of odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("p95 is nearest rank: the 86th of 90, the maximum of 10", () => {
    const ninety = Array.from({ length: 90 }, (_, i) => i + 1);
    expect(p95(ninety)).toBe(86);
    const ten = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
    expect(p95(ten)).toBe(100);
    expect(nearestRank(Array.from({ length: 20 }, (_, i) => i + 1), 0.95)).toBe(19);
    expect(p95([])).toBeNull();
  });

  it("mean skips nothing finite and returns null when empty", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBeNull();
  });
});
