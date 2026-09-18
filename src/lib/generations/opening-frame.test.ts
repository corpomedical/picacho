import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OPENING_FRAME_PAINT_MS,
  openingFrameApplies,
  openingFrameLogLine,
  openingFramePath,
  openingFramePrompt,
  openingFrameShape,
  timeForAnotherPaint,
  type OpeningFrameInput,
} from "./opening-frame";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

const qualifying: OpeningFrameInput = {
  flagOn: true,
  contentType: "video",
  modelId: "kling-o3",
  hasCharacterAnchor: true,
  hasAttachment: false,
  hasStoryboard: false,
  hasMultiReference: false,
  hasContinuation: false,
};

describe("openingFrameApplies", () => {
  it("applies to a one-character send on a first-frame lane", () => {
    expect(openingFrameApplies(qualifying)).toBe(true);
    for (const modelId of ["kling-2.5", "veo", "wan-turbo"]) {
      expect(openingFrameApplies({ ...qualifying, modelId })).toBe(true);
    }
  });

  it("never applies where frame one is not a picture we hand over", () => {
    for (const modelId of ["kling-o3-pro", "kling", "minimax-h3", "gemini-omni", "seedance", "seedance-2"]) {
      expect(openingFrameApplies({ ...qualifying, modelId })).toBe(false);
    }
  });

  it("stays off until the operator turns it on", () => {
    expect(openingFrameApplies({ ...qualifying, flagOn: false })).toBe(false);
  });

  it("leaves alone every frame one the person chose", () => {
    expect(openingFrameApplies({ ...qualifying, hasAttachment: true })).toBe(false);
    expect(openingFrameApplies({ ...qualifying, hasStoryboard: true })).toBe(false);
    expect(openingFrameApplies({ ...qualifying, hasMultiReference: true })).toBe(false);
    expect(openingFrameApplies({ ...qualifying, hasContinuation: true })).toBe(false);
  });

  it("needs a character and a video", () => {
    expect(openingFrameApplies({ ...qualifying, hasCharacterAnchor: false })).toBe(false);
    expect(openingFrameApplies({ ...qualifying, contentType: "image" })).toBe(false);
  });
});

describe("openingFrameShape", () => {
  it("paints the size GPT Image offers and cuts it to the clip's band", () => {
    expect(openingFrameShape("16:9")).toEqual({ size: "1536x1024", band: 16 / 9 });
    expect(openingFrameShape("9:16")).toEqual({ size: "1024x1536", band: 9 / 16 });
  });
});

describe("openingFramePrompt", () => {
  it("keeps the drafted shot whole and asks for one frame of it", () => {
    const shot = "Eva walks through a market at dawn, camera tracking left.";
    const prompt = openingFramePrompt(`  ${shot}  `);
    expect(prompt.endsWith(shot)).toBe(true);
    expect(prompt).toContain("the opening frame of the shot");
    expect(prompt).toContain("no collage, no split screen");
  });

  it("matches the person, never the photo it replaces", () => {
    const prompt = openingFramePrompt("x");
    expect(prompt).toContain("match their face, hair and features exactly");
    expect(prompt).toContain("do not copy that photo's pose, framing or background");
  });
});

describe("timeForAnotherPaint", () => {
  it("starts a paint only when it can finish before the deadline", () => {
    expect(timeForAnotherPaint(0, OPENING_FRAME_PAINT_MS)).toBe(true);
    expect(timeForAnotherPaint(1, OPENING_FRAME_PAINT_MS)).toBe(false);
  });
});

describe("openingFrameLogLine", () => {
  it("says what opened the clip, with the face scores it read", () => {
    expect(openingFrameLogLine({ used: true, scores: [62, 84], threshold: 70 })).toBe(
      "Opening frame made from the character's photo and face-checked (face 62, then 84).",
    );
    expect(openingFrameLogLine({ used: false, scores: [51, 58], threshold: 70, reason: "missed" })).toBe(
      "The opening frame missed the character's face (face 51, then 58), under 70 — the clip opens on the character's photo instead.",
    );
  });

  it("does not claim a check that never ran", () => {
    expect(openingFrameLogLine({ used: true, scores: [null], threshold: 70 })).toContain("could not run");
  });
});

describe("openingFramePath", () => {
  it("sits under the owner's folder, named for the generation and the paint", () => {
    expect(openingFramePath("u1", "g1", 2)).toBe("u1/opening-frames/g1-2.png");
  });
});

describe("wiring", () => {
  it("the send hands the frame-maker to the pipeline only when the policy says so", () => {
    const actions = read("actions.ts");
    const at = actions.indexOf("let makeOpeningFrameForSend");
    expect(at).toBeGreaterThan(-1);
    const block = actions.slice(at, at + 4000);
    expect(block).toContain("openingFrameApplies({");
    expect(block).toContain("flagOn: await flagOn(supabase, OPENING_FRAME_FLAG)");
    expect(actions).toContain("makeOpeningFrame: makeOpeningFrameForSend,");
    // Stored under a name finish() can find, and flagged on the job so it does.
    expect(block).toContain("openingFramePath(userId, placeholder.id, openingFramesPainted)");
    expect(actions).toContain("openingFrames: openingFramesPainted > 0,");
    const runner = read("job-runner.ts");
    expect(runner).toContain("if (jobRow?.payload?.openingFrames) {\n    await removeOpeningFrames(admin, userId, generationId);");
  });

  it("the pipeline opens on the frame, and says so, only when one was made", () => {
    const pipeline = read("pipeline.ts");
    expect(pipeline).toContain("characterAnchorImageUrl: openingFrameUrl ?? options.videoCharacterAnchorUrl,");
    expect(pipeline).toContain("openingFrame: openingFrameUrl !== null,");
    // Made once per reviewed prompt, not once per submit retry.
    expect(pipeline).toContain("const fresh = openingFrameFor !== reviewedPrompt;");
  });

  it("fal never reframes an opening frame on the lanes that reframe", () => {
    const fal = read("providers/fal.ts");
    expect(fal).toContain("if (!options.openingFrame) startImage = await reframeImage(");
    expect(fal).toContain("if (!options.openingFrame) {\n        o3ImageUrl = await reframeImage(");
  });
});
