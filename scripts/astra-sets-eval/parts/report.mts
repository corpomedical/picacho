// report <runDir> [<runDir>...]: every bar the runs in hand can settle.
//
// It reads each run's manifest, results, ledger, sheet keys and returned
// ratings (<runDir>/ratings/*.json), imports the ratings against their keys,
// computes the bars (pass-bars.mts) and writes one summary: a line per bar
// with its value, threshold, n and arithmetic; the spend picture (billed and
// production-equivalent, by kind, and the metered tokens of unpriced
// models); and the release line for SETS_OPEN_TO_PLANS.
//
//   simulated runs      (a dry run's) never reach a bar: listed, set aside
//   incomplete runs     (interrupted, stopped, unfinished: manifest.complete
//                       is not true) may fail a bar, never pass one
//   sheets with import  problems are left out entirely (and the report
//                       exits 2)
//   the release line    is decided by the arm that ships (SET_BUILD_EFFORT);
//                       the other Astra arm is REPORTED beside it
//   persons (D)         every item on every real persons sheet counts: an
//                       item nobody rated leaves the bar UNDETERMINED
//   stills (C)          every real C run's stills pooled (probes set aside),
//                       with the composition sheets' ratings: barC per
//                       engine, all three engines section 4 names (one with
//                       no still in hand is UNDETERMINED, a BLOCKED arm never
//                       passes), and the look — its objects question, and
//                       identity and composition with it against without —
//                       with the camera heights and the rest, REPORTED
//   stills (D)          D's outcomes carry the stills leg's verdicts; the
//                       d-stills sheet (stills that passed the output gate,
//                       rated off limits or not) is REPORTED, outside the bar
//   the photo arm       (runs whose manifest says photos: A and B on the
//                       location photos, D on the photos with people) is read
//                       apart: its own bars — A photo validity and cost
//                       (--photo-credits, default ceil(worst first photo
//                       attempt / $0.28) = 4 → $1.12), B photo fidelity, and
//                       the persons bar over the photo runs' sheets, which
//                       never passes while a photo with people is
//                       undetermined or none reached a sheet — decided by
//                       SET_PHOTO_BUILD_EFFORT's arm, and its own line under
//                       the release line. SETS_OPEN_TO_PLANS never opens
//                       Sets from a photo, so the photo arm never decides it.
//   Match this shot     (E runs) every read in hand, each with the two
//                       ratings of its stage view (the e-match sheets):
//                       barE's two bars — held by the builder the route
//                       sends Match to, the other builder's reported — and
//                       the route, on a line of their own. Match this shot
//                       sits behind astra_photo_sets, never
//                       SETS_OPEN_TO_PLANS

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SET_BUILD_EFFORT, SET_MATCH_EFFORT, SET_PHOTO_BUILD_EFFORT } from "../../../src/lib/sets/set-config.ts";
import type { BuildRecord } from "../lib/build-flow.mts";
import { combineRatings, importRatings, type RatingRow, type SheetKey } from "../lib/blind-sheet.mts";
import type { Flags } from "../lib/cli.mts";
import { barLine } from "../lib/context.mts";
import { Ledger, type CallKind } from "../lib/ledger.mts";
import {
  agreement,
  asReported,
  barACost,
  barAValidity,
  barB,
  barD,
  barE,
  barPersons,
  capAtUndetermined,
  capPhotoPersons,
  defaultCredits,
  PRIOR_HITS_SOURCES,
  photoArm,
  priorHitsConstruction,
  reportDPhotos,
  reportDStills,
  shotPromptRefusalsCount,
  type BarResult,
  type BItem,
  type DRow,
  type PersonsItem,
} from "../lib/pass-bars.mts";
import { tokenCounts, type PriceBook } from "../lib/prices.mts";
import { canonicalJson, newRunId, pct, usd } from "../lib/util.mts";
import { readRun } from "./b.mts";
import { cFromRuns } from "./c.mts";
import { dPhotoRow, type DOutcome, type DPhotoOutcome } from "./d.mts";
import { eItems, type EPhotoRow, type EReadRow } from "./e.mts";

