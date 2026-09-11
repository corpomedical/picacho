// Part C: stills. 10 sets (4 interior / 3 exterior / 3 stylised, from an A
// run at --effort, run 1 preferred) × their first 3 cameras × 2 characters
// = 60 shots per engine (GPT Image 2 edit, FLUX.2 Pro edit, Seedream v4
// edit), plus an ordinary-render control arm.
//
// BUILT NOW: the plan and ceiling, the frames (each camera's view with the
// grey figure on the first mark, the set's own lift — exactly the snapshot
// a person shoots in the product), the exact shot prompt each still would
// send (buildSetShotPrompt with the layout, and the two pipeline sentences
// it gains on the way), the pipeline-string drift check, and the bars.
//
// NOT BUILT YET (design §9, second sitting): the engine leg — the stills
// themselves, their gates and identity scores. So `c --spend` stops before
// any call. The dry run hands each frame back as its own "still", as the
// simulated engine, which exercises the sheets end to end.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSetShotPrompt } from "../../../src/lib/sets/set-shot-prompt.ts";
import { cleanText, normaliseSetLayout, type SetSpec } from "../../../src/lib/sets/set-spec.ts";
import { SET_BUILD_EFFORT, SET_DIRECTION_MAX_CHARS } from "../../../src/lib/sets/set-config.ts";
import { identityGateDecision, DEFAULT_IDENTITY_THRESHOLD } from "../../../src/lib/generations/identity-gate.ts";
import type { BuildRecord } from "../lib/build-flow.mts";
import { mulberry32 } from "../lib/blind-sheet.mts";
import { writeManifest, writeResult, writeSummary } from "../lib/context.mts";
import { checkPipelineStrings, pipelinePrompt } from "../lib/pipeline-strings.mts";
import { planC, planProbeC } from "../lib/plan.mts";
import { HarnessError } from "../lib/util.mts";
import { framePose, renderSets, type RenderJob } from "../render/render-sets.mts";
import { readRun, specOf } from "./b.mts";
import { runSeed, writeRaterSheets, type PartModule } from "./common.mts";
import { FIXTURES, fixtureJson } from "./simulate.mts";
import type { SheetItemIn } from "../lib/blind-sheet.mts";

export const C_SPLIT = { interior: 4, exterior: 3, stylised: 3 } as const;
export const C_CAMERAS = 3;

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

