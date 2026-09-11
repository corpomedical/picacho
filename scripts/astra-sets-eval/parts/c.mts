// Part C: stills. 10 sets (4 interior / 3 exterior / 3 stylised, from an A
// run at --effort, run 1 preferred) × their first 3 cameras × 2 characters
// = 60 shots per engine (GPT Image 2 edit, FLUX.2 Pro edit, Seedream v4
// edit), each on its own sketch: section 4's sample, and the one its bar
// reads (pass-bars.mts barC).
//
// THE LOOK (the product since 2026-09-11: sets/actions.ts shootInSet and the
// pipeline's lookImageUrl). For each set, character and engine, camera 1's
// still is shot first, on its own sketch. The later cameras are shot twice:
// on their own sketch (the no-look arm) and again carrying camera 1's still
// as the look, exactly as the product sends it — the same character, so the
// look sentences with sameCharacter true; no saved outfit photo (the corpus
// has none). A look rides only where the product lets it: a still, one
// character, GPT Image or FLUX, beside an identity photo (shots.mts
// lookRides). So the plan grows by 10 sets × 2 later cameras × 2
// characters = 40 look shots on each of GPT Image and FLUX. On the
// composition sheet every later camera's still, in either arm and on every
// engine, is shown beside its first still and asked one more question,
// whether its objects, vehicles and finishes are the first still's: a look
// shot and its twin are presented alike, and the twin is the look's
// baseline. Report prints that, and identity and composition with the look
// against without, as REPORTED lines: section 4 has no bar for the look.
// --no-look drops the arm.
//
// THE EFFORT. The sets come from an A run at --effort (SET_BUILD_EFFORT by
// default); the manifest records it, and report decides C on the shipped
// effort's runs only, the other effort REPORTED beside it, as A and B.
//
// THE CONTROL ARM: an ordinary render per set and character on each product
// engine (the same character and engine, no frame, drafter on, strict lane
// off), the identity baseline when baselines.json has none (Seedream is held
// to GPT Image's).
//
// The frames are each camera's view with the grey figure on the first mark
// and the set's own lift: the snapshot a person shoots in the product
// (render/). The stills are lib/shots.mts. A finished real run prints the
// bars it can settle alone (identity and miss rate against the baseline,
// output-gate refusals); composition needs the raters, so report settles it.
//
// `c --probe`: one fixture set (fixtures-rainy-market.json), the first
// character, each engine: camera 1 on its own sketch, and camera 2 carrying
// camera 1's still as the look where a look rides (the largest request: the
// identity, the sketch and the earlier still). It asks whether fal takes
// data: references (FLUX), with the look too, what Seedream's square size
// returns, whether the gates and the scorer answer, and which hosts the tap
// saw. If fal refuses the data: references, that engine's arm is BLOCKED
// (only its look arm, if fal refused only the look's request): the runner
// never uploads anything, and a C run stops sending those stills the moment
// fal refuses them.
//
// A dry run draws the frames for real (local Chrome) and hands each frame
// back as its still (shots.mts simulateShot), the look arm and the sheets
// included; the network line stays 0.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SET_BUILD_EFFORT } from "../../../src/lib/sets/set-config.ts";
import type { SetCamera, SetSpec } from "../../../src/lib/sets/set-spec.ts";
import { DEFAULT_IDENTITY_THRESHOLD } from "../../../src/lib/generations/identity-gate.ts";
import type { BuildRecord } from "../lib/build-flow.mts";
import { mulberry32, type Combined, type SheetItemIn } from "../lib/blind-sheet.mts";
import { ENGINES, type Engine } from "../lib/cli.mts";
import { barLine, spendLines, writeManifest, writeResult, writeSummary, type RunContext } from "../lib/context.mts";
import { LIVE_HOSTS } from "../lib/net-guard.mts";
import {
  barC,
  capAtUndetermined,
  cBaseline,
  reportCHeights,
  reportCLook,
  reportCOther,
  type BarResult,
  type CExportedBaselines,
  type CShot,
} from "../lib/pass-bars.mts";
import { checkPipelineStrings } from "../lib/pipeline-strings.mts";
import { planC, planProbeC } from "../lib/plan.mts";
import { SEEDREAM_SQUARE } from "../lib/seedream.mts";
import { blockKey, lookRides, RenderTap, runShots, sniffImage, type ShotArm, type ShotCharacter, type ShotGroup, type ShotRecord, type ShotRequest } from "../lib/shots.mts";
import { HarnessError, sha256, usd } from "../lib/util.mts";
import { framePose, renderSets, type RenderJob } from "../render/render-sets.mts";
import { readRun, specOf } from "./b.mts";
import { loadShotCharacters, makeShotEnv, runSeed, shotTally, writeRaterSheets, type PartModule } from "./common.mts";
import { FIXTURES, fixtureJson } from "./simulate.mts";

