import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The sheet is the app's most repeated object, and cn() cannot resolve
// conflicting utilities — so the rules that keep one definition honest are
// pinned here rather than left to review.
const src = readFileSync("src/components/ui/card.tsx", "utf8");

describe("the Card sheet", () => {
  it("keeps padding out of the base class, so a pad never fights a baked-in one", () => {
    const base = src.split('"rounded-control')[1].split('"')[0];
    expect(base).not.toMatch(/\bp-\d/);
  });

  it("ships one elevation, and it is the two-layer lift", () => {
    const shadows = src.match(/shadow-\[[^\]]+\]/g) ?? [];
    expect(shadows).toHaveLength(1);
    expect(shadows[0]).toContain("0_16px_40px_-24px");
  });

  it("offers exactly the four paddings the app uses", () => {
    const pads = src.split("const PADS = {")[1].split("} as const")[0];
    expect(pads).toContain('none: ""');
    expect(pads).toContain('sm: "p-3"');
    expect(pads).toContain('md: "p-6"');
    expect(pads).toContain('lg: "p-8"');
  });
});
