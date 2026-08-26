import { describe, expect, it } from "vitest";
import {
  ANOTHER_SHOT_ANGLE_TAIL,
  buildAnotherShotPrompt,
  trimUnfilledAnotherShotScaffold,
  isAnotherShotEligible,
} from "./another-shot";
import { isRenderableUrl } from "../media/url";

// Incident-replay style, same as send-plan.test.ts: each case pins a way
// this prefill could lie or misfire. The operator's bar for this feature
// was explicit ("it must work 1000% no mistakes"), and the launch-night
// renders taught two lessons now pinned here: the scaffold must forbid
// framing-copying, and the set/wardrobe must ride as concrete text
// (continuity notes), not just pixels.

const NOTES = "Set: courtside seats, warm arena lights.\nWardrobe: cream silk blouse, gold bracelet.";

describe("buildAnotherShotPrompt", () => {
  it("appends the scaffold and ends ready for the angle", () => {
    const built = buildAnotherShotPrompt("Eva courtside at a Lakers game");
    expect(built.startsWith("Eva courtside at a Lakers game\n\n")).toBe(true);
    expect(built.endsWith(ANOTHER_SHOT_ANGLE_TAIL)).toBe(true);
  });

  it("always forbids repeating the previous framing (the launch-night failure)", () => {
    for (const built of [
      buildAnotherShotPrompt("Eva at the cafe"),
      buildAnotherShotPrompt("Eva at the cafe", NOTES),
    ]) {
      expect(built).toContain("do not repeat the previous shot's framing");
    }
  });

  it("embeds the continuity notes verbatim when provided", () => {
    const built = buildAnotherShotPrompt("Eva courtside", NOTES);
    expect(built).toContain(NOTES);
    expect(built).toContain("Rebuild the same set and wardrobe exactly:");
    expect(built.endsWith(ANOTHER_SHOT_ANGLE_TAIL)).toBe(true);
  });

  it("null/empty notes degrade to the plain scaffold (describe failures never block)", () => {
    expect(buildAnotherShotPrompt("Eva", null)).toBe(buildAnotherShotPrompt("Eva"));
    expect(buildAnotherShotPrompt("Eva", "   ")).toBe(buildAnotherShotPrompt("Eva"));
  });

  it("with an empty original, starts directly at the scaffold (no leading blank lines)", () => {
    const built = buildAnotherShotPrompt("");
    expect(built.startsWith("The attached image is the previous shot")).toBe(true);
  });
});

describe("trimUnfilledAnotherShotScaffold", () => {
  it("strips only the dangling angle phrase, keeping the rebuild instruction", () => {
    const built = buildAnotherShotPrompt("Eva courtside", NOTES);
    const trimmed = trimUnfilledAnotherShotScaffold(built);
    expect(trimmed.endsWith("do not repeat the previous shot's framing.")).toBe(true);
    expect(trimmed).toContain(NOTES);
    expect(trimmed).not.toContain(ANOTHER_SHOT_ANGLE_TAIL.trim());
  });

  it("strips it even with stray trailing whitespace", () => {
    const built = buildAnotherShotPrompt("Eva at the cafe") + "   \n ";
    expect(trimUnfilledAnotherShotScaffold(built).endsWith("framing.")).toBe(true);
  });

  it("keeps a filled-in angle byte-for-byte", () => {
    const filled = buildAnotherShotPrompt("Eva at the cafe", NOTES) + "low angle from behind her";
    expect(trimUnfilledAnotherShotScaffold(filled)).toBe(filled);
  });

  it("leaves ordinary prompts untouched", () => {
    expect(trimUnfilledAnotherShotScaffold("A dog on the beach")).toBe("A dog on the beach");
    expect(trimUnfilledAnotherShotScaffold("")).toBe("");
  });
});

describe("isAnotherShotEligible", () => {
  const eligible = {
    content_type: "image",
    status: "succeeded",
    result_url: "/api/media/generated-images/u/x.png?v=abc",
  };

  it("accepts a finished image with a media-route result", () => {
    expect(isAnotherShotEligible(eligible)).toBe(true);
  });

  it("accepts an absolute http result (older rows)", () => {
    expect(isAnotherShotEligible({ ...eligible, result_url: "https://x.supabase.co/f.png" })).toBe(true);
  });

  it("rejects videos — Continue this clip owns that surface", () => {
    expect(isAnotherShotEligible({ ...eligible, content_type: "video" })).toBe(false);
  });

  it("rejects unfinished or failed generations", () => {
    expect(isAnotherShotEligible({ ...eligible, status: "failed" })).toBe(false);
    expect(isAnotherShotEligible({ ...eligible, status: "drafted" })).toBe(false);
  });

  it("rejects rows with nothing renderable", () => {
    expect(isAnotherShotEligible({ ...eligible, result_url: null })).toBe(false);
    expect(isAnotherShotEligible({ ...eligible, result_url: "data:image/png;base64,x" })).toBe(false);
  });

  it("matches isRenderableUrl's verdict (the server-only original it mirrors)", () => {
    for (const url of [
      "/api/media/generated-images/u/x.png?v=abc",
      "https://x.supabase.co/f.png",
      "http://old.example/f.png",
      "data:image/png;base64,x",
      "",
      null,
    ]) {
      expect(isAnotherShotEligible({ content_type: "image", status: "succeeded", result_url: url })).toBe(
        Boolean(isRenderableUrl(url)),
      );
    }
  });
});