export const C_SPLIT = { interior: 4, exterior: 3, stylised: 3 } as const;
export const C_SETS = 10;
export const C_CAMERAS = 3;
/** The probe's one set: a recorded product fixture (design §7 C). */
export const PROBE_FIXTURE = "rainy-market" as const;
/** Stills in flight at once (each is one image take: tens of seconds). */
const CONCURRENCY = 4;

type CSet = { key: string; spec: SetSpec; category: string; buildId: string };

/** 4/3/3 by category, seeded; run 1 preferred, later runs only to fill a gap. */
export function chooseSets(records: readonly BuildRecord[], builder: string, seed: number): BuildRecord[] {
  const rng = mulberry32(seed);
  const out: BuildRecord[] = [];
  for (const [cat, want] of Object.entries(C_SPLIT)) {
    const pool = records.filter((r) => r.type === "build" && r.builder === builder && r.status === "delivered" && r.specFile && r.category === cat);
    const byBrief = new Map<string, BuildRecord[]>();
    for (const r of pool) byBrief.set(r.briefId, [...(byBrief.get(r.briefId) ?? []), r]);
    const briefs = [...byBrief.keys()].sort();
    for (let i = briefs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [briefs[i], briefs[j]] = [briefs[j], briefs[i]];
    }
    for (const id of briefs.slice(0, want)) {
      const runs = (byBrief.get(id) ?? []).sort((a, b) => a.run - b.run);
      out.push(runs[0]);
    }
  }
  return out;
}

/** A set drawn from its cameras: each frame's camera, file in the run, and bytes. */
export type FramedSet = { key: string; spec: SetSpec; lifted: boolean; frames: { camera: SetCamera; file: string; picture: { bytes: Buffer; mime: string } }[] };

/**
 * Every still C sends, in the order it sends them. Per set, character and
 * engine: camera 1 first (its still is the look), the later cameras on their
 * own sketch, and — where a look rides (lookRides: GPT Image and FLUX, beside
 * an identity photo) — the later cameras again, to carry camera 1's still.
 * A control per set and character on each product engine. Shot k (one set,
 * camera and character) takes directions[k % n], the same on every engine
 * and in both arms, so a look shot and its twin differ by the look alone.
 * Every later camera's still names camera 1's (firstShotId), for the sheet.
 * `twins: false` (the probe) sends the later cameras only with the look.
 */
export function planCShots(o: {
  sets: readonly FramedSet[];
  characters: readonly ShotCharacter[];
  directions: readonly string[];
  engines: readonly Engine[];
  look: boolean;
  control: boolean;
  twins?: boolean;
}): { groups: ShotGroup[]; singles: ShotRequest[] } {
  const groups: ShotGroup[] = [];
  const singles: ShotRequest[] = [];
  const directions = o.directions.length ? o.directions : ["(no direction)"];
  let k = 0;
  for (const set of o.sets) {
    if (set.frames.length === 0) continue;
    for (const ch of o.characters) {
      const dirs = set.frames.map(() => directions[k++ % directions.length]);
      for (const engine of o.engines) {
        const req = (i: number, arm: ShotArm): ShotRequest => ({
          part: "c",
          shotId: `${arm === "look" ? "cl" : "cs"}-${set.key}-${set.frames[i].camera.id}-${ch.id}-${engine}`,
          arm,
          engine,
          setKey: set.key,
          spec: set.spec,
          camera: set.frames[i].camera,
          frame: set.frames[i].picture,
          frameFile: set.frames[i].file,
          lifted: set.lifted,
          direction: dirs[i],
          character: ch,
          look: null,
          priorHits: 0,
        });
        const later = set.frames.map((_, i) => i).slice(1);
        const rides = o.look && lookRides({ engine, identityPhoto: ch.photo !== null, characters: 1 });
        const first = req(0, "set");
        const afterFirst = (r: ShotRequest): ShotRequest => ({ ...r, firstShotId: first.shotId });
        groups.push({
          first,
          rest: o.twins === false ? [] : later.map((i) => afterFirst(req(i, "set"))),
          withLook: rides ? later.map((i) => afterFirst(req(i, "look"))) : [],
        });
        if (o.control && engine !== "seedream") {
          singles.push({ ...req(0, "control"), shotId: `cc-${set.key}-${ch.id}-${engine}`, camera: null, frame: null, frameFile: null });
        }
      }
    }
  }
  return { groups, singles };
}

