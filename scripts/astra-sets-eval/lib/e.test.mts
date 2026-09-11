import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAstraRequestBody } from "../../../src/lib/generations/providers/astra.ts";
import { matchShotRequest } from "../../../src/lib/sets/match-shot.ts";
import { photoDataUrl } from "../../../src/lib/sets/photo.ts";
import type { SheetKey } from "./blind-sheet.mts";
import { evalSafetyId, miniMatchBody } from "./builders.mts";
import { parseCli } from "./cli.mts";
import { makeRunDir, type Gates, type RunContext } from "./context.mts";
import { loadCorpus } from "./corpus.mts";
import { verticalFovDegFrom35mm } from "./exif-fov.mts";
import type { LedgerInput } from "./ledger.mts";
import { photoSquare } from "./match-pose.mts";
import { NetGuard } from "./net-guard.mts";
import { preparePhoto } from "./photos.mts";
import { makePriceBook, type ExternalPrices } from "./prices.mts";
import { SpendGuard, type StopReason } from "./spend-guard.mts";
import type { MatchAttempt } from "./transports.mts";
import { EVAL_DIR, REPO_ROOT } from "./util.mts";
import { makePictureCheck } from "./words-gate.mts";
import { E_VIEWS_PER_PAGE, readOutcome, runE, type EDeps, type EPhotoRow, type EReadRow } from "../parts/e.mts";
import { runReport } from "../parts/report.mts";
import type { RenderJob, Rendered } from "../render/render-sets.mts";

// Part E over generated pictures: the dry run's fakes, then a "real" run
// whose providers are a scripted fetch behind the live net guard, and report
// over it. Nothing leaves the process; no Chrome opens (the renderer is a
// stand-in that writes a placeholder per pose), and the read's clock runs on
// a fake one.

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
let prevKey: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "astra-e-"));
  prevFetch = globalThis.fetch;
  prevKey = process.env.OPENAI_API_KEY;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  globalThis.fetch = prevFetch;
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
});

const picture = (w: number, h: number, shade: number) => (sharp as SharpFn)({ create: { width: w, height: h, channels: 3, background: { r: shade, g: 110, b: 90 } } });

/** Three reference pictures: the lens in the file's EXIF; a phone portrait (orientation 6) whose match.json disagrees on the orientation; and one with no lens at all. */
async function corpus(): Promise<{ dir: string; files: Record<string, Buffer> }> {
  const dir = join(root, "corpus");
  mkdirSync(join(dir, "match-photos"), { recursive: true });
  const files: Record<string, Buffer> = {
    "mt-1": await picture(1536, 1024, 40).withExif({ IFD2: { FocalLengthIn35mmFilm: "26", FocalLength: "57/10" } }).jpeg().toBuffer(),
    "mt-2": await picture(1600, 1200, 80).withMetadata({ orientation: 6 }).withExif({ IFD2: { FocalLengthIn35mmFilm: "50" } }).jpeg().toBuffer(),
    "mt-3": await picture(1200, 800, 120).png().toBuffer(),
  };
  const rows = [
    { id: "mt-1", file: "match-photos/mt-1.jpg", licence: "generated for this test", containsPeople: false },
    { id: "mt-2", file: "match-photos/mt-2.jpg", licence: "generated for this test", containsPeople: true, exif: { focal35mm: 50, orientation: 1 }, consent: { kind: "ai-generated", covers: ["OpenAI", "Anthropic", "raters"], confirmedBy: "test" } },
    { id: "mt-3", file: "match-photos/mt-3.png", licence: "generated for this test", containsPeople: false },
  ];
  for (const r of rows) writeFileSync(join(dir, r.file), files[r.id]);
  writeFileSync(join(dir, "match.json"), JSON.stringify(rows));
  writeFileSync(join(dir, "corpus.json"), JSON.stringify({ corpusVersion: 1, writtenBy: "test", writtenOn: "2026-09-11", blindAttestation: "Generated for a unit test; nothing here was read.", files: { match: "match.json" } }));
  return { dir, files };
}

