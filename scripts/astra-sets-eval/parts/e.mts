// Part E: Match this shot, measured (docs/ASTRA_SETS.md section 4, row E).
// Every reference photo × 3 runs is read by both builders the way the
// product reads a reference (src/lib/sets/match-actions.ts matchSetShot),
// without the database:
//
//   1. the ground truth, from the ORIGINAL file (lib/match-truth.mts): its
//      stored size and orientation, and its lens — match.json's figure, or
//      the file's own EXIF where match.json leaves it out; where both give
//      one and they differ, it is reported, with the figure used (the
//      file's orientation always: the photo is turned by it). A file whose
//      EXIF frame is not the picture's shape was cropped: its own lens is
//      not the picture's
//   2. the product's own preparation (lib/photos.mts: the browser's step,
//      then parseSetPhotoDataUri and normaliseSetPhoto — no EXIF leaves).
//      It only scales, so the field of view is the file's: the shape sent
//      must hold within a pixel (aspectHeld), or the run stops before
//      anything is sent
//   3. the picture check (assertOutputAllowed on the photo's own bytes,
//      strict lane), once per photo: every read sends those same bytes. A
//      photo it refuses is recorded and never sent, as in the product, and
//      is outside the bars. Never gatePrompt or recordPolicyRefusal
//   4. the reads: Astra gets the product's matchShotRequest in background,
//      polled every SET_MATCH_POLL_MS and cancelled at SET_MATCH_DEADLINE_MS;
//      gpt-5.4-mini the same instructions, schema and input as one call
//      (lib/builders.mts, lib/transports.mts). NEVER ON BATCH: a Batch line
//      is a line of an uploaded file, and a photo in it would sit in
//      OpenAI's Files storage, which the product never does. Every read is
//      reserved at its worst case and settled from its usage
//   5. the answer, read by the product's own parseMatchShotText: an answer
//      it refuses is a miss, and counted (pass-bars.mts barE says how every
//      read counts)
//   6. the stage view: the product's solveMatchPose and placeMatchedCamera
//      in a set (lib/match-pose.mts), drawn as the still would be framed —
//      the centre square, the set's own lift, the grey figure on the mark —
//      in the local Chrome B and C draw in, then laid beside the photo on a
//      blind sheet (e-match). Builder labels live only in keys/
//
// The bars are held by the builder Match runs on (pass-bars barE: the
// route). Both builders' FOV shares print here, and the FOV bar settles
// here where they agree or the FOV alone sends Match to mini; the rating
// bar and the route in report, once both raters' sheets are back.
//
// The sets to match in come from --from-run (every delivered Astra set of
// that A run) or, without one, the product's four recorded fixture sets, and
// each photo's set is pinned by the run's seed (match-pose.mts pinnedSet).
//
// E does not resume, like D: a run that stops (Ctrl-C, the budget) leaves
// what it did not read missing, is not complete, and report never passes a
// bar on it — rerun it. A photo's bytes never enter the ledger or the
// manifest (its hash and size do); the run keeps the bytes it sent in its
// photos/, for the sheet.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { parseMatchShotText, type CameraPose, type MatchNotes, type ShotMatch } from "../../../src/lib/sets/match-shot.ts";
import { SET_MATCH_DEADLINE_MS, SET_MATCH_EFFORT, SET_MATCH_INPUT_TOKENS, SET_MATCH_MAX_OUTPUT_TOKENS } from "../../../src/lib/sets/set-config.ts";
import type { SetSpec } from "../../../src/lib/sets/set-spec.ts";
import type { AttemptMeta, BuildRecord } from "../lib/build-flow.mts";
import type { SheetItemIn } from "../lib/blind-sheet.mts";
import { matchAstraRequest, MINI_MODEL } from "../lib/builders.mts";
import { barLine, spendLines, writeManifest, writeResult, writeSummary, type RunContext } from "../lib/context.mts";
import { MATCH_PHOTOS_WANTED, type MatchRow } from "../lib/corpus.mts";
import { transportEnv } from "../lib/drive.mts";
import { aspectHeld } from "../lib/exif-fov.mts";
import { matchPromptFingerprint } from "../lib/fingerprint.mts";
import { buildForMatching, matchedStagePose, matchFramePose, pinnedSet, type StagePose } from "../lib/match-pose.mts";
import { photoTruth, type PhotoTruth } from "../lib/match-truth.mts";
import { barE, capAtUndetermined, fovWithin, type BarResult, type EItem, type EOutcome } from "../lib/pass-bars.mts";
import type { PreparedPhoto } from "../lib/photos.mts";
import { planE } from "../lib/plan.mts";
import { median } from "../lib/stats.mts";
import { astraMatchAttempt, miniMatchAttempt, REAL_CLOCK, settleAstra, type MatchAttempt, type MatchClock } from "../lib/transports.mts";
import { HarnessError, mapLimit, Semaphore, usd } from "../lib/util.mts";
import { NOT_REACHED, type GateVerdict, type NotReached } from "../lib/words-gate.mts";
import { DEFAULT_CHROME } from "../render/chrome.mts";
import { renderSets, type RenderJob, type Rendered } from "../render/render-sets.mts";
import { readRun, specOf } from "./b.mts";
import { preparePhotos, runSeed, selectRows, writeRaterSheets, type PartModule } from "./common.mts";
import { fakeMatchAnswer, fakeMatchPictureCheck, FIXTURES, fixtureJson, matchCapUsage } from "./simulate.mts";

