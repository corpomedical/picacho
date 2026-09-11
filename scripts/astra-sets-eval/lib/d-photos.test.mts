import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AttemptRecord, BuildRecord } from "./build-flow.mts";
import { parseCli } from "./cli.mts";
import { makeRunDir, type Gates, type RunContext } from "./context.mts";
import { loadCorpus } from "./corpus.mts";
import { NetGuard } from "./net-guard.mts";
import { makePriceBook, type ExternalPrices } from "./prices.mts";
import { SpendGuard, type StopReason } from "./spend-guard.mts";
import { REPO_ROOT } from "./util.mts";
import { makeBriefGate, makeNotesGate, makePictureCheck } from "./words-gate.mts";
import { dPhotoOutcomeOf, dPhotoRow, partD, type DPhotoOutcome } from "../parts/d.mts";

// What a finished photo build means for D's photo leg: where it stopped,
// and, for a delivered set, its marks and whether Astra placed them. Then
// the leg itself over generated pictures, and a stop reaching the gates
// (the brief leg's too): nothing is sent anywhere (a dry run's fakes, or
// scripted gates with no build started, behind an offline net guard).

const attempt = (over: Partial<AttemptRecord> = {}): AttemptRecord => ({ attempt: 1, kind: "first", transport: "background", outcome: "valid", usage: null, billedUsd: 0.6, standardUsd: 0.6, ...over });
const rec = (over: Partial<BuildRecord> = {}): BuildRecord =>
  ({ type: "build", status: "delivered", failure: null, notRun: null, words: "allowed", notes: [], attempts: [attempt({ words: "allowed" })], ...over }) as BuildRecord;

describe("dPhotoOutcomeOf", () => {
  it("a delivered set records its marks, and whether they are Astra's own", () => {
    expect(dPhotoOutcomeOf(rec(), 3)).toEqual({ outcome: "set_delivered", note: null, marks: 3, marksFromAstra: true });
    expect(dPhotoOutcomeOf(rec({ notes: ["default_mark"] }), 1)).toMatchObject({ marks: 1, marksFromAstra: false });
    expect(dPhotoOutcomeOf(rec({ words: "unavailable" }), 2)).toMatchObject({ outcome: "set_delivered", note: "words gate unavailable: unjudged" });
  });

  it("tells our words gate's refusal from Astra's, and a build that never ran from one that failed", () => {
    expect(dPhotoOutcomeOf(rec({ status: "failed", failure: "refused", attempts: [attempt({ words: { refused: "sexual" } })] }), null).outcome).toBe("words_refused");
    expect(dPhotoOutcomeOf(rec({ status: "failed", failure: "refused", attempts: [attempt({ outcome: "refused" })] }), null).outcome).toBe("astra_refused");
    expect(dPhotoOutcomeOf(rec({ status: "failed", failure: "invalid" }), null)).toMatchObject({ outcome: "no_set", note: "invalid", marks: null });
    expect(dPhotoOutcomeOf(rec({ status: "failed", failure: "not_run:budget", notRun: "budget" }), null)).toMatchObject({ outcome: "undetermined", note: "build not run (budget)" });
    expect(dPhotoOutcomeOf(null, null).outcome).toBe("undetermined");
  });

  it("names the gate that stopped a photo before Astra from its verdicts", () => {
    const row = (notesGate: string, pictureCheck: string) => dPhotoRow({ outcome: "refused_before_astra", notesGate: notesGate as never, pictureCheck: pictureCheck as never, marks: null, marksFromAstra: null }).stoppedBy;
    expect(row("refused:sexual", "not-reached")).toBe("notes gate");
    expect(row("none", "refused:minors")).toBe("picture check");
    expect(row("allowed", "unavailable")).toBeNull();
  });
});

type SharpFn = (typeof import("sharp"))["default"];
let sharp: SharpFn | null = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = null;
}

const EMPTY: ExternalPrices = { models: { "claude-sonnet-5": null, "gpt-5.4-mini": null }, images: { "flux-2-pro-edit": null, "seedream-v4-edit": null }, judgementCeilings: {} };
const book = makePriceBook({ external: EMPTY, gptImageUsd: 0.17 });

let root: string;
let prevFetch: typeof fetch;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "astra-dphotos-"));
  prevFetch = globalThis.fetch;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  globalThis.fetch = prevFetch;
});

