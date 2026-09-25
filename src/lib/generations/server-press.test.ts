import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serverPress, withServerPress } from "./server-press";

// A Helios press as runGeneration needs to know it (operator, 2026-09-25:
// "GO ahead" on Cut 1): its real start, for the request's 300 s, and that a
// take's renders skip the 3-second cooldown. Held in server memory by the
// Helios actions, never read from a form field.

describe("the press held in server memory", () => {
  it("is seen inside the call that set it, through awaits, and nowhere else", async () => {
    expect(serverPress()).toBeNull();
    const press = { startedAt: 1_000, skipCooldown: true };
    const inside = withServerPress(press, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return serverPress();
    });
    expect(serverPress()).toBeNull();
    expect(await inside).toEqual(press);
    expect(serverPress()).toBeNull();
  });
});

describe("runGeneration reads it, and nothing a request carries (generations/actions.ts)", () => {
  const src = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const run = src.slice(src.indexOf("export async function runGeneration("), src.indexOf("\nexport async function", src.indexOf("export async function runGeneration(") + 10));

  it("starts its clock on the press's first line when there is one", () => {
    const body = run.slice(run.indexOf("{") + 1).trimStart();
    expect(body.startsWith("const sendStartedAt = Math.min(Date.now(), serverPress()?.startedAt ?? Number.POSITIVE_INFINITY);")).toBe(true);
    expect(src).not.toContain("requestStartedAt");
    expect(run).toContain("elapsedMs: Date.now() - sendStartedAt,");
    expect(run).toContain("deadlineAt: sendStartedAt + REPEAT_FOLLOW_DEADLINE_MS");
    expect(run).toContain("deadlineAt: sendStartedAt + OPENING_FRAME_DEADLINE_MS");
  });

  it("skips the cooldown only for a Helios take, on both of its allowance checks", () => {
    const cooldown = run.indexOf("const cooldown = serverPress()?.skipCooldown ? { skipCooldown: true } : undefined;");
    expect(cooldown).toBeGreaterThan(-1);
    expect(cooldown).toBeLessThan(run.indexOf("checkGenerationAllowance("));
    const calls = run.match(/checkGenerationAllowance\([^)]*\)/g) ?? [];
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c).toMatch(/creditWeight, cooldown\)$/);
    // The repeat follower's pins stay as they were (repeat-send.test.ts).
    expect(run).toContain("if (allowance.error) return (await followRepeat()) ?? { error: allowance.error };");
    expect(run).toContain("if (reAllowance.error) return (await followRepeat()) ?? { error: reAllowance.error };");
  });

  it("never takes either from a form field", () => {
    expect(src).not.toMatch(/formData\.get\("skip_cooldown"\)|formData\.get\("press"\)|formData\.get\("started_at"\)/);
    expect(src).toContain('import { serverPress } from "@/lib/generations/server-press";');
  });
});

describe("the Helios actions set it around their own work (sets/actions.ts)", () => {
  const sets = readFileSync(join(__dirname, "../sets/actions.ts"), "utf8");
  const bodyAfter = (sig: string) => {
    const at = sets.indexOf(sig);
    expect(at, sig).toBeGreaterThan(-1);
    return sets.slice(sets.indexOf("{\n", at) + 2).trimStart();
  };

  it("starts each press's clock on its first line", () => {
    expect(bodyAfter("export async function shootInSet(").startsWith("const startedAt = Date.now();")).toBe(true);
    expect(bodyAfter("export async function takeInSet(").startsWith("const startedAt = Date.now();")).toBe(true);
  });

  it("keeps a still's cooldown and lifts a take's", () => {
    const shoot = sets.slice(sets.indexOf("export async function shootInSet("), sets.indexOf("async function shootStill("));
    const take = sets.slice(sets.indexOf("export async function takeInSet("), sets.indexOf("async function takeWork("));
    expect(shoot).toContain("withServerPress({ startedAt, skipCooldown: false }");
    expect(take).toContain("withServerPress({ startedAt, skipCooldown: true }");
    expect(sets.split("withServerPress(").length - 1).toBe(2);
  });
});