/** Section 4's heading: "3 runs each". */
export const E_DEFAULT_RUNS = 3;
/** The two builders section 4 compares; the names barE reads. */
export const E_BUILDERS = ["astra", "mini"] as const;
export type EBuilder = (typeof E_BUILDERS)[number];
/**
 * Stage views drawn in one page load: chrome.mts gives a page 60 s, and hands
 * every frame back in one message. Twelve views took 2.2–4.4 s a page in
 * swiftshader (a dry run, 2026-09-11); a set holding 45 reads gets four
 * loads, each measuring the same lift.
 */
export const E_VIEWS_PER_PAGE = 12;

/** The doc's own Match-this-shot figures, quoted with their line numbers (never retyped). */
export function docFigures(repoRoot: string): string[] {
  const p = join(repoRoot, "docs/ASTRA_SETS.md");
  if (!existsSync(p)) return ["docs/ASTRA_SETS.md not found"];
  const lines = readFileSync(p, "utf8").split("\n");
  const out: string[] = [];
  const at = lines.findIndex((l) => l.includes("Match this shot on its own"));
  if (at < 0) out.push("docs/ASTRA_SETS.md: the Match-this-shot figures were not found");
  for (let i = at; at >= 0 && i < lines.length && i < at + 4 && lines[i].trim() && !lines[i].trim().startsWith("```"); i++) {
    out.push(`docs/ASTRA_SETS.md:${i + 1}  ${lines[i].trim()}`);
  }
  const spend = lines.findIndex((l) => l.trim().startsWith("E match:"));
  if (spend >= 0) out.push(`docs/ASTRA_SETS.md:${spend + 1}  ${lines[spend].trim()}`);
  return out;
}

export type PictureCheckMark = "allowed" | `refused:${string}` | "unavailable" | "not-reached";

/** One photo: its truth (numbers only), what was sent, the picture check, and the set it is matched in. */
export type EPhotoRow = {
  type: "e-photo";
  photoId: string;
  simulated: boolean;
  containsPeople: boolean;
  truth: PhotoTruth;
  sent: { width: number; height: number; sha256: string };
  pictureCheck: PictureCheckMark;
  setKey: string;
};

/** One read: a photo × run × builder (withheld: the picture check refused the photo, so it was never sent). */
export type EReadRow = {
  type: "e-read";
  readId: string;
  builder: EBuilder;
  photoId: string;
  run: number;
  simulated: boolean;
  outcome: EOutcome | "withheld";
  why: string;
  detail: string | null;
  match: ShotMatch | null;
  fovDeg: number | null;
  exifFovDeg: number | null;
  within: boolean | null;
  usage: Record<string, unknown> | null;
  billedUsd: number | null;
  standardUsd: number | null;
  costFlag: string | null;
  latencyMs: number | null;
  answerFile: string | null;
  setKey: string;
  stage: { position: CameraPose["position"]; target: CameraPose["target"]; fovDeg: number; moved: StagePose["moved"]; notes: MatchNotes; summary: StagePose["summary"] } | null;
  frame: string | null;
  renderError: string | null;
};

