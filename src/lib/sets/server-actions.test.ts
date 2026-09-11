import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Every export of a "use server" file is an action any browser can call
// with any arguments it likes (2026-09-11). The build tick takes a user id
// on trust — the finisher runs it for each build's owner, with no session —
// so it lives in build-tick.ts, which is not such a file. This fails the
// suite if it ever becomes callable: exported from a "use server" file, or
// replaced there by any export that takes a user id or does its work before
// checking who is asking. Read as source: a "use server" module cannot load
// here.

const SRC = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

// The directive counts only as the file's first statement; comments may
// come before it.
const USE_SERVER = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/;
const isUseServer = (file: string) => USE_SERVER.test(readFileSync(file, "utf8"));

type Action = { name: string; params: string; body: string };

/** Every exported async function, its parameter list, and its text up to the next export. */
function actionsOf(source: string): { actions: Action[]; others: string[] } {
  const actions: Action[] = [];
  const others: string[] = [];
  const exportAt = [...source.matchAll(/^export\b.*$/gm)];
  for (const [i, m] of exportAt.entries()) {
    const line = m[0];
    const fn = /^export async function (\w+)\(/.exec(line);
    if (!fn) {
      // Types are erased before anything runs; anything else is not allowed.
      if (!/^export (type|interface) /.test(line)) others.push(line);
      continue;
    }
    const open = (m.index ?? 0) + fn[0].length;
    let depth = 1;
    let close = open;
    while (depth > 0 && close < source.length) {
      const ch = source[close++];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    const end = i + 1 < exportAt.length ? (exportAt[i + 1].index ?? source.length) : source.length;
    actions.push({ name: fn[1], params: source.slice(open, close - 1), body: source.slice(close, end) });
  }
  return { actions, others };
}

const SESSION_CHECK = /\bsetsAccess\(\)|\.auth\.getUser\(\)/;
const WORK = /\bcreateAdminClient\(|\badvanceSetBuild\(|\bsubmitAstraJob\(|\brunGeneration\(|\.storage\b/;

describe('no "use server" file can hand out the build tick', () => {
  const allServerFiles = walk(SRC).filter(isUseServer);
  const setsServerFiles = walk(__dirname).filter(isUseServer);

  it("finds the Sets actions, and knows the tick and the finisher are not actions", () => {
    expect(setsServerFiles.map((f) => relative(__dirname, f))).toContain("actions.ts");
    expect(isUseServer(join(__dirname, "build-tick.ts"))).toBe(false);
    expect(isUseServer(join(__dirname, "finisher.ts"))).toBe(false);
    expect(readFileSync(join(__dirname, "build-tick.ts"), "utf8")).toContain("export async function advanceSetBuild(");
  });

  it("no \"use server\" file anywhere in src/ exports the tick, the finisher or the refusal log", () => {
    const offenders = allServerFiles
      .filter((f) => {
        const s = readFileSync(f, "utf8");
        return (
          /^export\b[^\n]*\b(advanceSetBuild|runSetsFinisher|logBriefRefusedByAstra)\b/m.test(s) ||
          /^export\s*\*\s*from\s*["'][^"']*(build-tick|finisher)["']/m.test(s)
        );
      })
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("every Sets action checks who is asking before it does anything, and takes no user id", () => {
    expect(setsServerFiles.length).toBeGreaterThan(0);
    for (const file of setsServerFiles) {
      const { actions, others } = actionsOf(readFileSync(file, "utf8"));
      const where = relative(__dirname, file);
      expect(others, `${where}: exports that are not async functions`).toEqual([]);
      for (const a of actions) {
        expect(a.params, `${where} ${a.name} takes a user id`).not.toMatch(/\buserId\b/);
        const checked = a.body.search(SESSION_CHECK);
        expect(checked, `${where} ${a.name} never checks the session`).toBeGreaterThan(-1);
        const work = a.body.search(WORK);
        if (work > -1) expect(checked, `${where} ${a.name} works before checking the session`).toBeLessThan(work);
      }
    }
  });

  it("the scan reads the actions it should (a parser that saw nothing would pass everything)", () => {
    const { actions } = actionsOf(readFileSync(join(__dirname, "actions.ts"), "utf8"));
    expect(actions.map((a) => a.name)).toEqual(
      expect.arrayContaining([
        "submitSetBuild",
        "submitSetPhotoBuild",
        "pollSetBuild",
        "saveSetLayout",
        "saveSetThumbnail",
        "shootInSet",
        "deleteSet",
      ]),
    );
    const poll = actions.find((a) => a.name === "pollSetBuild")!;
    expect(poll.params.trim()).toBe("setId: string");
  });

  it("the page's poll runs the tick for the session's own person, with the photo switch it always used, and hands back only the result", () => {
    const { actions } = actionsOf(readFileSync(join(__dirname, "actions.ts"), "utf8"));
    const poll = actions.find((a) => a.name === "pollSetBuild")!.body;
    const steps = [
      "const access = await setsAccess();",
      "if (access.error !== null) return { error: access.error };",
      "if (!UUID_RE.test(setId)) return { error: SET_NOT_FOUND };",
      "advanceSetBuild({",
    ];
    const at = steps.map((s) => poll.indexOf(s));
    for (const [i, s] of steps.entries()) expect(at[i], s).toBeGreaterThan(-1);
    for (let i = 1; i < at.length; i++) expect(at[i], `${steps[i - 1]} before ${steps[i]}`).toBeGreaterThan(at[i - 1]);
    expect(poll).toContain("userId: access.userId,");
    expect(poll).toContain("photoSwitchOn: () => isPhotoSetsEnabled(access.supabase),");
    expect(poll).toContain("return tick.result;");
    // The page's own settle is never pushed: the page announces it itself
    // (sets-home.tsx announceIfHidden, pinned in leaving.test.ts).
    expect(poll).not.toMatch(/settledHere|notifyUser/);
  });
});
