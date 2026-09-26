#!/usr/bin/env node
// PRESS TOUR BAKE-OFF (synthesis v2 §3.5, Cut 3): which lane keeps a real
// product and a real face, at what price, and hand-labelled frames to
// calibrate the product checker.
//
// ESTIMATE FIRST. With no flags it prints every line item, its arithmetic and
// its dollars from the PRICE constants below, per product and in total, and
// exits. It touches no network in that mode (fetch is replaced by a thrower
// before anything else runs).
//
//   node scripts/press-tour-bakeoff.mjs                        the estimate, for 3 products
//   node scripts/press-tour-bakeoff.mjs --count 1              …for 1 product
//   node scripts/press-tour-bakeoff.mjs --products <dir>       …for the products in <dir>, checked for what each needs
//
// SPENDING needs all of these, or it refuses and spends nothing:
//   --go
//   CAP_USD=<dollars> in the environment: the most this run may spend, all
//     providers together. Each product is a batch; a batch starts only if
//     what has been spent plus that batch's CEILING fits under CAP_USD.
//   --products <dir>: one folder per product (see PRODUCT FOLDER below).
//   FAL_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GOOGLE_VISION_API_KEY,
//     ANTHROPIC_API_KEY, and FAL_ADMIN_KEY for the balance check.
//   Lines whose request shape is not pinned by the product's own code (V1's
//     second element and start frame, V2, V4) run only when named in
//     --allow-unverified V1,V2,V4 after you have read their fal pages; or
//     leave them out with --skip V1,V2,V4 (their dollars leave the plan).
//
//   CAP_USD=13.60 node scripts/press-tour-bakeoff.mjs --products ~/bakeoff --go --skip V2,V4
//
// BALANCE CHECK, before every product: fal's balance (FAL_ADMIN_KEY) must
// cover that batch's fal ceiling plus $1; OpenAI, Google and Anthropic have
// no balance endpoint, so the run stops at the first answer that says the
// account is out of credit (402, or 429 insufficient_quota) and never
// retries it. A stop keeps everything already made.
//
// STOP-LOSS (S3): a GPT Image 2:3 still priced from its usage above $0.15
// stops the whole run.
//
// THE CHECKS (C1–C4) run through the product's own checker
// (src/lib/product-lock) in a child process:
//   npx tsx scripts/press-tour-bakeoff-check.ts --run <out> --product <slug> --max-usd <left> --go
// Add --write-db here to pass it on (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// BAKEOFF_USER_ID = your admin account id): every frame read then lands in
// product_frame_checks with its picture, ready to label in Admin → Product
// checks. Without it the verdicts stay in <out>/<slug>/checks.json.
//
// PRODUCT FOLDER (<dir>/<slug>/):
//   product.json    { "name": "...", "labelStrings": ["..."], "noReadableText": false,
//                     "stillPrompt": "...", "endStillPrompt": "...", "motionPrompt": "..." }
//   front.jpg       the product's front, label readable (+ any photo-*.jpg: more angles)
//   character.jpg   the character's identity photo — a person who agreed to it, or an AI persona
//   character.json  { "traitSummary": "..." }   (optional)
// Everything made lands in <out>/<slug>/ (default out/press-tour-bakeoff/<timestamp>/),
// with ledger.jsonl beside the products: every call, its line, its dollars.
//
// Pictures reach fal through fal's own storage (@fal-ai/client, already a
// dependency); nothing here writes to Picacho's database except the check
// step with --write-db.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// PRICES — every figure with where it was read. The estimate is these
// constants times the counts below; nothing else.
// ---------------------------------------------------------------------------
export const PRICE = {
  /** Nano Banana Pro edit, flat per image (fal; constraints §3; image-models.ts:57). */
  nanoBananaStill: 0.15,
  /** GPT Image high, measured $0.0531–$0.0909 at 1024² (build map §2); the 2:3 price is what this run measures. */
  gptImageHigh: 0.0909,
  /** S3's stop-loss per still (synthesis §3.5). */
  gptImageStopLoss: 0.15,
  /** Kling O3 Pro reference-to-video, per second (constraints §3). */
  klingO3ProPerS: 0.112,
  /** Kling 3.0 Pro image-to-video, per second; ×2 if the elements surcharge applies (constraints §3). */
  kling30ProPerS: 0.112,
  kling30ProSurchargeFactor: 2,
  /** MiniMax H3 at 768p, per second (constraints §3; video-models.ts). */
  h3PerS: 0.06,
  /** Wan 3.0 at 720p, per second (constraints §3). */
  wan30PerS: 0.1,
  /** kling-o3 (O3 standard image-to-video), per second: code's rate, audio on; audio off may bill less (synthesis #18). */
  klingO3PerS: 0.112,
  /** wan-turbo 720p, flat per clip (fal; video-models.ts). */
  wanTurboFlat: 0.1,
  /** Gemini Omni Flash 720p, per second (video-models.ts). */
  omniPerS: 0.1,
  /** One product check per frame, as the constraints brief priced it (SAM 3 + OCR + judge). */
  productCheckPerFrame: 0.0075,
  /** One face check, ceiling (build map §3.3: gpt-5.4-mini ≤ $0.011). */
  faceCheck: 0.011,
  /** One second reading (Sonnet 5, constraints §3: ≈ $0.011). */
  secondReading: 0.011,
  /** One word reading (Cloud Vision, $1.50 per 1,000). */
  wordReading: 0.0015,
};
export const CLIP_SECONDS = 5;
export const MOMENTS_PER_CLIP = 3;
/** Second readings per product, at most (the checker's per-ad allowance). */
export const SECOND_READINGS = 2;
/** Reference photos whose words are read once per product, at most (ocr.ts OCR_MAX_IMAGES). */
export const REFERENCE_PHOTOS = 5;

