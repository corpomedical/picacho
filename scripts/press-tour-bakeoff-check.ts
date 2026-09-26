// Press Tour bake-off, the CHECK step (lines C1–C4 of the bake-off list):
// the product's own checker (src/lib/product-lock) run over one product's
// stills and clips, exactly as a campaign will run it. Started by
// scripts/press-tour-bakeoff.mjs once that product's renders are in; not
// meant to be run by hand, and it refuses to spend without the same rails:
//
//   npx tsx scripts/press-tour-bakeoff-check.ts --run <runDir> --product <slug> --max-usd <n> --go [--write-db]
//
// Keys: GEMINI_API_KEY, GOOGLE_VISION_API_KEY, ANTHROPIC_API_KEY (second
// readings), OPENAI_API_KEY (the face scorer). A missing key is not an
// error: that reader answers "not configured" and the frames read "Not
// checked" (and cost nothing).
//
// What it writes, always: <runDir>/<slug>/checks.json — every verdict and
// what the checks cost (the parent script adds it to its ledger).
// With --write-db (and SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
// BAKEOFF_USER_ID, the operator's own admin account id): every frame read
// also becomes a product_frame_checks row with source "bakeoff", its
// picture kept in press-kit under that account, so Admin → Product checks
// can label it. Nothing else is ever written.
//
// Money: each check is started only while what has been spent plus that
// check's ceiling stays within --max-usd (the parent passes what is left of
// CAP_USD for this product's checks).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { scoreIdentityMatch } from "../src/lib/generations/providers/openai";
import { productScorerVersion } from "../src/lib/generations/scorer-version";
import { readLabelText } from "../src/lib/press-tour/ocr";
import { FACE_USD, WORDS_USD, checkMoments, checkStill, type CheckCard, type CheckDeps, type CheckResult } from "../src/lib/product-lock/check";
import { jpegDataUrl } from "../src/lib/product-lock/crop";
import { ESCALATION_CEILING_USD, ESCALATION_MODEL, escalateFrame, type MessagesClient } from "../src/lib/product-lock/escalate";
import { sampleMoments } from "../src/lib/product-lock/frames";
import { JUDGE_CALL_CEILING_USD, judgeModel, judgeProduct, locateProduct } from "../src/lib/product-lock/judge";
import { MAX_ESCALATIONS_PER_AD, type ProductVisibility } from "../src/lib/product-lock/product-lock";
import { writeFrameChecks, type RecordContext } from "../src/lib/product-lock/records";

type Manifest = {
  slug: string;
  product: { name: string; labelStrings: string[]; noReadableText: boolean; palette?: string[]; photos: string[] };
  character: { identity: string; traitSummary: string };
  faceThreshold: number;
  stills: { id: string; path: string; visibility: ProductVisibility; face: boolean }[];
  clips: { id: string; lane: string; path: string; seconds: number; visibility: ProductVisibility; face: boolean }[];
};

