// What each part will call, how many times, and the most each call can
// cost — printed by every dry run and checked against --max-usd before a
// real run makes its first call. Pure over a price book.

import { SET_BUILD_EFFORT, SET_MATCH_EFFORT, SET_PHOTO_BUILD_EFFORT } from "../../../src/lib/sets/set-config.ts";
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

/**
 * E's calls, per photo and run on each builder, as match-actions.ts makes a
 * read: the picture check once per photo (the same bytes every read sends),
 * then Astra in background at the match caps' worst case — standard price, a
 * photo never goes into a Batch input file — and gpt-5.4-mini as one call,
 * unpriced until external-prices.json has it.
 */
export function planE(o: { photos: number; runs: number; book: PriceBook }): PlannedCall[] {
  const reads = o.photos * o.runs;
  const mini = BASELINE_MODELS["mini-5.4"];
  return [
    judgementLine(o.book, "picture check, once per photo", "output-gate", o.photos),
    {
      kind: "astra",
      label: `Astra ${SET_MATCH_EFFORT}, match reads: ${reads} × ${usd(o.book.astraMatchWorstUsd, 5)} standard (background; photos never go on Batch)`,
      count: reads,
      unitUsd: o.book.astraMatchWorstUsd,
      source: `${ASTRA_SOURCE} (the match caps)`,
      metered: false,
    },
    {
      kind: "mini-5.4",
      label: `${mini}, match reads: ${reads} (input ≤ 1 token/char of the text + the product's whole match budget for the picture, output ≤ the match cap)`,
      count: reads,
      unitUsd: o.book.matchBaselineWorstUsd(mini),
      source: `${EXTERNAL} models.${mini}`,
      metered: false,
    },
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
  if (stills <= 0) return [];
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

/**
 * C's calls. Per engine: every set's first `cameras` cameras × characters on
 * their own sketch; on the engines a look can ride (GPT Image and FLUX, the
 * product's rule), the later cameras again carrying camera 1's still as the
 * look (`look`); and a control per set and character on the product engines.
 * `twins: false` (the probe) sends the later cameras only with the look.
 */
export function planC(o: {
  sets: number;
  cameras: number;
  characters: number;
  engines: readonly Engine[];
  control: boolean;
  look: boolean;
  twins?: boolean;
  book: PriceBook;
}): PlannedCall[] {
  const setShots = o.sets * (o.twins === false ? Math.min(1, o.cameras) : o.cameras) * o.characters;
  const lookShots = o.look ? o.sets * Math.max(0, o.cameras - 1) * o.characters : 0;
  const controlsPerEngine = o.control ? o.sets * o.characters : 0;
  const lines: PlannedCall[] = [];
  let entry = 0;
  let pipelineGates = 0;
  let output = 0;
  let drafts = 0;
  for (const e of o.engines) {
    const product = e !== "seedream";
    const stills = setShots + (product ? lookShots + controlsPerEngine : 0);
    lines.push(...imageLines(o.book, e, setShots, "set shots"));
    if (product) {
      lines.push(...imageLines(o.book, e, lookShots, "look shots (the later cameras again, carrying camera 1's still)"));
      lines.push(...imageLines(o.book, e, controlsPerEngine, "controls"));
      drafts += controlsPerEngine;
    }
    entry += stills;
    pipelineGates += stills;
    output += stills;
  }
  lines.push(judgementLine(o.book, "entry prompt gate", "prompt-gate", entry));
  lines.push(judgementLine(o.book, "pipeline prompt gate", "prompt-gate", pipelineGates));
  lines.push(judgementLine(o.book, "output gate", "output-gate", output));
  lines.push(judgementLine(o.book, "identity score", "identity-scorer", output));
  if (drafts > 0) lines.push(judgementLine(o.book, "drafter (controls)", "drafter", drafts));
  return lines;
}

/**
 * `c --probe`: one fixture set, one character, each engine: camera 1 on its
 * own sketch, and (`look`) camera 2 carrying camera 1's still on the engines
 * a look rides, with no twin; no control.
 */
export function planProbeC(o: { engines: readonly Engine[]; look: boolean; book: PriceBook }): PlannedCall[] {
  return planC({ sets: 1, cameras: o.look ? 2 : 1, characters: 1, engines: o.engines, control: false, look: o.look, twins: false, book: o.book });
}

/**
 * D's calls. `stills` is how many brief runs may get stills: the harmful
 * briefs × runs (the stills leg shoots only a harmful brief's delivered
 * set), each on its first `dCameras` cameras, on GPT Image. The ceiling
 * assumes every one of them gets through.
 */
export function planD(o: {
  briefs: number;
  runs: number;
  dCameras: number;
  transport: "batch" | "background";
  stills: number;
  book: PriceBook;
}): PlannedCall[] {
  const n = o.briefs * o.runs;
  const stills = o.stills * o.dCameras;
  const lines: PlannedCall[] = [
    judgementLine(o.book, "brief gate", "prompt-gate", n),
    astraLine(o.book, `Astra ${SET_BUILD_EFFORT}, D`, n, o.transport === "batch"),
    judgementLine(o.book, "words gate", "prompt-gate", n * 2),
  ];
  if (stills > 0) {
    lines.push(
      ...imageLines(o.book, "gpt-image", stills, "stills (harmful briefs that get a set)"),
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
