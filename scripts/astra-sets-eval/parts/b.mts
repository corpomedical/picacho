// Part B: fidelity, $0 of API spend. Every delivered set from an A run —
// every builder, every run — is drawn from its first camera with the grey
// figure hidden and the set's own lift (the product's card picture, at
// 1024 px), then shuffled into one blind sheet per rater with its brief.
// The B bar (Astra median ≥ 4; the route rule) is computed by report, from
// the returned ratings and A's costs.
//
// B makes no API calls and takes no --spend. Without --from-run it draws
// the product's four fixture sets as a dry run.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normaliseSetSpec, type SetSpec } from "../../../src/lib/sets/set-spec.ts";
import type { BuildRecord } from "../lib/build-flow.mts";
import { writeManifest, writeResult, writeSummary } from "../lib/context.mts";
import { renderSets, cardPose, type RenderJob } from "../render/render-sets.mts";
import { HarnessError } from "../lib/util.mts";
import { writeRaterSheets, type PartModule } from "./common.mts";
import { FIXTURES, fixtureJson } from "./simulate.mts";
import type { SheetItemIn } from "../lib/blind-sheet.mts";

export type RunFiles = { manifest: Record<string, unknown>; rows: Record<string, unknown>[] };

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
  return { manifest, rows };
}

export function specOf(raw: unknown): SetSpec {
  const n = normaliseSetSpec(raw);
  if (!n.ok) throw new HarnessError(`a stored set no longer normalises (${n.reason})`);
  return n.spec;
}

export const partB: PartModule = {
  needs: (ctx) => ({ briefs: Boolean(ctx.flags.fromRun) }),

  plan() {
    return { title: "B: $0 of API spend (local rendering; rater time only)", lines: [], notes: ["B draws sets in a local, network-locked Chrome; nothing is sent anywhere."] };
  },

  async run(ctx) {
    const jobs: RenderJob[] = [];
    const meta = new Map<string, { builder: string; run: number; briefId: string; text: string }>();
    if (ctx.flags.fromRun) {
      const a = readRun(ctx.flags.fromRun);
      if (a.manifest.part !== "a") throw new HarnessError(`--from-run ${ctx.flags.fromRun} is not an A run`);
      const corpus = (a.manifest.corpus ?? {}) as { hash?: string };
      if (corpus.hash !== ctx.corpus.corpusHash) throw new HarnessError("the corpus is not the one the A run used (corpus hash differs)");
      const briefs = new Map(ctx.corpus.data.briefs.map((b) => [b.id, b.brief]));
      for (const r of a.rows as unknown as BuildRecord[]) {
        if (r.type !== "build" || r.status !== "delivered" || !r.specFile) continue;
        const spec = specOf(JSON.parse(readFileSync(join(ctx.flags.fromRun, r.specFile), "utf8")));
        jobs.push({ key: r.buildId, spec, mark: null, poses: [cardPose(spec)] });
        meta.set(r.buildId, { builder: r.builder, run: r.run, briefId: r.briefId, text: briefs.get(r.briefId) ?? "" });
      }
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
      const m = meta.get(r.key) as { builder: string; run: number; briefId: string; text: string };
      if (!r.ok) {
        failed += 1;
        writeResult(ctx, { type: "b-frame", buildId: r.key, ...m, text: undefined, ok: false, error: r.error, simulated: ctx.dry });
        continue;
      }
      const frame = r.result.frames[0];
      writeResult(ctx, {
        type: "b-frame",
        buildId: r.key,
        builder: m.builder,
        run: m.run,
        briefId: m.briefId,
        ok: true,
        file: `frames/${r.files[frame.poseId]}`,
        lift: r.result.lift,
        lifted: r.result.lifted,
        ms: r.result.ms,
        errors: r.result.errors,
        controlsWouldMove: frame.controlsWouldMove,
        simulated: ctx.dry,
      });
      items.push({
        source: { buildId: r.key, builder: m.builder, run: m.run, briefId: m.briefId },
        groupKey: m.briefId,
        text: m.text,
        images: [{ role: "snapshot", path: join(ctx.runDir, "frames", r.files[frame.poseId]) }],
      });
    }
    const pages = writeRaterSheets(ctx, "b-fidelity", items);
    const lifted = rendered.filter((r) => r.ok && r.result.lifted).length;
    const out = [
      `B ${ctx.runId}${ctx.dry ? "  (DRY RUN: product fixtures or a simulated A run)" : ""}`,
      `  sets drawn ${rendered.length - failed}/${rendered.length} (render errors, left out: ${failed}); lifted ${lifted}`,
      `  pose: the first camera, figure hidden, 1024 px (the card picture); swiftshader, pixel ratio 1`,
      "--- rater sheets (send each rater only their own folder; keys/ stays with the operator) ---",
      ...pages.map((p) => `  ${p}`),
      "  ratings come back as ratings-<sheetId>.json: put them in " + join(ctx.runDir, "ratings") + ", then run report on the A and B runs.",
    ];
    for (const l of out) ctx.out(l);
    writeSummary(ctx, out.join("\n"), { part: "b", simulated: ctx.dry, drawn: rendered.length - failed, failed, sheets: pages.length });
    writeManifest(ctx);
    return failed > 0 && rendered.length === failed ? 2 : 0;
  },
};
