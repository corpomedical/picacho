// What each part will call, how many times, and the most each call can
// cost — printed by every dry run and checked against --max-usd before a
// real run makes its first call. Pure over a price book.

import { SET_BUILD_EFFORT, SET_PHOTO_BUILD_EFFORT } from "../../../src/lib/sets/set-config.ts";
import type { Builder, Engine } from "./cli.mts";
import { BASELINE_MODELS, BATCH_SOURCE, type PriceBook } from "./prices.mts";
import { GENERATE_RETRIES } from "./pipeline-strings.mts";
import type { PlannedCall } from "./spend-guard.mts";
import { usd } from "./util.mts";

const ASTRA_SOURCE = "src/lib/astra/prices.ts worstCaseAstraUsd over set-config.ts caps";
const EXTERNAL = "external-prices.json";

function astraLine(book: PriceBook, label: string, builds: number, batch: boolean, firstOnly = false): PlannedCall {
  const unit = (firstOnly ? book.astraFirstWorstUsd : book.astraBuildWorstUsd) * (batch ? book.batchMultiplier : 1);
  const parts = firstOnly ? `first attempt ${usd(book.astraFirstWorstUsd, 3)}` : `first ${usd(book.astraFirstWorstUsd, 3)} + retry ${usd(book.astraRetryWorstUsd, 3)}`;
  return {
    kind: "astra",
    label: `${label}: ${builds} × (${parts})${batch ? ` × ${book.batchMultiplier} Batch` : " standard"}`,
    count: builds,
    unitUsd: unit,
    source: batch ? `${ASTRA_SOURCE}; ${BATCH_SOURCE}` : ASTRA_SOURCE,
    metered: false,
  };
}

/** A photo build: the photo caps, background at standard price — a photo never goes into a Batch input file. */
function astraPhotoLine(book: PriceBook, label: string, builds: number): PlannedCall {
  return {
    kind: "astra",
    label: `${label}: ${builds} × (first ${usd(book.astraPhotoFirstWorstUsd, 3)} + retry ${usd(book.astraPhotoRetryWorstUsd, 5)}) standard (background; photos never go on Batch)`,
    count: builds,
    unitUsd: book.astraPhotoBuildWorstUsd,
    source: `${ASTRA_SOURCE} (the photo caps)`,
    metered: false,
  };
}

function baselineLines(book: PriceBook, builder: "sonnet-5" | "mini-5.4", builds: number, firstOnly = false): PlannedCall[] {
  const model = BASELINE_MODELS[builder];
  const lines: PlannedCall[] = [
    {
      kind: builder,
      label: `${model}: ${builds} first attempts (input ≤ 1 token/char, output ≤ 10,000)`,
      count: builds,
      unitUsd: book.baselineAttemptWorstUsd(model, "first"),
      source: `${EXTERNAL} models.${model}`,
      metered: false,
    },
  ];
  if (!firstOnly) {
    lines.push({
      kind: builder,
      label: `${model}: ≤ ${builds} retries`,
      count: builds,
      unitUsd: book.baselineAttemptWorstUsd(model, "retry"),
      source: `${EXTERNAL} models.${model}`,
      metered: false,
    });
  }
  return lines;
}

function judgementLine(book: PriceBook, what: string, key: "prompt-gate" | "output-gate" | "identity-scorer" | "drafter", count: number): PlannedCall {
  const kind = key === "identity-scorer" ? "scorer" : key === "drafter" ? "drafter" : "gates";
  return {
    kind,
    label: `${what}: ≤ ${count} judgements`,
    count,
    unitUsd: book.judgement(key),
    source: `${EXTERNAL} judgementCeilings.${key}`,
    metered: true,
  };
}

export function planA(o: {
  briefs: number;
  runs: number;
  builders: readonly Builder[];
  transport: "batch" | "background";
  wordsGate: boolean;
  book: PriceBook;
}): PlannedCall[] {
  const builds = o.briefs * o.runs;
  const lines: PlannedCall[] = [];
  for (const b of o.builders) {
    if (b === "astra-low" || b === "astra-medium") lines.push(astraLine(o.book, `Astra ${b.slice(6)}`, builds, o.transport === "batch"));
    else lines.push(...baselineLines(o.book, b, builds));
  }
  if (o.wordsGate) lines.push(judgementLine(o.book, "words gate on every valid answer", "prompt-gate", builds * o.builders.length * 2));
  return lines;
}

/** A's photo arm: Astra only (section 4 bars photo builds on Astra's cost; the baselines are words-only). */
export function planAPhotos(o: { photos: number; runs: number; builders: readonly Builder[]; wordsGate: boolean; book: PriceBook }): PlannedCall[] {
  const builds = o.photos * o.runs;
  const arms = o.builders.filter((b) => b === "astra-low" || b === "astra-medium");
  const lines = arms.map((b) => astraPhotoLine(o.book, `Astra ${b.slice(6)}, photos`, builds));
  if (o.wordsGate) lines.push(judgementLine(o.book, "words gate on every valid answer", "prompt-gate", builds * arms.length * 2));
  return lines;
}

/**
 * D's photo leg, per photo and run, as submitSetPhotoBuild orders it: the
 * notes gate (photos with notes only), the picture check, then the build
 * (every photo is assumed to pass, the ceiling) and its words gate.
 */