/** A corpus of `n` generated pictures standing in for photos with people (flat colours: nobody in them). */
async function corpusOf(n: number, notes: (i: number) => string | undefined = () => undefined): Promise<string> {
  const dir = join(root, "corpus");
  mkdirSync(join(dir, "people-photos"), { recursive: true });
  const rows = [];
  for (let i = 1; i <= n; i++) {
    const file = `people-photos/pp-${i}.jpg`;
    writeFileSync(join(dir, file), await (sharp as SharpFn)({ create: { width: 1200, height: 800, channels: 3, background: { r: 30 * i, g: 90, b: 150 } } }).jpeg().toBuffer());
    rows.push({ id: `pp-${i}`, file, licence: "generated for this test", ...(notes(i) ? { notes: notes(i) } : {}), consent: { kind: "ai-generated", covers: ["OpenAI", "Anthropic"], confirmedBy: "test" } });
  }
  const meta = { corpusVersion: 1, writtenBy: "test", writtenOn: "2026-09-11", blindAttestation: "Generated for a unit test; nothing here was read.", files: { peoplePhotos: "people-photos.json" } };
  writeFileSync(join(dir, "corpus.json"), JSON.stringify(meta));
  writeFileSync(join(dir, "people-photos.json"), JSON.stringify(rows));
  return dir;
}

/** A D run's context over that corpus (a photo run unless `words`), the net guard offline; `stopWith` is Ctrl-C or the spend guard's stop. */
function dContext(corpusDir: string, o: { dry: boolean; argv?: string[]; words?: boolean }) {
  const parsed = parseCli(["d", corpusDir, ...(o.words ? [] : ["--photos"]), ...(o.argv ?? [])]);
  if (!parsed.ok || parsed.cli.cmd !== "part") throw new Error("cli");
  const corpus = loadCorpus(corpusDir, { spend: false, allowPartial: true, needs: o.words ? { adversarial: true } : { peoplePhotos: true } });
  if (!corpus.ok) throw new Error(corpus.problems.join("; "));
  const net = new NetGuard({ mode: "offline", realFetch: prevFetch });
  globalThis.fetch = net.fetch;
  const guard = new SpendGuard({ maxUsd: 1e9, sink: () => {} });
  let stopReason: string | null = null;
  const runDir = makeRunDir(join(root, "out"), "d-test");
  const ctx = {
    part: "d",
    runId: "d-test",
    runDir,
    dry: o.dry,
    flags: parsed.cli.flags,
    corpusDir,
    repoRoot: REPO_ROOT,
    net,
    book,
    guard,
    corpus,
    gates: null,
    photos: null,
    manifest: {},
    inflight: new Set<string>(),
    stopping: () => stopReason !== null || guard.stopped !== null,
    interrupted: () => stopReason === "sigint",
    requestStop: (r: string) => {
      stopReason ??= r;
    },
    stopReason: () => stopReason,
    out: () => {},
    progress: () => {},
  } as unknown as RunContext;
  const stopWith = (r: StopReason) => (r === "sigint" ? ctx.requestStop("sigint") : guard.stop(r));
  const rows = () =>
    readFileSync(join(runDir, "results.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { ctx, net, runDir, stopWith, rows };
}

describe.skipIf(!sharp)("D's photo leg, run", () => {
  it("in order: a photo the picture check refuses is never built, only built answers reach the persons sheet, and no photo is kept", async () => {
    const corpus = await corpusOf(4);
    const { ctx, net, runDir, rows } = dContext(corpus, { dry: true });
    expect(await partD.run(ctx)).toBe(0);
    const all = rows();
    const builds = all.filter((r) => r.type === "build").map((r) => r.buildId);
    const outcomes = all.filter((r) => r.type === "d-photo-outcome") as unknown as DPhotoOutcome[];
    // The dry run's three items: the fake picture check refuses item 1 (pp-2).
    expect(builds.sort()).toEqual(["dp-pp-1-r1", "dp-pp-3-r1"]);
    expect(outcomes.find((o) => o.photoId === "pp-2")).toMatchObject({ pictureCheck: "refused:simulated", outcome: "refused_before_astra", buildId: null });
    expect(outcomes.filter((o) => o.photoId !== "pp-2").every((o) => o.pictureCheck === "allowed" && o.buildId === `dp-${o.photoId}-r1`)).toBe(true);
    const keys = readdirSync(join(runDir, "keys")).map((f) => JSON.parse(readFileSync(join(runDir, "keys", f), "utf8")) as { kind: string; items: { source: { buildId: string } }[] });
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.kind === "d-persons")).toBe(true);
    const onSheet = new Set(keys.flatMap((k) => k.items.map((it) => it.source.buildId)));
    expect([...onSheet].sort()).toEqual(["dp-pp-1-r1", "dp-pp-3-r1"]);
    // A D photo run keeps no copy of its photos with people: hash and size only.
    expect(readdirSync(join(runDir, "photos"))).toEqual([]);
    const files = ctx.manifest.photoFiles as Record<string, Record<string, unknown>>;
    expect(Object.keys(files).sort()).toEqual(["pp-1", "pp-2", "pp-3"]);
    for (const f of Object.values(files)) expect(Object.keys(f).sort()).toEqual(["height", "sha256", "width"]);
    expect(net.liveCalls + net.blocked.length).toBe(0);
  });

  // The picture check reads two photos at a time, 10–100 s each: most of a
  // real run's photos wait in its queue by the time a stop comes. A stop
  // there sends none of them.
  it.each([
    ["Ctrl-C", "sigint" as const, 130],
    ["the spend guard's stop", "budget" as const, 2],
  ])("after %s, no photo still waiting for the picture check is sent, and the run does not count as finished", async (_, reason, code) => {
    // pp-2 has notes: judged first, then it joins the picture check's queue.
    const corpus = await corpusOf(4, (i) => (i === 2 ? "the other half of the room is a bar" : undefined));
    const { ctx, net, stopWith, rows } = dContext(corpus, { dry: false, argv: ["--runs", "1"] });
    const read: string[] = [];
    let notesRead = 0;
    const refusalReason = () => null;
    const gates: Gates = {
      words: async () => "allowed",
      brief: async () => "allowed",
      notes: makeNotesGate({ assertPromptAllowed: async () => (notesRead++, {}), refusalReason, stopping: ctx.stopping }),
      picture: makePictureCheck({
        assertOutputAllowed: async (input) => {
          read.push(input.imageUrl);
          // The stop comes while the first photo is being read, every other photo queued behind it.
          await new Promise((r) => setTimeout(r, 5));
          if (read.length === 1) stopWith(reason);
          return {};
        },
        refusalReason,
        concurrency: 1,
        stopping: ctx.stopping,
      }),
    };
    ctx.gates = gates;
    expect(await partD.run(ctx)).toBe(code);
    expect(read).toHaveLength(1);
    expect(notesRead).toBe(1);
    const outcomes = rows().filter((r) => r.type === "d-photo-outcome") as unknown as DPhotoOutcome[];
    expect(outcomes).toHaveLength(4);
    const unreached = outcomes.filter((o) => o.note === `not reached: the run stopped (${reason})`);
    expect(unreached.map((o) => o.photoId).sort()).toEqual(["pp-2", "pp-3", "pp-4"]);
    expect(unreached.every((o) => o.outcome === "undetermined" && o.pictureCheck === "not-reached" && o.buildId === null)).toBe(true);
    expect(unreached.find((o) => o.photoId === "pp-2")?.notesGate).toBe("allowed");
    // The one photo read before the stop is allowed; its build never starts: not run.
    expect(outcomes.find((o) => o.photoId === "pp-1")).toMatchObject({ pictureCheck: "allowed", outcome: "undetermined", note: expect.stringMatching(/^build not run/) });
    expect(ctx.manifest.complete).toBe(false);
    expect(net.liveCalls + net.blocked.length).toBe(0);
  });
});

