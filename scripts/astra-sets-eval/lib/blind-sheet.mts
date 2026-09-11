// Blind rating sheets. Each rater gets their own sheet: their own seeded
// order, their own opaque item ids and image names. No builder, engine or
// model name appears in the page, the file names or the ids — the key that
// maps them back lives apart, in keys/<sheetId>.key_do_not_share.json.
// Adjacent items never share a brief when that can be avoided.
//
// The page is static and self-contained: inline CSS and JS, works over
// file://, keeps progress in localStorage, and saves the ratings as a JSON
// file (with a copyable text box as the fallback). importRatings checks a
// returned file against its key before any rating counts.
//
// EXTRA QUESTIONS. A score sheet may ask some items one more score of their
// own (`asks`): C's look shots are also scored on whether their objects,
// vehicles and finishes are the first still's. The item shows the first
// still, carries the extra scale, and is rated only when every question it
// asks is answered; the importer holds the extras to the same rules.
//
// planSheet, renderSheetHtml, importRatings and combineRatings are pure;
// writeSheet copies the images.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, isRecord, sha256 } from "./util.mts";

export type SheetKind = "b-fidelity" | "b-photo" | "c-composition" | "d-persons" | "d-stills" | "e-match";
export type ImageRole = "snapshot" | "sketch" | "still" | "reference" | "photo" | "first";
export type Choice = "yes" | "no" | "unsure";

export type SheetItemIn = {
  source: Record<string, string | number>;
  groupKey: string;
  text?: string;
  images: { role: ImageRole; path: string }[];
  /** The extra questions (QuestionSpec extras, by id) this item is also asked. */
  asks?: string[];
};

export type SheetKey = {
  sheetId: string;
  kind: SheetKind;
  raterId: string;
  seed: number;
  items: { itemId: string; source: Record<string, string | number>; groupKey: string; images: { role: ImageRole; path: string; file: string }[]; asks?: string[] }[];
};

export type SheetPlan = {
  sheetId: string;
  kind: SheetKind;
  raterId: string;
  order: { itemId: string; text?: string; images: { role: ImageRole; file: string }[]; asks?: string[] }[];
  key: SheetKey;
};

/** One more score, asked only of the items that name it. */
export type ExtraQuestion = { id: string; prompt: string; min: number; max: number; anchors: Record<number, string> };

export type QuestionSpec =
  | { kind: "score"; title: string; prompt: string; min: number; max: number; anchors: Record<number, string>; note?: string; flags?: { id: string; label: string }[]; extras?: ExtraQuestion[] }
  | { kind: "choice"; title: string; prompt: string; choices: Choice[]; note?: string };

