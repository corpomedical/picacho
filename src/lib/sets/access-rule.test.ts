import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setsAccessForProfile } from "./access-rule";
import { SETS_OPEN_TO_PLANS } from "./set-config";
import { SETS_NOT_OPEN, SETS_SUSPENDED } from "./messages";

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
    expect(access).not.toMatch(/"suspended"|setsEligible\(/);
  });

  it("the finisher applies it to every build's owner", () => {
    expect(read("finisher.ts")).toContain("setsAccessForProfile(profileOf.get(userId))");
  });
});
