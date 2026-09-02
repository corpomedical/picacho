import { describe, expect, it, vi } from "vitest";
import { guardedRead } from "./read-guard";

// The contract the workspace first-paint path leans on: clean reads pass
// through, one transient failure is absorbed, a persistent failure throws
// with the read's name and the real message, and .single()'s "zero rows"
// stays a null-data answer (not an error) exactly as every caller already
// assumes.

describe("guardedRead", () => {
  it("returns data untouched on a clean read", async () => {
    const query = vi.fn().mockResolvedValue({ data: [{ id: "c1" }], error: null });
    await expect(guardedRead("characters", query)).resolves.toEqual([{ id: "c1" }]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("absorbs a single transient failure with one retry", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "connection reset" } })
      .mockResolvedValueOnce({ data: { plan: "growth" }, error: null });
    await expect(guardedRead("profile", query)).resolves.toEqual({ plan: "growth" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("throws a labeled error naming the read when the retry also fails", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "upstream timeout" } });
    await expect(guardedRead("characters", query)).rejects.toThrow(
      "[first-paint] characters read failed twice: upstream timeout",
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("treats PGRST116 (zero rows) as null data, immediately and without retry", async () => {
    const query = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
    });
    await expect(guardedRead("profile", query)).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("honors PGRST116 on the retry attempt too", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "connection reset" } })
      .mockResolvedValueOnce({ data: null, error: { message: "no rows", code: "PGRST116" } });
    await expect(guardedRead("profile", query)).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
