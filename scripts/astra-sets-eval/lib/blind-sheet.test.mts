import { describe, expect, it } from "vitest";
import { eSheetItem } from "../parts/e.mts";
import { combineRatings, importRatings, planSheet, QUESTIONS, renderSheetHtml, type SheetItemIn } from "./blind-sheet.mts";

const BUILDERS = ["builder-alpha-secret", "builder-beta-secret", "builder-gamma-secret"];
const items: SheetItemIn[] = Array.from({ length: 12 }, (_, i) => ({
  source: { buildId: `build-${i}-hidden`, builder: BUILDERS[i % 3], run: 1 + (i % 2), briefId: `brief-${Math.floor(i / 3)}` },
  groupKey: `brief-${Math.floor(i / 3)}`,
  text: `Brief text ${Math.floor(i / 3)}`,
  images: [{ role: "snapshot", path: `/runs/frames/build-${i}-hidden-c1.jpg` }],
}));

describe("planSheet", () => {
  it("is deterministic for a seed, and a permutation of every item", () => {
    const a = planSheet({ kind: "b-fidelity", raterId: "r1", seed: 7, items });
    const b = planSheet({ kind: "b-fidelity", raterId: "r1", seed: 7, items });
    expect(a).toEqual(b);
    expect(a.order).toHaveLength(12);
    const sources = a.key.items.map((k) => k.source.buildId).sort();
    expect(sources).toEqual(items.map((i) => i.source.buildId).sort());
    expect(new Set(a.order.map((o) => o.itemId)).size).toBe(12);
  });

  it("gives each rater their own order and ids", () => {
    const r1 = planSheet({ kind: "b-fidelity", raterId: "r1", seed: 7, items });
    const r2 = planSheet({ kind: "b-fidelity", raterId: "r2", seed: 7, items });
    expect(r1.sheetId).not.toBe(r2.sheetId);
    expect(r1.order.map((o) => o.itemId)).not.toEqual(r2.order.map((o) => o.itemId));
    expect(r1.key.items.map((k) => k.source.buildId)).not.toEqual(r2.key.items.map((k) => k.source.buildId));
  });

  it("never puts two items of one brief side by side when it can be avoided", () => {
    const p = planSheet({ kind: "b-fidelity", raterId: "r1", seed: 99, items });
    const groups = p.key.items.map((k) => k.groupKey);
    for (let i = 1; i < groups.length; i++) expect(groups[i]).not.toBe(groups[i - 1]);
  });

  it("the page carries none of the key's hidden values, and the files are opaque", () => {
    const p = planSheet({ kind: "b-fidelity", raterId: "r1", seed: 3, items });
    const html = renderSheetHtml(p, QUESTIONS["b-fidelity"]);
    for (const k of p.key.items) {
      expect(html).not.toContain(String(k.source.buildId));
      expect(html).not.toContain(String(k.source.builder));
      for (const im of k.images) {
        expect(html).not.toContain(im.path);
        expect(im.file).toMatch(/^img\/[0-9a-f]{10}-1\.jpg$/);
      }
    }
    expect(html).toContain("Brief text 0");
    expect(html).toContain(p.sheetId);
  });
});

