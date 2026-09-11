// Part B: fidelity, $0 of API spend. Every delivered set from an A run —
// every builder, every run — is drawn from its first camera with the grey
// figure hidden and the set's own lift (the product's card picture, at
// 1024 px), then shuffled into one blind sheet per rater with its brief.
// The B bar (Astra median ≥ 4; the route rule) is computed by report, from
// the returned ratings and A's costs.
//
// FROM AN A PHOTO RUN (a --photos): each set's camera 1 is drawn the way the
// product lays it beside its photo — no figure, at the photo's shape
// (compare.ts compareCrop and widenFovDeg, exactly as set-view.tsx does;
// render/snap-page.html), long side SET_COMPARE_PX — and goes on the sheet
// BESIDE the photo the A run sent (its photos/, checked against the hash it
// recorded). Raters score how well the set reproduces the photographed
// place; the sheet kind is b-photo, and report reads it as the photo arm's.
// B follows its A run's arm: --photos is only needed for a dry run.
//
// B makes no API calls and takes no --spend. Without --from-run it draws
// the product's four fixture sets as a dry run (with --photos, each beside
// one of the corpus's location photos).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normaliseSetSpec, type SetSpec } from "../../../src/lib/sets/set-spec.ts";
import { SET_COMPARE_PX } from "../../../src/lib/sets/set-config.ts";
import type { BuildRecord } from "../lib/build-flow.mts";
import { writeManifest, writeResult, writeSummary, type RunContext } from "../lib/context.mts";
import type { PhotoFile } from "../lib/photos.mts";
import { renderSets, cardPose, comparePose, type RenderJob } from "../render/render-sets.mts";
import { HarnessError, sha256 } from "../lib/util.mts";
import { preparePhotos, writeRaterSheets, type PartModule } from "./common.mts";
import { FIXTURES, fixtureJson } from "./simulate.mts";
import type { SheetItemIn } from "../lib/blind-sheet.mts";

export type RunFiles = { manifest: Record<string, unknown>; rows: Record<string, unknown>[] };

/** One row per build: the last one written wins (a run written before results were rewritten on --resume can carry a build twice). */
export function latestBuildRows(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const last = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.type === "build" && typeof r.buildId === "string") last.set(r.buildId, i);
  });
  return rows.filter((r, i) => !(r.type === "build" && typeof r.buildId === "string") || last.get(r.buildId) === i);
}

export function readRun(runDir: string): RunFiles {
  const m = join(runDir, "manifest.json");
  if (!existsSync(m)) throw new HarnessError(`${runDir} has no manifest.json`);
  const manifest = JSON.parse(readFileSync(m, "utf8")) as Record<string, unknown>;
  const r = join(runDir, "results.jsonl");
  const rows = existsSync(r)
    ? readFileSync(r, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];
  return { manifest, rows: latestBuildRows(rows) };
}

export function specOf(raw: unknown): SetSpec {
  const n = normaliseSetSpec(raw);
  if (!n.ok) throw new HarnessError(`a stored set no longer normalises (${n.reason})`);
  return n.spec;
}

/** The A run B draws from: an A run, finished (or simulated), on this corpus. */
function aRunOf(ctx: RunContext, fromRun: string): RunFiles {
  const a = readRun(fromRun);
  if (a.manifest.part !== "a") throw new HarnessError(`--from-run ${fromRun} is not an A run`);
  if (a.manifest.simulated !== true && a.manifest.complete !== true) {
    throw new HarnessError(`--from-run ${fromRun} did not finish (interrupted or stopped): --resume it first, so B draws every set`);
  }
  const corpus = (a.manifest.corpus ?? {}) as { hash?: string };
  if (corpus.hash !== ctx.corpus.corpusHash) throw new HarnessError("the corpus is not the one the A run used (corpus hash differs)");
  return a;
}

type Meta = { builder: string; run: number; briefId: string; text?: string; photo?: string };