function eContext(corpusDir: string, o: { dry: boolean; argv?: string[]; provider?: (url: string, init?: RequestInit) => Promise<Response> }) {
  const parsed = parseCli(["e", corpusDir, "--seed", "7", ...(o.argv ?? [])]);
  if (!parsed.ok || parsed.cli.cmd !== "part") throw new Error(parsed.ok ? "cli" : parsed.error);
  const c = loadCorpus(corpusDir, { spend: false, allowPartial: true, needs: { match: true } });
  if (!c.ok) throw new Error(c.problems.join("; "));
  const calls: { url: string; method: string; body: string }[] = [];
  const net = new NetGuard({
    mode: o.dry ? "offline" : "live",
    realFetch: (async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(u), method: init?.method ?? "GET", body: String(init?.body ?? "") });
      if (!o.provider) throw new Error("no provider");
      return o.provider(String(u), init);
    }) as typeof fetch,
  });
  globalThis.fetch = net.fetch;
  const events: LedgerInput[] = [];
  const guard = new SpendGuard({ maxUsd: o.dry ? 1e9 : 5, sink: (e) => events.push(e) });
  let stopReason: string | null = null;
  const runDir = makeRunDir(join(root, "out"), o.dry ? "e-test-DRYRUN" : "e-test");
  const out: string[] = [];
  const ctx = {
    part: "e",
    runId: o.dry ? "e-test-DRYRUN" : "e-test",
    runDir,
    dry: o.dry,
    flags: parsed.cli.flags,
    corpusDir,
    repoRoot: REPO_ROOT,
    net,
    book,
    guard,
    corpus: c,
    gates: null,
    photos: null,
    manifest: { runId: o.dry ? "e-test-DRYRUN" : "e-test", part: "e", simulated: o.dry },
    inflight: new Set<string>(),
    stopping: () => stopReason !== null || guard.stopped !== null,
    interrupted: () => stopReason === "sigint",
    requestStop: (r: string) => {
      stopReason ??= r;
    },
    stopReason: () => stopReason,
    out: (l = "") => out.push(l),
    progress: () => {},
  } as unknown as RunContext;
  const stopWith = (r: StopReason) => (r === "sigint" ? ctx.requestStop("sigint") : guard.stop(r));
  const rows = () =>
    readFileSync(join(runDir, "results.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { ctx, net, calls, events, guard, runDir, out, rows, stopWith };
}

/** The renderer's stand-in: a placeholder JPEG per pose, and the jobs it was handed. */
function fakeRender(seen: RenderJob[]): EDeps["render"] {
  return async (o) =>
    o.jobs.map((j): Rendered => {
      seen.push(j);
      const files: Record<string, string> = {};
      for (const p of j.poses) {
        const name = `${j.key}-${p.poseId}.jpg`;
        writeFileSync(join(o.outDir, name), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        files[p.poseId] = name;
      }
      return { key: j.key, ok: true, result: { lift: { fill: 1, exposure: 1 }, lifted: false, frames: j.poses.map((p) => ({ poseId: p.poseId, jpeg: null, controlsWouldMove: false })), errors: [], ms: 1, meshCount: 1 }, files };
    });
}

const fakeClock = () => {
  let t = 0;
  return { now: () => t, pause: async (ms: number) => void (t += ms) };
};

const deps = (seen: RenderJob[] = []): EDeps => ({ render: fakeRender(seen), clock: fakeClock(), chromeFound: () => true });

describe("readOutcome: what a read's attempt means for the bars", () => {
  const meta = { transport: "background" as const, billedUsd: 0.1, standardUsd: 0.1 };
  const at = (r: MatchAttempt["r"], extra: Partial<MatchAttempt> = {}): MatchAttempt => ({ r, meta, ...extra });
  const good = JSON.stringify({ subject_found: false, camera_height_m: 1.6, pitch_deg: 0, vertical_fov_deg: 45, subject_distance_m: null, subject_x: null, framing: null, confidence: "low" });

  it("a camera; a miss when the builder's own answer is unusable; missing when there is nothing to judge it by", () => {
    expect(readOutcome(at({ state: "done", text: good, usage: null }))).toMatchObject({ outcome: "read", match: { verticalFovDeg: 45 } });
    expect(readOutcome(at({ state: "done", text: '{"subject_found": tr', usage: null }))).toEqual({ outcome: "miss", why: "invalid", match: null });
    expect(readOutcome(at({ state: "failed", kind: "refused", detail: "", usage: null })).outcome).toBe("miss");
    expect(readOutcome(at({ state: "failed", kind: "incomplete", detail: "", usage: null })).outcome).toBe("miss");
    expect(readOutcome(at({ state: "failed", kind: "cancelled", detail: "", usage: null }, { timedOut: true }))).toMatchObject({ outcome: "miss", why: "timed_out" });
    // Still reading at the deadline is a miss on either builder (mini's shows as its one call unanswered at it);
    // a deadline that passed with no word from OpenAI is missing.
    expect(readOutcome(at({ state: "submit-failed", kind: "unavailable", detail: "" }, { timedOut: true }))).toEqual({ outcome: "miss", why: "timed_out", match: null });
    expect(readOutcome(at({ state: "failed", kind: "failed", detail: "", usage: null }, { unanswered: true }))).toEqual({ outcome: "missing", why: "unanswered", match: null });
    expect(readOutcome(at({ state: "submit-failed", kind: "refused", detail: "" }))).toMatchObject({ outcome: "miss", why: "refused" });
    expect(readOutcome(at({ state: "failed", kind: "cancelled", detail: "", usage: null, interrupted: true }))).toMatchObject({ outcome: "missing", why: "not_run:interrupted" });
    expect(readOutcome(at({ state: "failed", kind: "failed", detail: "", usage: null }))).toMatchObject({ outcome: "missing", why: "failed" });
    expect(readOutcome(at({ state: "failed", kind: "expired", detail: "", usage: null })).outcome).toBe("missing");
    for (const [kind, why] of [
      ["budget", "not_run:budget"],
      ["stopped", "not_run:interrupted"],
      ["unavailable", "not_run:transport"],
      ["rate_limited", "not_run:transport"],
      ["bad_request", "not_run:rejected"],
      ["config", "not_run:config"],
    ] as const) {
      expect(readOutcome(at({ state: "submit-failed", kind, detail: "" }))).toEqual({ outcome: "missing", why, match: null });
    }
  });
});

describe("E never goes near Batch", () => {
  it("the part holds no Batch step: no Batch driver, line or upload", () => {
    const src = readFileSync(join(EVAL_DIR, "parts/e.mts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const word of ["driveBatch", "submitRound", "batchLineBody", "openai-batch", "/v1/files", "/v1/batches"]) expect(src).not.toContain(word);
  });
});

describe.skipIf(!sharp)("E, run", () => {
  it("a dry run: the truth from each file, the product's preparation, fake reads, every read's stage view, a blind sheet — and nothing sent", async () => {
    const { dir } = await corpus();
    const seen: RenderJob[] = [];
    const { ctx, net, runDir, rows, out, guard } = eContext(dir, { dry: true });
    expect(await runE(ctx, deps(seen))).toBe(0);
    const all = rows();
    const photos = all.filter((r) => r.type === "e-photo") as unknown as EPhotoRow[];
    const reads = all.filter((r) => r.type === "e-read") as unknown as EReadRow[];
    expect(photos.map((p) => p.photoId)).toEqual(["mt-1", "mt-2", "mt-3"]);
    expect(reads).toHaveLength(3 * 3 * 2);
    const truth = (id: string) => (photos.find((p) => p.photoId === id) as EPhotoRow).truth;
    expect(truth("mt-1")).toMatchObject({ source: "file", focal35mm: 26, orientation: 1 });
    // match.json's lens is used, the file's orientation always (the photo is turned by it), and the line says so.
    expect(truth("mt-2")).toMatchObject({ source: "match.json", orientation: 6, upright: { width: 1200, height: 1600 }, disagreements: ["orientation: match.json 1, the file 6 (the file's is used: the photo is turned by it)"] });
    expect(truth("mt-2").exifFovDeg).toBeCloseTo(verticalFovDegFrom35mm(50, 1200, 1600), 12);
    expect(truth("mt-3").exifFovDeg).toBeNull();
    expect((photos.find((p) => p.photoId === "mt-2") as EPhotoRow).sent).toMatchObject({ width: 1200, height: 1600 });
    expect(out.join("\n")).toMatch(/EXIF DISAGREES for mt-2: orientation: match.json 1, the file 6 \(the file's is used: the photo is turned by it\)/);
    expect(out.join("\n")).not.toMatch(/match.json's figure is used/);
    // The fakes: Astra within 5% of each truth; mini 35% wide, and its run 2 cut short.
    expect(reads.filter((r) => r.builder === "astra").every((r) => r.outcome === "read" && (r.exifFovDeg === null ? r.within === null : r.within === true))).toBe(true);
    expect(reads.filter((r) => r.builder === "mini" && r.run === 2).map((r) => [r.outcome, r.why])).toEqual(Array(3).fill(["miss", "invalid"]));
    // Every read with a camera is placed and drawn, the figure on the mark.
    const framed = reads.filter((r) => r.outcome === "read");
    expect(framed.every((r) => r.stage && r.frame)).toBe(true);
    expect(seen.flatMap((j) => j.poses).every((p) => p.figure === true && p.aspect === undefined)).toBe(true);
    expect(seen.every((j) => j.mark && j.mark.x === j.spec.marks[0].x && j.mark.z === j.spec.marks[0].z)).toBe(true);
    // One sheet per rater, an item per drawn read, the builder only in the key.
    const keys = readdirSync(join(runDir, "keys")).map((f) => JSON.parse(readFileSync(join(runDir, "keys", f), "utf8")) as SheetKey);
    expect(keys.map((k) => k.kind)).toEqual(["e-match", "e-match"]);
    expect(keys[0].items).toHaveLength(framed.length);
    expect(new Set(keys[0].items.map((i) => i.source.builder))).toEqual(new Set(["astra", "mini"]));
    for (const s of readdirSync(join(runDir, "sheets"))) {
      const html = readFileSync(join(runDir, "sheets", s, "index.html"), "utf8");
      for (const w of ["astra", "mini", "mt-1", "e-read"]) expect(html).not.toContain(w);
    }
    // Beside each view, the photo's sheet copy: the still's square outlined, one copy a photo whoever read it,
    // at the size sent, dimmed outside the square (all three photos here are wider or taller than square).
    for (const p of photos) {
      const shown = new Set(keys[0].items.filter((it) => it.source.photoId === p.photoId).map((it) => it.images[0].path));
      expect([...shown]).toEqual([join(runDir, "photos", `${p.photoId}.square.jpg`)]);
      const copy = await (sharp as SharpFn)(readFileSync([...shown][0])).raw().toBuffer({ resolveWithObject: true });
      expect([copy.info.width, copy.info.height]).toEqual([p.sent.width, p.sent.height]);
      const sent = await (sharp as SharpFn)(readFileSync(join(runDir, "photos", `${p.photoId}.jpg`))).raw().toBuffer({ resolveWithObject: true });
      const sq = photoSquare(p.sent.width, p.sent.height);
      const at = (d: Buffer, x: number, y: number) => d[(y * p.sent.width + x) * 3];
      const [ox, oy] = sq.left > 0 ? [Math.floor(sq.left / 2), Math.floor(p.sent.height / 2)] : [Math.floor(p.sent.width / 2), Math.floor(sq.top / 2)];
      expect(at(copy.data, ox, oy)).toBeLessThan(at(sent.data, ox, oy) * 0.6);
      const [cx, cy] = [sq.left + Math.floor(sq.size / 2), sq.top + Math.floor(sq.size / 2)];
      expect(Math.abs(at(copy.data, cx, cy) - at(sent.data, cx, cy))).toBeLessThanOrEqual(3);
    }
    // mt-2 shows people, and every sheet holds every read: no sheet leaves this machine.
    expect(out.join("\n")).toMatch(/--- rater sheets \(photos of people on every sheet: mt-2\. They stay on this machine: each rater rates here, opening only their own sheet, and no folder is sent/);
    // A photo's bytes never enter the manifest, the ledger or the results: its hash and size do.
    const files = ctx.manifest.photoFiles as Record<string, Record<string, unknown>>;
    for (const f of Object.values(files)) expect(Object.keys(f).sort()).toEqual(["file", "height", "sha256", "width"]);
    for (const text of [JSON.stringify(ctx.manifest), readFileSync(join(runDir, "results.jsonl"), "utf8")]) expect(text).not.toMatch(/data:image|base64,/);
    // Simulated money: every Astra read reserved and settled at the match caps; mini unpriced.
    expect(guard.settledUsd).toBeCloseTo(9 * book.astraMatchWorstUsd, 9);
    expect(net.liveCalls + net.blocked.length).toBe(0);
  });

  it("draws a set's views a page load at a time, every view once", async () => {
    const { dir } = await corpus();
    const seen: RenderJob[] = [];
    // 3 photos × 10 runs on 2 builders: whichever sets they are pinned to, one holds more than a page.
    const { ctx, rows } = eContext(dir, { dry: true, argv: ["--runs", "10"] });
    expect(await runE(ctx, deps(seen))).toBe(0);
    const framed = (rows().filter((r) => r.type === "e-read") as unknown as EReadRow[]).filter((r) => r.frame);
    const poses = seen.flatMap((j) => j.poses.map((p) => p.poseId));
    expect(seen.every((j) => j.poses.length <= E_VIEWS_PER_PAGE)).toBe(true);
    expect(new Set(seen.map((j) => j.key)).size).toBeLessThan(seen.length);
    expect(poses.sort()).toEqual(framed.map((r) => r.readId).sort());
  });

  it("a real run (scripted providers): the product's requests, the picture check first, a refused photo never sent, no Batch, and report settles barE", async () => {
    const { dir, files } = await corpus();
    process.env.OPENAI_API_KEY = "test-key-not-real";
    const prepared = async (id: string) => {
      const p = await preparePhoto(id, files[id]);
      if (!p.ok) throw new Error(p.error);
      return p.photo;
    };
    const [p1, p2, p3] = [await prepared("mt-1"), await prepared("mt-2"), await prepared("mt-3")];
    const usage = { input_tokens: 2400, input_tokens_details: { cached_tokens: 600, cache_write_tokens: 0 }, output_tokens: 700 };
    // Astra reads each photo's lens within 5%; mini 40% wide of it.
    const truthFov: Record<string, number> = {};
    const answer = (dataUrl: string, factor: number) => {
      const fov = (dataUrl === p1.dataUrl ? truthFov["mt-1"] : truthFov["mt-2"]) * factor;
      return JSON.stringify({ subject_found: true, camera_height_m: 1.5, pitch_deg: -5, vertical_fov_deg: fov, subject_distance_m: 3, subject_x: 0.5, framing: "full", confidence: "high" });
    };
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    const completed = (id: string, text: string, model?: string) => ({ id, status: "completed", ...(model ? { model } : {}), output: [{ type: "message", content: [{ type: "output_text", text }] }], usage });
    const astraJobs = new Map<string, string>();
    let n = 0;
    const provider = async (url: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { background?: boolean; input: { content: { image_url?: string }[] }[] };
        const image = body.input[0].content[1].image_url as string;
        n += 1;
        if (body.background) {
          const id = `resp_astra${String(n).padStart(4, "0")}`;
          astraJobs.set(id, answer(image, 1.05));
          return json({ id });
        }
        return json(completed(`resp_mini${String(n).padStart(5, "0")}`, answer(image, 1.4), "gpt-5.4-mini"));
      }
      const id = url.split("/").pop() as string;
      return json(completed(id, astraJobs.get(id) as string));
    };
    const { ctx, calls, events, runDir, rows } = eContext(dir, { dry: false, argv: ["--spend", "--max-usd", "5", "--allow-unpriced", "mini-5.4,gates", "--runs", "1"], provider });
    const read: string[] = [];
    class Refusal extends Error {
      constructor(readonly reason: string) {
        super(reason);
      }
    }
    ctx.gates = {
      words: async () => "allowed",
      brief: async () => "allowed",
      picture: makePictureCheck({
        assertOutputAllowed: async (i) => {
          read.push(i.imageUrl);
          if (i.imageUrl === p3.dataUrl) throw new Refusal("minors");
          return {};
        },
        refusalReason: (e) => (e instanceof Refusal ? e.reason : null),
        stopping: ctx.stopping,
      }),
    } as Gates;
    // The truth each photo is read against, as the run computes it.
    const { photoTruth } = await import("./match-truth.mts");
    truthFov["mt-1"] = (await photoTruth("mt-1", files["mt-1"], null)).exifFovDeg as number;
    truthFov["mt-2"] = (await photoTruth("mt-2", files["mt-2"], { focal35mm: 50, focalMm: null, orientation: 1 })).exifFovDeg as number;

    expect(await runE(ctx, deps())).toBe(0);
    // The picture check read each photo once, before any read; the refused one went nowhere else.
    expect(read.sort()).toEqual([p1.dataUrl, p2.dataUrl, p3.dataUrl].sort());
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.every((c) => c.url === "https://api.openai.com/v1/responses")).toBe(true);
    const sentImages = posts.map((c) => (JSON.parse(c.body) as { input: { content: { image_url?: string }[] }[] }).input[0].content[1].image_url);
    expect(new Set(sentImages)).toEqual(new Set([p1.dataUrl, p2.dataUrl]));
    expect(posts.some((c) => c.body.includes(p3.dataUrl))).toBe(false);
    expect(calls.some((c) => /\/v1\/(files|batches)/.test(c.url))).toBe(false);
    // Astra: byte for byte the product's request for the same bytes; mini: the same read as one call.
    const astraBodies = posts.filter((c) => JSON.parse(c.body).background === true).map((c) => c.body);
    expect(astraBodies.sort()).toEqual([p1, p2].map((p) => JSON.stringify(buildAstraRequestBody(matchShotRequest(photoDataUrl(p.jpeg), evalSafetyId("e"))))).sort());
    const miniBodies = posts.filter((c) => JSON.parse(c.body).background !== true).map((c) => c.body);
    expect(miniBodies.sort()).toEqual([p1, p2].map((p) => JSON.stringify(miniMatchBody(p.dataUrl, "e"))).sort());
    // Money: each Astra read reserved at the match caps' worst case, settled from its usage; mini unpriced, metered.
    expect(events.filter((e) => e.ev === "reserve").map((e) => (e as { kind: string; worstUsd: number }).worstUsd)).toEqual([book.astraMatchWorstUsd, book.astraMatchWorstUsd]);
    expect(events.filter((e) => e.ev === "settle")).toHaveLength(2);
    const reads = rows().filter((r) => r.type === "e-read") as unknown as EReadRow[];
    expect(reads.filter((r) => r.photoId === "mt-3").map((r) => [r.outcome, r.why])).toEqual([
      ["withheld", "the picture check refused:minors"],
      ["withheld", "the picture check refused:minors"],
    ]);
    expect(reads.filter((r) => r.photoId !== "mt-3").map((r) => [r.builder, r.outcome, r.within])).toEqual([
      ["astra", "read", true],
      ["mini", "read", false],
      ["astra", "read", true],
      ["mini", "read", false],
    ]);
    expect(ctx.manifest.complete).toBe(true);

    // The raters: Astra's views score 5 and 4, mini's 2.
    const keys = readdirSync(join(runDir, "keys")).map((f) => JSON.parse(readFileSync(join(runDir, "keys", f), "utf8")) as SheetKey);
    expect(keys).toHaveLength(2);
    const rate = (k: SheetKey) => ({ sheetId: k.sheetId, raterId: k.raterId, ratings: k.items.map((it) => ({ itemId: it.itemId, score: it.source.builder === "astra" ? (k.raterId === "r1" ? 5 : 4) : 2 })) });
    writeFileSync(join(runDir, "ratings", "r1.json"), JSON.stringify(rate(keys.find((k) => k.raterId === "r1") as SheetKey)));
    const lines: string[] = [];
    const reportOf = async () => {
      lines.length = 0;
      const p = parseCli(["report", runDir]);
      if (!p.ok || p.cli.cmd !== "report") throw new Error("cli");
      return runReport({ runDirs: [runDir], flags: p.cli.flags, book, repoRoot: REPO_ROOT, outRoot: join(root, "reports"), out: (l = "") => lines.push(l) });
    };
    // One rater back: every read lacks its second rating, so the rating bar and the route stay open —
    // and with it whose FOV bar decides: Astra's passes, mini's fails, so neither counts yet.
    expect(await reportOf()).toBe(2);
    expect(lines.find((l) => l.startsWith("  E Astra vertical FOV"))).toMatch(/2\/2 = 100\.0% ≥ 80%.*→ REPORTED  \(measured: PASS\)/);
    expect(lines.find((l) => l.startsWith("  E gpt-5.4-mini vertical FOV"))).toMatch(/→ REPORTED  \(measured: FAIL\)/);
    expect(lines.find((l) => l.startsWith("  E Astra blind match rating"))).toMatch(/→ UNDETERMINED/);
    expect(lines.join("\n")).toMatch(/E FOV \? rating \?; route: \?/);
    writeFileSync(join(runDir, "ratings", "r2.json"), JSON.stringify(rate(keys.find((k) => k.raterId === "r2") as SheetKey)));
    expect(await reportOf()).toBe(0);
    expect(lines.find((l) => l.startsWith("  E Astra blind match rating"))).toMatch(/2\/2 = 100\.0% ≥ 70%.*→ PASS/);
    expect(lines.find((l) => l.startsWith("  E gpt-5.4-mini vertical FOV"))).toMatch(/0\/2 = 0\.0%.*→ REPORTED/);
    expect(lines.join("\n")).toMatch(/Match this shot \(astra_photo_sets; SETS_OPEN_TO_PLANS never opens it\) at SET_MATCH_EFFORT = low: E FOV ✓ rating ✓; route: astra/);
    expect(lines.join("\n")).toMatch(/the picture check refused 1 photo\(s\), never sent and outside the bars: mt-3/);
    expect(lines.join("\n")).toMatch(/SETS_OPEN_TO_PLANS needs A–D PASS .*: A \? B \? C \? D \?/);
  });

  it("a stop reaches the reads still queued: never sent, missing, and the run is not complete", async () => {
    const { dir } = await corpus();
    process.env.OPENAI_API_KEY = "test-key-not-real";
    let submits = 0;
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    let stop: (r: StopReason) => void = () => {};
    const provider = async (_url: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === "POST") {
        submits += 1;
        // The budget stops while the first reads are out: what is in flight lands, nothing new starts.
        stop("budget");
        return JSON.parse(String(init.body)).background ? json({ id: `resp_astra${String(submits).padStart(4, "0")}` }) : json({ id: `resp_mini${String(submits).padStart(5, "0")}`, status: "failed", error: { code: "server_error" } });
      }
      return json({ id: "resp_x", status: "failed", error: { code: "server_error" } });
    };
    const { ctx, rows, stopWith } = eContext(dir, { dry: false, argv: ["--spend", "--max-usd", "5", "--allow-unpriced", "mini-5.4,gates", "--runs", "3"], provider });
    stop = stopWith;
    ctx.gates = { words: async () => "allowed", brief: async () => "allowed", picture: async () => "allowed" } as Gates;
    expect(await runE(ctx, deps())).toBe(2);
    const reads = rows().filter((r) => r.type === "e-read") as unknown as EReadRow[];
    expect(submits).toBeLessThan(reads.length);
    const unsent = reads.filter((r) => r.why === "not_run:budget");
    expect(unsent.length).toBe(reads.length - submits);
    expect(unsent.every((r) => r.outcome === "missing" && r.usage === null)).toBe(true);
    expect(ctx.manifest.complete).toBe(false);
    expect(readdirSync(join(ctx.runDir, "keys"))).toEqual([]);
  });

  it("a stage view that could not be drawn leaves the run unfinished: no sheets, and it says to rerun E", async () => {
    const { dir } = await corpus();
    process.env.OPENAI_API_KEY = "test-key-not-real";
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    const text = JSON.stringify({ subject_found: true, camera_height_m: 1.5, pitch_deg: -5, vertical_fov_deg: 40, subject_distance_m: 3, subject_x: 0.5, framing: "full", confidence: "high" });
    const usage = { input_tokens: 2400, input_tokens_details: { cached_tokens: 600, cache_write_tokens: 0 }, output_tokens: 700 };
    const done = (id: string, model?: string) => ({ id, status: "completed", ...(model ? { model } : {}), output: [{ type: "message", content: [{ type: "output_text", text }] }], usage });
    let n = 0;
    const provider = async (url: string, init?: RequestInit): Promise<Response> => {
      if (init?.method !== "POST") return json(done(url.split("/").pop() as string));
      n += 1;
      return JSON.parse(String(init.body)).background ? json({ id: `resp_astra${String(n).padStart(4, "0")}` }) : json(done(`resp_mini${String(n).padStart(5, "0")}`, "gpt-5.4-mini"));
    };
    const { ctx, rows, out } = eContext(dir, { dry: false, argv: ["--spend", "--max-usd", "5", "--allow-unpriced", "mini-5.4,gates", "--runs", "1"], provider });
    ctx.gates = { words: async () => "allowed", brief: async () => "allowed", picture: async () => "allowed" } as Gates;
    // One set's page load fails (chrome.mts's 60 s limit, say): renderSets answers for that set alone, and never throws.
    const drawn = fakeRender([]);
    const render: EDeps["render"] = async (o) => (await drawn(o)).map((x, i): Rendered => (i === 0 ? { key: x.key, ok: false, error: "evaluate timed out after 60 s" } : x));
    expect(await runE(ctx, { render, clock: fakeClock(), chromeFound: () => true })).toBe(2);
    const reads = rows().filter((r) => r.type === "e-read") as unknown as EReadRow[];
    const lost = reads.filter((r) => r.stage && !r.frame);
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.every((r) => r.renderError === "evaluate timed out after 60 s")).toBe(true);
    expect(ctx.manifest.complete).toBe(false);
    expect(out.join("\n")).toContain(`DID NOT FINISH (${lost.length} stage view(s) could not be drawn: evaluate timed out after 60 s): E does not resume, so rerun it`);
    expect(out.join("\n")).toMatch(/--- rater sheets: none until the run finishes ---/);
    expect(readdirSync(join(ctx.runDir, "keys"))).toEqual([]);
  });
});