const r4 = (n) => Math.round(n * 10000) / 10000;

/**
 * The lines, per product (synthesis §3.5). `usd` is the typical figure,
 * `ceiling` the most it can cost; `provider` says whose balance pays;
 * `verified` says whether the product's own code pins its request shape.
 */
export function planLines(skip = []) {
  const clip = (perS) => CLIP_SECONDS * perS;
  const on = (id) => !skip.includes(id);
  // What the checks read follows what is made: every clip at 3 moments,
  // every still once; faces on every clip but V2 (the packshot has no one in it).
  const stills = ["S1", "S2", "S3"].filter(on).length;
  const clips = ["V1", "V2", "V3", "V4", "V5", "V6", "V7"].filter(on).length;
  const characterClips = ["V1", "V3", "V4", "V5", "V6", "V7"].filter(on).length;
  const checkFrames = clips * MOMENTS_PER_CLIP + stills;
  const faceFrames = characterClips * MOMENTS_PER_CLIP + stills;
  const lines = [
    { id: "S1", what: "Nano Banana Pro start still", arithmetic: `1 × ${PRICE.nanoBananaStill}`, usd: PRICE.nanoBananaStill, ceiling: PRICE.nanoBananaStill, provider: "fal", verified: true },
    { id: "S2", what: "Nano Banana Pro end still (for Omni)", arithmetic: `1 × ${PRICE.nanoBananaStill}`, usd: PRICE.nanoBananaStill, ceiling: PRICE.nanoBananaStill, provider: "fal", verified: true },
    { id: "S3", what: "GPT Image high 2:3 → local 9:16 crop (stop-loss $0.15)", arithmetic: `1 × ${PRICE.gptImageHigh} (cap ${PRICE.gptImageStopLoss})`, usd: PRICE.gptImageHigh, ceiling: PRICE.gptImageStopLoss, provider: "openai", verified: true },
    { id: "V1", what: "Kling O3 Pro reference (character + product as elements, from S1)", arithmetic: `${CLIP_SECONDS} × ${PRICE.klingO3ProPerS}`, usd: clip(PRICE.klingO3ProPerS), ceiling: clip(PRICE.klingO3ProPerS), provider: "fal", verified: false },
    { id: "V2", what: "Kling 3.0 Pro image-to-video (packshot, the real front photo)", arithmetic: `${CLIP_SECONDS} × ${PRICE.kling30ProPerS} (× ${PRICE.kling30ProSurchargeFactor} if the elements surcharge applies)`, usd: clip(PRICE.kling30ProPerS), ceiling: clip(PRICE.kling30ProPerS) * PRICE.kling30ProSurchargeFactor, provider: "fal", verified: false },
    { id: "V3", what: "MiniMax H3 768p (character + product as references)", arithmetic: `${CLIP_SECONDS} × ${PRICE.h3PerS}`, usd: clip(PRICE.h3PerS), ceiling: clip(PRICE.h3PerS), provider: "fal", verified: true },
    { id: "V4", what: "Wan 3.0 720p (from S1)", arithmetic: `${CLIP_SECONDS} × ${PRICE.wan30PerS}`, usd: clip(PRICE.wan30PerS), ceiling: clip(PRICE.wan30PerS), provider: "fal", verified: false },
    { id: "V5", what: "kling-o3 from S3, audio off (the shipped default)", arithmetic: `${CLIP_SECONDS} × ${PRICE.klingO3PerS}`, usd: clip(PRICE.klingO3PerS), ceiling: clip(PRICE.klingO3PerS), provider: "fal", verified: true },
    { id: "V6", what: "wan-turbo from S3 (the trial lane)", arithmetic: `1 × ${PRICE.wanTurboFlat}`, usd: PRICE.wanTurboFlat, ceiling: PRICE.wanTurboFlat, provider: "fal", verified: true },
    { id: "V7", what: "Gemini Omni 720p, S1 → S2", arithmetic: `${CLIP_SECONDS} × ${PRICE.omniPerS}`, usd: clip(PRICE.omniPerS), ceiling: clip(PRICE.omniPerS), provider: "fal", verified: true },
    { id: "C1", what: `Product checks: ${clips} clips × ${MOMENTS_PER_CLIP} moments + ${stills} stills`, arithmetic: `${checkFrames} × ${PRICE.productCheckPerFrame}`, usd: checkFrames * PRICE.productCheckPerFrame, ceiling: checkFrames * PRICE.productCheckPerFrame, provider: "checks", verified: true },
    { id: "C2", what: `Face checks: ${characterClips} character clips × ${MOMENTS_PER_CLIP} + ${stills} stills`, arithmetic: `${faceFrames} × ≤ ${PRICE.faceCheck}`, usd: faceFrames * PRICE.faceCheck, ceiling: faceFrames * PRICE.faceCheck, provider: "checks", verified: true },
    { id: "C3", what: "Second readings (not in the synthesis list: the checker's build)", arithmetic: `≤ ${SECOND_READINGS} × ${PRICE.secondReading}`, usd: SECOND_READINGS * PRICE.secondReading, ceiling: SECOND_READINGS * PRICE.secondReading, provider: "checks", verified: true },
    { id: "C4", what: "Words on the reference photos, once (not in the synthesis list)", arithmetic: `≤ ${REFERENCE_PHOTOS} × ${PRICE.wordReading}`, usd: REFERENCE_PHOTOS * PRICE.wordReading, ceiling: REFERENCE_PHOTOS * PRICE.wordReading, provider: "checks", verified: true },
  ];
  return lines.filter((l) => on(l.id)).map((l) => ({ ...l, usd: r4(l.usd), ceiling: r4(l.ceiling) }));
}