/**
 * What a read's attempt means for the bars (pass-bars barE): a camera; a
 * miss — the builder's own answer, unusable (unparsable, refused, cut off
 * at the output cap, or still reading at the product's deadline, on either
 * builder: transports.mts says how each shows it); or missing — nothing to
 * judge it by (never sent, never answered, a deadline that passed with no
 * word from OpenAI, a failure on OpenAI's side, which the product tells the
 * person to try again on).
 */
export function readOutcome(a: MatchAttempt): { outcome: EOutcome; why: string; match: ShotMatch | null } {
  const r = a.r;
  if (r.state === "done") {
    const parsed = parseMatchShotText(r.text);
    return parsed.ok ? { outcome: "read", why: "read", match: parsed.match } : { outcome: "miss", why: "invalid", match: null };
  }
  if (a.timedOut) return { outcome: "miss", why: "timed_out", match: null };
  if (a.unanswered) return { outcome: "missing", why: "unanswered", match: null };
  if (r.state === "failed") {
    if (r.interrupted) return { outcome: "missing", why: "not_run:interrupted", match: null };
    if (r.kind === "refused" || r.kind === "incomplete") return { outcome: "miss", why: r.kind, match: null };
    return { outcome: "missing", why: r.kind, match: null };
  }
  if (r.kind === "refused") return { outcome: "miss", why: "refused", match: null };
  const notRun: Record<string, string> = { budget: "budget", stopped: "interrupted", bad_request: "rejected", config: "config" };
  return { outcome: "missing", why: `not_run:${notRun[r.kind] ?? "transport"}`, match: null };
}

type ESet = { key: string; spec: SetSpec; from: string };

/** The sets E matches in: every delivered Astra set of an A run, or the product's recorded fixture sets. */
export function setPool(fromRun: string | null): ESet[] {
  if (!fromRun) return FIXTURES.map((name) => ({ key: `fx-${name}`, spec: specOf(fixtureJson(name)), from: `src/lib/sets/fixtures-${name}.json` }));
  const a = readRun(fromRun);
  if (a.manifest.part !== "a") throw new HarnessError(`--from-run ${fromRun} is not an A run`);
  if (a.manifest.simulated !== true && a.manifest.complete !== true) throw new HarnessError(`--from-run ${fromRun} did not finish (interrupted or stopped): --resume it first`);
  const delivered = (a.rows as unknown as BuildRecord[]).filter((r) => r.type === "build" && r.status === "delivered" && r.specFile && r.builder.startsWith("astra-"));
  if (delivered.length === 0) throw new HarnessError(`--from-run ${fromRun} delivered no Astra set to match in`);
  return delivered.map((r) => ({ key: r.buildId, spec: specOf(JSON.parse(readFileSync(join(fromRun, r.specFile as string), "utf8"))), from: fromRun }));
}

/** A read's sheet item: the photo it was read from, and on its right the stage view it solved to. Only the key knows the builder. */
export function eSheetItem(runId: string, read: Pick<EReadRow, "readId" | "builder" | "photoId" | "run">, photoPath: string, framePath: string): SheetItemIn {
  return {
    source: { part: "e", runId, readId: read.readId, builder: read.builder, photoId: read.photoId, run: read.run },
    groupKey: read.photoId,
    images: [
      { role: "photo", path: photoPath },
      { role: "snapshot", path: framePath },
    ],
  };
}

/** The reads as barE counts them (ratings come from report). A withheld read is not an item. */
export function eItems(reads: readonly EReadRow[], ratings: (readId: string) => number[] = () => []): EItem[] {
  return reads
    .filter((r): r is EReadRow & { outcome: EOutcome } => r.outcome !== "withheld")
    .map((r) => ({ builder: r.builder, outcome: r.outcome, fovDeg: r.fovDeg, exifFovDeg: r.exifFovDeg, ratings: ratings(r.readId) }));
}

/** What the part needs from outside: the renderer and the read's clock (a test hands in its own). */
export type EDeps = { render: typeof renderSets; clock: MatchClock; chromeFound: (path: string) => boolean };

