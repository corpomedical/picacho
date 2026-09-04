import { describe, expect, it } from "vitest";
import { pageBounds, pageHref, pageRange, parsePage, takePage } from "./pagination";

describe("parsePage", () => {
  it("reads a real page number", () => {
    expect(parsePage("2")).toBe(2);
    expect(parsePage("17")).toBe(17);
  });
  it("treats anything malformed as page 1 rather than erroring", () => {
    for (const raw of [undefined, "", "0", "-3", "abc", "1.5", "1e3", " 2", "2x"]) {
      expect(parsePage(raw)).toBe(1);
    }
  });
  it("takes the first value when a param repeats", () => {
    expect(parsePage(["3", "9"])).toBe(3);
  });
  it("clamps a page number far past anything real", () => {
    expect(parsePage("99999999")).toBe(10_000);
  });
});

describe("pageRange and takePage", () => {
  it("asks for one extra row so the next page can be detected without a count", () => {
    expect(pageRange(1, 48)).toEqual({ from: 0, to: 48 });
    expect(pageRange(2, 48)).toEqual({ from: 48, to: 96 });
  });
  it("drops the probe row and reports there is more", () => {
    const rows = Array.from({ length: 49 }, (_, i) => i);
    const page = takePage(rows, 48);
    expect(page.rows).toHaveLength(48);
    expect(page.rows[47]).toBe(47);
    expect(page.hasNext).toBe(true);
  });
  it("reports no next page on a short read", () => {
    expect(takePage([1, 2, 3], 48)).toEqual({ rows: [1, 2, 3], hasNext: false });
  });
  it("reports no next page on an exactly-full read", () => {
    const rows = Array.from({ length: 48 }, (_, i) => i);
    expect(takePage(rows, 48).hasNext).toBe(false);
  });
});

describe("pageHref", () => {
  it("keeps the active filters — a next page that dropped them would be worse than none", () => {
    expect(pageHref("/app/history", { type: "video", outcome: "passed" }, 2)).toBe(
      "/app/history?type=video&outcome=passed&page=2",
    );
  });
  it("omits the param on page 1 so the first page has one canonical URL", () => {
    expect(pageHref("/app/history", { type: "video", page: "3" }, 1)).toBe("/app/history?type=video");
    expect(pageHref("/app/history", {}, 1)).toBe("/app/history");
  });
  it("never carries the old page number through", () => {
    expect(pageHref("/app/media", { page: "5" }, 6)).toBe("/app/media?page=6");
  });
});

describe("pageBounds", () => {
  it("numbers the rows a person is looking at", () => {
    expect(pageBounds(1, 48, 48)).toEqual({ first: 1, last: 48 });
    expect(pageBounds(2, 48, 12)).toEqual({ first: 49, last: 60 });
  });
  it("says nothing rather than 1-0 on an empty page", () => {
    expect(pageBounds(3, 48, 0)).toEqual({ first: 0, last: 96 });
  });
});
