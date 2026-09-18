import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { characterVideoLock, isFirstFrameLane } from "./face-lock";
import { MODEL_CAPABILITIES } from "./send-plan";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

describe("isFirstFrameLane", () => {
  it("follows the capability matrix, not a list of its own", () => {
    for (const [id, caps] of Object.entries(MODEL_CAPABILITIES)) {
      expect(isFirstFrameLane(id)).toBe(caps.identity.mechanism === "first-frame");
    }
  });

  it("knows the lanes whose frame one is a photo", () => {
    expect(isFirstFrameLane("kling-o3")).toBe(true);
    expect(isFirstFrameLane("kling-2.5")).toBe(true);
    expect(isFirstFrameLane("kling-o3-pro")).toBe(false);
    expect(isFirstFrameLane("gemini-omni")).toBe(false);
  });

  it("says no for a model it has never heard of", () => {
    expect(isFirstFrameLane("not-a-model")).toBe(false);
  });
});

describe("characterVideoLock", () => {
  it("gives a characterless render no lock — there is no face to judge", () => {
    expect(
      characterVideoLock({ hasCharacter: false, modelId: "kling-o3-pro", threshold: 70, refundOn: true }),
    ).toBeUndefined();
  });

  it("judges an elements lane from the first frame on", () => {
    expect(
      characterVideoLock({ hasCharacter: true, modelId: "kling-o3-pro", threshold: 70, refundOn: false }),
    ).toEqual({ threshold: 70, refund: false });
  });

  it("skips frame one on a first-frame lane, where its face is already known", () => {
    expect(
      characterVideoLock({ hasCharacter: true, modelId: "kling-o3", threshold: 70, refundOn: false }),
    ).toEqual({ threshold: 70, refund: false, skipFirst: true });
  });

  it("refunds a miss only when the switch is on", () => {
    expect(
      characterVideoLock({ hasCharacter: true, modelId: "minimax-h3", threshold: 70, refundOn: true })?.refund,
    ).toBe(true);
    expect(
      characterVideoLock({ hasCharacter: true, modelId: "minimax-h3", threshold: 70, refundOn: false })?.refund,
    ).toBe(false);
  });

  it("never refunds with the gate off: a threshold of 0 is no bar at all", () => {
    expect(
      characterVideoLock({ hasCharacter: true, modelId: "minimax-h3", threshold: 0, refundOn: true }),
    ).toEqual({ threshold: 0, refund: false });
  });
});

describe("wiring", () => {
  it("every character video path hands its lock to saveVideoJob", () => {
    const actions = read("actions.ts");
    const single = actions.indexOf("await saveVideoJob({\n          generationId: placeholder.id");
    expect(single).toBeGreaterThan(-1);
    expect(actions.slice(single, single + 1200)).toContain("identityLock: characterVideoLock({");
    const angle = actions.indexOf("await saveVideoJob({\n              generationId: rowId");
    expect(angle).toBeGreaterThan(-1);
    expect(actions.slice(angle, angle + 900)).toContain("identityLock: angleFaceLock");
  });

  it("a frame with no face in it is never counted as a miss", () => {
    const runner = read("job-runner.ts");
    expect(runner).toContain("v !== null && !v.unusable && v.faceVisible !== false;");
    // With no face anywhere, the row records no score rather than a number
    // about the back of someone's head.
    expect(runner).toContain("const recorded = lock\n              ? worstScore");
    const scorer = read("providers/openai.ts");
    expect(scorer).toContain("never because less of the face can be seen");
    expect(scorer).toContain("faceVisible: parsed.faceVisible !== false,");
    // The image gate reads a faceless picture as "not measured", which it passes.
    expect(read("identity-gate-run.ts")).toContain("if (verdict.faceVisible === false) {");
  });

  it("the runner does not read frame one when the lock says skip it", () => {
    const runner = read("job-runner.ts");
    expect(runner).toContain("lock.skipFirst\n                  ? Promise.resolve(null)");
  });
});