type ERead = { readId: string; builder: EBuilder; row: MatchRow; run: number; index: number };

function simulatedRead(ctx: RunContext, read: ERead, exifFovDeg: number | null): MatchAttempt {
  const usage = matchCapUsage(read.builder);
  const r = fakeMatchAnswer(read.builder, read.index, read.run, exifFovDeg, usage);
  let meta: AttemptMeta;
  if (read.builder === "astra") {
    const worst = ctx.book.astraMatchWorstUsd;
    const res = ctx.guard.reserve("astra", worst, read.readId);
    if (!res.ok) return { r: { state: "submit-failed", kind: "budget", detail: res.reason }, meta: { transport: "simulated", billedUsd: 0, standardUsd: 0 } };
    meta = { ...settleAstra(ctx, res.ticket, worst, usage, "background"), transport: "simulated" };
  } else {
    const cost = ctx.book.modelCost(MINI_MODEL, usage, "openai");
    const worst = ctx.book.matchBaselineWorstUsd(MINI_MODEL);
    if (worst !== null && cost !== null) {
      const res = ctx.guard.reserve("mini-5.4", worst, read.readId);
      if (res.ok) ctx.guard.settle(res.ticket, cost, cost, "usage (simulated)", usage);
    }
    meta = { transport: "simulated", billedUsd: cost, standardUsd: cost };
  }
  if (r.state === "done") {
    const file = `answers/${read.readId}.txt`;
    writeFileSync(join(ctx.runDir, file), r.text);
    meta.answerFile = file;
  }
  return { r, meta };
}

const checkMark = (v: GateVerdict | NotReached): PictureCheckMark => (v === NOT_REACHED ? "not-reached" : typeof v === "object" ? `refused:${v.refused}` : v);

