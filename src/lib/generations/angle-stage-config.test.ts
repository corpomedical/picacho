import { describe, expect, it } from "vitest";
import {
  angleStageEligible,
  ANGLE_STAGE_MONTHLY_LIMITS,
  MAX_STAGE_FRAMES_PER_TAKE,
  stageProxyPath,
  stageFramesPrefix,
} from "./angle-stage-config";

describe("angle stage config", () => {
  it("eligibility mirrors the frames lane's server gate exactly", () => {
    // actions.ts refuses frames for anyone but studio/elite/admin — a stage
    // whose render the server would refuse must not open.
    expect(angleStageEligible("studio", false)).toBe(true);
    expect(angleStageEligible("elite", false)).toBe(true);
    expect(angleStageEligible("none", true)).toBe(true);
    for (const plan of ["none", "basic", "starter", "growth"]) {
      expect(angleStageEligible(plan, false), `${plan} must not open the stage`).toBe(false);
    }
  });

  it("monthly limits are zero exactly where the stage is closed", () => {
    for (const [plan, limit] of Object.entries(ANGLE_STAGE_MONTHLY_LIMITS)) {
      expect(limit > 0, `${plan} cap vs eligibility`).toBe(angleStageEligible(plan, false));
    }
  });

  it("the per-take frame cap is small and positive", () => {
    expect(MAX_STAGE_FRAMES_PER_TAKE).toBeGreaterThan(1);
    expect(MAX_STAGE_FRAMES_PER_TAKE).toBeLessThanOrEqual(10);
  });

  it("storage paths sit under the owner's folder — the buckets' RLS keys on it", () => {
    expect(stageProxyPath("u1", "g1")).toBe("u1/proxies/g1.glb");
    expect(stageFramesPrefix("u1", "g1")).toBe("u1/stage/g1");
  });
});
