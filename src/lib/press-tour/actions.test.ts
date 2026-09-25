import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// actions.ts is the "use server" door onto card-service.ts. Its imports use
// the "@/" alias (vitest has none), so it is read as source, like the
// other doors' wiring tests. What it must hold: every action goes through
// ONE door, the door asks who is calling (switch, access, confirmed email)
// before it hands out the service-role client, and the consent's language
// and address come from the server, never from the page.

const source = readFileSync(join(__dirname, "actions.ts"), "utf8");
const code = source
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");

const ACTIONS = [
  "importProductFromUrl",
  "reservePressUploads",
  "createProductFromUploads",
  "recordConsent",
  "confirmProductCard",
  "importBrandKit",
  "saveBrandKit",
] as const;

/** The text of one top-level function: from its head to the next top-level declaration. */
function body(head: string): string {
  const start = code.indexOf(head);
  expect(start, head).toBeGreaterThan(-1);
  const rest = code.slice(start + head.length);
  const next = rest.search(/\n(?:export )?(?:async )?function |\n\/\/ -{10}/);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("actions.ts, the Press Tour door", () => {
  it("is a server-actions file whose only exports are async functions (and types)", () => {
    expect(source.startsWith('"use server";\n')).toBe(true);
    const exported = [...code.matchAll(/^export\s+(\S+(?:\s+\S+)?)/gm)].map((m) => m[1]);
    for (const e of exported) expect(e === "async function" || e.startsWith("type ")).toBe(true);
    const names = [...code.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]).sort();
    expect(names).toEqual([...ACTIONS].sort());
  });

  it("every action goes through the one door and nothing else runs first", () => {
    for (const name of ACTIONS) {
      const fn = body(`export async function ${name}(`);
      const opens = fn.search(/\): Promise<[^\n]*\{\n/);
      expect(opens, name).toBeGreaterThan(-1);
      const firstStatement = fn.slice(fn.indexOf("{\n", opens) + 2).trim();
      expect(firstStatement.startsWith("return behindDoor("), name).toBe(true);
    }
  });

  it("the door asks who is calling before the service role is handed out", () => {
    const d = body("async function door(");
    const who = d.indexOf("await pressTourCaller(supabase, data.user)");
    const stop = d.indexOf("if (who.error !== null) return who;");
    const admin = d.indexOf("createAdminClient()");
    expect(who).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(who);
    expect(admin).toBeGreaterThan(stop);
    // The person's own session, read on the server.
    expect(d).toContain("const supabase = await createClient();");
    expect(d).toContain("await supabase.auth.getUser()");
    // The shared limiter (fails closed) and its salted keys.
    expect(d).toContain("rateLimited, hashKey: hashedRateKey");
    expect(code).toContain('import { hashedRateKey, rateLimited } from "@/lib/rate-limit";');
  });

  it("a failure inside the door or behind it is one plain sentence, never the raw error", () => {
    const guard = body("async function behindDoor<");
    expect(guard).toContain("const d = await door();");
    expect(guard).toContain("if (d.error !== null) return d;");
    expect(guard).toContain('return { error: PRESS_TOUR_FAILED, code: "unavailable" };');
    expect(guard.indexOf("try {")).toBeLessThan(guard.indexOf("await door()"));
  });

  it("the consent's language and address are the server's, not the page's", () => {
    const consent = body("export async function recordConsent(");
    expect(consent).toContain("await Promise.all([getLocale(), callerIp()])");
    expect(consent).toContain("keepConsent(deps, caller, input, { locale, ip })");
    const input = consent.slice(0, consent.indexOf("): Promise<"));
    expect(input).not.toMatch(/\blocale\b|\bip\b|notice|method/);
  });

  it("no action reaches a provider, storage or a table itself: card-service.ts does, after its checks", () => {
    const actionsOnly = ACTIONS.map((name) => body(`export async function ${name}(`)).join("\n");
    expect(actionsOnly).not.toMatch(/\.from\(|\.storage|fetch\(|safeFetch|readProductDna|readLabelText|createAdminClient/);
  });
});
