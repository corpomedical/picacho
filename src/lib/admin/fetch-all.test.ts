import { describe, expect, it } from "vitest";
import { fetchIn } from "./fetch-all";

// The reports page looks up the renders and people behind up to 300 reports;
// every id rides in the request URL, so the lookup asks in slices.

describe("fetchIn", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

  it("asks in slices of 100 and returns every row", async () => {
    const asked: number[] = [];
    const rows = await fetchIn(ids(250), async (slice) => {
      asked.push(slice.length);
      return { data: slice.map((id) => ({ id })), error: null };
    });
    expect(asked).toEqual([100, 100, 50]);
    expect(rows).toHaveLength(250);
  });

  it("asks for each id once", async () => {
    const asked: string[] = [];
    await fetchIn(["a", "b", "a", "c", "b"], async (slice) => {
      asked.push(...slice);
      return { data: [], error: null };
    });
    expect(asked).toEqual(["a", "b", "c"]);
  });

  it("asks for nothing when there is nothing to find", async () => {
    let calls = 0;
    const rows = await fetchIn([], async () => {
      calls++;
      return { data: [], error: null };
    });
    expect(calls).toBe(0);
    expect(rows).toEqual([]);
  });

  it("leaves out a slice that failed instead of failing the page", async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      const rows = await fetchIn(ids(150), async (slice) =>
        slice[0] === "id-0" ? { data: null, error: { message: "boom" } } : { data: slice.map((id) => ({ id })), error: null },
      );
      expect(rows).toHaveLength(50);
    } finally {
      console.error = quiet;
    }
  });
});