type LoadedRun = {
  dir: string;
  manifest: Record<string, unknown>;
  rows: Record<string, unknown>[];
  keys: SheetKey[];
  ratings: unknown[];
  simulated: boolean;
  complete: boolean;
  part: string;
  /** A photo-arm run (a/b/d --photos). */
  photos: boolean;
};

function loadRun(dir: string): LoadedRun {
  const { manifest, rows } = readRun(dir);
  const read = (sub: string, match: (f: string) => boolean) =>
    existsSync(join(dir, sub))
      ? readdirSync(join(dir, sub))
          .filter(match)
          .map((f) => JSON.parse(readFileSync(join(dir, sub, f), "utf8")) as unknown)
      : [];
  return {
    dir,
    manifest,
    rows,
    keys: read("keys", (f) => f.endsWith(".key_do_not_share.json")) as SheetKey[],
    ratings: read("ratings", (f) => f.endsWith(".json")),
    simulated: manifest.simulated === true,
    complete: manifest.complete === true,
    part: String(manifest.part ?? "?"),
    photos: manifest.photos === true,
  };
}

const runName = (r: LoadedRun) => `${String(r.manifest.runId ?? r.dir)}${r.photos ? " [photos]" : ""}`;

function spendPicture(runs: readonly LoadedRun[]): string[] {
  const lines = ["--- spend (from each run's ledger) ---"];
  for (const r of runs) {
    const events = Ledger.read(join(r.dir, "ledger.jsonl"));
    const kindOf = new Map<string, CallKind>();
    const byKind = new Map<string, { billed: number; standard: number; n: number }>();
    const meters = new Map<string, { n: number; usd: number | null; input: number; output: number }>();
    let unknown = 0;
    for (const e of events) {
      if (e.ev === "reserve") kindOf.set(e.ticket, e.kind);
      if (e.ev === "settle") {
        const k = kindOf.get(e.ticket) ?? "?";
        const v = byKind.get(k) ?? { billed: 0, standard: 0, n: 0 };
        v.billed += e.actualUsd;
        v.standard += e.standardUsd;
        v.n += 1;
        byKind.set(k, v);
        if (e.basis.startsWith("outcome unknown")) unknown += 1;
      }
      if (e.ev === "meter") {
        const m = meters.get(e.model) ?? { n: 0, usd: 0, input: 0, output: 0 };
        m.n += 1;
        m.usd = e.usd === null || m.usd === null ? null : m.usd + e.usd;
        const t = tokenCounts(e.usage, e.host === "api.anthropic.com" ? "anthropic" : "openai");
        if (t) {
          m.input += t.freshInput + t.cachedInput + t.cacheWrite;
          m.output += t.output;
        }
        meters.set(e.model, m);
      }
    }
    lines.push(`  ${runName(r)}${r.simulated ? " (simulated)" : ""}`);
    for (const [k, v] of byKind) lines.push(`    ${k}: ${v.n} calls, billed ${usd(v.billed)}, production-equivalent ${usd(v.standard)}`);
    for (const [model, m] of meters) lines.push(`    metered ${model}: ${m.n} calls, ${m.input} in / ${m.output} out tokens, ${m.usd === null ? "unpriced" : usd(m.usd)}`);
    if (unknown) lines.push(`    ${unknown} request(s) sent with no answer: booked at the worst case (outcome unknown)`);
    if (byKind.size === 0 && meters.size === 0) lines.push("    nothing spent");
  }
  return lines;
}

/** The builds A planned for a builder: the manifest's briefs × runs, or (older runs) its rows. */
function plannedOf(r: LoadedRun, builder: string): number {
  const p = r.manifest.plannedBuilds as Record<string, unknown> | undefined;
  const n = p?.[builder];
  return typeof n === "number" ? n : r.rows.filter((x) => x.type === "build" && x.builder === builder).length;
}