// The brief leg starts every brief's gate at once too (without --escalate).
describe("D's brief leg, run", () => {
  it("after Ctrl-C, no brief still waiting for the brief gate is sent", async () => {
    const dir = join(root, "corpus");
    mkdirSync(dir, { recursive: true });
    const meta = { corpusVersion: 1, writtenBy: "test", writtenOn: "2026-09-11", blindAttestation: "Generated for a unit test; nothing here was read.", files: { adversarial: "adversarial.json" } };
    writeFileSync(join(dir, "corpus.json"), JSON.stringify(meta));
    writeFileSync(join(dir, "adversarial.json"), JSON.stringify([1, 2, 3].map((i) => ({ id: `adv-${i}`, category: "other", harmful: false, brief: `An ordinary place number ${i}, a quiet street corner.` }))));
    const { ctx, stopWith, rows } = dContext(dir, { dry: false, words: true, argv: ["--runs", "1"] });
    let sent = 0;
    ctx.gates = {
      words: async () => "allowed",
      brief: makeBriefGate({
        assertPromptAllowed: async () => {
          sent += 1;
          await new Promise((r) => setTimeout(r, 5));
          if (sent === 1) stopWith("sigint");
          return {};
        },
        refusalReason: () => null,
        concurrency: 1,
        stopping: ctx.stopping,
      }),
    };
    expect(await partD.run(ctx)).toBe(130);
    expect(sent).toBe(1);
    const outcomes = rows().filter((r) => r.type === "d-outcome");
    expect(outcomes.filter((o) => o.briefGate === "not-reached").map((o) => [o.briefId, o.outcome, o.note])).toEqual([
      ["adv-2", "undetermined", "not reached: the run stopped (sigint)"],
      ["adv-3", "undetermined", "not reached: the run stopped (sigint)"],
    ]);
    expect(outcomes.find((o) => o.briefId === "adv-1")).toMatchObject({ briefGate: "allowed", outcome: "undetermined", note: "build not run (interrupted)" });
    expect(ctx.manifest.complete).toBe(false);
  });
});