/** The composition sheet's ratings of one still, by ratingKey (its run and shotId). */
export type CRatings = { scores: number[]; objects: number[]; younger: number };

/** A still's ratings key: shotIds repeat across runs over the same sets, so the run is part of it. */
export const ratingKey = (run: string, shotId: string) => `${run}|${shotId}`;

/** Real stills of one run as the bars read them, with the composition sheet's ratings when report has them. */
export function cShotsOf(rows: readonly ShotRecord[], run: string, ratings: ReadonlyMap<string, CRatings> = new Map()): CShot[] {
  return rows.map((r) => {
    const rated = ratings.get(ratingKey(run, r.shotId));
    return {
      engine: r.engine,
      arm: r.arm,
      outcome: r.outcome,
      score: r.identity.score,
      decision: r.identityDecision,
      compositionScores: rated?.scores ?? [],
      pairKey: r.arm === "control" || !r.cameraId ? undefined : `${run}|${r.setKey}|${r.cameraId}|${r.characterId}`,
      cameraHeightM: r.cameraHeightM,
      later: Boolean(r.firstShotId),
      objectsScores: rated?.objects ?? [],
      youngerFlags: rated?.younger ?? 0,
      dims: r.resultDims,
      promptParity: r.promptParity,
    };
  });
}

/** The composition sheet's combined ratings, by ratingKey: each rater's score, the objects question's score, and the "looks younger" ticks. */
export function cRatingsOf(combined: readonly Combined[]): Map<string, CRatings> {
  const out = new Map<string, CRatings>();
  for (const c of combined) {
    const id = String(c.source.shotId ?? "");
    if (!id) continue;
    out.set(ratingKey(String(c.source.run ?? ""), id), {
      scores: c.ratings.map((x) => x.score).filter((x): x is number => typeof x === "number"),
      objects: c.ratings.map((x) => x.extras?.objects).filter((x): x is number => typeof x === "number"),
      younger: c.ratings.filter((x) => x.flags?.includes("younger")).length,
    });
  }
  return out;
}

/** What fal refused data: references for, from a run's rows (shots.mts blockKey): an engine, or its look arm alone. */
export function blockedOf(rows: readonly Pick<ShotRecord, "refsRefused" | "engine" | "arm">[]): Set<string> {
  return new Set(rows.filter((r) => r.refsRefused && r.engine !== "gpt-image").map((r) => blockKey(r.engine, r.arm)));
}

/**
 * Every C bar over real stills, per engine: barC on the set arm against the
 * engine's baseline (cBaseline), and the look, the camera heights and the
 * rest as REPORTED lines. An engine with no still in hand is UNDETERMINED;
 * a BLOCKED arm (fal refused its data: references) never passes; a BLOCKED
 * look arm alone leaves the bars (the set arm's) and notes the look lines.
 * `composition: false` leaves the composition bar out (a run's own summary:
 * the raters have not rated yet).
 */
export function cBars(
  shots: readonly CShot[],
  o: { engines: readonly Engine[]; exported: CExportedBaselines; blocked: ReadonlySet<string>; composition?: boolean },
): { bars: BarResult[]; reported: BarResult[] } {
  const bars: BarResult[] = [];
  const reported: BarResult[] = [];
  for (const e of o.engines) {
    const mine = shots.filter((s) => s.engine === e && s.arm === "set");
    if (mine.length === 0) {
      bars.push({ id: `C-${e}`, label: `C ${e} stills`, verdict: "UNDETERMINED", value: "none", threshold: "60 set shots", n: 0, arithmetic: "no real still on this engine in hand", notes: [] });
      continue;
    }
    const base = cBaseline(e, { exported: o.exported, controls: shots, threshold: DEFAULT_IDENTITY_THRESHOLD });
    let bs = barC(e, shots, base);
    if (o.composition === false) bs = bs.filter((b) => !b.id.startsWith("C-composition"));
    if (o.blocked.has(e)) bs = bs.map((b) => capAtUndetermined({ ...b, notes: [...b.notes, "the arm is BLOCKED: fal refused the data: references"] }, "the arm is BLOCKED"));
    bars.push(...bs);
    const lookBlocked = !o.blocked.has(e) && o.blocked.has(blockKey(e, "look"));
    reported.push(...reportCLook(e, shots).map((b) => (lookBlocked ? { ...b, notes: [...b.notes, "the look arm is BLOCKED: fal refused a look shot's data: references"] } : b)));
    for (const r of [reportCHeights(e, shots), reportCOther(e, shots)]) if (r) reported.push(r);
  }
  return { bars, reported };
}

