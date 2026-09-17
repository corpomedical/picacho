import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The take's order, pinned as source — the money and the gates are in the
// ORDER, and a test that imports the action would drag Supabase and every
// provider in (the repo's standing reason for source pins).

const source = readFileSync(join(__dirname, "actions.ts"), "utf8");
const start = source.slice(source.indexOf("export async function startRecastTake"), source.indexOf("export async function getRecastTakeMedia"));
const at = (needle: string) => {
  const i = start.indexOf(needle);
  expect(i, `startRecastTake no longer contains: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("startRecastTake", () => {
  it("is admins only, behind the switch, before anything else", () => {
    const access = source.slice(source.indexOf("async function recastAccess"), source.indexOf("type Admin"));
    expect(access).toContain('profile?.role === "admin"');
    expect(access).toContain("if (!isAdmin) return { error: RECAST_NOT_OPEN }");
    expect(access).toContain("isRecastEnabled");
    for (const fn of ["reserveRecastUpload", "inspectRecastUpload", "discardRecastUpload", "startRecastTake", "getRecastTakeMedia"]) {
      const body = source.slice(source.indexOf(`export async function ${fn}`));
      // The first thing each action awaits is the access check.
      expect(body.indexOf("await recastAccess()"), fn).toBeGreaterThan(-1);
      expect(body.indexOf("await recastAccess()"), fn).toBe(body.indexOf("await "));
    }
  });

  it("wants the rights tick before it reads a byte", () => {
    expect(at("input?.rights !== true")).toBeLessThan(at("readClip(admin, path)"));
  });

  it("only ever touches the caller's own reserved path", () => {
    expect(start).toContain("parsed.userId !== userId");
    expect(at("parsed.userId !== userId")).toBeLessThan(at("readClip(admin, path)"));
  });

  it("casts only the caller's own character, with one of its own photos", () => {
    expect(start).toContain('.eq("user_id", userId)');
    expect(start).toContain("photos.includes(input.photoPath)");
  });

  it("prices from the file, never from the form", () => {
    expect(start).toContain("recastCreditCost(engine, clip)");
    expect(start).not.toMatch(/input\??\.(seconds|frames|credits|price)/);
    expect(at("readClip(admin, path)")).toBeLessThan(at("recastCreditCost(engine, clip)"));
  });

  it("judges the clip in the strict lane BEFORE any credit moves", () => {
    const gate = at("await judgeRender({");
    expect(start.slice(gate, gate + 200)).toContain("strictLane: true");
    expect(gate).toBeLessThan(at("checkGenerationAllowance("));
    expect(gate).toBeLessThan(at('admin.rpc("reserve_generation"'));
    expect(gate).toBeLessThan(at("submitRecastJob("));
  });

  it("logs a refusal, and keeps the clip only when the check itself was unreachable", () => {
    const refusal = start.slice(at("err instanceof OutputPolicyRefusal"), at("const spec = RECAST_ENGINES[engine]"));
    expect(refusal).toContain("recordPolicyRefusal");
    expect(refusal.indexOf('err.reason === "unavailable"')).toBeLessThan(refusal.indexOf("removeSource(admin, path)"));
    expect(refusal).toContain("return { error: err.userMessage }");
  });

  it("reserves, spends, submits, records — and refunds by force when the submit fails", () => {
    expect(at('admin.rpc("reserve_generation"')).toBeLessThan(at("consumePurchasedCredits("));
    expect(at("consumePurchasedCredits(")).toBeLessThan(at("submitRecastJob("));
    expect(at("submitRecastJob(")).toBeLessThan(at("saveVideoJob({"));
    const rescue = start.slice(at("} catch (err) {\n    if (pendingJob)"));
    expect(rescue).toContain("cancelQueuedJob(pendingJob)");
    expect(rescue).toContain("refundGenerationCosts(generationId, { force: true })");
  });

  it("stores the take under the clip's own id, so a second press meets the key", () => {
    expect(start).toContain("id: takeId,");
    expect(start).toContain("RECAST_ALREADY_STARTED");
  });

  it("is an ordinary video render from the job row on, in the strict lane", () => {
    const save = start.slice(at("saveVideoJob({"), at("saveVideoJob({") + 400);
    expect(save).toContain("strictLane: true");
    expect(save).toContain('provider: "fal"');
    expect(start).toContain('content_type: "video"');
    expect(start).toContain("character_profile_id: character.id");
    // The free daily slot never covers a recast.
    expect(start).toContain("free_generation_used: false");
    expect(start).not.toContain("consumeFreeGeneration");
  });

  it("the job runner knows nothing of this lane", () => {
    const runner = readFileSync(join(__dirname, "..", "generations", "job-runner.ts"), "utf8");
    expect(runner).not.toMatch(/recast/i);
  });
});

describe("the account-deletion sweep", () => {
  it("covers the bucket the lane created", () => {
    const buckets = readFileSync(join(__dirname, "..", "profile", "storage-buckets.ts"), "utf8");
    expect(buckets).toContain('"recast-sources"');
    // Pending until it is run, then filed under applied/<date>/ — found in either.
    const supabaseDir = join(__dirname, "..", "..", "..", "supabase");
    const sqlPath = [join(supabaseDir, "pending"), ...readdirSync(join(supabaseDir, "applied")).map((d) => join(supabaseDir, "applied", d))]
      .map((dir) => join(dir, "recast.sql"))
      .find((p) => existsSync(p));
    expect(sqlPath, "recast.sql is in neither supabase/pending nor supabase/applied/*").toBeDefined();
    const sql = readFileSync(sqlPath!, "utf8");
    expect(sql).toContain("'recast-sources'");
    expect(sql).toContain("array['video/mp4', 'video/quicktime']");
    expect(sql).toMatch(/'recast',\s+false,/);
  });
});
