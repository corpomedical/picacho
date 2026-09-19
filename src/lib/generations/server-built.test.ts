import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serverBuiltFrames, withServerBuiltFrames } from "./server-built";

// Helios's takes and films opened to every paid plan (2026-09-19 "Open to
// all plans") while the composer's storyboard lane stayed Studio-and-up:
// the frames gate tells them apart by a mark held in server memory, never
// by anything a request carries.

describe("the server-built mark", () => {
  it("is seen inside the call that set it, through awaits, and nowhere else", async () => {
    expect(serverBuiltFrames()).toBe(false);
    const inside = withServerBuiltFrames(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return serverBuiltFrames();
    });
    expect(serverBuiltFrames()).toBe(false);
    expect(await inside).toBe(true);
    expect(serverBuiltFrames()).toBe(false);
  });
});

describe("the wiring, read as source", () => {
  const generations = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const sets = readFileSync(join(__dirname, "../sets/actions.ts"), "utf8");
  const films = readFileSync(join(__dirname, "../sets/film-actions.ts"), "utf8");

  it("lets a server-built take through the frames gate, and multi-image reference never", () => {
    expect(generations).toContain("const framesAreServerBuilt = serverBuiltFrames() && referencePhotoPaths.length === 0;");
    expect(generations).toContain("if (wantsAdvancedVideoOptions && !advancedVideoPlan(userPlan, isAdmin) && !framesAreServerBuilt) {");
  });

  it("marks exactly the take's own render, after its own plan check", () => {
    expect(sets).toContain("const clip = await withServerBuiltFrames(() => runGeneration(fd));");
    expect(sets.split("withServerBuiltFrames(").length - 1).toBe(1); // the one call, nowhere else
    expect(sets).toContain("if (!setTakesEligible(access.plan, access.isAdmin)) return { error: SET_TAKE_NEEDS_PLAN };");
    expect(films).toContain("if (!setTakesEligible(access.plan, access.isAdmin)) return { error: SET_TAKE_NEEDS_PLAN };");
    // The old Studio-and-up rule is out of the sets lane entirely.
    expect(sets).not.toContain("advancedVideoPlan");
    expect(films).not.toContain("advancedVideoPlan");
  });
});