/** The Astra effort a C run's sets were built at (manifest.stills.effort), or null when it records none. */
export function cEffortOf(manifest: Record<string, unknown>): string | null {
  const e = (manifest.stills as { effort?: unknown } | undefined)?.effort;
  return typeof e === "string" ? e : null;
}

/**
 * Report's C over the runs it is given (report passes the runs of one
 * effort): their stills pooled, each still's ratings found by its run and
 * shotId, the first recorded baselines export.
 */
export function cFromRuns(
  runs: readonly { rows: Record<string, unknown>[]; manifest: Record<string, unknown> }[],
  combined: readonly Combined[],
): { bars: BarResult[]; reported: BarResult[]; blocked: string[] } {
  const ratings = cRatingsOf(combined);
  const perRun = runs.map((r) => ({ run: String(r.manifest.runId ?? ""), rows: r.rows.filter((x) => x.type === "shot") as unknown as ShotRecord[] }));
  const blocked = blockedOf(perRun.flatMap((r) => r.rows));
  const exported = (runs.map((r) => r.manifest.baselines).find((b) => b) ?? null) as CExportedBaselines;
  const out = cBars(
    perRun.flatMap((r) => cShotsOf(r.rows, r.run, ratings)),
    { engines: ENGINES, exported, blocked },
  );
  return { ...out, blocked: [...blocked] };
}

/** The sets C shoots: the probe's fixture, an A run's (a real run), or the product's fixtures (a dry run); and the effort an A run's were built at. */
function setsFor(ctx: RunContext): { sets: CSet[]; from: string; effort: string | null } {
  const f = ctx.flags;
  const fixture = (name: (typeof FIXTURES)[number]): CSet => ({ key: `fx-${name}`, spec: specOf(fixtureJson(name)), category: "fixture", buildId: `fx-${name}` });
  if (f.probe) return { sets: [fixture(PROBE_FIXTURE)], from: `the product fixture ${PROBE_FIXTURE}`, effort: null };
  if (!f.fromRun) {
    if (!ctx.dry) throw new HarnessError("a real C run draws its sets from an A run: pass --from-run <the A run> (a dry run draws the product's fixtures). Nothing was called.");
    return { sets: FIXTURES.map(fixture), from: "product fixtures", effort: null };
  }
  const effort = f.effort ?? SET_BUILD_EFFORT;
  const a = readRun(f.fromRun);
  if (a.manifest.part !== "a" || a.manifest.photos === true) throw new HarnessError(`--from-run ${f.fromRun} is not an A words run`);
  if (!ctx.dry && a.manifest.simulated === true) throw new HarnessError(`--from-run ${f.fromRun} is a dry run: a real C run shoots a real A run's sets`);
  if (a.manifest.simulated !== true && a.manifest.complete !== true) throw new HarnessError(`--from-run ${f.fromRun} did not finish (interrupted or stopped): --resume it first`);
  if ((a.manifest.corpus as { hash?: string } | undefined)?.hash !== ctx.corpus.corpusHash) throw new HarnessError("the corpus is not the one the A run used (corpus hash differs)");
  const chosen = chooseSets(a.rows as unknown as BuildRecord[], `astra-${effort}`, runSeed(ctx));
  const sets = chosen.map((r) => ({ key: r.buildId, spec: specOf(JSON.parse(readFileSync(join(f.fromRun as string, r.specFile as string), "utf8"))), category: r.category, buildId: r.buildId }));
  if (sets.length < C_SETS) ctx.out(`  note: only ${sets.length} of ${C_SETS} sets available at astra-${effort} in ${f.fromRun}`);
  return { sets, from: `${f.fromRun} at astra-${effort}`, effort };
}

