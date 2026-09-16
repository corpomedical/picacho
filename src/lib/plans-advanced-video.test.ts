import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { advancedVideoPlan } from "./plans";

// Start & end frames (and multi-image reference) are Studio-and-up. The
// rule was written out by hand in the server's gate, the composer's lock and
// the Angle Stage, each told to "keep in sync" with the others — and Helios,
// whose takes and films are all start-and-end-frame clips, did not check it
// at all: a take shot its end still, paid, and only then had its clip
// refused (2026-09-16). One function now, and everything that gates on it
// calls it.

describe("advancedVideoPlan", () => {
  it("opens Studio, Elite and admins; closes the rest", () => {
    expect(advancedVideoPlan("studio", false)).toBe(true);
    expect(advancedVideoPlan("elite", false)).toBe(true);
    for (const plan of ["none", "basic", "starter", "growth", null, undefined, "Studio"]) {
      expect(advancedVideoPlan(plan, false), String(plan)).toBe(false);
      expect(advancedVideoPlan(plan, true), `${String(plan)} as admin`).toBe(true);
    }
  });
});

describe("everything gated on it asks it", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

  it("the server's gate, the composer's lock and the Angle Stage", () => {
    expect(read("generations/actions.ts")).toContain("if (wantsAdvancedVideoOptions && !advancedVideoPlan(userPlan, isAdmin)) {");
    expect(read("generations/workspace-data.ts")).toContain("const advancedPlanActive = advancedVideoPlan(");
    expect(read("generations/angle-stage-config.ts")).toContain("return advancedVideoPlan(plan, isAdmin);");
  });

  it("Helios: a take and a film are refused before anything is shot, and the page is told", () => {
    const actions = read("sets/actions.ts");
    const take = actions.slice(actions.indexOf("export async function takeInSet("), actions.indexOf("// Delete\n"));
    const gate = take.indexOf("if (!advancedVideoPlan(access.plan, access.isAdmin)) return { error: SET_TAKE_NEEDS_PLAN };");
    expect(gate).toBeGreaterThan(-1);
    for (const later of ["finishedStillUrl(", "checkGenerationAllowance(", 'rateLimited(userId, "set-take"', "await shootInSet(", "runGeneration(fd)"]) {
      expect(take.indexOf(later), later).toBeGreaterThan(gate);
    }
    const film = read("sets/film-actions.ts");
    const check = film.slice(film.indexOf("export async function checkFilmCredits("), film.indexOf("export type TakeStatusRow"));
    expect(check.indexOf("if (!advancedVideoPlan(access.plan, access.isAdmin)) return { error: SET_TAKE_NEEDS_PLAN };")).toBeLessThan(
      check.indexOf("checkGenerationAllowance("),
    );
    expect(read("sets/data.ts")).toContain("takesOn: advancedVideoPlan(access.plan, access.isAdmin),");
    expect(read("../app/app/sets/[id]/page.tsx")).toContain("takesOn={data.takesOn}");
  });

  it("no one writes the pair out by hand again", () => {
    const root = join(__dirname, "..");
    const hits: string[] = [];
    // A line joining "studio" and "elite" with || or && — and naming no
    // other plan, which a list of every plan does.
    const pair = /["']studio["']\s*(\|\||&&)[^\n]*["']elite["']|["']elite["']\s*(\|\||&&)[^\n]*["']studio["']/;
    const byHand = (text: string) => text.split("\n").some((line) => pair.test(line) && !/["'](basic|starter|growth)["']/.test(line));
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && byHand(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    expect(byHand('return plan === "studio" || plan === "elite";')).toBe(true);
    expect(byHand('if (userPlan !== "studio" && userPlan !== "elite" && !isAdmin)')).toBe(true);
    expect(byHand('p === "basic" || p === "starter" || p === "growth" || p === "studio" || p === "elite"')).toBe(false);
    walk(root);
    expect(hits.map((p) => p.slice(root.length + 1))).toEqual(["lib/plans.ts"]);
  });
});
