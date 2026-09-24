import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// "The 3d render is completely white" (2026-09-24): a TRELLIS car with its
// paint baked in drew plain white on the Helios stage in Chrome. three.js's
// GLTFLoader unpacks a model's embedded textures into blob: URLs and, in
// Chromium, fetches them — so connect-src decides, not img-src. Reproduced
// on the real stage with the live policy (white) and with blob: added
// (painted).
describe("the page policy lets a 3D model's paint load", () => {
  const middleware = readFileSync(join(__dirname, "../../../middleware.ts"), "utf8");
  const directive = (name: string) => middleware.split("\n").find((l) => l.includes(`\`${name} `)) ?? "";

  it("allows blob: fetches (Chromium's texture path) and blob: images (Safari's)", () => {
    expect(directive("connect-src")).toMatch(/connect-src 'self' blob:/);
    expect(directive("img-src")).toContain("blob:");
  });
});