/**
 * The composition sheet: every set or look still that rendered, beside its
 * sketch, the reference photo small. Every later camera's still, in either
 * arm, also shows its first still (camera 1's, firstShotId) and is asked the
 * objects question, so a look shot and its twin on the same sketch look
 * alike to a rater and the twin is the look's baseline. Each item's source
 * carries the run: shotIds repeat across runs over the same sets.
 */
export function compositionItems(o: {
  run: string;
  runDir: string;
  records: readonly ShotRecord[];
  /** Each character's identity photo in the corpus, for those that have one. */
  photoOf: ReadonlyMap<string, string>;
}): SheetItemIn[] {
  const byId = new Map(o.records.map((r) => [r.shotId, r]));
  const items: SheetItemIn[] = [];
  for (const r of o.records) {
    if (r.arm === "control" || r.outcome !== "rendered" || !r.resultFile || !r.frameFile) continue;
    const first = r.firstShotId ? byId.get(r.firstShotId) : undefined;
    const firstFile = first?.outcome === "rendered" ? first.resultFile : null;
    const photo = o.photoOf.get(r.characterId);
    items.push({
      source: { run: o.run, shotId: r.shotId, engine: r.engine, arm: r.arm, setKey: r.setKey, cameraId: r.cameraId ?? "", characterId: r.characterId },
      groupKey: r.setKey,
      images: [
        { role: "sketch", path: join(o.runDir, r.frameFile) },
        { role: "still", path: join(o.runDir, r.resultFile) },
        ...(firstFile ? [{ role: "first" as const, path: join(o.runDir, firstFile) }] : []),
        ...(photo ? [{ role: "reference" as const, path: photo }] : []),
      ],
      ...(firstFile ? { asks: ["objects"] } : {}),
    });
  }
  return items;
}

const ALLOWED = (host: string) => (LIVE_HOSTS as readonly string[]).includes(host) || host.endsWith(".fal.media");

