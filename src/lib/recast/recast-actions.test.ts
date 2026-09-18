import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The take's order, pinned as source — the money and the gates are in the
// ORDER, and a test that imported the action would drag Supabase and every
// provider in (the repo's standing reason for source pins).

const source = readFileSync(join(__dirname, "actions.ts"), "utf8");
const start = source.slice(source.indexOf("export async function startRecastTakes"), source.indexOf("export async function getRecastTakeMedia"));
const inspect = source.slice(source.indexOf("export async function inspectRecastClip"), source.indexOf("export async function discardRecastUpload"));
const at = (needle: string, body = start) => {
  const i = body.indexOf(needle);
  expect(i, `no longer contains: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("every action", () => {
  it("is admins only, behind the switch, before anything else", () => {
    const access = source.slice(source.indexOf("async function recastAccess"), source.indexOf("type Admin"));
    expect(access).toContain('profile?.role === "admin"');
    expect(access).toContain("if (!isAdmin) return { error: RECAST_NOT_OPEN }");
    expect(access).toContain("isRecastEnabled");
    for (const fn of ["reserveRecastUpload", "inspectRecastClip", "discardRecastUpload", "startRecastTakes", "getRecastTakeMedia"]) {
      const body = source.slice(source.indexOf(`export async function ${fn}`));
      expect(body.indexOf("await recastAccess()"), fn).toBeGreaterThan(-1);
      expect(body.indexOf("await recastAccess()"), fn).toBe(body.indexOf("await "));
    }
  });

  it("only ever touches the caller's own clips, takes and characters", () => {
    expect(start).toContain("parsed.userId !== userId");
    expect(inspect).toContain("parsed.userId !== access.userId");
    expect(start).toContain('.eq("user_id", userId)');
    // A take used as the performance must be the caller's own, finished, undeleted.
    const own = source.slice(source.indexOf("async function readOwnTake"), source.indexOf("export async function reserveRecastUpload"));
    expect(own).toContain('.eq("user_id", userId)');
    expect(own).toContain('.eq("status", "succeeded")');
    expect(own).toContain('.is("deleted_at", null)');
  });
});

describe("startRecastTakes", () => {
  it("wants the rights tick before it reads a byte", () => {
    expect(at("input?.rights !== true")).toBeLessThan(at("readUpload(admin, uploadPath)"));
    expect(at("input?.rights !== true")).toBeLessThan(at("readOwnTake(supabase, userId, input.takeId)"));
  });

  it("prices from the file, never from the form and never from the read", () => {
    expect(start).toContain("recastCreditCost(engine, clip)");
    expect(start).not.toMatch(/input\??\.(seconds|frames|credits|price|quotes)/);
    expect(at("readUpload(admin, uploadPath)")).toBeLessThan(at("const perTake = recastCreditCost(engine, clip)"));
    // The read makes a round trip through a browser, so it is re-bounded and
    // may only shape the BRIEF — never the money or the cast.
    expect(start).toContain("reboundRecastRead(input?.read, clip.seconds)");
    const readLine = at("const read = reboundRecastRead");
    expect(start.slice(readLine, at("const perTake"))).not.toMatch(/credit|allowance|characterIds/);
  });

  it("judges the words and the clip BEFORE any credit moves", () => {
    const words = at("await gatePrompt({");
    const picture = at("await judgeRender({");
    expect(words).toBeLessThan(at("checkGenerationAllowance("));
    expect(picture).toBeLessThan(at("checkGenerationAllowance("));
    expect(picture).toBeLessThan(at('admin.rpc("reserve_generations"'));
    expect(picture).toBeLessThan(at("submitRecastJob("));
    expect(start.slice(picture, picture + 220)).toContain("strictLane: true");
  });

  it("re-judges an upload but not one of our own finished takes", () => {
    // Our own render met the output gate on the way out; judging it again on
    // the way in would be paying twice to learn the same thing.
    const guard = start.slice(at("if (uploadPath) {"), at("const perTake"));
    expect(guard).toContain("judgeRender");
    expect(guard).toContain("recordPolicyRefusal");
    expect(guard.indexOf('err.reason === "unavailable"')).toBeLessThan(guard.indexOf("removeSource(admin, uploadPath)"));
  });

  it("asks for the whole press at once, then reserves it in one transaction", () => {
    expect(start).toContain("const total = perTake * cast.length");
    expect(at("checkGenerationAllowance(supabase, userId, total)")).toBeLessThan(at('admin.rpc("reserve_generations"'));
    expect(at('admin.rpc("reserve_generations"')).toBeLessThan(at("consumePurchasedCredits("));
    expect(at("consumePurchasedCredits(")).toBeLessThan(at("submitRecastJob("));
    expect(at("submitRecastJob(")).toBeLessThan(at("saveVideoJob({"));
  });

  it("groups its variants in its own column, never in the composer's", () => {
    // angle_group_id would have been free, and would have locked the
    // composer out of fan-out for two minutes at a time.
    expect(start).not.toContain("angle_group_id");
    expect(start).toContain("groupId,");
  });

  it("refunds by force when a submit fails, one variant at a time", () => {
    const rescue = start.slice(at("} catch (err) {\n        if (pendingJob)"));
    expect(rescue).toContain("cancelQueuedJob(pendingJob)");
    expect(rescue).toContain("refundGenerationCosts(generationId, { force: true })");
    // One bad variant must not take the others down.
    expect(start).toContain("if (started.length === 0) return { error: RECAST_COULDNT_START }");
  });

  it("is an ordinary video render from the job row on, in the strict lane", () => {
    const save = start.slice(at("saveVideoJob({"), at("saveVideoJob({") + 600);
    expect(save).toContain("strictLane: true");
    expect(save).toContain('provider: "fal"');
    expect(start).toContain('content_type: "video"');
    // The free daily slot never covers a recast.
    expect(start).toContain("free_generation_used: false");
    expect(start).not.toContain("consumeFreeGeneration");
  });

  it("asks for the lock through the payload, and only where a face is cast", () => {
    expect(start).toContain("identityLock: character && lockOn ? { threshold: RECAST_LOCK_THRESHOLD, refund: true } : undefined");
    const runner = readFileSync(join(__dirname, "..", "generations", "job-runner.ts"), "utf8");
    // The runner grew the capability, not the lane.
    expect(runner).not.toMatch(/recast/i);
    expect(runner).toContain("identityLock");
    expect(runner).toContain('extractVideoFrame(providerDownloadUrl(outcome.resultUrl), "first")');
    expect(runner).toContain("Math.min(...lockScores)");
  });
});

describe("inspectRecastClip", () => {
  it("reads the file for the numbers and the frames for the meaning", () => {
    expect(inspect).toContain("readUpload(admin, input.path!)");
    expect(inspect).toContain("askRecastRead(");
    expect(inspect).toContain("parseRecastRead(");
    expect(inspect).toContain("recastCreditCost(engine, clip)");
  });

  it("brakes the read, and a clip it cannot read can still be taken", () => {
    expect(inspect).toContain('rateLimited(access.userId, "recast-read"');
    expect(inspect).toContain("let read: RecastRead | null = null");
    // No branch turns a failed read into a refusal.
    expect(inspect.slice(inspect.indexOf("let read"))).not.toMatch(/return \{ error: [A-Z_]*READ/);
  });
});

describe("the lane's own housekeeping", () => {
  it("sweeps a bucket that account deletion also sweeps", () => {
    const buckets = readFileSync(join(__dirname, "..", "profile", "storage-buckets.ts"), "utf8");
    expect(buckets).toContain('"recast-sources"');
    const data = readFileSync(join(__dirname, "data.ts"), "utf8");
    expect(data).toContain("sweepRecastOrphans");
    // A failed read of what is spoken for must never be read as "nothing is".
    expect(data).toContain("if (rowsError || !rows) return;");
  });

  it("ships the database the code needs, with both switches off", () => {
    const supabaseDir = join(__dirname, "..", "..", "..", "supabase");
    const sqlPath = [join(supabaseDir, "pending"), ...readdirSync(join(supabaseDir, "applied")).map((d) => join(supabaseDir, "applied", d))]
      .map((dir) => join(dir, "recast.sql"))
      .find((p) => existsSync(p));
    expect(sqlPath, "recast.sql is in neither supabase/pending nor supabase/applied/*").toBeDefined();
    const sql = readFileSync(sqlPath!, "utf8");
    expect(sql).toContain("'recast-sources'");
    expect(sql).toContain("array['video/mp4', 'video/quicktime']");
    expect(sql).toContain("add column if not exists recast jsonb");
    expect(sql).toMatch(/'recast',\s+false,/);
    expect(sql).toMatch(/'recast_lock',\s+false,/);
  });

  it("names the recast column in exactly one module", () => {
    const dir = __dirname;
    for (const file of readdirSync(dir)) {
      if (file === "store.ts" || file.endsWith(".test.ts")) continue;
      const text = readFileSync(join(dir, file), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      // The actions may WRITE the column through recastRow and read it back
      // through readRecastRecipe; neither spells its shape out.
      expect(text, file).not.toMatch(/recast:\s*\{\s*v:/);
    }
  });
});

// What the door shows when the column its recipes live in is not there yet
// ("I tried mystic, uploaded video generated and it looks like nothing has
// happened", 2026-09-18). `recast` arrives with a migration the operator
// runs by hand; PostgREST fails a WHOLE statement that names a column the
// database does not have. It was named in the door's list of takes, so with
// the bucket and the flag in place — the upload working, the take started
// and charged — the page had nothing on it at all. Verified against
// production the same day: the flag and the bucket were there, the column
// was not.
describe("the door survives a migration that has not run", () => {
  const data = readFileSync(join(__dirname, "data.ts"), "utf8");
  const store = readFileSync(join(__dirname, "store.ts"), "utf8");
  const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");

  it("never names the recipe's column in a query that carries anything else", () => {
    const columns = data.slice(data.indexOf("const TAKE_COLUMNS ="), data.indexOf(";", data.indexOf("const TAKE_COLUMNS =")));
    expect(columns).not.toContain("recast");
    // Everywhere it IS named, it is the only thing that query asks for, so a
    // missing column costs that one answer and nothing else.
    for (const m of [...data.matchAll(/\.select\("([^"]*)"\)/g), ...actions.matchAll(/\.select\("([^"]*)"\)/g), ...store.matchAll(/\.select\("([^"]*)"\)/g)]) {
      if (!m[1].includes("recast")) continue;
      // Only the recipe, and at most the id to hang it on.
      expect(m[1].replace(/\s/g, "").split(",").sort().filter((c) => c !== "id")).toEqual(["recast"]);
    }
    expect(store).toContain("export async function readRecastRecipes(");
  });

  it("lists a take that failed, instead of hiding it", () => {
    const home = data.slice(data.indexOf("export async function getRecastHome("), data.indexOf("const ORPHAN_AFTER_MS"));
    expect(home).not.toContain('.neq("status", "failed")');
    // A failed take can still never be offered as a performance to recast.
    expect(home).toContain('.filter((g) => g.status === "succeeded")');
  });
});