export async function runReport(o: { runDirs: readonly string[]; flags: Flags; book: PriceBook; repoRoot: string; outRoot: string; out: (l?: string) => void }): Promise<number> {
  const runs = o.runDirs.map(loadRun);
  const real = runs.filter((r) => !r.simulated);
  const problems: string[] = [];
  const warnings: string[] = [];
  const finishes = (r: LoadedRun) => ["a", "c", "d", "e", "canary"].includes(r.part) && r.manifest.probe !== true;
  const incomplete = real.filter((r) => !r.complete && finishes(r));
  for (const r of incomplete) warnings.push(`${runName(r)}: INCOMPLETE (interrupted, stopped or unfinished): it may fail a bar, never pass one. ${r.part === "c" || r.part === "d" || r.part === "e" ? `Rerun ${r.part.toUpperCase()}` : "--resume it"}`);

  // Ratings, imported against their keys. A sheet whose import has a
  // problem is left out whole: none of its ratings reach a bar.
  const ratingRows: RatingRow[] = [];
  for (const r of runs) {
    if (!r.simulated && r.keys.length && r.ratings.length === 0) warnings.push(`${runName(r)}: ${r.keys.length} sheet key(s) and no ratings files in ${join(r.dir, "ratings")}`);
    for (const key of r.keys) {
      if (r.ratings.length === 0) continue;
      const imp = importRatings(key, r.ratings, { allowIncomplete: o.flags.allowIncomplete });
      if (imp.rows.length === 0 && imp.problems.every((p) => p.includes("no ratings file"))) {
        warnings.push(...imp.problems);
        continue;
      }
      warnings.push(...imp.warnings);
      if (imp.problems.length) {
        problems.push(...imp.problems);
        continue;
      }
      if (!r.simulated) ratingRows.push(...imp.rows.map((x) => ({ ...x, source: { ...x.source, kind: key.kind } })));
    }
  }
  const combined = combineRatings(ratingRows);
  const ofKind = (kind: string) => [...combined.values()].filter((c) => c.source.kind === kind);

  const shipped = `astra-${SET_BUILD_EFFORT}`;
  const notShipped = `not the shipped effort (SET_BUILD_EFFORT = ${SET_BUILD_EFFORT})`;
  const bars: BarResult[] = [];
  const reported: BarResult[] = [];
  const release: Record<"A" | "B" | "C" | "D", "✓" | "✗" | "?"> = { A: "?", B: "?", C: "?", D: "?" };
  const otherArms: string[] = [];
  const verdictOf = (all: BarResult[]) => {
    const bs = all.filter((b) => b.verdict !== "REPORTED");
    return bs.length === 0 ? "?" : bs.some((b) => b.verdict === "FAIL") ? "✗" : bs.every((b) => b.verdict === "PASS") ? "✓" : "?";
  };
  const measured = (all: BarResult[]) => verdictOf(all.map((b) => ({ ...b, verdict: (b.notes.find((n) => n.startsWith("measured: "))?.slice(10) ?? b.verdict) as BarResult["verdict"] })));
  const capIf = (bs: BarResult[], runsOf: readonly LoadedRun[]) => {
    const open = runsOf.filter((r) => !r.complete);
    return open.length ? bs.map((b) => capAtUndetermined(b, `${open.map(runName).join(", ")} did not finish`)) : bs;
  };

  const buildsOf = (rs: readonly LoadedRun[]) => rs.flatMap((r) => r.rows.filter((x) => x.type === "build") as unknown as BuildRecord[]);
  const costPerDeliveredOf = (builds: readonly BuildRecord[], builders: readonly string[]) => {
    const out: Record<string, number | null> = {};
    for (const b of builders) {
      const mine = builds.filter((x) => x.builder === b && !x.notRun);
      const delivered = mine.filter((x) => x.status === "delivered").length;
      out[b] = mine.some((x) => x.standardUsd === null) || delivered === 0 ? null : mine.reduce((s, x) => s + (x.standardUsd as number), 0) / delivered;
    }
    return out;
  };
  const scoresOf = (kind: string): BItem[] => ofKind(kind).map((c) => ({ builder: String(c.source.builder), scores: c.ratings.map((x) => x.score).filter((x): x is number => typeof x === "number") }));
  const agreementBar = (id: string, label: string, items: readonly BItem[]): BarResult | null => {
    const ag = agreement(items);
    if (!ag.n) return null;
    return {
      id,
      label,
      verdict: "REPORTED",
      value: pct(ag.exact / ag.n),
      threshold: "reported",
      n: ag.n,
      arithmetic: `exact ${ag.exact}/${ag.n} = ${pct(ag.exact / ag.n)}; within 1 point ${ag.within1}/${ag.n} = ${pct(ag.within1 / ag.n)}`,
      notes: [],
    };
  };
  /** Every item on every persons sheet (or D's stills sheet) of these runs: one nobody rated counts as lacking two ratings. */
  const personsOf = (rs: readonly LoadedRun[], kind: "d-persons" | "d-stills" = "d-persons"): PersonsItem[] => {
    const universe = new Set<string>();
    for (const r of rs) for (const key of r.keys) if (key.kind === kind) for (const it of key.items) universe.add(canonicalJson({ ...it.source, kind: key.kind }));
    return [...universe].map((k) => ({
      choices: (combined.get(k)?.ratings ?? []).map((x) => x.choice).filter((x): x is "yes" | "no" | "unsure" => typeof x === "string"),
    }));
  };
  const construction = () => {
    const policyLog = readFileSync(join(o.repoRoot, "src/lib/generations/policy-log.ts"), "utf8");
    return {
      ...priorHitsConstruction({ sets: PRIOR_HITS_SOURCES.map((f) => readFileSync(join(o.repoRoot, f), "utf8")).join("\n"), policyLog }),
      shotPromptsCount: shotPromptRefusalsCount(policyLog),
    };
  };
  const words = real.filter((r) => !r.photos);

  // A
  const aRuns = words.filter((r) => r.part === "a" && r.manifest.probe !== true);
  const aBuilds = buildsOf(aRuns);
  const builders = [...new Set(aBuilds.map((b) => b.builder))];
  const astraArms = builders.filter((b) => b.startsWith("astra-"));
  const planned = (b: string) => aRuns.reduce((s, r) => s + plannedOf(r, b), 0);
  const credits = o.flags.credits ?? defaultCredits(o.book.astraFirstWorstUsd, o.book.costBasisUsdPerCredit);
  const aBars: BarResult[] = [];
  for (const arm of astraArms) {
    const plan = { planned: planned(arm), worstBuildUsd: o.book.astraBuildWorstUsd };
    const bs = capIf([barAValidity(arm, aBuilds, plan), barACost(arm, aBuilds, credits, o.book.costBasisUsdPerCredit, plan)], aRuns);
    if (arm === shipped) aBars.push(...bs);
    else {
      const rep = bs.map((b) => asReported(b, notShipped));
      reported.push(...rep);
      otherArms.push(`${arm} A ${measured(rep)}`);
    }
  }
  bars.push(...aBars);
  for (const b of builders.filter((x) => !x.startsWith("astra-"))) {
    reported.push({ ...barAValidity(b, aBuilds, { planned: planned(b) }), label: `A ${b} validity (baseline, no bar)`, verdict: "REPORTED" });
  }
  if (aBars.length) release.A = verdictOf(aBars);

  // B
  const costPerDelivered = costPerDeliveredOf(aBuilds, builders);
  const bItems = scoresOf("b-fidelity");
  if (words.some((r) => r.part === "b")) {
    const bAll = capIf(barB(bItems, costPerDelivered, astraArms.length ? astraArms : [shipped]), aRuns);
    const mineB = bAll.filter((b) => b.id.endsWith(`-${shipped}`));
    const otherB = bAll.filter((b) => !b.id.endsWith(`-${shipped}`)).map((b) => asReported(b, notShipped));
    bars.push(...mineB);
    reported.push(...otherB);
    release.B = verdictOf(mineB.filter((b) => b.id.startsWith("B-median")));
    for (const arm of astraArms.filter((a) => a !== shipped)) otherArms.push(`${arm} B ${measured(otherB.filter((b) => b.id === `B-median-${arm}`))}`);
    const ag = agreementBar("B-agreement", "B inter-rater agreement (no bar)", bItems);
    if (ag) reported.push(ag);
  }

  // C: every real C run's stills (probes set aside), pooled, with the composition sheets' ratings.
  const cRuns = words.filter((r) => r.part === "c" && r.manifest.probe !== true);
  let cNote: string | null = "C: no real C run in hand";
  if (cRuns.length) {
    const c = cFromRuns(cRuns, ofKind("c-composition"));
    const cBarsIn = capIf(c.bars, cRuns);
    bars.push(...cBarsIn);
    reported.push(...c.reported);
    release.C = verdictOf(cBarsIn);
    cNote = c.blocked.length ? `C: ${c.blocked.join(", ")} BLOCKED (fal refused the data: references; the runner uploads nothing)` : null;
  }

  // D
  const dRuns = words.filter((r) => r.part === "d");
  const dOutcomes = dRuns.flatMap((r) => r.rows.filter((x) => x.type === "d-outcome") as unknown as DOutcome[]);
  let priorHitsBar: BarResult | null = null;
  if (dOutcomes.length) {
    const rows: DRow[] = dOutcomes.map((x) => ({ briefId: `${x.briefId}-r${x.run}`, harmful: x.harmful, outcome: x.outcome }));
    // Every item on every real words persons sheet (A's and D's).
    const persons = personsOf(words);
    const personsFrom = words.filter((r) => r.keys.some((k) => k.kind === "d-persons"));
    const dBars = barD(rows, persons, construction()).map((b) => (b.id === "D-persons" ? capIf([b], personsFrom)[0] : b.id === "D-harmful" ? capIf([b], dRuns)[0] : b));
    bars.push(...dBars);
    priorHitsBar = dBars.find((b) => b.id === "D-prior-hits") ?? null;
    release.D = verdictOf(dBars.filter((b) => b.id !== "D-over-refusal"));
    // The stills that passed the output gate, rated off limits or not: a gate false negative, never the bar.
    if (dRuns.some((r) => r.keys.some((k) => k.kind === "d-stills"))) reported.push(reportDStills(personsOf(dRuns, "d-stills")));
  }

  // THE PHOTO ARM (Sets from a photo): the same bars over the photo runs,
  // decided by SET_PHOTO_BUILD_EFFORT's arm, on a line of their own.
  const photoRuns = real.filter((r) => r.photos);
  const photoShipped = `astra-${SET_PHOTO_BUILD_EFFORT}`;
  const photoNotShipped = `not the shipped photo effort (SET_PHOTO_BUILD_EFFORT = ${SET_PHOTO_BUILD_EFFORT})`;
  const photoRelease: Record<"A" | "B" | "D", "✓" | "✗" | "?"> = { A: "?", B: "?", D: "?" };
  const photoOtherArms: string[] = [];
  const photoNotes: string[] = [];
  const photoCredits = o.flags.photoCredits ?? defaultCredits(o.book.astraPhotoFirstWorstUsd, o.book.costBasisUsdPerCredit);
  const paRuns = photoRuns.filter((r) => r.part === "a");
  const paBuilds = buildsOf(paRuns);
  const photoArms = [...new Set(paBuilds.map((b) => b.builder))].filter((b) => b.startsWith("astra-"));
  if (paBuilds.length) {
    const aP: BarResult[] = [];
    for (const arm of photoArms) {
      const plan = { planned: paRuns.reduce((s, r) => s + plannedOf(r, arm), 0), worstBuildUsd: o.book.astraPhotoBuildWorstUsd };
      const bs = capIf([barAValidity(arm, paBuilds, plan), barACost(arm, paBuilds, photoCredits, o.book.costBasisUsdPerCredit, plan)], paRuns).map(photoArm);
      if (arm === photoShipped) aP.push(...bs);
      else {
        const rep = bs.map((b) => asReported(b, photoNotShipped));
        reported.push(...rep);
        photoOtherArms.push(`${arm} A ${measured(rep)}`);
      }
    }
    bars.push(...aP);
    if (aP.length) photoRelease.A = verdictOf(aP);
    else photoNotes.push(`A photos: no ${photoShipped} builds in hand (SET_PHOTO_BUILD_EFFORT = ${SET_PHOTO_BUILD_EFFORT} is the arm that decides)`);
  } else if (photoRuns.length) photoNotes.push("A photos: no real A photo run in hand");
  if (photoRuns.some((r) => r.part === "b")) {
    const items = scoresOf("b-photo");
    const all = capIf(barB(items, costPerDeliveredOf(paBuilds, photoArms), photoArms.length ? photoArms : [photoShipped]), paRuns).map(photoArm);
    const mine = all.filter((b) => b.id.endsWith(`-${photoShipped}`));
    const other = all.filter((b) => !b.id.endsWith(`-${photoShipped}`)).map((b) => asReported(b, photoNotShipped));
    bars.push(...mine);
    reported.push(...other);
    photoRelease.B = verdictOf(mine.filter((b) => b.id.startsWith("B-photo-median")));
    for (const arm of photoArms.filter((a) => a !== photoShipped)) photoOtherArms.push(`${arm} B ${measured(other.filter((b) => b.id === `B-photo-median-${arm}`))}`);
    const ag = agreementBar("B-photo-agreement", "B photos: inter-rater agreement (no bar)", items);
    if (ag) reported.push(ag);
  }
  // D's photo leg: section 4's bar for the photos with people is the persons
  // bar, over every photo run's persons sheet (the A photos' included). It
  // passes only when D's photos were measured (capPhotoPersons): none left
  // undetermined, and at least one Astra answer from them on a sheet.
  const pdRuns = photoRuns.filter((r) => r.part === "d");
  if (pdRuns.length) {
    const from = photoRuns.filter((r) => r.part === "d" || r.keys.some((k) => k.kind === "d-persons"));
    const rows = pdRuns.flatMap((r) => r.rows.filter((x) => x.type === "d-photo-outcome") as unknown as DPhotoOutcome[]).map(dPhotoRow);
    const persons = capPhotoPersons(capIf([photoArm(barPersons(personsOf(photoRuns)))], from)[0], { rows, dItems: personsOf(pdRuns).length });
    priorHitsBar ??= barD([], [], construction()).find((b) => b.id === "D-prior-hits") ?? null;
    bars.push(persons);
    if (priorHitsBar && !bars.includes(priorHitsBar)) bars.push(priorHitsBar);
    photoRelease.D = verdictOf([persons, ...(priorHitsBar ? [priorHitsBar] : [])]);
    if (persons.verdict === "FAIL") photoNotes.push("an Astra output from a photo named, identified or described a person: section 3.2 says photos containing people are then refused at input");
    reported.push(reportDPhotos(rows));
  } else if (photoRuns.length) photoNotes.push("D photos: no real D photo run in hand (the photos with people)");

  // E: Match this shot. Each read's ratings are the two raters' scores of
  // its stage view; barE counts every read (a miss inside, a missing or
  // unrated read bounded), and an unfinished E run never passes.
  const eRuns = real.filter((r) => r.part === "e");
  let eRelease: { fov: "✓" | "✗" | "?"; rating: "✓" | "✗" | "?"; route: string } | null = null;
  const eNotes: string[] = [];
  if (eRuns.length) {
    const scores = new Map<string, number[]>();
    for (const c of ofKind("e-match")) scores.set(`${String(c.source.runId)}:${String(c.source.readId)}`, c.ratings.map((x) => x.score).filter((x): x is number => typeof x === "number"));
    const items = eRuns.flatMap((r) =>
      eItems(
        r.rows.filter((x) => x.type === "e-read") as unknown as EReadRow[],
        (readId) => scores.get(`${String(r.manifest.runId)}:${readId}`) ?? [],
      ),
    );
    // The builder Match runs on holds the bars (barE): its two count, the
    // other builder's are reported; with the route open, a bar counts only
    // where both builders agree.
    const eBars = capIf(barE(items), eRuns);
    const counts = (b: BarResult) => b.id === "E-route" || b.verdict !== "REPORTED";
    bars.push(...eBars.filter(counts));
    reported.push(...eBars.filter((b) => !counts(b)));
    const decided = (ids: readonly string[]) => verdictOf(eBars.filter((b) => ids.includes(b.id)));
    eRelease = { fov: decided(["E-fov", "E-fov-mini"]), rating: decided(["E-rating", "E-rating-mini"]), route: eBars.find((b) => b.id === "E-route")?.value ?? "route: ?" };
    const photos = eRuns.flatMap((r) => r.rows.filter((x) => x.type === "e-photo") as unknown as EPhotoRow[]);
    const refused = photos.filter((p) => p.pictureCheck.startsWith("refused:"));
    if (refused.length) eNotes.push(`E: the picture check refused ${refused.length} photo(s), never sent and outside the bars: ${refused.map((p) => p.photoId).join(", ")}`);
    for (const p of photos.filter((x) => x.truth.disagreements.length)) warnings.push(`E ${p.photoId}: the EXIF disagrees: ${p.truth.disagreements.join("; ")}`);
  }

  // Canary: the latest real canary run's own verdict.
  const canaries = real.filter((r) => r.part === "canary");
  const canaryLines: string[] = [];
  let canaryAlerted = false;
  for (const c of canaries) {
    const s = join(c.dir, "summary.json");
    if (!c.complete || !existsSync(s)) {
      canaryLines.push(`  ${runName(c)}: did not finish; not read`);
      continue;
    }
    const j = JSON.parse(readFileSync(s, "utf8")) as { alert?: { alert?: boolean; lines?: string[]; reasons?: string[] } };
    canaryLines.push(`  ${runName(c)}: ${j.alert?.alert ? `ALERT (${(j.alert.reasons ?? []).join("; ")})` : "no alert"}`);
    for (const l of j.alert?.lines ?? []) canaryLines.push(`    ${l}`);
    canaryAlerted ||= Boolean(j.alert?.alert);
  }

  const lines: string[] = [];
  lines.push(`Astra Sets eval report — ${new Date().toISOString()}`);
  lines.push(`runs: ${runs.map((r) => `${runName(r)}${r.simulated ? " (SIMULATED: set aside)" : !r.complete && finishes(r) ? " (INCOMPLETE)" : ""}`).join(", ")}`);
  if (real.length === 0) lines.push("*** DRY RUN ONLY: every run here is simulated; no bar below is a result ***");
  lines.push("--- bars ---");
  for (const b of bars) lines.push(`  ${barLine(b)}`);
  for (const b of reported) lines.push(`  ${barLine(b)}`);
  if (cNote) lines.push(`  ${cNote}`);
  if (!dOutcomes.length) lines.push("  D: no real D run in hand");
  if (!aBuilds.length) lines.push("  A: no real A run in hand");
  else if (!astraArms.includes(shipped)) lines.push(`  A: no ${shipped} builds in hand (SET_BUILD_EFFORT = ${SET_BUILD_EFFORT} is the arm that ships)`);
  lines.push(`  A cost bar priced at ${credits} credits${o.flags.credits ? " (--credits)" : ` (ceil(${usd(o.book.astraFirstWorstUsd, 3)} / ${usd(o.book.costBasisUsdPerCredit, 2)}))`}; the worst case with the closing retry, ${usd(o.book.astraBuildWorstUsd, 3)}, would be ${defaultCredits(o.book.astraBuildWorstUsd, o.book.costBasisUsdPerCredit)} credits: the operator's call`);
  if (photoRuns.length) {
    for (const n of photoNotes) lines.push(`  ${n}`);
    lines.push(
      `  A photo cost bar priced at ${photoCredits} credits${o.flags.photoCredits ? " (--photo-credits)" : ` (ceil(${usd(o.book.astraPhotoFirstWorstUsd, 3)} / ${usd(o.book.costBasisUsdPerCredit, 2)}))`}; the worst case with the closing retry, ${usd(o.book.astraPhotoBuildWorstUsd, 3)}, would be ${defaultCredits(o.book.astraPhotoBuildWorstUsd, o.book.costBasisUsdPerCredit)} credits: the operator's call`,
    );
  } else lines.push("  photo arm: no real photo run in hand");
  if (eRuns.length) for (const n of eNotes) lines.push(`  ${n}`);
  else lines.push("  E: no real E run in hand");
  lines.push("  statistics: median averages the two middle values; p95 is nearest rank, sorted[ceil(0.95 n) − 1]");
  if (canaryLines.length) lines.push("--- canary ---", ...canaryLines);
  if (warnings.length) lines.push("--- warnings ---", ...warnings.map((w) => `  ${w}`));
  if (problems.length) lines.push("--- ratings: PROBLEMS (these sheets' ratings were not used) ---", ...problems.map((p) => `  ${p}`));
  lines.push(...spendPicture(runs));
  lines.push(
    `SETS_OPEN_TO_PLANS needs A–D PASS at SET_BUILD_EFFORT = ${SET_BUILD_EFFORT}: A ${release.A} B ${release.B} C ${release.C} D ${release.D}${otherArms.length ? `   [reported only, not shipped: ${otherArms.join("; ")}]` : ""}`,
  );
  if (photoRuns.length) {
    lines.push(
      `Photo arm (Sets from a photo, astra_photo_sets; SETS_OPEN_TO_PLANS never opens it) at SET_PHOTO_BUILD_EFFORT = ${SET_PHOTO_BUILD_EFFORT}: A ${photoRelease.A} B ${photoRelease.B} D ${photoRelease.D}${photoOtherArms.length ? `   [reported only, not shipped: ${photoOtherArms.join("; ")}]` : ""}`,
    );
  }
  if (eRelease) {
    const whose = eRelease.route === "route: mini" ? " (gpt-5.4-mini's bars: Match runs on it)" : eRelease.route === "route: ?" ? " (a bar settles only where both builders agree)" : "";
    lines.push(`Match this shot (astra_photo_sets; SETS_OPEN_TO_PLANS never opens it) at SET_MATCH_EFFORT = ${SET_MATCH_EFFORT}: E FOV ${eRelease.fov} rating ${eRelease.rating}; ${eRelease.route}${whose}`);
  }

  const dir = join(o.outRoot, newRunId("report", real.length === 0));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.txt"), lines.join("\n") + "\n");
  writeFileSync(
    join(dir, "summary.json"),
    JSON.stringify(
      {
        runs: runs.map((r) => ({ dir: r.dir, part: r.part, photos: r.photos, simulated: r.simulated, complete: r.complete })),
        shippedArm: shipped,
        shippedPhotoArm: photoShipped,
        bars,
        reported,
        release,
        photoRelease: photoRuns.length ? photoRelease : null,
        matchRelease: eRelease,
        problems,
        warnings,
        credits,
        photoCredits,
      },
      null,
      2,
    ),
  );
  for (const l of lines) o.out(l);
  o.out(`summary: ${join(dir, "summary.txt")}`);

  if (real.length === 0) return 0;
  if (problems.length) return 2;
  if (bars.some((b) => b.verdict === "FAIL") || canaryAlerted) return 1;
  if (bars.some((b) => b.verdict === "UNDETERMINED") || incomplete.length) return 2;
  return 0;
}