export async function runE(ctx: RunContext, deps: EDeps): Promise<number> {
  const f = ctx.flags;
  const runs = f.runs ?? E_DEFAULT_RUNS;
  let rows = selectRows(ctx.corpus.data.match, f.only);
  if (ctx.dry) rows = rows.slice(0, 3);
  if (rows.length === 0) throw new HarnessError("match.json has no photo to read");
  ctx.manifest.transport = { astra: "background", mini: "sync", photos: true };
  ctx.manifest.matchPromptFingerprint = matchPromptFingerprint();
  ctx.manifest.plannedReads = Object.fromEntries(E_BUILDERS.map((b) => [b, rows.length * runs]));
  // Every read ends in a stage view drawn in Chrome: missing, it would strand paid reads unrated.
  const chrome = f.chrome ?? DEFAULT_CHROME;
  if (!deps.chromeFound(chrome)) throw new HarnessError(`Chrome not found at ${chrome}: E draws each read's stage view in it (pass --chrome <path>); nothing was called`);

  // 1. The truth, from each ORIGINAL file, before anything is prepared or sent.
  const truths = new Map<string, PhotoTruth>();
  for (const row of rows) truths.set(row.id, await photoTruth(row.id, readFileSync(join(ctx.corpusDir, row.file)), row.exif));
  // 2. Prepared as the product prepares a reference, and only scaled.
  const store = await preparePhotos(ctx, rows.map((r) => ({ id: r.id, file: r.file, notes: "", licence: r.licence, template: r.template })), { keep: true });
  ctx.photos = store;
  const photoOf = (id: string) => store.get(id) as PreparedPhoto;
  for (const row of rows) {
    const t = truths.get(row.id) as PhotoTruth;
    const p = store.get(row.id);
    if (!p || !aspectHeld(t.upright, p)) {
      throw new HarnessError(`match photo ${row.id}: preparing it changed its shape (${t.upright.width} × ${t.upright.height} → ${p?.width} × ${p?.height}), so its field of view is no longer the file's; nothing was sent`);
    }
  }
  ctx.manifest.truth = Object.fromEntries(truths);

  // 3. The sets, each photo's pinned by the seed.
  const seed = runSeed(ctx);
  const pool = setPool(f.fromRun);
  const pinned = new Map(rows.map((r) => [r.id, pinnedSet(pool, r.id, seed)]));
  ctx.manifest.sets = { from: f.fromRun ?? "the product's fixture sets", pinned: Object.fromEntries([...pinned].map(([id, s]) => [id, s.key])) };
  writeManifest(ctx);

  // 4. The picture check, once per photo, before any read. A stop reaches
  // the photos still queued for it (words-gate.mts): never sent.
  const picture = ctx.dry ? null : (ctx.gates?.picture ?? null);
  if (!ctx.dry && !picture) throw new HarnessError("E needs the picture check");
  const checks = new Map<string, PictureCheckMark>();
  await Promise.all(
    rows.map(async (row, i) => {
      const v = ctx.stopping() ? NOT_REACHED : picture ? await picture(photoOf(row.id).dataUrl, { promptScores: null, priorHits: 0 }, row.id) : fakeMatchPictureCheck(i);
      checks.set(row.id, checkMark(v));
    }),
  );

  // 5. The reads: every run × photo × builder the check let through, the
  // builders side by side so both keep their slots busy.
  const reads: ERead[] = [];
  for (let run = 1; run <= runs; run++) rows.forEach((row, index) => E_BUILDERS.forEach((builder) => reads.push({ readId: `e-${builder}-${row.id}-r${run}`, builder, row, run, index })));
  const attempts = new Map<string, MatchAttempt>();
  const env = transportEnv(ctx);
  const sems: Record<EBuilder, Semaphore> = { astra: new Semaphore(6), mini: new Semaphore(4) };
  let configDetail: string | null = null;
  await mapLimit(
    reads.filter((r) => checks.get(r.row.id) === "allowed"),
    10,
    async (read) => {
      await sems[read.builder].use(async () => {
        // Asked when this read's turn comes: a stop reaches the ones still queued.
        if (ctx.stopping()) return;
        const photo = photoOf(read.row.id);
        const a = ctx.dry
          ? simulatedRead(ctx, read, (truths.get(read.row.id) as PhotoTruth).exifFovDeg)
          : read.builder === "astra"
            ? await astraMatchAttempt(env, read.readId, matchAstraRequest(photo.dataUrl, ctx.part), deps.clock)
            : await miniMatchAttempt(env, read.readId, photo.dataUrl);
        attempts.set(read.readId, a);
        if (a.r.state === "submit-failed" && a.r.kind === "config") {
          // Our configuration (a 401 or 403), not the model: nothing new starts.
          configDetail ??= a.r.detail;
          ctx.requestStop("config");
        }
        ctx.progress(`${read.readId} ${readOutcome(a).why}`);
      });
    },
    ctx.stopping,
  );
  const stop = ctx.stopReason() ?? ctx.guard.stopped?.reason ?? null;
  const unread = `not_run:${stop === "sigint" ? "interrupted" : (stop ?? "unfinished")}`;

  // Every planned read's row: read, miss, missing, or withheld.
  const readRows: EReadRow[] = reads.map((read) => {
    const t = truths.get(read.row.id) as PhotoTruth;
    const set = pinned.get(read.row.id) as ESet;
    const base = { type: "e-read" as const, readId: read.readId, builder: read.builder, photoId: read.row.id, run: read.run, simulated: ctx.dry, exifFovDeg: t.exifFovDeg, setKey: set.key };
    const none = { detail: null, match: null, fovDeg: null, within: null, usage: null, billedUsd: null, standardUsd: null, costFlag: null, latencyMs: null, answerFile: null, stage: null, frame: null, renderError: null };
    const check = checks.get(read.row.id) as PictureCheckMark;
    if (check !== "allowed") {
      const why = check === "unavailable" ? "not_run:picture check unavailable" : check === "not-reached" ? unread : `the picture check ${check}`;
      return { ...base, ...none, outcome: check.startsWith("refused:") ? "withheld" : "missing", why };
    }
    const a = attempts.get(read.readId);
    if (!a) return { ...base, ...none, outcome: "missing", why: unread };
    const o = readOutcome(a);
    const fovDeg = o.match ? o.match.verticalFovDeg : null;
    return {
      ...base,
      ...none,
      outcome: o.outcome,
      why: o.why,
      detail: a.r.state === "done" ? null : a.r.detail,
      match: o.match,
      fovDeg,
      within: fovDeg !== null && t.exifFovDeg !== null ? fovWithin(fovDeg, t.exifFovDeg) : null,
      usage: a.r.state === "submit-failed" ? null : a.r.usage,
      billedUsd: a.meta.billedUsd,
      standardUsd: a.meta.standardUsd,
      costFlag: a.meta.costFlag ?? null,
      latencyMs: a.meta.latencyMs ?? null,
      answerFile: a.meta.answerFile ?? null,
    };
  });

  // 6. Each camera placed in its photo's set, then drawn: a set's views a
  // page load at a time.
  const built = new Map<string, ReturnType<typeof buildForMatching>>();
  const jobs: RenderJob[] = [];
  const open = new Map<string, RenderJob>();
  try {
    for (const r of readRows) {
      if (!r.match) continue;
      const set = pinned.get(r.photoId) as ESet;
      const scene = built.get(set.key) ?? buildForMatching(THREE, set.spec);
      built.set(set.key, scene);
      const photo = photoOf(r.photoId);
      const stage = matchedStagePose(THREE, set.spec, scene, r.match, photo.width / photo.height);
      r.stage = { position: stage.position, target: stage.target, fovDeg: stage.fovDeg, moved: stage.moved, notes: stage.solved.notes, summary: stage.summary };
      let job = open.get(set.key);
      if (!job || job.poses.length >= E_VIEWS_PER_PAGE) {
        const m = set.spec.marks[0];
        job = { key: set.key, spec: set.spec, mark: { x: m.x, z: m.z, facingDeg: m.facingDeg }, poses: [] };
        open.set(set.key, job);
        jobs.push(job);
      }
      job.poses.push(matchFramePose(r.readId, stage));
    }
  } finally {
    for (const scene of built.values()) scene.dispose();
  }
  let rendered: Rendered[] = [];
  let renderFailed: string | null = null;
  if (jobs.length) {
    try {
      rendered = await deps.render({ net: ctx.net, repoRoot: ctx.repoRoot, chromePath: f.chrome, jobs, outDir: join(ctx.runDir, "frames"), progress: ctx.progress });
    } catch (e) {
      renderFailed = e instanceof Error ? e.message.slice(0, 300) : String(e);
    }
  }
  const byRead = new Map<string, string>();
  const setErrors = new Map<string, string>();
  for (const x of rendered) {
    if (!x.ok) setErrors.set(x.key, x.error);
    else for (const [poseId, file] of Object.entries(x.files)) byRead.set(poseId, `frames/${file}`);
  }
  for (const r of readRows) {
    if (!r.stage) continue;
    r.frame = byRead.get(r.readId) ?? null;
    if (!r.frame) r.renderError = renderFailed ?? setErrors.get(r.setKey) ?? "not drawn";
  }

  // Complete: nothing stopped it, every read the check let through was
  // sent (a read OpenAI failed or never answered is still missing, and
  // bounded by the bars), and every stage view was drawn — renderSets
  // answers a set's failed page load (Chrome's 60 s limit, say) for that set
  // alone, and a read with no view can never be rated, nor E resumed.
  const undrawn = readRows.filter((r) => r.stage && !r.frame);
  const complete = stop === null && !renderFailed && undrawn.length === 0 && reads.every((r) => checks.get(r.row.id) !== "allowed" || attempts.has(r.readId));
  ctx.manifest.complete = complete;
  ctx.manifest.stop = stop;

  // 7. The rows, the sheets, the summary.
  const photoRows: EPhotoRow[] = rows.map((row) => {
    const p = photoOf(row.id);
    return {
      type: "e-photo",
      photoId: row.id,
      simulated: ctx.dry,
      containsPeople: row.containsPeople,
      truth: truths.get(row.id) as PhotoTruth,
      sent: { width: p.width, height: p.height, sha256: p.sha256 },
      pictureCheck: checks.get(row.id) as PictureCheckMark,
      setKey: (pinned.get(row.id) as ESet).key,
    };
  });
  for (const p of photoRows) writeResult(ctx, p);
  for (const r of readRows) writeResult(ctx, r);
  const photoFiles = ctx.manifest.photoFiles as Record<string, { file?: string }>;
  const items = readRows.filter((r) => r.frame).map((r) => eSheetItem(ctx.runId, r, join(ctx.runDir, photoFiles[r.photoId]?.file as string), join(ctx.runDir, r.frame as string)));
  const pages = complete || ctx.dry ? writeRaterSheets(ctx, "e-match", items) : [];

  const bars: BarResult[] = ctx.dry ? [] : barE(eItems(readRows)).filter((b) => b.id === "E-fov" || b.id === "E-fov-mini").map((b) => (complete ? b : capAtUndetermined(b, "the run did not finish")));

  const withTruth = photoRows.filter((p) => p.truth.exifFovDeg !== null);
  const out = [`E ${ctx.runId}${ctx.dry ? "  (DRY RUN: simulated picture check and answers; the stage views are drawn for real)" : ""}`];
  if (configDetail) out.push(`STOPPED: a request was refused for our configuration (${configDetail}): fix the key or the project's access, then rerun E`);
  else if (!complete && !ctx.dry) {
    const why = [
      ...(stop !== null ? [String(stop)] : []),
      ...(renderFailed ? [`the stage views could not be drawn: ${renderFailed}`] : undrawn.length ? [`${undrawn.length} stage view(s) could not be drawn: ${undrawn[0].renderError}`] : []),
    ];
    out.push(`DID NOT FINISH (${why.join("; ") || "unfinished"}): E does not resume, so rerun it`);
  }
  out.push(
    `  photos ${rows.length}: EXIF truth for ${withTruth.length} (match.json ${withTruth.filter((p) => p.truth.source === "match.json").length}, the file's own EXIF ${withTruth.filter((p) => p.truth.source === "file").length}); no 35 mm focal length for the picture as it is, so outside the FOV bar: ${rows.length - withTruth.length}`,
  );
  // Each line names the figure the truth uses (exif-fov.mts mergeExif).
  for (const p of photoRows.filter((x) => x.truth.disagreements.length)) out.push(`  EXIF DISAGREES for ${p.photoId}: ${p.truth.disagreements.join("; ")}`);
  const mark = (k: string) => photoRows.filter((p) => (k === "refused" ? p.pictureCheck.startsWith("refused:") : p.pictureCheck === k));
  const refused = mark("refused");
  out.push(
    `  picture check (once per photo): allowed ${mark("allowed").length}, refused ${refused.length}${refused.length ? ` (never sent, outside the bars: ${refused.map((p) => p.photoId).join(", ")})` : ""}, unavailable ${mark("unavailable").length}, not reached ${mark("not-reached").length}`,
  );
  out.push(`  sets to match in: ${f.fromRun ?? "the product's fixture sets"}, pinned per photo by seed ${seed}: ${photoRows.map((p) => `${p.photoId} → ${p.setKey}`).join(", ")}`);
  out.push("--- reads ---");
  for (const b of E_BUILDERS) {
    const mine = readRows.filter((r) => r.builder === b);
    const count = (o: EReadRow["outcome"]) => mine.filter((r) => r.outcome === o).length;
    const whys = new Map<string, number>();
    for (const r of mine) if (r.outcome === "miss" || r.outcome === "missing") whys.set(r.why, (whys.get(r.why) ?? 0) + 1);
    const judged = mine.filter((r) => r.exifFovDeg !== null && r.outcome !== "withheld" && r.outcome !== "missing");
    const lat = mine.map((r) => r.latencyMs).filter((x): x is number => x !== null);
    out.push(
      `  ${b === "astra" ? `Astra ${SET_MATCH_EFFORT}` : MINI_MODEL}: ${mine.length} reads: ${count("read")} read, ${count("miss")} miss, ${count("missing")} missing, ${count("withheld")} withheld${whys.size ? ` (${[...whys].map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}; within ±20% of EXIF ${judged.filter((r) => r.within).length}/${judged.length}${lat.length ? `; median latency ${Math.round((median(lat) as number) / 100) / 10} s` : ""}`,
    );
  }
  const drawn = readRows.filter((r) => r.frame).length;
  const placed = readRows.filter((r) => r.stage).length;
  out.push(`  stage views drawn ${drawn}/${placed}${placed > drawn ? ` (not drawn: ${placed - drawn}; those reads cannot be rated)` : ""}; the camera moved off its solved place for something built: ${readRows.filter((r) => r.stage && r.stage.moved !== "none").length}`);
  if (bars.length) {
    out.push(
      "--- bars: FOV (the rating bar and the route need both raters' sheets: run report) ---",
      "  the builder Match runs on holds the bars: until the route settles, a bar decides only where both builders agree",
      ...bars.map((b) => `  ${barLine(b)}`),
    );
  } else out.push(ctx.dry ? "--- bars: none (simulated rows are never a result) ---" : "--- bars: none ---");
  if (pages.length) {
    // Every rater's sheet holds every drawn read, so one photo of people on it puts people on every sheet.
    const people = rows.filter((r) => r.containsPeople && items.some((it) => it.groupKey === r.id)).map((r) => r.id);
    out.push(
      people.length
        ? `--- rater sheets (photos of people on every sheet: ${people.join(", ")}. They stay on this machine: each rater rates here, opening only their own sheet, and no folder is sent; keys/ stays with the operator) ---`
        : "--- rater sheets (send each rater only their own folder; keys/ stays with the operator) ---",
      ...pages.map((p) => `  ${p}`),
    );
    out.push(`  ratings come back as ratings-<sheetId>.json: put them in ${join(ctx.runDir, "ratings")}, then run report on this run.`);
  } else if (!ctx.dry) out.push("--- rater sheets: none until the run finishes ---");
  out.push(...spendLines(ctx));
  for (const l of out) ctx.out(l);
  writeSummary(ctx, out.join("\n"), { part: "e", simulated: ctx.dry, complete, photos: rows.length, reads: readRows.length, bars, sheets: pages.length });
  writeManifest(ctx);
  if (ctx.stopReason() === "sigint") return 130;
  if (!ctx.dry && (ctx.guard.stopped || !complete)) return 2;
  if (bars.some((b) => b.verdict === "FAIL")) return 1;
  if (bars.some((b) => b.verdict === "UNDETERMINED")) return 2;
  return 0;
}

export const partE: PartModule = {
  needs: () => ({ match: true }),

  plan(ctx) {
    const f = ctx.flags;
    const b = ctx.book;
    const rows = selectRows(ctx.corpus.data.match, f.only);
    const runs = f.runs ?? E_DEFAULT_RUNS;
    const spec = MATCH_PHOTOS_WANTED * E_DEFAULT_RUNS;
    return {
      title: `E: ${rows.length} reference photos × ${runs} runs × Astra ${SET_MATCH_EFFORT} and ${MINI_MODEL} (background and one call: photos never go on Batch)`,
      lines: planE({ photos: rows.length, runs, book: b }),
      notes: [
        ...docFigures(ctx.repoRoot),
        `Section 4 prices E at the one measured read, on Batch. A photo never goes into a Batch input file here (it would sit in OpenAI's Files storage, which the product never does), so every read is at standard price, reserved at its worst case: ${SET_MATCH_INPUT_TOKENS.toLocaleString("en-US")} input tokens at the cache-write rate + ${SET_MATCH_MAX_OUTPUT_TOKENS.toLocaleString("en-US")} output = ${usd(b.astraMatchWorstUsd, 5)} (set-config.ts); ${spec} reads = ${usd(spec * b.astraMatchWorstUsd, 2)}. These numbers stand; the doc is not edited.`,
        `Both builders get each photo's prepared bytes (the product's preparation, no EXIF) after one picture check per photo: Astra the product's matchShotRequest, ${MINI_MODEL} the same instructions, schema and input as one Responses call. Astra is polled as the product polls it and cancelled at ${SET_MATCH_DEADLINE_MS / 1000} s.`,
        `The sets to match in: ${f.fromRun ?? "the product's four fixture sets (--from-run <an A run> for built ones)"}, each photo's pinned by the seed. The stage views are drawn in a local, network-locked Chrome.`,
        "Every read counts on its own (no median over a photo's runs); an answer that does not parse, a refusal, one cut off at the cap and one still reading at the deadline (on either builder) are misses; a deadline that passed with no word from OpenAI is missing. The bars are held by the builder Match runs on: both builders' FOV shares print here, the rating bar and the route come from report. E does not resume.",
      ],
    };
  },

  run: (ctx) => runE(ctx, { render: renderSets, clock: REAL_CLOCK, chromeFound: existsSync }),
};