export function sums(lines) {
  const usd = r4(lines.reduce((s, l) => s + l.usd, 0));
  const ceiling = r4(lines.reduce((s, l) => s + l.ceiling, 0));
  const falCeiling = r4(lines.filter((l) => l.provider === "fal").reduce((s, l) => s + l.ceiling, 0));
  return { usd, ceiling, falCeiling };
}

function printEstimate(lines, products, skipped) {
  const pad = (s, n) => String(s).padEnd(n);
  const money = (n) => `$${n.toFixed(4)}`;
  console.log(`PRESS TOUR BAKE-OFF — estimate for ${products.length} product${products.length === 1 ? "" : "s"}: ${products.join(", ")}`);
  console.log("Per product (every clip is 5 s):\n");
  console.log(`${pad("Line", 5)} ${pad("What", 80)} ${pad("Arithmetic", 44)} ${pad("Typical", 9)} Ceiling`);
  for (const l of lines) {
    console.log(`${pad(l.id, 5)} ${pad(l.what + (l.verified ? "" : " [unverified]"), 80)} ${pad(l.arithmetic, 44)} ${pad(money(l.usd), 9)} ${money(l.ceiling)}`);
  }
  if (skipped.length) console.log(`\nSkipped (--skip): ${skipped.join(", ")} — not in the sums below.`);
  const per = sums(lines);
  const synth = sums(lines.filter((l) => l.id !== "C3" && l.id !== "C4"));
  const n = products.length;
  console.log(`\nPer product:   typical ${money(per.usd)}, ceiling ${money(per.ceiling)} (fal's share of the ceiling ${money(per.falCeiling)})`);
  console.log(`All ${n}:         typical ${money(r4(per.usd * n))}, ceiling ${money(r4(per.ceiling * n))}`);
  console.log(`  (the synthesis §3.5 lines alone: ${money(r4(synth.usd * n))}, ceiling ${money(r4(synth.ceiling * n))}; C3 + C4 add ${money(r4((per.usd - synth.usd) * n))})`);
  console.log(`\nTo spend: CAP_USD=<dollars> node scripts/press-tour-bakeoff.mjs --products <dir> --go [--skip ...] [--allow-unverified ...]`);
  console.log(`A batch (one product) starts only while spent + ${money(per.ceiling)} ≤ CAP_USD.`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { go: false, products: null, count: 3, skip: [], allow: [], out: null, writeDb: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--go") out.go = true;
    else if (a === "--products") out.products = next();
    else if (a === "--count") out.count = Math.max(1, Math.min(10, Number(next()) || 3));
    else if (a === "--skip") out.skip = String(next() ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === "--allow-unverified") out.allow = String(next() ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === "--out") out.out = next();
    else if (a === "--write-db") out.writeDb = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

async function productSlugs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const slugs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const base = path.join(dir, e.name);
    const missing = ["product.json", "front.jpg", "character.jpg"].filter((f) => !existsSync(path.join(base, f)));
    if (missing.length) throw new Error(`${e.name}: missing ${missing.join(", ")}`);
    slugs.push(e.name);
  }
  if (slugs.length === 0) throw new Error(`no product folders in ${dir}`);
  return slugs.sort();
}

// ---------------------------------------------------------------------------
// Spending (only past every rail in main)
// ---------------------------------------------------------------------------
/** The stills each clip starts from. */
const NEEDS = { V1: ["S1"], V4: ["S1"], V5: ["S3"], V6: ["S3"], V7: ["S1", "S2"] };
const CHECK_SCRIPT = fileURLToPath(new URL("./press-tour-bakeoff-check.ts", import.meta.url));

const REQUIRED_KEYS = ["FAL_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_VISION_API_KEY", "ANTHROPIC_API_KEY", "FAL_ADMIN_KEY"];
const OPENAI_IMAGE_MODEL = "gpt-image-2.5-sunburst-2026-09-08"; // providers/openai-images.ts
const OPENAI_IMAGE_USD_PER_M = { textInput: 5, imageInput: 8, imageOutput: 30 }; // providers/openai-images.ts, read 2026-09-14

class OutOfCredit extends Error {}

async function falBalance() {
  const res = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", { headers: { authorization: `Key ${process.env.FAL_ADMIN_KEY}` } });
  if (!res.ok) throw new Error(`fal balance unreadable (${res.status}) — FAL_ADMIN_KEY must be admin scope`);
  const body = await res.json();
  const n = body?.credits?.current_balance;
  if (typeof n !== "number") throw new Error("fal balance missing from its answer");
  return n;
}

function outOfCredit(status, text) {
  return status === 402 || (status === 429 && /insufficient_quota|exhausted balance|billing/i.test(text)) || (status === 403 && /exhausted balance/i.test(text));
}

async function falUpload(bytes, type) {
  const { fal } = await import("@fal-ai/client");
  fal.config({ credentials: process.env.FAL_KEY });
  return fal.storage.upload(new Blob([bytes], { type }));
}

async function falRun(endpoint, body) {
  const res = await fetch(`https://fal.run/${endpoint}`, {
    method: "POST",
    headers: { authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (outOfCredit(res.status, text)) throw new OutOfCredit(`fal is out of credit (${res.status})`);
  if (!res.ok) throw new Error(`${endpoint} answered ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function falQueue(endpoint, body, { timeoutMs = 20 * 60_000 } = {}) {
  const auth = { authorization: `Key ${process.env.FAL_KEY}` };
  const res = await fetch(`https://queue.fal.run/${endpoint}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (outOfCredit(res.status, text)) throw new OutOfCredit(`fal is out of credit (${res.status})`);
  if (!res.ok) throw new Error(`${endpoint} answered ${res.status}: ${text.slice(0, 300)}`);
  const job = JSON.parse(text);
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await fetch(job.status_url, { headers: auth });
    if (s.ok) {
      const st = await s.json();
      if (st.status === "COMPLETED") break;
      if (st.error) throw new Error(`${endpoint} failed: ${String(st.error).slice(0, 300)}`);
    }
    if (Date.now() - started > timeoutMs) throw new Error(`${endpoint} still running after ${timeoutMs / 60000} min (it may still bill; request ${job.request_id})`);
  }
  const out = await fetch(job.response_url, { headers: auth });
  if (!out.ok) throw new Error(`${endpoint} result unreadable (${out.status})`);
  return out.json();
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

/** GPT Image high at 1024×1536 through the edits endpoint (providers/openai-images.ts), priced from its usage. */
async function gptImage23(prompt, pictures) {
  const form = new FormData();
  form.set("model", OPENAI_IMAGE_MODEL);
  form.set("quality", "high");
  form.set("prompt", prompt);
  form.set("size", "1024x1536");
  pictures.forEach((p, i) => form.append("image[]", new Blob([p], { type: "image/jpeg" }), `reference-${i}.jpg`));
  const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
  const text = await res.text();
  if (outOfCredit(res.status, text)) throw new OutOfCredit(`OpenAI is out of credit (${res.status})`);
  if (!res.ok) throw new Error(`GPT Image answered ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const u = data.usage ?? {};
  const inD = u.input_tokens_details ?? {};
  const outD = u.output_tokens_details ?? {};
  const usd =
    ((inD.text_tokens ?? 0) * OPENAI_IMAGE_USD_PER_M.textInput + (inD.image_tokens ?? 0) * OPENAI_IMAGE_USD_PER_M.imageInput + ((outD.image_tokens ?? 0) || (u.output_tokens ?? 0)) * OPENAI_IMAGE_USD_PER_M.imageOutput) /
    1_000_000;
  return { png: Buffer.from(data.data[0].b64_json, "base64"), usd: usd || PRICE.gptImageStopLoss };
}

/** The 2:3 still cut to 9:16 locally (864 × 1536, centred), as a campaign will (synthesis #2). */
async function cropTo916(png) {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(png).metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 1536;
  const target = Math.min(w, Math.round((h * 9) / 16));
  return sharp(png).extract({ left: Math.floor((w - target) / 2), top: 0, width: target, height: h }).jpeg({ quality: 92 }).toBuffer();
}

async function runProduct(slug, srcDir, outDir, lines, ledger) {
  const dir = path.join(outDir, slug);
  await mkdir(dir, { recursive: true });
  const meta = JSON.parse(await readFile(path.join(srcDir, slug, "product.json"), "utf8"));
  const traits = existsSync(path.join(srcDir, slug, "character.json")) ? JSON.parse(await readFile(path.join(srcDir, slug, "character.json"), "utf8")) : {};
  const front = await readFile(path.join(srcDir, slug, "front.jpg"));
  const character = await readFile(path.join(srcDir, slug, "character.jpg"));
  const extras = (await readdir(path.join(srcDir, slug))).filter((f) => /^photo-.*\.jpe?g$/i.test(f)).sort();
  const angles = await Promise.all(extras.slice(0, 4).map((f) => readFile(path.join(srcDir, slug, f))));
  await writeFile(path.join(dir, "front.jpg"), front);
  await writeFile(path.join(dir, "character.jpg"), character);
  for (const [i, a] of angles.entries()) await writeFile(path.join(dir, `photo-${i + 1}.jpg`), a);

  const want = new Set(lines.map((l) => l.id));
  const name = meta.name ?? slug;
  const stillPrompt =
    meta.stillPrompt ?? `The person from the character photo holds ${name} toward the camera, product large in frame, label turned to camera, soft daylight, vertical 9:16.`;
  const endPrompt = meta.endStillPrompt ?? `The same person, a moment later, smiling, ${name} still in hand with its label to camera, vertical 9:16.`;
  const motion = meta.motionPrompt ?? `Slow push-in; the person lifts ${name} slightly toward the camera. Slow motion, no fast spins, no hand over the label.`;

  const [charUrl, frontUrl, ...angleUrls] = await Promise.all([character, front, ...angles].map((b) => falUpload(b, "image/jpeg")));
  const book = async (id, usd, extra = {}) => {
    ledger.spent += usd;
    await appendFile(ledger.file, `${JSON.stringify({ at: new Date().toISOString(), product: slug, line: id, usd: r4(usd), ...extra })}\n`);
  };
  const stills = [];
  const clips = [];

  let s1Url = null;
  let s2Url = null;
  let s3Url = null;
  if (want.has("S1")) {
    const out = await falRun("fal-ai/nano-banana-pro/edit", { prompt: stillPrompt, image_urls: [charUrl, frontUrl], num_images: 1, resolution: "2K", aspect_ratio: "9:16", output_format: "png" });
    s1Url = out.images[0].url;
    await download(s1Url, path.join(dir, "S1.png"));
    await book("S1", PRICE.nanoBananaStill);
    stills.push({ id: "S1", path: "S1.png", visibility: "required_label", face: true });
  }
  if (want.has("S2")) {
    const out = await falRun("fal-ai/nano-banana-pro/edit", { prompt: endPrompt, image_urls: [charUrl, frontUrl, ...(s1Url ? [s1Url] : [])], num_images: 1, resolution: "2K", aspect_ratio: "9:16", output_format: "png" });
    s2Url = out.images[0].url;
    await download(s2Url, path.join(dir, "S2.png"));
    await book("S2", PRICE.nanoBananaStill);
    stills.push({ id: "S2", path: "S2.png", visibility: "required_label", face: true });
  }
  if (want.has("S3")) {
    const { png, usd } = await gptImage23(stillPrompt, [character, front]);
    await book("S3", usd, { measured: true });
    if (usd > PRICE.gptImageStopLoss) throw new Error(`STOP-LOSS: the 2:3 still metered $${usd.toFixed(4)} > $${PRICE.gptImageStopLoss}`);
    await writeFile(path.join(dir, "S3-2x3.png"), png);
    const crop = await cropTo916(png);
    await writeFile(path.join(dir, "S3.jpg"), crop);
    s3Url = await falUpload(crop, "image/jpeg");
    stills.push({ id: "S3", path: "S3.jpg", visibility: "required_label", face: true });
  }

  const film = async (id, lane, endpoint, body, usd, face) => {
    if (!want.has(id)) return;
    const out = await falQueue(endpoint, body);
    const url = out?.video?.url;
    if (!url) throw new Error(`${id}: no video in the answer`);
    await download(url, path.join(dir, `${id}.mp4`));
    await book(id, usd, { endpoint });
    clips.push({ id, lane, path: `${id}.mp4`, seconds: CLIP_SECONDS, visibility: face ? "required_label" : "required_shape", face });
  };
  const line = (id) => lines.find((l) => l.id === id);

  // V1: Kling O3 Pro reference — the person and the product as SEPARATE
  // elements (fal.ts:505-563 pins one element; the second and start_image_url
  // are per fal's page, unprobed: --allow-unverified V1).
  await film(
    "V1",
    "kling-o3-pro",
    "fal-ai/kling-video/o3/pro/reference-to-video",
    {
      prompt: `${motion}\n\nThe person is @Element1 — match their face, hair and features exactly. The product is @Element2 — keep its shape, label and logo exactly.`,
      duration: String(CLIP_SECONDS),
      elements: [
        { frontal_image_url: charUrl, reference_image_urls: [charUrl] },
        { frontal_image_url: frontUrl, reference_image_urls: angleUrls.length ? angleUrls.slice(0, 1) : [frontUrl] },
      ],
      ...(s1Url ? { start_image_url: s1Url } : {}),
      aspect_ratio: "9:16",
      generate_audio: false,
    },
    line("V1")?.usd ?? 0,
    true,
  );
  // V2: Kling 3.0 Pro image-to-video on the real front photo (the packshot;
  // endpoint from the constraints brief's source link; unverified).
  await film("V2", "kling-3-pro", "fal-ai/kling-video/v3/pro/image-to-video", { prompt: `Slow push-in on ${name}, label to camera, studio light.`, image_url: frontUrl, duration: String(CLIP_SECONDS), generate_audio: false }, line("V2")?.ceiling ?? 0, false);
  // V3: MiniMax H3 768p, both as references (fal.ts:571-639: plain-word
  // citations, integer duration, resolution pinned).
  await film(
    "V3",
    "minimax-h3",
    "minimax/h3/reference-to-video",
    {
      prompt: `${stillPrompt} ${motion}\n\nImage 1 is the person in this video — match their face, hair and features exactly. Image 2 is the product — keep its shape, label and logo exactly. The shot is already in motion when it begins.`,
      reference_image_urls: [charUrl, frontUrl],
      duration: CLIP_SECONDS,
      resolution: "768P",
      aspect_ratio: "9:16",
    },
    line("V3")?.usd ?? 0,
    true,
  );
  // V4: Wan 3.0 720p from S1. No Wan 3.0 endpoint is pinned anywhere in the
  // product: name it with BAKEOFF_WAN30_ENDPOINT after reading fal's page.
  if (want.has("V4")) {
    const endpoint = process.env.BAKEOFF_WAN30_ENDPOINT;
    if (!endpoint) throw new Error("V4 needs BAKEOFF_WAN30_ENDPOINT (fal's Wan 3.0 image-to-video id, read from its page)");
    await film("V4", "wan-3", endpoint, { prompt: motion, image_url: s1Url, resolution: "720p", aspect_ratio: "9:16" }, line("V4")?.usd ?? 0, true);
  }
  // V5: kling-o3 (O3 standard image-to-video) from the cropped S3, audio off (fal.ts:836-881).
  await film(
    "V5",
    "kling-o3",
    "fal-ai/kling-video/o3/standard/image-to-video",
    { prompt: motion, image_url: s3Url, duration: String(CLIP_SECONDS), generate_audio: false, negative_prompt: "blur, distort, and low quality, static posed portrait, frozen first frame" },
    line("V5")?.usd ?? 0,
    true,
  );
  // V6: wan-turbo image-to-video from S3 (fal.ts:640-681).
  await film("V6", "wan-turbo", "fal-ai/wan/v2.2-a14b/image-to-video/turbo", { prompt: motion, image_url: s3Url, resolution: "720p", aspect_ratio: "9:16" }, line("V6")?.usd ?? 0, true);
  // V7: Gemini Omni 720p, S1 → S2 (fal.ts:736-763, probed live 2026-09-15).
  await film("V7", "gemini-omni", "google/gemini-omni-flash/v1.1/image-to-video", { prompt: motion, image_url: s1Url, end_image_url: s2Url, duration: CLIP_SECONDS, resolution: "720p", aspect_ratio: "9:16" }, line("V7")?.usd ?? 0, true);

  const manifest = {
    slug,
    product: { name, labelStrings: meta.labelStrings ?? [], noReadableText: meta.noReadableText === true, palette: meta.palette ?? [], photos: ["front.jpg", ...angles.map((_, i) => `photo-${i + 1}.jpg`)] },
    character: { identity: "character.jpg", traitSummary: traits.traitSummary ?? "" },
    faceThreshold: Number(process.env.BAKEOFF_FACE_THRESHOLD ?? 70),
    stills: stills.filter((s) => want.has(s.id)),
    clips,
  };
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(await readFile(new URL(import.meta.url), "utf8").then((s) => s.split("\n").filter((l) => l.startsWith("//")).join("\n")));
    return 0;
  }
  const unknownSkip = args.skip.filter((id) => !planLines().some((l) => l.id === id));
  if (unknownSkip.length) throw new Error(`--skip names no line: ${unknownSkip.join(", ")}`);
  const lines = planLines(args.skip);
  const products = args.products ? await productSlugs(args.products) : Array.from({ length: args.count }, (_, i) => `product-${i + 1}`);

  if (!args.go) {
    // Estimate only: nothing may reach the network.
    globalThis.fetch = () => {
      throw new Error("estimate mode: no network");
    };
    printEstimate(lines, products, args.skip);
    return 0;
  }

  // ---- every rail before a single call ------------------------------------
  const cap = Number(process.env.CAP_USD);
  const per = sums(lines);
  const problems = [];
  if (!process.env.CAP_USD || !Number.isFinite(cap) || cap <= 0) problems.push("CAP_USD is not set to a positive number of dollars");
  else if (cap < per.ceiling) problems.push(`CAP_USD $${cap} is below one product's ceiling ($${per.ceiling.toFixed(4)}): not even one batch could start`);
  if (!args.products) problems.push("--products <dir> is required to spend");
  const missingKeys = REQUIRED_KEYS.filter((k) => !process.env[k]);
  if (missingKeys.length) problems.push(`missing keys: ${missingKeys.join(", ")}`);
  const unverified = lines.filter((l) => !l.verified && !args.allow.includes(l.id)).map((l) => l.id);
  const orphans = Object.entries(NEEDS)
    .filter(([id, stills]) => lines.some((l) => l.id === id) && stills.some((st) => args.skip.includes(st)))
    .map(([id, stills]) => `${id} (needs ${stills.join(" + ")})`);
  if (orphans.length) problems.push(`a clip's still is skipped: ${orphans.join(", ")} — skip the clip too`);
  if (unverified.length) problems.push(`${unverified.join(", ")} have no request shape pinned by the product's code: read their fal pages, then --allow-unverified ${unverified.join(",")} (or --skip them)`);
  if (problems.length) {
    printEstimate(lines, products, args.skip);
    console.error(`\nREFUSED — nothing was spent:\n  - ${problems.join("\n  - ")}`);
    return 2;
  }

  const outDir = args.out ?? path.join("out", "press-tour-bakeoff", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outDir, { recursive: true });
  const ledger = { file: path.join(outDir, "ledger.jsonl"), spent: 0 };
  printEstimate(lines, products, args.skip);
  console.log(`\nSPENDING, capped at $${cap}. Output: ${outDir}`);
  const checkLines = lines.filter((l) => l.provider === "checks");
  const checkCeiling = r4(checkLines.reduce((s, l) => s + l.ceiling, 0));

  for (const slug of products) {
    // The batch fits the cap, or it doesn't start.
    if (ledger.spent + per.ceiling > cap) {
      console.log(`\n${slug}: NOT STARTED — spent $${ledger.spent.toFixed(4)} + ceiling $${per.ceiling.toFixed(4)} > CAP_USD $${cap}.`);
      break;
    }
    // The balance check: fal must hold this batch's fal ceiling plus $1.
    const balance = await falBalance();
    if (balance < per.falCeiling + 1) {
      console.log(`\n${slug}: NOT STARTED — fal balance $${balance.toFixed(2)} < this batch's fal ceiling $${per.falCeiling.toFixed(4)} + $1. Top up fal and run again with --skip for done lines.`);
      break;
    }
    console.log(`\n${slug}: fal balance $${balance.toFixed(2)}; starting (ceiling $${per.ceiling.toFixed(4)}).`);
    try {
      await runProduct(slug, args.products, outDir, lines, ledger);
    } catch (err) {
      console.error(`${slug}: stopped — ${err instanceof Error ? err.message : String(err)}. Spent so far $${ledger.spent.toFixed(4)} (ledger: ${ledger.file}).`);
      if (err instanceof OutOfCredit || /STOP-LOSS/.test(String(err))) break;
      continue;
    }
    if (checkLines.length) {
      const left = r4(Math.min(checkCeiling, cap - ledger.spent));
      const child = spawnSync("npx", ["tsx", CHECK_SCRIPT, "--run", outDir, "--product", slug, "--max-usd", String(left), "--go", ...(args.writeDb ? ["--write-db"] : [])], {
        stdio: "inherit",
        env: process.env,
      });
      const checks = path.join(outDir, slug, "checks.json");
      if (child.status !== 0 || !existsSync(checks)) {
        console.error(`${slug}: the check step did not finish (exit ${child.status}). Renders are kept; run it again by hand.`);
        break;
      }
      const usd = JSON.parse(await readFile(checks, "utf8")).usd ?? 0;
      ledger.spent += usd;
      await appendFile(ledger.file, `${JSON.stringify({ at: new Date().toISOString(), product: slug, line: "C1-C4", usd })}\n`);
    }
    console.log(`${slug}: done. Spent so far $${ledger.spent.toFixed(4)} of $${cap}.`);
  }
  console.log(`\nTotal spent: $${ledger.spent.toFixed(4)}. Every call: ${ledger.file}`);
  return 0;
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  },
);
