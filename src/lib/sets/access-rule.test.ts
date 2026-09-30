import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setsAccessForProfile } from "./access-rule";
import { SETS_OPEN_TO_PLANS } from "./set-config";
import { SETS_NOT_OPEN, SETS_PAYMENT_FAILED, SETS_PLAN_INACTIVE, SETS_SUSPENDED } from "./messages";

// The rule Sets apply to a profile (2026-09-11). The page's setsAccess and
// the finisher's check of each build's owner are the same function, so the
// finisher can never collect a build the person could not collect by
// opening the page.

describe("setsAccessForProfile", () => {
  it("lets an admin in, with the plan the profile carries", () => {
    expect(setsAccessForProfile({ plan: "starter", role: "admin", status: "active" })).toEqual({
      error: null,
      plan: "starter",
      isAdmin: true,
    });
    expect(setsAccessForProfile({ plan: null, role: "admin", status: null })).toEqual({ error: null, plan: "none", isAdmin: true });
  });

  it("keeps a suspended account out, admin or not, before anything else is asked", () => {
    expect(setsAccessForProfile({ plan: "elite", role: "admin", status: "suspended" })).toEqual({ error: SETS_SUSPENDED });
    expect(setsAccessForProfile({ plan: "none", role: "user", status: "suspended" })).toEqual({ error: SETS_SUSPENDED });
  });

  it("keeps an account on no plan out", () => {
    expect(setsAccessForProfile({ plan: "none", role: "user", status: "active" })).toEqual({ error: SETS_NOT_OPEN });
    expect(setsAccessForProfile({ plan: null, role: null, status: null })).toEqual({ error: SETS_NOT_OPEN });
  });

  it.skipIf(SETS_OPEN_TO_PLANS)("keeps every paid plan out while Sets are admins only", () => {
    for (const plan of ["basic", "starter", "growth", "studio", "elite"]) {
      expect(setsAccessForProfile({ plan, role: "user", status: "active" }), plan).toEqual({ error: SETS_NOT_OPEN });
    }
  });

  // 2026-09-30 (operator: "Fix both holes now"): the rule used to read the
  // plan's name alone, so an account whose card had failed kept Helios while
  // its credits were paused.
  it.skipIf(!SETS_OPEN_TO_PLANS)("pauses a paid plan whose payments aren't in good standing, and opens again when they are", () => {
    expect(setsAccessForProfile({ plan: "growth", role: "user", status: "active", plan_status: "past_due" })).toEqual({
      error: SETS_PAYMENT_FAILED,
    });
    for (const plan_status of ["canceled", "inactive"]) {
      expect(setsAccessForProfile({ plan: "starter", role: "user", status: "active", plan_status }), plan_status).toEqual({
        error: SETS_PLAN_INACTIVE,
      });
    }
    // "active", and no status at all (comped and pre-Stripe plans), are in good standing.
    for (const plan_status of ["active", null, undefined]) {
      expect(setsAccessForProfile({ plan: "starter", role: "user", status: "active", plan_status }), String(plan_status)).toEqual({
        error: null,
        plan: "starter",
        isAdmin: false,
      });
    }
    // Admins keep access for support; a suspension is still said first; no plan is still "part of the paid plans".
    expect(setsAccessForProfile({ plan: "elite", role: "admin", status: "active", plan_status: "past_due" })).toEqual({
      error: null,
      plan: "elite",
      isAdmin: true,
    });
    expect(setsAccessForProfile({ plan: "elite", role: "user", status: "suspended", plan_status: "past_due" })).toEqual({ error: SETS_SUSPENDED });
    expect(setsAccessForProfile({ plan: "none", role: "user", status: "active", plan_status: "canceled" })).toEqual({ error: SETS_NOT_OPEN });
  });

  it("reads a missing profile as not eligible, never as open", () => {
    for (const missing of [null, undefined, {}]) expect(setsAccessForProfile(missing)).toEqual({ error: SETS_NOT_OPEN });
  });

  it("takes only the exact word for an admin", () => {
    for (const role of ["Admin", "admin ", "owner", 1, true]) {
      expect(setsAccessForProfile({ plan: "none", role, status: "active" }), String(role)).toEqual({ error: SETS_NOT_OPEN });
    }
  });
});

describe("the page and the finisher ask the one rule (read as source)", () => {
  const read = (name: string) => readFileSync(join(__dirname, name), "utf8");

  it("setsAccess applies it and keeps no copy of its own", () => {
    const access = read("access.ts");
    expect(access).toContain("setsAccessForProfile(profile)");
    // It reads the plan's payment standing for the rule (2026-09-30).
    expect(access).toMatch(/select\("plan, plan_status, role, status/);
    expect(access).not.toMatch(/"suspended"|setsEligible\(/);
  });

  it("the finisher applies it to every build's owner, before each tick, and keeps no copy of its own", () => {
    const finisher = read("finisher.ts");
    expect(finisher).toContain("const rule = setsAccessForProfile(profile);");
    // "suspended" appears only as the reason it logs, read off the rule's answer.
    expect(finisher).not.toMatch(/status\s*[!=]==\s*"suspended"|setsEligible\(/);
  });

  // The operator, 2026-09-29, opening Helios Studio to everyone: "make sure
  // users without plans do not get generations". Every Studio door that can
  // call a model or spend asks setsAccess (which keeps an account on no plan
  // out, above) before anything else, and refuses on its answer.
  it.each([
    ["editor-actions.ts", "askStudioAstra"],
    ["actions.ts", "shootInSet"],
    ["studio-actions.ts", "saveStudioScene"],
    ["studio-actions.ts", "loadStudioScene"],
    // Blender (Cycles) renders on a cloud GPU (2026-09-29): every door, before the admin gate.
    ["cycles-actions.ts", "reserveCyclesScene"],
    ["cycles-actions.ts", "renderCyclesInSet"],
    ["cycles-actions.ts", "readCyclesRender"],
    // Video with your character (2026-09-30): every door, before Recast's own rule is asked.
    ["studio-recast-actions.ts", "reserveStudioRecast"],
    ["studio-recast-actions.ts", "inspectStudioRecast"],
    ["studio-recast-actions.ts", "startStudioRecast"],
    ["studio-recast-actions.ts", "readStudioRecast"],
    // Real models in the Studio (2026-09-30): a new object's build, and keeping and signing its model files.
    ["model-actions.ts", "startNewModelBuild"],
    ["model-actions.ts", "pollNewModelBuild"],
    ["studio-model-actions.ts", "reserveStudioModel"],
    ["studio-model-actions.ts", "keepStudioModel"],
    ["studio-model-actions.ts", "studioModelUrls"],
  ])("%s's %s asks setsAccess first and stops on its refusal", (file, fn) => {
    const src = read(file);
    const start = src.indexOf(`export async function ${fn}(`);
    expect(start, fn).toBeGreaterThan(-1);
    const body = src.slice(src.indexOf("{", src.indexOf(")", start) + 1), start + 4000);
    const firstAwait = body.indexOf("await ");
    expect(body.slice(firstAwait, firstAwait + 30)).toContain("await setsAccess()");
    expect(body).toMatch(/if \(access\.error !== null\) return/);
  });
});