export function planDPhotos(o: { photos: number; withNotes: number; runs: number; effort?: string; book: PriceBook }): PlannedCall[] {
  const n = o.photos * o.runs;
  return [
    judgementLine(o.book, "notes gate", "prompt-gate", o.withNotes * o.runs),
    judgementLine(o.book, "picture check on each photo", "output-gate", n),
    astraPhotoLine(o.book, `Astra ${o.effort ?? SET_PHOTO_BUILD_EFFORT}, D photos`, n),
    judgementLine(o.book, "words gate", "prompt-gate", n * 2),
  ];
}

export function planCanary(o: { briefs: number; transport: "batch" | "background"; book: PriceBook }): PlannedCall[] {
  return [astraLine(o.book, `Astra ${SET_BUILD_EFFORT}, canary`, o.briefs, o.transport === "batch", true)];
}

export function planProbeA(book: PriceBook): PlannedCall[] {
  return [
    astraLine(book, "Astra, one Batch line", 1, true, true),
    ...baselineLines(book, "mini-5.4", 1, true),
    ...baselineLines(book, "sonnet-5", 1, true),
  ];
}

function imageLines(book: PriceBook, engine: Engine, stills: number, what: string): PlannedCall[] {
  const pipeline = engine !== "seedream";
  const renders = stills * (pipeline ? GENERATE_RETRIES : 1);
  return [
    {
      kind: engine,
      label: `${what} ${engine}: ${stills} stills${pipeline ? ` × ${GENERATE_RETRIES} renders reserved (GENERATE_RETRIES)` : ""}`,
      count: renders,
      unitUsd: book.image(engine),
      source: engine === "gpt-image" ? "IMAGE_COST_USD, src/lib/admin/economics.ts" : `${EXTERNAL} images`,
      metered: false,
    },
  ];
}

export function planC(o: {
  sets: number;
  cameras: number;
  characters: number;
  engines: readonly Engine[];
  control: boolean;
  book: PriceBook;
}): PlannedCall[] {
  const setShots = o.sets * o.cameras * o.characters;
  const controlsPerEngine = o.control ? o.sets * o.characters : 0;
  const lines: PlannedCall[] = [];
  let entry = 0;
  let pipelineGates = 0;
  let output = 0;
  let drafts = 0;
  for (const e of o.engines) {
    lines.push(...imageLines(o.book, e, setShots, "set shots"));
    entry += setShots;
    pipelineGates += setShots;
    output += setShots;
    if (e !== "seedream" && controlsPerEngine > 0) {
      lines.push(...imageLines(o.book, e, controlsPerEngine, "controls"));
      entry += controlsPerEngine;
      pipelineGates += controlsPerEngine;
      output += controlsPerEngine;
      drafts += controlsPerEngine;
    }
  }
  lines.push(judgementLine(o.book, "entry prompt gate", "prompt-gate", entry));
  lines.push(judgementLine(o.book, "pipeline prompt gate", "prompt-gate", pipelineGates));
  lines.push(judgementLine(o.book, "output gate", "output-gate", output));
  lines.push(judgementLine(o.book, "identity score", "identity-scorer", output));
  if (drafts > 0) lines.push(judgementLine(o.book, "drafter (controls)", "drafter", drafts));
  return lines;
}

export function planProbeC(o: { engines: readonly Engine[]; book: PriceBook }): PlannedCall[] {
  return planC({ sets: 1, cameras: 1, characters: 1, engines: o.engines, control: false, book: o.book });
}

/**
 * D's calls. `stills` is false while D's stills leg is not built (design §9,
 * second sitting): the plan then holds only what this runner can call.
 */
export function planD(o: {
  briefs: number;
  runs: number;
  dCameras: number;
  transport: "batch" | "background";
  stills: boolean;
  book: PriceBook;
}): PlannedCall[] {
  const n = o.briefs * o.runs;
  const stills = n * o.dCameras;
  const lines: PlannedCall[] = [
    judgementLine(o.book, "brief gate", "prompt-gate", n),
    astraLine(o.book, `Astra ${SET_BUILD_EFFORT}, D`, n, o.transport === "batch"),
    judgementLine(o.book, "words gate", "prompt-gate", n * 2),
  ];
  if (o.stills) {
    lines.push(
      ...imageLines(o.book, "gpt-image", stills, "stills (only for briefs that get through)"),
      judgementLine(o.book, "gates on the stills (entry + pipeline)", "prompt-gate", stills * 2),
      judgementLine(o.book, "output gate on the stills", "output-gate", stills),
      judgementLine(o.book, "identity score on the stills", "identity-scorer", stills),
    );
  }
  return lines;
}

export function ceilingOf(plan: readonly PlannedCall[]): { ceilingUsd: number; unpriced: string[] } {
  let ceilingUsd = 0;
  const unpriced = new Set<string>();
  for (const l of plan) {
    if (l.count <= 0) continue;
    if (l.unitUsd === null) unpriced.add(l.kind);
    else ceilingUsd += l.count * l.unitUsd;
  }
  return { ceilingUsd, unpriced: [...unpriced] };
}

export function formatPlan(title: string, plan: readonly PlannedCall[]): string {
  const rows = plan.map((l) => {
    const total = l.unitUsd === null ? "unpriced" : usd(l.count * l.unitUsd, 2);
    return `  ${l.label}\n      ${l.count} × ${usd(l.unitUsd, 4)} = ${total}${l.metered ? "  (metered)" : ""}   [${l.source}]`;
  });
  const { ceilingUsd, unpriced } = ceilingOf(plan);
  return [
    `--- ${title} ---`,
    ...rows,
    `  CEILING (priced lines): ${usd(ceilingUsd, 2)}`,
    unpriced.length ? `  UNPRICED until external-prices.json is filled (metered either way): ${unpriced.join(", ")}` : "  every line priced",
  ].join("\n");
}