/** What `c --probe` settles (design §10.3), one line per question. */
export function probeLines(records: readonly ShotRecord[], seen: { hosts: ReadonlySet<string>; blocked: readonly { host: string }[]; simulated: boolean }): string[] {
  const lines = [seen.simulated ? "--- probe (SIMULATED: the lines' shape only; nothing was asked, so nothing is settled) ---" : "--- probe ---"];
  const of = (e: Engine, arm: ShotArm = "set") => records.find((r) => r.engine === e && r.arm === arm);
  const dims = (r: ShotRecord) => (r.resultDims ? `${r.resultDims.w}×${r.resultDims.h}` : "size unread");
  const plain = (label: string, r: ShotRecord) => `  ${label}: ${r.outcome}${r.outcome === "rendered" ? ` (${dims(r)})` : r.note ? ` (${r.note})` : ""}`;
  const gpt = of("gpt-image");
  if (gpt) lines.push(plain("gpt-image", gpt));
  const gptLook = of("gpt-image", "look");
  if (gptLook) lines.push(plain("gpt-image with the look", gptLook));
  const flux = of("flux");
  if (flux) {
    lines.push(
      flux.outcome === "rendered"
        ? `  flux: data: references ACCEPTED (rendered ${dims(flux)})`
        : flux.refsRefused
          ? `  flux: data: references REFUSED (${flux.note ?? "?"}) → the FLUX arm is BLOCKED. The runner uploads nothing: run C with --engines gpt-image,seedream (the in-app route is the README's fallback)`
          : `  flux: not settled (${flux.outcome}${flux.note ? `: ${flux.note}` : ""})`,
    );
  }
  // The largest request a C run sends: the identity, the sketch and camera 1's still.
  const fluxLook = of("flux", "look");
  if (fluxLook) {
    lines.push(
      fluxLook.outcome === "rendered"
        ? `  flux with the look: three data: references ACCEPTED (rendered ${dims(fluxLook)})`
        : fluxLook.refsRefused
          ? `  flux with the look: three data: references REFUSED (${fluxLook.note ?? "?"}) → the FLUX look arm is BLOCKED: a C run records FLUX's look shots as not run, and its set arm goes on`
          : `  flux with the look: not settled (${fluxLook.outcome}${fluxLook.note ? `: ${fluxLook.note}` : ""})`,
    );
  }
  const sd = of("seedream");
  if (sd) {
    const square = sd.resultDims?.w === 1024 && sd.resultDims?.h === 1024;
    lines.push(
      sd.outcome === "rendered"
        ? `  seedream: image_size "${SEEDREAM_SQUARE}" came back ${dims(sd)}${square ? ": square at 1024 ✓" : ": NOT 1024×1024. Read fal's Seedream v4 edit page and change SEEDREAM_SQUARE in lib/seedream.mts"}`
        : sd.refsRefused
          ? `  seedream: data: references REFUSED (${sd.note ?? "?"}) → the Seedream arm is BLOCKED; the runner uploads nothing`
          : `  seedream: not settled (${sd.outcome}${sd.note ? `: ${sd.note}` : ""})`,
    );
  }
  const answered = records.filter((r) => r.entryGate === "allowed" || r.entryGate.startsWith("refused:")).length;
  lines.push(`  entry gate answered ${answered}/${records.length} (${records.map((r) => `${r.engine} ${r.entryGate}`).join(", ")})`);
  const judged = records.filter((r) => r.outcome === "rendered" || r.outcome === "output_blocked").length;
  const rendered = records.filter((r) => r.outcome === "rendered");
  lines.push(`  output gate judged ${judged} picture(s); unavailable on ${records.filter((r) => r.outcome === "unjudged").length}`);
  lines.push(`  identity scorer answered on ${rendered.filter((r) => r.identity.score !== null).length}/${rendered.length} rendered (${rendered.map((r) => `${r.engine} ${r.identity.score ?? "no answer"}`).join(", ") || "none"})`);
  const parity = records.filter((r) => r.promptParity !== null);
  lines.push(`  prompt parity: ${parity.filter((r) => r.promptParity).length}/${parity.length} engines received the shot prompt and the pipeline's notes exactly`);
  const hosts = [...seen.hosts].sort();
  const stray = hosts.filter((h) => !ALLOWED(h));
  lines.push(
    `  hosts the tap saw: ${hosts.join(", ") || "none"}; ${stray.length || seen.blocked.length ? `NOT ONLY ALLOWED HOSTS (${[...stray, ...seen.blocked.map((b) => `blocked ${b.host}`)].join(", ")})` : "only allowed hosts, nothing blocked"}`,
  );
  return lines;
}

