import { describe, expect, it } from "vitest";
import { latestSetId } from "./latest-set";

// Which set the Sets home's Set chip starts on (Helios Cut 3, step 6b).

type Row = Parameters<typeof latestSetId>[0][number];
const row = (id: string, status: Row["status"], lastShotAt: string | null = null): Row => ({ id, status, lastShotAt });

describe("latestSetId", () => {
  it("the ready set with the newest still wins, wherever it is in the list", () => {
    const sets = [
      row("newest-built", "ready", "2026-09-20T10:00:00.000+00:00"),
      row("shot-yesterday", "ready", "2026-09-25T18:30:00.5+00:00"),
      row("oldest", "ready", "2026-09-25T18:30:00.123+00:00"),
    ];
    expect(latestSetId(sets)).toBe("shot-yesterday");
  });

  it("with no stills anywhere, the newest ready set (the list is newest first)", () => {
    expect(latestSetId([row("building", "building"), row("a", "ready"), row("b", "ready")])).toBe("a");
    // A ready set with a still beats a newer one without.
    expect(latestSetId([row("a", "ready"), row("b", "ready", "2026-09-01T00:00:00Z")])).toBe("b");
  });

  it("never picks a set still building or one that failed", () => {
    const sets = [
      row("building", "building", "2026-09-26T00:00:00Z"),
      row("failed", "failed", "2026-09-26T00:00:00Z"),
      row("ready", "ready", "2026-09-01T00:00:00Z"),
    ];
    expect(latestSetId(sets)).toBe("ready");
    expect(latestSetId([row("building", "building"), row("failed", "failed")])).toBeNull();
  });

  it("no sets: a new place", () => {
    expect(latestSetId([])).toBeNull();
  });

  it("a date that doesn't read counts as no still", () => {
    expect(latestSetId([row("a", "ready", "not a date"), row("b", "ready", "2026-09-02T00:00:00Z")])).toBe("b");
    expect(latestSetId([row("a", "ready", "not a date"), row("b", "ready")])).toBe("a");
  });
});
