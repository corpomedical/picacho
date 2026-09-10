import { describe, expect, it } from "vitest";
import { buildSetShotPrompt } from "./set-shot-prompt";
import { SET_DIRECTION_MAX_CHARS } from "./set-config";

// The server-built prompt for a still in a Set. What it must always say is
// what makes the sketch a layout and the character photos the only face.

describe("buildSetShotPrompt", () => {
  const p = buildSetShotPrompt({ description: "Rain-dark cobbles under amber lamps.", direction: "She looks back over her shoulder." });

  it("asks for the sketch's composition — the one thing the pipeline otherwise forbids copying", () => {
    expect(p).toMatch(/Match its camera position, lens, framing, horizon/);
  });

  it("takes identity only from the character photos, never the grey figure", () => {
    expect(p).toMatch(/take the person's face, hair and features only from the character photos/);
  });

  it("carries the set's description and the person's direction", () => {
    expect(p).toContain("Rain-dark cobbles under amber lamps.");
    expect(p).toContain("In this frame: She looks back over her shoulder.");
  });

  it("works with no direction, and bounds a long one", () => {
    expect(buildSetShotPrompt({ description: "d", direction: "" })).not.toContain("In this frame");
    const long = buildSetShotPrompt({ description: "d", direction: "x".repeat(5000) });
    expect(long.length).toBeLessThan(1500);
    expect(long).toContain("x".repeat(SET_DIRECTION_MAX_CHARS));
  });

  it("stays far under the composer's 8,000-character prompt cap", () => {
    expect(buildSetShotPrompt({ description: "d".repeat(300), direction: "x".repeat(300) }).length).toBeLessThan(2000);
  });
});