export const partB: PartModule = {
  needs: (ctx) => (ctx.flags.photos ? { locationPhotos: true } : { briefs: Boolean(ctx.flags.fromRun) }),

  // B follows its A run's arm; --photos on a words run is a mistake.
  resolveFlags(f) {
    if (!f.fromRun) return f;
    const photos = readRun(f.fromRun).manifest.photos === true;
    if (f.photos && !photos) throw new HarnessError(`--photos: ${f.fromRun} is a words run; its sets have no photo to lay beside them`);
    return { ...f, photos };
  },

  plan(ctx) {
    const notes = ["B draws sets in a local, network-locked Chrome; nothing is sent anywhere."];
    if (ctx.flags.photos) notes.push("Photo arm: each set's camera 1 is drawn at its photo's shape (compare.ts), and rated beside the photo.");
    return { title: `B${ctx.flags.photos ? " photos" : ""}: $0 of API spend (local rendering; rater time only)`, lines: [], notes };
  },

  async run(ctx) {
    const photos = ctx.flags.photos;
    const jobs: RenderJob[] = [];
    const meta = new Map<string, Meta>();
    if (ctx.flags.fromRun) {
      const fromRun = ctx.flags.fromRun;
      const a = aRunOf(ctx, fromRun);
      const briefs = new Map(ctx.corpus.data.briefs.map((b) => [b.id, b.brief]));
      const files = (a.manifest.photoFiles ?? {}) as Record<string, PhotoFile>;
      for (const r of a.rows as unknown as BuildRecord[]) {
        if (r.type !== "build" || r.status !== "delivered" || !r.specFile) continue;
        const spec = specOf(JSON.parse(readFileSync(join(fromRun, r.specFile), "utf8")));
        if (!photos) {
          jobs.push({ key: r.buildId, spec, mark: null, poses: [cardPose(spec)] });
          meta.set(r.buildId, { builder: r.builder, run: r.run, briefId: r.briefId, text: briefs.get(r.briefId) ?? "" });
          continue;
        }
        // The photo the A run sent, and nothing else.
        const pf = files[r.briefId];
        if (!pf?.file) throw new HarnessError(`${fromRun} kept no photo for ${r.briefId}`);
        const path = join(fromRun, pf.file);
        if (!existsSync(path) || sha256(readFileSync(path)) !== pf.sha256) throw new HarnessError(`${path} is not the photo the A run sent`);
        jobs.push({ key: r.buildId, spec, mark: null, poses: [comparePose(spec, pf.width / pf.height)] });
        meta.set(r.buildId, { builder: r.builder, run: r.run, briefId: r.briefId, photo: path });
      }
    } else if (photos) {
      // Dry run: each fixture beside one of the corpus's location photos, prepared as the product prepares it.
      const rows = ctx.corpus.data.locationPhotos;
      if (rows.length === 0) throw new HarnessError("b --photos without --from-run draws the fixtures beside the corpus's location photos, and it has none");
      await preparePhotos(ctx, rows, { keep: true });
      const files = ctx.manifest.photoFiles as Record<string, PhotoFile>;
      FIXTURES.forEach((name, i) => {
        const row = rows[i % rows.length];
        const pf = files[row.id];
        const spec = specOf(fixtureJson(name));
        jobs.push({ key: `fx-${name}`, spec, mark: null, poses: [comparePose(spec, pf.width / pf.height)] });
        meta.set(`fx-${name}`, { builder: "fixture", run: 1, briefId: row.id, photo: join(ctx.runDir, pf.file as string), text: `<<FORMAT ONLY: the product fixture "${name}" beside a template photo, drawn as a dry run>>` });
      });
    } else {
      for (const name of FIXTURES) {
        const spec = specOf(fixtureJson(name));
        jobs.push({ key: `fx-${name}`, spec, mark: null, poses: [cardPose(spec)] });
        meta.set(`fx-${name}`, { builder: "fixture", run: 1, briefId: name, text: `<<FORMAT ONLY: the product fixture "${name}", drawn as a dry run>>` });
      }
    }
    ctx.progress(`B: rendering ${jobs.length} sets`);
    const rendered = await renderSets({ net: ctx.net, repoRoot: ctx.repoRoot, chromePath: ctx.flags.chrome, jobs, outDir: join(ctx.runDir, "frames"), progress: ctx.progress });
    const items: SheetItemIn[] = [];
    let failed = 0;
    for (const r of rendered) {
      const m = meta.get(r.key) as Meta;
      if (!r.ok) {
        failed += 1;
        writeResult(ctx, { type: "b-frame", buildId: r.key, builder: m.builder, run: m.run, briefId: m.briefId, photos, ok: false, error: r.error, simulated: ctx.dry });
        continue;
      }
      const frame = r.result.frames[0];
      writeResult(ctx, {
        type: "b-frame",
        buildId: r.key,
        builder: m.builder,
        run: m.run,
        briefId: m.briefId,
        photos,
        ok: true,
        file: `frames/${r.files[frame.poseId]}`,
        lift: r.result.lift,
        lifted: r.result.lifted,
        ms: r.result.ms,
        errors: r.result.errors,
        controlsWouldMove: frame.controlsWouldMove,
        simulated: ctx.dry,
      });
      const snapshot = { role: "snapshot" as const, path: join(ctx.runDir, "frames", r.files[frame.poseId]) };
      items.push({
        source: { buildId: r.key, builder: m.builder, run: m.run, briefId: m.briefId },
        groupKey: m.briefId,
        ...(m.text !== undefined ? { text: m.text } : {}),
        // The photo first, then camera 1 beside it: the product's own order.
        images: m.photo ? [{ role: "photo", path: m.photo }, snapshot] : [snapshot],
      });
    }
    const pages = writeRaterSheets(ctx, photos ? "b-photo" : "b-fidelity", items);
    const lifted = rendered.filter((r) => r.ok && r.result.lifted).length;
    const out = [
      `B ${ctx.runId}${photos ? " (photo arm)" : ""}${ctx.dry ? `  (DRY RUN: product fixtures or a simulated A run)` : ""}`,
      `  sets drawn ${rendered.length - failed}/${rendered.length} (render errors, left out: ${failed}); lifted ${lifted}`,
      photos
        ? `  pose: camera 1, figure hidden, at the photo's shape (compare.ts), long side ${SET_COMPARE_PX} px, beside the photo; swiftshader, pixel ratio 1`
        : "  pose: the first camera, figure hidden, 1024 px (the card picture); swiftshader, pixel ratio 1",
      "--- rater sheets (send each rater only their own folder; keys/ stays with the operator) ---",
      ...pages.map((p) => `  ${p}`),
      "  ratings come back as ratings-<sheetId>.json: put them in " + join(ctx.runDir, "ratings") + ", then run report on the A and B runs.",
    ];
    for (const l of out) ctx.out(l);
    writeSummary(ctx, out.join("\n"), { part: "b", photos, simulated: ctx.dry, drawn: rendered.length - failed, failed, sheets: pages.length });
    ctx.manifest.complete = true;
    writeManifest(ctx);
    return failed > 0 && rendered.length === failed ? 2 : 0;
  },
};