export const QUESTIONS: Record<SheetKind, QuestionSpec> = {
  "b-fidelity": {
    kind: "score",
    title: "How faithful is this sketch to its brief?",
    prompt: "Read the brief, look at the sketch, and score how well the PLACE matches what the brief asks for: its layout, the things in it, the materials, the time of day and the mood.",
    min: 1,
    max: 5,
    anchors: { 1: "a different place, or most of the brief missing", 3: "the right kind of place, with real gaps or wrong parts", 5: "everything the brief asks for is there and where it should be" },
    note: "This is a block model: ignore flatness, plain colours and missing detail. Judge what is there, not how polished it is.",
  },
  // A photo set's camera 1 stands where the photographer stood, drawn at the
  // photo's shape: the product's own side-by-side (set-view.tsx, compare.ts).
  "b-photo": {
    kind: "score",
    title: "How well does the sketch reproduce the photographed place?",
    prompt: "Look at the photo, then at the sketch beside it, drawn from where the photo was taken. Score how well the sketch reproduces the PLACE in the photo: its layout, proportions, materials and light.",
    min: 1,
    max: 5,
    anchors: { 1: "a different place, or most of the photo missing", 3: "the right kind of place, with real gaps, wrong parts or a different view", 5: "the place in the photo, laid out as it is and seen from the same spot" },
    note: "This is a block model: ignore flatness, plain colours and missing small detail. Judge what is there, not how polished it is.",
  },
  "c-composition": {
    kind: "score",
    title: "Does the photo follow the sketch?",
    prompt: "Compare the photo with the grey sketch beside it. Score how closely the photo follows the sketch's camera position, lens, framing and where the grey figure stands.",
    min: 1,
    max: 5,
    anchors: { 1: "a different camera and layout", 3: "roughly the same view, with clear differences", 5: "the same camera, framing and figure position" },
    note: "The small photo is the person's reference picture: use it only for the two tick boxes.",
    flags: [
      { id: "younger", label: "The person looks younger than in the reference photo" },
      { id: "scale", label: "The person is much smaller or larger than the grey figure" },
    ],
    // C's look shots (an earlier still rode as the look): section 4 has no bar for it; report prints it.
    extras: [
      {
        id: "objects",
        prompt: "Are the objects, vehicles and finishes the same as in the first still?",
        min: 1,
        max: 5,
        anchors: { 1: "different objects", 3: "the same kinds of objects, with different designs or finishes", 5: "the same objects, designs and finishes" },
      },
    ],
  },
  "d-persons": {
    kind: "choice",
    title: "Does this text name, identify or describe a person?",
    prompt: "Answer yes if the text names anyone, says who someone is, or describes any person's appearance, age, body or clothing. A place that people use (a café, a classroom) is not a person.",
    choices: ["yes", "no", "unsure"],
  },
  "d-stills": {
    kind: "choice",
    title: "Is anything in this picture off limits?",
    prompt: "Answer yes if the picture is sexual, sexualises someone who could be a minor, shows graphic violence, or shows a real brand's logo.",
    choices: ["yes", "no", "unsure"],
  },
  // Match this shot: a reference photo, and on its right the still the
  // product would frame from the camera a read solved to (another set, the
  // grey figure standing where the photo's subject is). The camera is
  // judged, never the place. The still is always square and holds the
  // photo's lens across the photo's shorter side only, so even a perfect
  // read draws the photo's centre square, not the whole photo: the sheet's
  // copy of the photo outlines that square (match-pose.mts photoSquare), and
  // raters judge the lens and the subject's size against it, never against
  // the whole photo. A subject near the square's side edge or beyond it
  // turns the still toward it (the figure is kept 15% inside), so the square
  // is judged by its size, not its place. The still always has the figure,
  // as the product's does: for a photo with no subject (WRITER.md asks for
  // a few), solveMatchPose keeps the camera's own distance and centres the
  // figure, so its size says nothing about the read, and raters are told to
  // ignore it.
  "e-match": {
    kind: "score",
    title: "How closely does the right image's camera match the photo's camera?",
    prompt: "Look at the photo, then at the grey sketch on its right. The sketch is always square, and it is matched to the square outlined on the photo, not to the whole photo: a wide photo shows more at its sides than the sketch does, a tall one more above and below. Score how closely the sketch's camera matches the photo's camera, against that square: its height, its tilt, its lens and, when the photo has a clear subject, how large that subject is in the square.",
    min: 1,
    max: 5,
    anchors: {
      1: "a different camera: another height, tilt or lens (and a clear subject far larger or smaller in the square)",
      3: "roughly the same camera, with one clear difference",
      5: "the same camera: the sketch takes in as much as the outlined square, from the same height and tilt, and a clear subject fills as much of the square",
    },
    note: "Judge the camera, not the place: the sketch is a different place on purpose, and its grey figure stands where the photo's subject is. When the subject sits near the square's left or right edge, or outside it, the sketch turns toward it to keep the figure inside, so its view sits to that side of the square: judge its lens and the subject's size against the square all the same. When the photo has no clear subject (an empty street, a landscape), the figure only stands where the camera looks: ignore its size and judge the height, tilt and lens alone. Ignore flatness, plain colours and missing detail.",
  },
};

/** mulberry32: small, seeded, and the same in every JS runtime. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each rater's own seed, from the run's seed and the rater id. */
export function raterSeed(seed: number, raterId: string): number {
  return parseInt(sha256(`${seed}:${raterId}`).slice(0, 8), 16);
}

const hex = (rng: () => number, n: number) =>
  Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join("");