/** A check's ceiling: every frame at the readers' worst (two judge calls, two word reads, a face) plus the second readings left. */
function ceiling(frames: number, face: boolean, escalationsLeft: number): number {
  return frames * (2 * JUDGE_CALL_CEILING_USD + 2 * WORDS_USD + (face ? FACE_USD : 0)) + escalationsLeft * ESCALATION_CEILING_USD;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

async function main(): Promise<number> {
  const runDir = arg("--run");
  const slug = arg("--product");
  const maxUsd = Number(arg("--max-usd"));
  if (!process.argv.includes("--go") || !runDir || !slug || !Number.isFinite(maxUsd) || maxUsd <= 0) {
    console.error("usage: npx tsx scripts/press-tour-bakeoff-check.ts --run <runDir> --product <slug> --max-usd <n> --go [--write-db]");
    return 2;
  }
  const dir = path.join(runDir, slug);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Manifest;

  const writeDb = process.argv.includes("--write-db");
  const userId = process.env.BAKEOFF_USER_ID ?? "";
  const db =
    writeDb && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      : null;
  if (writeDb && (!db || !/^[0-9a-f-]{36}$/i.test(userId))) {
    console.error("--write-db needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and BAKEOFF_USER_ID (your admin account's id).");
    return 2;
  }

  const anthropic = process.env.ANTHROPIC_API_KEY ? (new Anthropic() as unknown as MessagesClient) : null;
  const deps: CheckDeps = {
    locate: (input) => locateProduct(input),
    judge: (input) => judgeProduct(input),
    escalate: (input) => escalateFrame(input, { client: anthropic }),
    readWords: async (image) => {
      const read = await readLabelText([image]);
      return read.configured && read.ok ? { lines: read.lines[0] ?? [] } : null;
    },
    scoreFace: async (frame, identity, traitSummary) => {
      const v = await scoreIdentityMatch(jpegDataUrl(frame), jpegDataUrl(identity), traitSummary);
      return v ? { score: v.score, unusable: v.unusable, faceVisible: v.faceVisible } : null;
    },
    sampleMoments: (video, times) => sampleMoments(video, times),
    record: db ? (ctx, drafts) => writeFrameChecks(db, ctx, drafts) : undefined,
    scorerVersion: productScorerVersion(judgeModel(), ESCALATION_MODEL),
  };

  const references = await Promise.all(manifest.product.photos.map((p) => readFile(path.join(dir, p))));
  const identity = await readFile(path.join(dir, manifest.character.identity));
  let card: CheckCard = {
    productId: null,
    name: manifest.product.name,
    labelStrings: manifest.product.labelStrings,
    noReadableText: manifest.product.noReadableText,
    dna: null,
    palette: manifest.product.palette ?? [],
    references,
    referenceText: null,
  };
  const face = { identity, traitSummary: manifest.character.traitSummary, threshold: manifest.faceThreshold };

  let spent = 0;
  let escalationsLeft = MAX_ESCALATIONS_PER_AD;
  const results: { id: string; lane: string | null; result: CheckResult | null; skipped?: string }[] = [];
  const record = (lane: string | null): RecordContext | undefined =>
    db ? { userId, source: "bakeoff", lane, keepFrames: true } : undefined;

  for (const still of manifest.stills) {
    const need = ceiling(1, still.face, escalationsLeft) + (card.referenceText ? 0 : references.length * WORDS_USD);
    if (spent + need > maxUsd) {
      results.push({ id: still.id, lane: null, result: null, skipped: `over --max-usd (${spent.toFixed(4)} + ${need.toFixed(4)})` });
      continue;
    }
    const r = await checkStill(
      { image: await readFile(path.join(dir, still.path)), visibility: still.visibility, card, face: still.face ? face : null, escalationsLeft, record: record(still.id) },
      deps,
    );
    spent += r.signals.usd;
    escalationsLeft -= r.signals.escalationsUsed;
    if (r.signals.referenceText) card = { ...card, referenceText: r.signals.referenceText };
    results.push({ id: still.id, lane: still.id, result: r });
    console.log(`[check] ${still.id}: product ${r.product}${r.face ? `, face ${r.face}` : ""} ($${r.signals.usd.toFixed(4)})`);
  }
  for (const clip of manifest.clips) {
    const need = ceiling(3, clip.face, escalationsLeft) + (card.referenceText ? 0 : references.length * WORDS_USD);
    if (spent + need > maxUsd) {
      results.push({ id: clip.id, lane: clip.lane, result: null, skipped: `over --max-usd (${spent.toFixed(4)} + ${need.toFixed(4)})` });
      continue;
    }
    const r = await checkMoments(
      {
        video: await readFile(path.join(dir, clip.path)),
        seconds: clip.seconds,
        visibility: clip.visibility,
        card,
        face: clip.face ? face : null,
        escalationsLeft,
        record: record(clip.lane),
      },
      deps,
    );
    spent += r.signals.usd;
    escalationsLeft -= r.signals.escalationsUsed;
    if (r.signals.referenceText) card = { ...card, referenceText: r.signals.referenceText };
    results.push({ id: clip.id, lane: clip.lane, result: r });
    console.log(`[check] ${clip.id} (${clip.lane}): product ${r.product}${r.face ? `, face ${r.face}` : ""} at ${r.signals.moments.length} moments ($${r.signals.usd.toFixed(4)})`);
  }

  await writeFile(path.join(dir, "checks.json"), JSON.stringify({ slug, usd: Math.round(spent * 1e6) / 1e6, results }, null, 2));
  console.log(`[check] ${slug}: $${spent.toFixed(4)} on checks${db ? ", rows written to product_frame_checks" : ""}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[check] stopped: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
