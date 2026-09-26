import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// campaign-actions.ts is the "use server" door onto campaign-service.ts.
// Its imports use the "@/" alias (vitest has none), so it is read as
// source, like the card door's wiring test (actions.test.ts). What it must
// hold: it implements the contract's names (campaign-types.ts
// CampaignActions), every action goes through ONE door, the door asks who
// is calling (switch, access, confirmed email) before any client is handed
// out. The cron is
// pinned here too: it answers only its secret and does nothing while Press
// Tour is off.

const repo = join(__dirname, "..", "..", "..");
const source = readFileSync(join(__dirname, "campaign-actions.ts"), "utf8");
const code = source
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");
const contract = readFileSync(join(__dirname, "campaign-types.ts"), "utf8");

const ACTIONS = [
  "planCampaign",
  "paintStills",
  "approveStill",
  "keepStill",
  "undoStill",
  "repaintStill",
  "getCampaign",
  "cancelCampaign",
] as const;

function body(head: string): string {
  const start = code.indexOf(head);
  expect(start, head).toBeGreaterThan(-1);
  const rest = code.slice(start + head.length);
  const next = rest.search(/\n(?:export )?(?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("campaign-actions.ts, the campaign door", () => {
  it("is a server-actions file whose only exports are async functions, named as the contract names them", () => {
    expect(source.startsWith('"use server";\n')).toBe(true);
    const exported = [...code.matchAll(/^export\s+(\S+(?:\s+\S+)?)/gm)].map((m) => m[1]);
    for (const e of exported) expect(e).toBe("async function");
    const names = [...code.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]).sort();
    expect(names).toEqual([...ACTIONS].sort());
    const iface = contract.slice(contract.indexOf("export interface CampaignActions {"));
    const promised = [...iface.matchAll(/^ {2}(\w+)\??\(input/gm)].map((m) => m[1]).sort();
    expect(promised).toEqual([...ACTIONS].sort());
  });

  it("every action goes through the one door and nothing else runs first", () => {
    for (const name of ACTIONS) {
      const fn = body(`export async function ${name}(`);
      const opens = fn.search(/\): Promise<[^\n]*\{\n/);
      expect(opens, name).toBeGreaterThan(-1);
      const first = fn.slice(fn.indexOf("{\n", opens) + 2).trim();
      expect(first.startsWith("return behindDoor("), name).toBe(true);
    }
  });

  it("the door asks who is calling before any client is handed out", () => {
    const d = body("async function door(");
    const who = d.indexOf("await pressTourCaller(supabase, data.user)");
    const stop = d.indexOf("if (who.error !== null) return { ok: false, error: who.error };");
    const deps = d.indexOf("campaignDeps(");
    expect(who).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(who);
    expect(deps).toBeGreaterThan(stop);
    expect(d).toContain("const supabase = await createClient();");
    expect(d).toContain("await supabase.auth.getUser()");
  });

  it("a failure is one plain sentence, never the raw error", () => {
    const guard = body("async function behindDoor<");
    expect(guard.indexOf("try {")).toBeLessThan(guard.indexOf("await door()"));
    expect(guard).toContain("return { ok: false, error: PRESS_TOUR_FAILED };");
  });

  it("a browser can only start a campaign from the door or Generate", () => {
    expect(body("function browserSource(")).toContain('source === "generate" ? "generate" : "door"');
    expect(body("export async function planCampaign(")).toContain("source: browserSource(input?.source)");
  });

  it("no action reaches a table, storage or a provider itself", () => {
    const actionsOnly = ACTIONS.map((name) => body(`export async function ${name}(`)).join("\n");
    expect(actionsOnly).not.toMatch(/\.from\(|\.storage|\.rpc\(|fetch\(|createAdminClient/);
  });
});

describe("the press cron", () => {
  const route = readFileSync(join(repo, "src", "app", "api", "cron", "press", "route.ts"), "utf8");

  it("runs every minute, behind the cron secret, and does nothing while Press Tour is off", () => {
    const crons = (JSON.parse(readFileSync(join(repo, "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons.find((c) => c.path === "/api/cron/press")?.schedule).toBe("* * * * *");
    expect(route).toContain("if (!secret || auth !== `Bearer ${secret}`) {");
    const unauthorized = route.indexOf("{ status: 401 }");
    const off = route.indexOf("if (!(await isPressTourEnabled(admin)))");
    const tick = route.indexOf("await pressTick(");
    expect(unauthorized).toBeGreaterThan(-1);
    expect(off).toBeGreaterThan(unauthorized);
    expect(tick).toBeGreaterThan(off);
    expect(route).toContain("export const maxDuration = 300;");
  });
});