describe("the photo sheet (b-photo)", () => {
  // Each item: the photo the A run sent, then camera 1 at its shape. The
  // same photo recurs across runs and arms; nothing on the page says which
  // arm drew which sketch, or which photo file it was.
  const photoItems: SheetItemIn[] = Array.from({ length: 8 }, (_, i) => ({
    source: { buildId: `pal-secret-${i}`, builder: BUILDERS[i % 2], run: 1 + (i % 2), briefId: `ph-hidden-${i % 4}` },
    groupKey: `ph-hidden-${i % 4}`,
    images: [
      { role: "photo", path: `/runs/a-photo/photos/ph-hidden-${i % 4}.jpg` },
      { role: "snapshot", path: `/runs/b-photo/frames/pal-secret-${i}-c1.jpg` },
    ],
  }));

  it("shows the photo beside the sketch, under opaque names, with nothing of the key", () => {
    const p = planSheet({ kind: "b-photo", raterId: "r1", seed: 11, items: photoItems });
    const html = renderSheetHtml(p, QUESTIONS["b-photo"]);
    for (const k of p.key.items) {
      for (const v of [k.source.buildId, k.source.builder, k.source.briefId]) expect(html).not.toContain(String(v));
      expect(k.images.map((im) => im.role)).toEqual(["photo", "snapshot"]);
      for (const im of k.images) {
        expect(html).not.toContain(im.path);
        expect(im.file).toMatch(/^img\/[0-9a-f]{10}-[12]\.jpg$/);
      }
    }
    expect(html).not.toMatch(/photos\/|frames\//);
    expect(html).toContain('alt="Photo"');
    expect(html).toContain('alt="Sketch"');
    expect(html).toContain("How well does the sketch reproduce the photographed place?");
    // One photo's items never sit side by side when that can be avoided.
    const groups = p.key.items.map((k) => k.groupKey);
    for (let i = 1; i < groups.length; i++) expect(groups[i]).not.toBe(groups[i - 1]);
  });

  it("each rater gets their own order and ids, and scores 1–5", () => {
    const r1 = planSheet({ kind: "b-photo", raterId: "r1", seed: 11, items: photoItems });
    const r2 = planSheet({ kind: "b-photo", raterId: "r2", seed: 11, items: photoItems });
    expect(r1.order.map((o) => o.itemId)).not.toEqual(r2.order.map((o) => o.itemId));
    const ids = r1.key.items.map((k) => k.itemId);
    const ok = importRatings(r1.key, [{ sheetId: r1.sheetId, raterId: "r1", ratings: ids.map((itemId) => ({ itemId, score: 4 })) }]);
    expect(ok.problems).toEqual([]);
    expect(importRatings(r1.key, [{ sheetId: r1.sheetId, raterId: "r1", ratings: ids.map((itemId) => ({ itemId, choice: "no" })) }]).problems.join(" ")).toMatch(/whole number 1–5/);
  });
});

describe("the Match-this-shot sheet (e-match)", () => {
  // Each read of each photo, by either builder, is its own item: the photo
  // it was read from, then the stage view it solved to, on the right. Only
  // the key knows which builder read it.
  const reads: SheetItemIn[] = ["astra", "mini"].flatMap((builder) =>
    [1, 2, 3].flatMap((run) =>
      ["mt-hidden-a", "mt-hidden-b"].map((photoId) =>
        eSheetItem("e-run-secret", { readId: `e-${builder}-${photoId}-r${run}`, builder: builder as "astra" | "mini", photoId, run }, `/runs/e/photos/${photoId}.jpg`, `/runs/e/frames/fx-set-e-${builder}-${photoId}-r${run}.jpg`),
      ),
    ),
  );

  it("shows the photo and, on its right, the stage view, with nothing of the key: no builder, photo, read or path", () => {
    const p = planSheet({ kind: "e-match", raterId: "r1", seed: 4, items: reads });
    const html = renderSheetHtml(p, QUESTIONS["e-match"]);
    expect(p.order).toHaveLength(12);
    for (const k of p.key.items) {
      expect(k.images.map((im) => im.role)).toEqual(["photo", "snapshot"]);
      for (const v of [k.source.readId, k.source.photoId, k.source.runId]) expect(html).not.toContain(String(v));
      for (const im of k.images) expect(html).not.toContain(im.path);
    }
    for (const word of ["astra", "Astra", "mini", "gpt", "e-read", "photos/", "frames/"]) expect(html).not.toContain(word);
    expect(html).toContain("How closely does the right image&#39;s camera match the photo&#39;s camera?");
    expect(html).toContain("Judge the camera, not the place");
    // The still is square and holds the photo's lens across its shorter side only (match-pose.mts photoSquare):
    // raters judge it against the square outlined on the photo, never the whole photo, or a correct read scores low.
    expect(html).toContain(
      "The sketch is always square, and it is matched to the square outlined on the photo, not to the whole photo: a wide photo shows more at its sides than the sketch does, a tall one more above and below. Score how closely the sketch&#39;s camera matches the photo&#39;s camera, against that square: its height, its tilt, its lens and, when the photo has a clear subject, how large that subject is in the square.",
    );
    expect(html).toContain("<b>1</b> a different camera: another height, tilt or lens (and a clear subject far larger or smaller in the square)");
    expect(html).toContain("<b>5</b> the same camera: the sketch takes in as much as the outlined square, from the same height and tilt, and a clear subject fills as much of the square");
    // A subject near the square's side edge turns the still toward it: the square is judged by its size, not its place.
    expect(html).toContain("When the subject sits near the square&#39;s left or right edge, or outside it, the sketch turns toward it to keep the figure inside, so its view sits to that side of the square: judge its lens and the subject&#39;s size against the square all the same.");
    expect(html).not.toMatch(/in frame/);
    // A photo with no subject still gets the figure (the product's still has it): raters judge height, tilt and lens alone.
    expect(html).toContain("When the photo has no clear subject (an empty street, a landscape), the figure only stands where the camera looks: ignore its size and judge the height, tilt and lens alone.");
    // Every read of a photo is its own item, and one photo's items never sit side by side when that can be avoided.
    const groups = p.key.items.map((k) => k.groupKey);
    expect(groups.filter((g) => g === "mt-hidden-a")).toHaveLength(6);
    for (let i = 1; i < groups.length; i++) expect(groups[i]).not.toBe(groups[i - 1]);
    expect(new Set(p.key.items.map((k) => k.source.builder))).toEqual(new Set(["astra", "mini"]));
  });

  it("each rater gets their own order, and a rating maps back to its read through the key", () => {
    const r1 = planSheet({ kind: "e-match", raterId: "r1", seed: 4, items: reads });
    const r2 = planSheet({ kind: "e-match", raterId: "r2", seed: 4, items: reads });
    expect(r1.key.items.map((k) => k.source.readId)).not.toEqual(r2.key.items.map((k) => k.source.readId));
    const rows = importRatings(r1.key, [{ sheetId: r1.sheetId, raterId: "r1", ratings: r1.key.items.map((k) => ({ itemId: k.itemId, score: k.source.builder === "astra" ? 5 : 2 })) }]).rows;
    expect(rows.filter((x) => x.score === 5).every((x) => x.source.builder === "astra")).toBe(true);
  });
});

describe("the composition sheet's extra question (C's later cameras)", () => {
  // Six stills; the later cameras' (odd ones) also show the first still and
  // ask whether its objects are the same.
  const cItems: SheetItemIn[] = Array.from({ length: 6 }, (_, i) => ({
    source: { shotId: `cl-secret-${i}`, engine: ["gpt-image", "flux"][i % 2], setKey: `set-${i % 3}` },
    groupKey: `set-${i % 3}`,
    images: [
      { role: "sketch", path: `/runs/frames/f-${i}.jpg` },
      { role: "still", path: `/runs/stills/s-${i}.png` },
      ...(i % 2 ? [{ role: "first" as const, path: `/runs/stills/first-${i}.png` }] : []),
    ],
    ...(i % 2 ? { asks: ["objects"] } : {}),
  }));
  const p = planSheet({ kind: "c-composition", raterId: "r1", seed: 4, items: cItems });
  const q = QUESTIONS["c-composition"];
  const file = (ratings: unknown[]) => ({ sheetId: p.sheetId, raterId: "r1", ratings });
  const asked = p.key.items.filter((k) => k.asks?.includes("objects")).map((k) => k.itemId);
  const plain = p.key.items.filter((k) => !k.asks).map((k) => k.itemId);

  it("asks it only of the items that name it, beside the first still, with nothing of the key on the page", () => {
    const html = renderSheetHtml(p, q);
    expect(html.split("Are the objects, vehicles and finishes the same as in the first still?").length - 1).toBe(3);
    expect(html.split('alt="First still"').length - 1).toBe(3);
    for (const k of p.key.items) for (const v of [k.source.shotId, k.source.engine]) expect(html).not.toContain(String(v));
    expect(asked).toHaveLength(3);
    for (const id of asked) expect(html).toContain(`name="x-objects-${id}"`);
    for (const id of plain) expect(html).not.toContain(`name="x-objects-${id}"`);
  });

  it("imports the extra score beside the composition score, and holds it to the same rules", () => {
    const all = [...asked.map((itemId) => ({ itemId, score: 4, extras: { objects: 5 } })), ...plain.map((itemId) => ({ itemId, score: 3 }))];
    const ok = importRatings(p.key, [file(all)]);
    expect(ok.problems).toEqual([]);
    expect(ok.rows.filter((r) => r.extras).map((r) => r.extras)).toEqual([{ objects: 5 }, { objects: 5 }, { objects: 5 }]);
    const missing = [...asked.map((itemId) => ({ itemId, score: 4 })), ...plain.map((itemId) => ({ itemId, score: 3 }))];
    expect(importRatings(p.key, [file(missing)]).problems.join(" ")).toMatch(/3 rated item\(s\) lack the score of a question they were also asked/);
    expect(importRatings(p.key, [file(missing)], { allowIncomplete: true }).warnings.join(" ")).toMatch(/lack the score/);
    const high = all.map((r) => ("extras" in r ? { ...r, extras: { objects: 6 } } : r));
    expect(importRatings(p.key, [file(high)]).problems.join(" ")).toMatch(/"objects" score must be a whole number 1–5/);
    const stray = all.map((r) => (plain.includes(r.itemId) ? { ...r, extras: { objects: 4 } } : r));
    expect(importRatings(p.key, [file(stray)]).problems.join(" ")).toMatch(/answers a question it was not asked/);
  });
});

describe("importRatings", () => {
  const p = planSheet({ kind: "b-fidelity", raterId: "r1", seed: 5, items: items.slice(0, 3) });
  const ids = p.key.items.map((k) => k.itemId);
  const file = (ratings: unknown[], over: Record<string, unknown> = {}) => ({ sheetId: p.sheetId, raterId: "r1", ratedAt: "2026-09-12T00:00:00Z", ratings, ...over });

  it("accepts a complete, valid file", () => {
    const r = importRatings(p.key, [file(ids.map((itemId, i) => ({ itemId, score: i + 3 })))]);
    expect(r.problems).toEqual([]);
    expect(r.rows.map((x) => x.score)).toEqual([3, 4, 5]);
    expect(r.rows[0].source.buildId).toBe(p.key.items[0].source.buildId);
  });

  it("rejects a wrong sheet, duplicates, unknown items and out-of-range scores", () => {
    expect(importRatings(p.key, [file([], { sheetId: "someone-else" })]).problems.join(" ")).toMatch(/no ratings file/);
    expect(importRatings(p.key, [file([...ids.map((itemId) => ({ itemId, score: 4 })), { itemId: ids[0], score: 5 }])]).problems.join(" ")).toMatch(/rated twice/);
    expect(importRatings(p.key, [file([...ids.map((itemId) => ({ itemId, score: 4 })), { itemId: "ffffffffff", score: 5 }])]).problems.join(" ")).toMatch(/unknown item/);
    expect(importRatings(p.key, [file(ids.map((itemId) => ({ itemId, score: 6 })))]).problems.join(" ")).toMatch(/whole number 1–5/);
    expect(importRatings(p.key, [file(ids.map((itemId) => ({ itemId, score: 3.5 })))]).problems.join(" ")).toMatch(/whole number/);
    expect(importRatings(p.key, [file(ids.map((itemId) => ({ itemId, score: 4 })), { raterId: "r9" })]).problems.join(" ")).toMatch(/does not match/);
  });

  it("errors on missing items unless allowed", () => {
    const partial = [file([{ itemId: ids[0], score: 4 }])];
    expect(importRatings(p.key, partial).problems.join(" ")).toMatch(/2 of 3 items unrated/);
    const allowed = importRatings(p.key, partial, { allowIncomplete: true });
    expect(allowed.problems).toEqual([]);
    expect(allowed.warnings.join(" ")).toMatch(/unrated/);
  });

  it("combines two raters per source item", () => {
    const p2 = planSheet({ kind: "b-fidelity", raterId: "r2", seed: 5, items: items.slice(0, 3) });
    const a = importRatings(p.key, [file(p.key.items.map((k) => ({ itemId: k.itemId, score: 4 })))]).rows;
    const b = importRatings(p2.key, [{ sheetId: p2.sheetId, raterId: "r2", ratings: p2.key.items.map((k) => ({ itemId: k.itemId, score: 5 })) }]).rows;
    const c = combineRatings([...a, ...b]);
    expect(c.size).toBe(3);
    for (const v of c.values()) {
      expect(v.raters).toBe(2);
      expect(v.ratings.map((x) => x.score).sort()).toEqual([4, 5]);
    }
  });

  it("choice sheets take yes, no or unsure", () => {
    const q = planSheet({ kind: "d-persons", raterId: "r1", seed: 1, items: [{ source: { buildId: "x" }, groupKey: "g", text: "t", images: [] }] });
    const id = q.key.items[0].itemId;
    expect(importRatings(q.key, [{ sheetId: q.sheetId, raterId: "r1", ratings: [{ itemId: id, choice: "maybe" }] }]).problems.join(" ")).toMatch(/yes \| no \| unsure/);
    expect(importRatings(q.key, [{ sheetId: q.sheetId, raterId: "r1", ratings: [{ itemId: id, choice: "unsure" }] }]).rows[0].choice).toBe("unsure");
  });
});
