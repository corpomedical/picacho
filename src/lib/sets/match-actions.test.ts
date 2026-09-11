import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Match this shot's action (match-actions.ts), read as source: a "use server"
// module cannot load here. What it promises is an order — nothing reaches a
// paid reader or Astra before the access, set and picture checks, and
// nothing reaches Astra before the picture check has passed it — and that
// nothing of the picture outlives the request. photo.test.ts holds the photo
// build to the same promises the same way.

const source = readFileSync(join(__dirname, "match-actions.ts"), "utf8");
const start = source.indexOf("export async function matchSetShot(");
const body = source.slice(start);
/** The source without its comments, so a comment can neither satisfy nor trip a check. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1");

describe("matchSetShot's order", () => {
  it("checks admin and both switches, the set, the picture, the brake and the picture check — and only then calls Astra", () => {
    expect(start).toBeGreaterThan(0);
    const steps = [
      "if (!access.isAdmin) return { error: SETS_NOT_OPEN }",
      "isPhotoSetsEnabled(access.supabase)",
      "readyOwnedSet(setId, userId)",
      "parseSetPhotoDataUri(",
      "normaliseSetPhoto(",
      'rateLimited(userId, "set-match"',
      "assertOutputAllowed(",
      "submitAstraJob(matchShotRequest(dataUrl, openAiSafetyId(userId)))",
      "pollAstraJob(",
      "parseMatchShotText(",
    ];
    const at = steps.map((s) => body.indexOf(s));
    for (const [i, s] of steps.entries()) expect(at[i], s).toBeGreaterThan(-1);
    for (let i = 1; i < at.length; i++) expect(at[i], `${steps[i - 1]} before ${steps[i]}`).toBeGreaterThan(at[i - 1]);
  });

  it("returns on every failed check before anything costs money", () => {
    const check = body.slice(0, body.indexOf("assertOutputAllowed("));
    for (const guard of [
      "if (access.error !== null) return { error: access.error }",
      "if (!access.isAdmin) return { error: SETS_NOT_OPEN }",
      "if (!(await isPhotoSetsEnabled(access.supabase))) return { error: SETS_UNAVAILABLE }",
      "if (notOwned) return { error: notOwned }",
      "if (!parsed.ok) return { error: parsed.error }",
      'if (await rateLimited(userId, "set-match", 60 * 60, SET_MATCH_PER_HOUR)) return { error: SET_MATCH_TOO_FAST }',
    ]) {
      expect(check, guard).toContain(guard);
    }
  });

  it("runs the picture check exactly as a photo build does, on the bytes Astra is then sent", () => {
    expect(body).toContain("const dataUrl = photoDataUrl(photo.jpeg);");
    expect(body).toContain(
      "assertOutputAllowed({ imageUrl: dataUrl, strictLane: true, promptScores: null, sessionPriorHits: priorHits })",
    );
    expect(body.indexOf("const priorHits = await recentRefusalCount(userId);")).toBeLessThan(body.indexOf("assertOutputAllowed("));
    // A refusal is logged and answered; anything else the check throws is not swallowed.
    expect(body).toMatch(/if \(err instanceof OutputPolicyRefusal\) \{[\s\S]*?provider: "set-match"[\s\S]*?return \{ error: err\.reason === "unavailable" \? SET_MATCH_UNCHECKED : SET_MATCH_REFUSED \};[\s\S]*?\}\s*throw err;/);
    // Astra is sent that picture once, inline (the order test pins the call's
    // argument): never a link to one.
    expect(code.match(/submitAstraJob\(/g)).toHaveLength(1);
    expect(code).not.toMatch(/mediaUrl\(|createSignedUrl|getPublicUrl/);
  });

  it("cancels a read nobody will collect", () => {
    const timeout = body.slice(body.indexOf("if (!polled || polled.state === \"working\")"));
    expect(timeout.indexOf("await cancelAstraJob(submitted.responseId);")).toBeGreaterThan(0);
    expect(timeout.indexOf("await cancelAstraJob(submitted.responseId);")).toBeLessThan(timeout.indexOf("return { error: SET_MATCH_TIMED_OUT }"));
  });
});

describe("what a failed match says", () => {
  it("routes every provider failure through matchFailureMessage, so only an unusable answer asks for another picture", () => {
    expect(body).toContain("return { error: matchFailureMessage(submitted.kind) };");
    expect(body).toContain("return { error: matchFailureMessage(polled.kind) };");
    expect(body).toContain('if (!read.ok) return { error: matchFailureMessage("invalid") };');
    // No path hands back the try-another sentence directly.
    expect(code).not.toContain("SET_MATCH_FAILED");
  });

  it("never speaks of a set being started when the server cannot read a picture", () => {
    expect(body).toContain(
      "if (!photo.ok) return { error: photo.error === SET_BUILD_COULDNT_START ? SET_MATCH_COULDNT_READ : photo.error };",
    );
  });
});

describe("nothing of the picture outlives the request", () => {
  it("writes no row and uploads nothing: one read of the person's own set is its only database call", () => {
    expect(code).not.toMatch(/\.upload\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.storage\b|\.rpc\(/);
    expect(code.match(/\.from\(/g)).toHaveLength(1);
    expect(code).toMatch(/\.from\("location_sets"\)\s*\.select\("status, spec"\)/);
  });

  it("never logs the picture, its bytes or the numbers read from it", () => {
    const calls = [...code.matchAll(/console\.(?:log|info|warn|error|debug)\(([^;]*)\);/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      // String literals aside: a label may say "read"; an argument may not be the reading.
      const values = args.replace(/"[^"]*"/g, '""');
      expect(values, args).not.toMatch(/\b(?:dataUrl|photo|parsed|input|read|jpeg|bytes)\b|\.text\b|\.match\b/);
    }
  });
});

describe("the file exports exactly one action", () => {
  it("is a \"use server\" module whose only export is matchSetShot, which runs every check itself", () => {
    // Every export of a "use server" file is a client-callable action: a
    // helper exported here (readyOwnedSet takes a userId) would be one too.
    expect(source.startsWith('"use server";')).toBe(true);
    const exports = [...code.matchAll(/^export\s+(.*)$/gm)].map((m) => m[1]);
    expect(exports).toHaveLength(1);
    expect(exports[0]).toMatch(/^async function matchSetShot\(/);
    expect(body).toContain("const access = await setsAccess();");
    expect(body.indexOf("const access = await setsAccess();")).toBeLessThan(body.indexOf("readyOwnedSet(setId, userId)"));
  });
});

describe("the page runs a match and a shot one at a time", () => {
  // Next runs a page's server actions one after another, so a match beside a
  // shot would sit in the queue saying "reading" (cross-review, 2026-09-11).
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  it("a match does not start during a shot, nor a shot during a match", () => {
    expect(view).toContain("if (!file || matching || shooting || !ready) return;");
    expect(view).toContain("if (shooting || matching || !characterId || !ready) return;");
    expect(view).toContain("disabled={!ready || matching || shooting}");
    expect(view).toContain("disabled={shooting || matching || !characterId || loadFailed || !ready}");
  });
});