export const partC: PartModule = {
  needs: (ctx) => ({ directions: true, characters: true, briefs: Boolean(ctx.flags.fromRun), photos: true }),

  plan(ctx) {
    const f = ctx.flags;
    const chars = Math.max(2, ctx.corpus.data.characters.length);
    const notes = [
      "The engine leg (the stills, their gates and scores) is not built yet: design §9, second sitting. `c --spend` stops before any call.",
      "The doc's C line ($10.20 for GPT Image) becomes $13.60 expected and $27.20 reserved: the control arm adds 20 renders per product engine, and each still reserves GENERATE_RETRIES renders.",
      "FLUX.2 Pro edit and Seedream v4 edit are unpriced until external-prices.json holds fal's page figures (the doc says $0.03 for Seedream; angle-stage-config.ts says fal publishes no price: re-read before the run).",
    ];
    if (f.probe) return { title: "C probe: 1 set, 1 camera, 1 character, each engine", lines: planProbeC({ engines: f.engines, book: ctx.book }), notes };
    return {
      title: `C: 10 sets × ${C_CAMERAS} cameras × ${chars} characters × ${f.engines.join(", ")}${f.control ? " + controls" : ""}`,
      lines: planC({ sets: 10, cameras: C_CAMERAS, characters: chars, engines: f.engines, control: f.control, book: ctx.book }),
      notes,
    };
  },

  async run(ctx) {
    if (!ctx.dry) {
      throw new HarnessError("C's engine leg (GPT Image 2, FLUX.2 and Seedream stills, their gates and identity scores) is not built yet — design §9, second sitting. Nothing was called. The dry run draws the frames and writes the prompts.");
    }
    const f = ctx.flags;
    const effort = f.effort ?? SET_BUILD_EFFORT;
    const drift = checkPipelineStrings(ctx.repoRoot);
    ctx.manifest.pipelineStrings = drift;

    const sets: CSet[] = [];
    if (f.fromRun) {
      const a = readRun(f.fromRun);
      if (a.manifest.part !== "a") throw new HarnessError(`--from-run ${f.fromRun} is not an A run`);
      const chosen = chooseSets(a.rows as unknown as BuildRecord[], `astra-${effort}`, runSeed(ctx));
      for (const r of chosen) {
        sets.push({ key: r.buildId, spec: specOf(JSON.parse(readFileSync(join(f.fromRun, r.specFile as string), "utf8"))), category: r.category, buildId: r.buildId });
      }
      if (sets.length < 10) ctx.out(`  note: only ${sets.length} of 10 sets available at astra-${effort} in ${f.fromRun}`);
    } else {
      for (const name of FIXTURES) sets.push({ key: `fx-${name}`, spec: specOf(fixtureJson(name)), category: "fixture", buildId: `fx-${name}` });
    }

    const jobs: RenderJob[] = sets.map((s) => ({
      key: s.key,
      spec: s.spec,
      mark: { x: s.spec.marks[0].x, z: s.spec.marks[0].z, facingDeg: s.spec.marks[0].facingDeg },
      poses: s.spec.cameras.slice(0, C_CAMERAS).map((_, i) => framePose(s.spec, i)),
    }));
    const rendered = await renderSets({ net: ctx.net, repoRoot: ctx.repoRoot, chromePath: f.chrome, jobs, outDir: join(ctx.runDir, "frames"), progress: ctx.progress });

    const directions = ctx.corpus.data.directions.length ? ctx.corpus.data.directions : ["(no direction)"];
    const characters = ctx.corpus.data.characters;
    const items: SheetItemIn[] = [];
    let shotNo = 0;
    let setShot = 0;
    let failed = 0;
    for (const r of rendered) {
      const set = sets.find((s) => s.key === r.key) as CSet;
      if (!r.ok) {
        failed += 1;
        writeResult(ctx, { type: "c-frame", setKey: r.key, ok: false, error: r.error, simulated: true });
        continue;
      }
      for (const frame of r.result.frames) {
        const cam = set.spec.cameras.find((c) => c.id === frame.poseId);
        if (!cam || !r.files[frame.poseId]) continue;
        const framePath = join(ctx.runDir, "frames", r.files[frame.poseId]);
        writeResult(ctx, { type: "c-frame", setKey: r.key, cameraId: cam.id, ok: true, file: `frames/${r.files[frame.poseId]}`, lift: r.result.lift, lifted: r.result.lifted, controlsWouldMove: frame.controlsWouldMove, simulated: true });
        const layout = normaliseSetLayout({ markId: set.spec.marks[0].id, mark: set.spec.marks[0], camera: { position: cam.position, target: cam.target, fovDeg: cam.fovDeg } }, set.spec);
        for (const ch of characters) {
          // Shot k (one set, camera and character) takes directions[k % n], the same on every engine.
          const direction = directions[setShot % directions.length];
          setShot += 1;
          const prompt = buildSetShotPrompt({ description: set.spec.description, direction: cleanText(direction, SET_DIRECTION_MAX_CHARS), lifted: r.result.lifted, layout });
          for (const engine of f.engines) {
            shotNo += 1;
            const shotId = `cs-${r.key}-${cam.id}-${ch.id}-${engine}`;
            const decision = identityGateDecision({ score: null, threshold: DEFAULT_IDENTITY_THRESHOLD, retriesUsed: 0 });
            writeResult(ctx, {
              type: "shot",
              shotId,
              arm: "set",
              engine,
              setKey: r.key,
              cameraId: cam.id,
              cameraHeightM: cam.position[1],
              characterId: ch.id,
              prompt,
              expectedPipelinePrompt: engine === "seedream" ? null : pipelinePrompt(prompt),
              entryGate: "allowed",
              outcome: "rendered",
              resultFile: `frames/${r.files[frame.poseId]}`,
              identity: { score: null },
              identityDecision: decision.action === "retry" ? "retry" : "pass",
              engineCalls: 0,
              billedUsd: 0,
              simulated: true,
            });
            const photo = ch.identityPhoto ? join(ctx.corpusDir, ch.identityPhoto) : "";
            items.push({
              source: { shotId, engine, setKey: r.key, cameraId: cam.id, characterId: ch.id },
              groupKey: r.key,
              images: [
                { role: "sketch", path: framePath },
                { role: "still", path: framePath },
                ...(photo && existsSync(photo) ? [{ role: "reference" as const, path: photo }] : []),
              ],
            });
          }
        }
      }
    }
    const pages = writeRaterSheets(ctx, "c-composition", items);
    const out = [
      `C ${ctx.runId}  (DRY RUN: frames are real, stills are the frames themselves)`,
      `  sets ${sets.length} (${f.fromRun ? `from ${f.fromRun} at astra-${effort}` : "product fixtures"}); frames drawn for ${rendered.length - failed}; render errors ${failed}`,
      `  lifted sets: ${rendered.filter((r) => r.ok && r.result.lifted).length}; frames a live OrbitControls would have moved: ${rendered.reduce((n, r) => n + (r.ok ? r.result.frames.filter((x) => x.controlsWouldMove).length : 0), 0)}`,
      `  pipeline strings (GENERATE_RETRIES, and pipeline.ts appending reference-notes.ts) ${drift.ok ? "match" : `DRIFTED: ${drift.missing.join("; ")}`}`,
      `  simulated shots: ${shotNo} (${f.engines.join(", ")}; characters ${characters.length})`,
      "--- sample sheets (simulated) ---",
      ...pages.map((p) => `  ${p}`),
    ];
    for (const l of out) ctx.out(l);
    writeSummary(ctx, out.join("\n"), { part: "c", simulated: true, sets: sets.length, frames: rendered.length - failed, shots: shotNo, pipelineStrings: drift });
    writeManifest(ctx);
    return 0;
  },
};