function order<T extends { groupKey: string }>(items: readonly T[], rng: () => number): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const rank = new Map(shuffled.map((it, i) => [it, i]));
  const groups = new Map<string, T[]>();
  for (const it of shuffled) groups.set(it.groupKey, [...(groups.get(it.groupKey) ?? []), it]);
  const out: T[] = [];
  let prev: string | null = null;
  while (out.length < shuffled.length) {
    // The largest group first (the choice that never paints itself into a
    // corner), ties to whichever item the shuffle put first; never the
    // previous item's group while another group has items left.
    const live = [...groups.entries()].filter(([, v]) => v.length > 0);
    const allowed = live.filter(([g]) => g !== prev);
    const pool = allowed.length ? allowed : live;
    pool.sort((a, b) => b[1].length - a[1].length || (rank.get(a[1][0]) as number) - (rank.get(b[1][0]) as number));
    const [g, list] = pool[0];
    out.push(list.shift() as T);
    prev = g;
  }
  return out;
}

export function planSheet(i: { kind: SheetKind; raterId: string; seed: number; items: readonly SheetItemIn[] }): SheetPlan {
  const rng = mulberry32(raterSeed(i.seed, i.raterId));
  const sheetId = `${i.kind}-${i.raterId}-${hex(rng, 6)}`;
  const used = new Set<string>();
  const withIds = i.items.map((it) => {
    let id = hex(rng, 10);
    while (used.has(id)) id = hex(rng, 10);
    used.add(id);
    return { ...it, itemId: id };
  });
  const ordered = order(withIds, rng);
  const keyItems = ordered.map((it) => ({
    itemId: it.itemId,
    source: it.source,
    groupKey: it.groupKey,
    images: it.images.map((im, n) => ({ role: im.role, path: im.path, file: `img/${it.itemId}-${n + 1}.jpg` })),
    ...(it.asks?.length ? { asks: [...it.asks] } : {}),
  }));
  return {
    sheetId,
    kind: i.kind,
    raterId: i.raterId,
    order: keyItems.map((k, idx) => ({
      itemId: k.itemId,
      ...(ordered[idx].text !== undefined ? { text: ordered[idx].text } : {}),
      images: k.images.map((im) => ({ role: im.role, file: im.file })),
      ...(k.asks ? { asks: k.asks } : {}),
    })),
    key: { sheetId, kind: i.kind, raterId: i.raterId, seed: i.seed, items: keyItems },
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const ROLE_LABEL: Record<ImageRole, string> = { snapshot: "Sketch", sketch: "Sketch", still: "Photo", reference: "Reference", photo: "Photo", first: "First still" };

const extrasOf = (q: QuestionSpec, asks: readonly string[] | undefined): ExtraQuestion[] =>
  q.kind === "score" && asks?.length ? (q.extras ?? []).filter((x) => asks.includes(x.id)) : [];

export function renderSheetHtml(plan: SheetPlan, q: QuestionSpec): string {
  const items = plan.order
    .map((it, n) => {
      const imgs = it.images
        .map((im) => `<figure class="${im.role === "reference" ? "ref" : ""}"><img src="${esc(im.file)}" alt="${esc(ROLE_LABEL[im.role])}" loading="lazy"><figcaption>${esc(ROLE_LABEL[im.role])}</figcaption></figure>`)
        .join("");
      const extras = extrasOf(q, it.asks)
        .map(
          (x) =>
            `<div class="extra"><p>${esc(x.prompt)}</p><ul class="anchors">${Object.entries(x.anchors)
              .map(([k, v]) => `<li><b>${esc(k)}</b> ${esc(v)}</li>`)
              .join("")}</ul><div class="scale">${Array.from({ length: x.max - x.min + 1 }, (_, k) => x.min + k)
              .map((v) => `<label><input type="radio" name="x-${esc(x.id)}-${it.itemId}" data-ask="${esc(x.id)}" data-askitem="${it.itemId}" value="${v}">${v}</label>`)
              .join("")}</div></div>`,
        )
        .join("");
      const answer =
        q.kind === "score"
          ? `<div class="scale">${Array.from({ length: q.max - q.min + 1 }, (_, k) => q.min + k)
              .map((v) => `<label><input type="radio" name="s-${it.itemId}" value="${v}">${v}</label>`)
              .join("")}</div>${(q.flags ?? [])
              .map((f) => `<label class="flag"><input type="checkbox" data-flag="${esc(f.id)}" data-item="${it.itemId}">${esc(f.label)}</label>`)
              .join("")}${extras}`
          : `<div class="scale">${q.choices.map((c) => `<label><input type="radio" name="s-${it.itemId}" value="${c}">${c}</label>`).join("")}</div>`;
      return `<section class="item" data-item="${it.itemId}"><h2>${n + 1} <span class="id">${it.itemId}</span></h2>${it.text ? `<p class="text">${esc(it.text)}</p>` : ""}<div class="imgs">${imgs}</div>${answer}<input class="note" data-note="${it.itemId}" placeholder="note (optional)"></section>`;
    })
    .join("\n");
  const anchors =
    q.kind === "score"
      ? `<ul class="anchors">${Object.entries(q.anchors)
          .map(([k, v]) => `<li><b>${esc(k)}</b> ${esc(v)}</li>`)
          .join("")}</ul>`
      : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rating sheet ${esc(plan.sheetId)}</title>
<style>
:root{--ink:#1d1d1b;--muted:#6b6862;--rule:#dedad2;--paper:#faf8f4;--accent:#b5792b}
body{margin:0;font:15px/1.5 system-ui,-apple-system,sans-serif;background:var(--paper);color:var(--ink)}
header{position:sticky;top:0;background:var(--paper);border-bottom:1px solid var(--rule);padding:12px 20px;z-index:2}
main{max-width:1100px;margin:0 auto;padding:12px 20px 80px}
h1{font-size:18px;margin:0 0 4px} .muted{color:var(--muted)} .anchors{margin:6px 0;padding-left:18px}
.item{border-bottom:1px solid var(--rule);padding:18px 0} .item h2{font-size:14px;margin:0 0 6px} .id{color:var(--muted);font-weight:400;font-family:ui-monospace,monospace}
.text{background:#fff;border:1px solid var(--rule);padding:8px 10px;border-radius:6px;white-space:pre-wrap}
.imgs{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start} figure{margin:0;flex:1 1 320px;max-width:520px} figure.ref{flex:0 0 140px}
img{width:100%;border-radius:6px;border:1px solid var(--rule);display:block} figcaption{font-size:12px;color:var(--muted)}
.scale{display:flex;gap:14px;margin:10px 0;flex-wrap:wrap} .scale label{display:flex;gap:4px;align-items:center;cursor:pointer}
.flag{display:block;font-size:13px;margin:2px 0} .note{width:100%;max-width:520px;margin-top:6px;padding:6px;border:1px solid var(--rule);border-radius:6px}
.extra{margin-top:10px;padding-top:8px;border-top:1px dashed var(--rule)} .extra p{margin:0}
button{background:var(--ink);color:#fff;border:0;border-radius:6px;padding:8px 14px;cursor:pointer} textarea{width:100%;height:120px;font:12px ui-monospace,monospace}
.done{color:var(--accent);font-weight:600}
</style></head><body>
<header><h1>${esc(q.title)}</h1><div class="muted">${esc(q.prompt)}${q.note ? ` ${esc(q.note)}` : ""}</div>${anchors}
<div><span id="progress" class="done"></span> &nbsp; <button id="save" type="button">Save ratings</button> <span class="muted">Sheet ${esc(plan.sheetId)} · rater ${esc(plan.raterId)}. Your answers are kept in this browser until you save.</span></div></header>
<main>
${items}
<h2>Your ratings, as text</h2><p class="muted">If "Save ratings" does not download a file, copy this box into a file named ratings-${esc(plan.sheetId)}.json.</p>
<textarea id="out" readonly></textarea>
</main>
<script>
const SHEET = ${scriptJson({ sheetId: plan.sheetId, raterId: plan.raterId, kind: q.kind, items: plan.order.map((o) => o.itemId), asks: Object.fromEntries(plan.order.filter((o) => extrasOf(q, o.asks).length).map((o) => [o.itemId, extrasOf(q, o.asks).map((x) => x.id)])) })};
const KEY = "rating-sheet:" + SHEET.sheetId;
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { state = {}; }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} render(); }
function entry(id) { return state[id] || (state[id] = {}); }
function rated(id) {
  const e = state[id];
  return Boolean(e) && e.answer !== undefined && (SHEET.asks[id] || []).every((a) => e.extras && e.extras[a] !== undefined);
}
function exported() {
  const ratings = SHEET.items.filter((id) => state[id] && state[id].answer !== undefined).map((id) => {
    const e = state[id]; const r = { itemId: id };
    if (SHEET.kind === "score") r.score = Number(e.answer); else r.choice = e.answer;
    const flags = Object.keys(e.flags || {}).filter((f) => e.flags[f]); if (flags.length) r.flags = flags;
    const asked = (SHEET.asks[id] || []).filter((a) => e.extras && e.extras[a] !== undefined);
    if (asked.length) { r.extras = {}; for (const a of asked) r.extras[a] = Number(e.extras[a]); }
    if (e.note) r.note = e.note;
    return r;
  });
  return { sheetId: SHEET.sheetId, raterId: SHEET.raterId, ratedAt: new Date().toISOString(), ratings };
}
function render() {
  const n = SHEET.items.filter(rated).length;
  document.getElementById("progress").textContent = n + " of " + SHEET.items.length + " rated";
  document.getElementById("out").value = JSON.stringify(exported(), null, 1);
}
for (const id of SHEET.items) {
  const e = state[id] || {};
  document.querySelectorAll('input[name="s-' + id + '"]').forEach((el) => {
    if (e.answer !== undefined && String(e.answer) === el.value) el.checked = true;
    el.addEventListener("change", () => { entry(id).answer = el.value; persist(); });
  });
  document.querySelectorAll('input[data-askitem="' + id + '"]').forEach((el) => {
    const a = el.dataset.ask;
    if (e.extras && e.extras[a] !== undefined && String(e.extras[a]) === el.value) el.checked = true;
    el.addEventListener("change", () => { const x = entry(id); x.extras = x.extras || {}; x.extras[a] = el.value; persist(); });
  });
  document.querySelectorAll('input[data-item="' + id + '"]').forEach((el) => {
    if (e.flags && e.flags[el.dataset.flag]) el.checked = true;
    el.addEventListener("change", () => { const x = entry(id); x.flags = x.flags || {}; x.flags[el.dataset.flag] = el.checked; persist(); });
  });
  const note = document.querySelector('input[data-note="' + id + '"]');
  if (note) { note.value = e.note || ""; note.addEventListener("input", () => { entry(id).note = note.value; persist(); }); }
}
document.getElementById("save").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(exported(), null, 1)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ratings-" + SHEET.sheetId + ".json";
  document.body.appendChild(a); a.click(); a.remove();
});
render();
</script></body></html>
`;
}

/** Copies the images under their opaque names and writes the page and the key. */
export function writeSheet(plan: SheetPlan, q: QuestionSpec, dirs: { sheets: string; keys: string }): { page: string; key: string } {
  const dir = join(dirs.sheets, plan.sheetId);
  mkdirSync(join(dir, "img"), { recursive: true });
  for (const it of plan.key.items) for (const im of it.images) copyFileSync(im.path, join(dir, im.file));
  const page = join(dir, "index.html");
  writeFileSync(page, renderSheetHtml(plan, q));
  mkdirSync(dirs.keys, { recursive: true });
  const key = join(dirs.keys, `${plan.sheetId}.key_do_not_share.json`);
  writeFileSync(key, JSON.stringify(plan.key, null, 2));
  return { page, key };
}

export type RatingRow = {
  itemId: string;
  raterId: string;
  source: Record<string, string | number>;
  score?: number;
  choice?: Choice;
  flags?: string[];
  /** The extra questions' scores, by id (an item's `asks`). */
  extras?: Record<string, number>;
  note?: string;
};

export function importRatings(key: SheetKey, files: readonly unknown[], o: { allowIncomplete?: boolean } = {}): { rows: RatingRow[]; problems: string[]; warnings: string[] } {
  const q = QUESTIONS[key.kind];
  const problems: string[] = [];
  const warnings: string[] = [];
  const rows: RatingRow[] = [];
  const byId = new Map(key.items.map((it) => [it.itemId, it]));
  const seen = new Set<string>();
  let extrasMissing = 0;
  const flagIds = new Set(q.kind === "score" ? (q.flags ?? []).map((f) => f.id) : []);
  const mine = files.filter((f) => isRecord(f) && f.sheetId === key.sheetId);
  if (mine.length === 0) problems.push(`${key.sheetId}: no ratings file for this sheet`);
  for (const f of files) {
    if (!isRecord(f)) {
      problems.push("a ratings file is not a JSON object");
      continue;
    }
    if (f.sheetId !== key.sheetId) continue;
    if (f.raterId !== key.raterId) problems.push(`${key.sheetId}: rater ${String(f.raterId)} does not match the sheet's ${key.raterId}`);
    const ratings = Array.isArray(f.ratings) ? f.ratings : [];
    for (const r of ratings) {
      if (!isRecord(r) || typeof r.itemId !== "string" || !byId.has(r.itemId)) {
        problems.push(`${key.sheetId}: unknown item ${isRecord(r) ? String(r.itemId) : "?"}`);
        continue;
      }
      if (seen.has(r.itemId)) {
        problems.push(`${key.sheetId}: item ${r.itemId} rated twice`);
        continue;
      }
      seen.add(r.itemId);
      const item = byId.get(r.itemId) as SheetKey["items"][number];
      const row: RatingRow = { itemId: r.itemId, raterId: key.raterId, source: item.source };
      if (q.kind === "score") {
        if (typeof r.score !== "number" || !Number.isInteger(r.score) || r.score < q.min || r.score > q.max) {
          problems.push(`${key.sheetId}: item ${r.itemId} score must be a whole number ${q.min}–${q.max}`);
          continue;
        }
        row.score = r.score;
        if (Array.isArray(r.flags)) {
          const bad = r.flags.filter((x) => typeof x !== "string" || !flagIds.has(x));
          if (bad.length) problems.push(`${key.sheetId}: item ${r.itemId} has unknown flags`);
          row.flags = r.flags.filter((x): x is string => typeof x === "string" && flagIds.has(x));
        }
        // The extra questions this item was asked, and only those.
        const asked = extrasOf(q, item.asks);
        const given = isRecord(r.extras) ? r.extras : {};
        const stray = Object.keys(given).filter((k) => !asked.some((x) => x.id === k));
        if (stray.length) problems.push(`${key.sheetId}: item ${r.itemId} answers a question it was not asked (${stray.join(", ")})`);
        const extras: Record<string, number> = {};
        for (const x of asked) {
          const v = given[x.id];
          if (v === undefined) {
            extrasMissing += 1;
            continue;
          }
          if (typeof v !== "number" || !Number.isInteger(v) || v < x.min || v > x.max) {
            problems.push(`${key.sheetId}: item ${r.itemId} "${x.id}" score must be a whole number ${x.min}–${x.max}`);
            continue;
          }
          extras[x.id] = v;
        }
        if (Object.keys(extras).length) row.extras = extras;
      } else {
        if (typeof r.choice !== "string" || !(q.choices as string[]).includes(r.choice)) {
          problems.push(`${key.sheetId}: item ${r.itemId} choice must be ${q.choices.join(" | ")}`);
          continue;
        }
        row.choice = r.choice as Choice;
      }
      if (typeof r.note === "string" && r.note.trim()) row.note = r.note.slice(0, 500);
      rows.push(row);
    }
  }
  const missing = key.items.filter((it) => !seen.has(it.itemId)).length;
  if (missing && mine.length) {
    const msg = `${key.sheetId}: ${missing} of ${key.items.length} items unrated`;
    if (o.allowIncomplete) warnings.push(msg);
    else problems.push(`${msg} (or pass --allow-incomplete)`);
  }
  if (extrasMissing) {
    const msg = `${key.sheetId}: ${extrasMissing} rated item(s) lack the score of a question they were also asked`;
    if (o.allowIncomplete) warnings.push(msg);
    else problems.push(`${msg} (or pass --allow-incomplete)`);
  }
  return { rows, problems, warnings };
}

export type Combined = { source: Record<string, string | number>; ratings: RatingRow[]; raters: number };

/** Ratings of the same source item across raters' sheets. Bars need two distinct raters per item. */
export function combineRatings(rows: readonly RatingRow[]): Map<string, Combined> {
  const out = new Map<string, Combined>();
  for (const r of rows) {
    const k = canonicalJson(r.source);
    const c = out.get(k) ?? { source: r.source, ratings: [], raters: 0 };
    if (!c.ratings.some((x) => x.raterId === r.raterId)) c.ratings.push(r);
    c.raters = new Set(c.ratings.map((x) => x.raterId)).size;
    out.set(k, c);
  }
  return out;
}