export const partC: PartModule = {
  needs: (ctx) => ({ directions: true, characters: true, briefs: Boolean(ctx.flags.fromRun), photos: true }),

  plan(ctx) {
    const f = ctx.flags;
    const b = ctx.book;
    const chars = Math.max(2, ctx.corpus.data.characters.length);
    const set = C_SETS * C_CAMERAS * chars;
    const look = f.look ? C_SETS * (C_CAMERAS - 1) * chars : 0;
    const control = f.control ? C_SETS * chars : 0;
    const gpt = set + look + control;
    const notes = [
      `The doc's C line (60 × ${usd(b.gptImageUsd, 2)} = ${usd(60 * b.gptImageUsd, 2)} for GPT Image) grows: ${set} set shots${look ? ` + ${look} look shots` : ""}${control ? ` + ${control} controls` : ""} = ${gpt} GPT Image stills, ${usd(gpt * b.gptImageUsd, 2)} if each renders once, ${usd(gpt * 2 * b.gptImageUsd, 2)} reserved (each still reserves GENERATE_RETRIES = 2 renders).`,
      f.look
        ? `The look arm (the later cameras again, carrying camera 1's still, as the product sends a shot since 2026-09-11) adds ${look} stills on each of GPT Image and FLUX: ${look} × 2 × ${usd(b.gptImageUsd, 2)} = ${usd(look * 2 * b.gptImageUsd, 2)} reserved on GPT Image. --no-look drops it.`
        : "--no-look: no look arm.",
      "FLUX.2 Pro edit and Seedream v4 edit are unpriced until external-prices.json holds fal's page figures (the doc says $0.03 for Seedream; angle-stage-config.ts says fal publishes no price: re-read before the run). Until then each render is metered, not reserved.",
      "The product's default look follows the newest still (set-view.tsx); the eval pins camera 1's, so every look shot is judged against one first still.",
    ];
    if (f.probe) {
      return {
        title: `C probe: the ${PROBE_FIXTURE} fixture, camera 1${f.look ? " and camera 2 carrying its still" : ""}, 1 character, ${f.engines.join(", ")}`,
        lines: planProbeC({ engines: f.engines, look: f.look, book: b }),
        notes: [
          `The probe asks: does fal take data: references (FLUX)${f.look ? ", with the look too (camera 2 carrying camera 1's still, on GPT Image and FLUX: the largest request)" : ""}, what size does Seedream's square option return, do the gates and the scorer answer, which hosts did the tap see. No control.`,
          notes[2],
        ],
      };
    }
    return {
      title: `C: ${C_SETS} sets × ${C_CAMERAS} cameras × ${chars} characters × ${f.engines.join(", ")}${f.look ? " + look shots" : ""}${f.control ? " + controls" : ""}`,
      lines: planC({ sets: C_SETS, cameras: C_CAMERAS, characters: chars, engines: f.engines, control: f.control, look: f.look, book: b }),
      notes,
    };
  },

  async run(ctx) {
    const f = ctx.flags;
    const drift = checkPipelineStrings(ctx.repoRoot);
    ctx.manifest.pipelineStrings = { ...drift, acceptedDrift: !drift.ok && f.acceptDrift };
    if (!drift.ok && !ctx.dry && !f.acceptDrift) {
      throw new HarnessError(`the stills leg mirrors product lines that changed: ${drift.missing.join("; ")}. Update lib/pipeline-strings.mts and lib/shots.mts, or pass --accept-drift (recorded). Nothing was called.`);
    }
    const { sets, from, effort } = setsFor(ctx);
    const allCharacters = loadShotCharacters(ctx);
    const characters = f.probe ? allCharacters.slice(0, 1) : allCharacters;
    if (!ctx.dry && characters.some((c) => !c.photo)) throw new HarnessError("every character needs its identity photo in the corpus (README step 3). Nothing was called.");
    ctx.manifest.stills = {
      engines: f.engines,
      // The Astra effort of the A run's sets (null for fixtures): report decides C on SET_BUILD_EFFORT's runs.
      effort,
      look: f.look,
      control: f.control && !f.probe,
      threshold: DEFAULT_IDENTITY_THRESHOLD,
      seedreamSize: SEEDREAM_SQUARE,
      // Which photo each character was, by hash only: the bytes stay in the corpus.
      characters: characters.map((c) => ({ id: c.id, photoSha256: c.photo ? sha256(c.photo.bytes) : null })),
    };
    ctx.manifest.baselines = ctx.corpus.data.baselines;

    // The probe: camera 1, and camera 2 to carry its still as the look.
    const cameras = f.probe ? (f.look ? 2 : 1) : C_CAMERAS;
    const jobs: RenderJob[] = sets.map((s) => ({
      key: s.key,
      spec: s.spec,
      mark: { x: s.spec.marks[0].x, z: s.spec.marks[0].z, facingDeg: s.spec.marks[0].facingDeg },
      poses: s.spec.cameras.slice(0, cameras).map((_, i) => framePose(s.spec, i)),
    }));
    const rendered = await renderSets({ net: ctx.net, repoRoot: ctx.repoRoot, chromePath: f.chrome, jobs, outDir: join(ctx.runDir, "frames"), progress: ctx.progress });
    const framed: FramedSet[] = [];
    let failed = 0;
    for (const r of rendered) {
      const set = sets.find((s) => s.key === r.key) as CSet;
      if (!r.ok) {
        failed += 1;
        writeResult(ctx, { type: "c-frame", setKey: r.key, ok: false, error: r.error, simulated: ctx.dry });
        continue;
      }
      const frames: FramedSet["frames"] = [];
      for (const frame of r.result.frames) {
        const camera = set.spec.cameras.find((c) => c.id === frame.poseId);
        const file = r.files[frame.poseId];
        if (!camera || !file) continue;
        const bytes = readFileSync(join(ctx.runDir, "frames", file));
        frames.push({ camera, file: `frames/${file}`, picture: { bytes, mime: sniffImage(bytes).mime } });
        writeResult(ctx, { type: "c-frame", setKey: r.key, cameraId: camera.id, ok: true, file: `frames/${file}`, lift: r.result.lift, lifted: r.result.lifted, controlsWouldMove: frame.controlsWouldMove, simulated: ctx.dry });
      }
      framed.push({ key: set.key, spec: set.spec, lifted: r.result.lifted, frames });
    }

    // The probe sends camera 2 only with the look: the request it asks about.
    const plan = planCShots({ sets: framed, characters, directions: ctx.corpus.data.directions, engines: f.engines, look: f.look, control: f.control && !f.probe, twins: !f.probe });
    const tap = new RenderTap();
    const restore = tap.install(ctx.net);
    const env = makeShotEnv(ctx, tap);
    let records: ShotRecord[];
    try {
      records = await runShots(env, { ...plan, concurrency: f.probe ? 1 : CONCURRENCY, onRecord: (r) => writeResult(ctx, r) });
    } finally {
      restore();
    }
    const complete = ctx.stopReason() === null && ctx.guard.stopped === null;
    ctx.manifest.complete = complete;
    ctx.manifest.stop = ctx.stopReason() ?? ctx.guard.stopped?.reason ?? null;
    ctx.manifest.blocked = [...env.blocked];

    const corpusPhoto = new Map(ctx.corpus.data.characters.map((c) => [c.id, join(ctx.corpusDir, c.identityPhoto)]));
    const photoOf = new Map(characters.filter((c) => c.photo).map((c) => [c.id, corpusPhoto.get(c.id) as string]));
    const pages = f.probe ? [] : writeRaterSheets(ctx, "c-composition", compositionItems({ run: ctx.runId, runDir: ctx.runDir, records, photoOf }));
    const out = [
      `C ${ctx.runId}${f.probe ? " (probe)" : ""}${ctx.dry ? "  (DRY RUN: frames are real, stills are the frames themselves)" : ""}`,
      `  sets ${sets.length} (${from}); frames drawn for ${rendered.length - failed}; render errors ${failed}`,
      `  lifted sets: ${rendered.filter((r) => r.ok && r.result.lifted).length}; frames a live OrbitControls would have moved: ${rendered.reduce((n, r) => n + (r.ok ? r.result.frames.filter((x) => x.controlsWouldMove).length : 0), 0)}`,
      `  the pipeline and the shot's product lines the stills mirror ${drift.ok ? "match" : `DRIFTED: ${drift.missing.join("; ")}`}`,
      `  stills ${records.length} (characters ${characters.length}; ${f.engines.join(", ")})`,
      ...shotTally(records),
    ];
    if (env.blocked.size) {
      const what = [...env.blocked].map((k) => (k.endsWith(":look") ? `${k.slice(0, -5)} (its look arm only)` : k));
      out.push(`  BLOCKED: ${what.join(", ")} (fal refused the data: references; nothing is uploaded)`);
    }
    if (!complete && !ctx.dry) out.push(`DID NOT FINISH (${String(ctx.manifest.stop ?? "unfinished")}): the stills it did not send are recorded as not run; rerun C`);
    let bars: BarResult[] = [];
    if (f.probe) out.push(...probeLines(records, { hosts: tap.hosts, blocked: ctx.net.blocked, simulated: ctx.dry }));
    else if (ctx.dry) out.push("--- bars: none (simulated rows are never a result) ---");
    else {
      const c = cBars(cShotsOf(records, ctx.runId), { engines: f.engines, exported: ctx.corpus.data.baselines, blocked: env.blocked, composition: false });
      bars = complete ? c.bars : c.bars.map((b) => capAtUndetermined(b, "the run did not finish"));
      out.push("--- bars (composition needs the raters: run report) ---", ...bars.map(barLine), ...c.reported.map(barLine));
    }
    if (pages.length) out.push(`--- composition sheets${ctx.dry ? " (simulated)" : ""}: every later camera's still also asks whether the objects are the first still's ---`, ...pages.map((p) => `  ${p}`));
    out.push(...spendLines(ctx));
    for (const l of out) ctx.out(l);
    writeSummary(ctx, out.join("\n"), { part: "c", probe: f.probe, simulated: ctx.dry, complete, sets: sets.length, frames: rendered.length - failed, stills: records.length, blocked: [...env.blocked], pipelineStrings: drift, bars });
    writeManifest(ctx);
    if (ctx.stopReason() === "sigint") return 130;
    if (!ctx.dry && (ctx.guard.stopped || !complete)) return 2;
    if (bars.some((b) => b.verdict === "FAIL")) return 1;
    if (bars.some((b) => b.verdict === "UNDETERMINED")) return 2;
    return 0;
  },
};
