import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canarySha, cleanNotes, loadCorpus, validateCorpus } from "./corpus.mts";
import { EVAL_DIR } from "./util.mts";

const meta = {
  corpusVersion: 1,
  writtenBy: "writer-7",
  writtenOn: "2026-09-12",
  blindAttestation: "I have not read the builder instructions, the set schema, the design doc or any prompt.",
  files: {},
};

const briefs = (n: number) =>
  ["interior", "exterior", "stylised"].flatMap((category, c) =>
    Array.from({ length: n }, (_, i) => ({ id: `${category.slice(0, 3)}-${i}`, category, brief: `A distinct place number ${c}-${i}, quiet and specific.` })),
  );

const chars = [
  { id: "char-a", name: "Ann", consent: { kind: "ai-persona", confirmedBy: "AK" }, identityPhoto: "characters/a.jpg", traits: { hair: "short" } },
  { id: "char-b", name: "Ben", consent: { kind: "real-person", confirmedBy: "AK", confirmedOn: "2026-09-12" }, identityPhoto: "characters/b.png", traits: {} },
];

const spend = { spend: true, allowPartial: false, needs: { briefs: true } };
const dry = { spend: false, allowPartial: false, needs: { briefs: true } };

describe("validateCorpus", () => {
  it("accepts a minimal valid corpus for spend", () => {
    const r = validateCorpus({ corpus: meta, briefs: briefs(10) }, spend);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.data.briefs).toHaveLength(30);
    expect(r.data.meta.attested).toBe(true);
  });

  it("allows template rows in a dry run and refuses them for spend", () => {
    const rows = [...briefs(10).slice(1), { _template: true, id: "int-x", category: "interior", brief: "<<FORMAT ONLY — NOT A BRIEF: one place>>" }];
    expect(validateCorpus({ corpus: meta, briefs: rows }, dry).ok).toBe(true);
    expect(validateCorpus({ corpus: meta, briefs: rows }, dry).template).toBe(true);
    const s = validateCorpus({ corpus: meta, briefs: rows }, spend);
    expect(s.ok).toBe(false);
    expect(s.problems.join(" ")).toMatch(/FORMAT-ONLY/);
  });

  it("wants 10/10/10 for spend unless partial is allowed", () => {
    expect(validateCorpus({ corpus: meta, briefs: briefs(9) }, spend).ok).toBe(false);
    expect(validateCorpus({ corpus: meta, briefs: briefs(9) }, { ...spend, allowPartial: true }).ok).toBe(true);
    expect(validateCorpus({ corpus: meta, briefs: briefs(9) }, dry).warnings.length).toBeGreaterThan(0);
  });

  it("rejects duplicate ids and normalised duplicate briefs", () => {
    const dupId = [...briefs(10), { id: "int-0", category: "interior", brief: "Another place entirely, by the sea." }];
    expect(validateCorpus({ corpus: meta, briefs: dupId }, spend).problems.join(" ")).toMatch(/duplicate id int-0/);
    const dupText = [...briefs(10), { id: "int-99", category: "interior", brief: "  a DISTINCT place number 0-0,   quiet and specific. " }];
    expect(validateCorpus({ corpus: meta, briefs: dupText }, spend).problems.join(" ")).toMatch(/repeats/);
  });

  it("applies the production clean-up limits", () => {
    const long = [...briefs(10), { id: "int-l", category: "interior", brief: "x".repeat(501) }];
    expect(validateCorpus({ corpus: meta, briefs: long }, spend).problems.join(" ")).toMatch(/longer than 500/);
    const short = [...briefs(10), { id: "int-s", category: "interior", brief: "  tiny​​​ " }];
    expect(validateCorpus({ corpus: meta, briefs: short }, spend).problems.join(" ")).toMatch(/under 8/);
  });

  it("requires consent, and a date for a real person", () => {
    const ok = validateCorpus({ corpus: meta, characters: chars }, { ...spend, needs: { characters: true } });
    expect(ok.problems).toEqual([]);
    const noDate = [chars[0], { ...chars[1], consent: { kind: "real-person", confirmedBy: "AK" } }];
    expect(validateCorpus({ corpus: meta, characters: noDate }, { ...spend, needs: { characters: true } }).problems.join(" ")).toMatch(/confirmedOn/);
    const heic = [chars[0], { ...chars[1], identityPhoto: "characters/b.heic" }];
    expect(validateCorpus({ corpus: meta, characters: heic }, { ...spend, needs: { characters: true } }).problems.join(" ")).toMatch(/HEIC/);
    const escape = [chars[0], { ...chars[1], identityPhoto: "../secret.jpg" }];
    expect(validateCorpus({ corpus: meta, characters: escape }, { ...spend, needs: { characters: true } }).ok).toBe(false);
  });

  it("checks directions", () => {
    const needs = { ...spend, needs: { directions: true } };
    expect(validateCorpus({ corpus: meta, directions: ["looks up", "turns", "waves"] }, needs).ok).toBe(true);
    expect(validateCorpus({ corpus: meta, directions: ["looks up", "turns"] }, needs).ok).toBe(false);
    expect(validateCorpus({ corpus: meta, directions: ["looks up", "turns", "x".repeat(301)] }, needs).ok).toBe(false);
  });

  it("refuses a missing attestation for spend and warns in a dry run", () => {
    const noAtt = { ...meta, blindAttestation: "" };
    expect(validateCorpus({ corpus: noAtt, briefs: briefs(10) }, spend).problems.join(" ")).toMatch(/blindAttestation/);
    expect(validateCorpus({ corpus: noAtt, briefs: briefs(10) }, dry).ok).toBe(true);
  });

  it("hashes are stable under key reordering", () => {
    const a = validateCorpus({ corpus: meta, briefs: briefs(10) }, spend);
    const reordered = briefs(10).map((b) => ({ brief: b.brief, category: b.category, id: b.id }));
    const metaReordered = Object.fromEntries(Object.entries(meta).reverse());
    const b = validateCorpus({ corpus: metaReordered, briefs: reordered }, spend);
    expect(b.corpusHash).toBe(a.corpusHash);
    expect(canarySha([{ id: "c1", brief: "x", template: false }])).toBe(canarySha([{ id: "c1", brief: "x", template: true }]));
  });

  it("treats a failing adversarial brief as a test case, not a corpus error", () => {
    const adv = [{ id: "adv-1", category: "violence", harmful: true, brief: "x".repeat(600) }];
    const r = validateCorpus({ corpus: meta, adversarial: adv }, { spend: false, allowPartial: false, needs: { adversarial: true } });
    expect(r.problems).toEqual([]);
    expect(r.data.adversarial[0].brief).toHaveLength(600);
  });
});

// The photo arm's two files: A/B's people-free location photos (20, at
// least 5 of each category) and D's photos with people (10, each with how
// it may be sent to OpenAI).
const locations = (perCategory: number[]) =>
  ["interior", "exterior", "stylised"].flatMap((category, c) =>
    Array.from({ length: perCategory[c] }, (_, i) => ({ id: `ph-${category.slice(0, 3)}-${i}`, category, file: `location-photos/${category}-${i}.jpg`, licence: "my own photo" })),
  );
const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `pp-${i}`, file: `people-photos/p-${i}.jpg`, licence: "my own photo", consent: { kind: i % 2 ? "consented" : "ai-generated", confirmedBy: "writer-7", confirmedOn: "2026-09-12" } }));

describe("photo rows", () => {
  const spendOn = (key: "locationPhotos" | "peoplePhotos") => ({ spend: true, allowPartial: false, needs: { [key]: true } });

  it("accepts 20 location photos, at least 5 of each category, and 10 photos with people", () => {
    const a = validateCorpus({ corpus: meta, locationPhotos: locations([7, 7, 6]) }, spendOn("locationPhotos"));
    expect(a.problems).toEqual([]);
    expect(a.data.locationPhotos).toHaveLength(20);
    expect(a.data.locationPhotos[0]).toMatchObject({ category: "interior", notes: "", template: false });
    const d = validateCorpus({ corpus: meta, peoplePhotos: people(10) }, spendOn("peoplePhotos"));
    expect(d.problems).toEqual([]);
    expect(d.data.peoplePhotos.map((p) => p.consent.kind)).toContain("consented");
  });

  it("wants the counts for spend: 20 with 5 of each category, and 10", () => {
    expect(validateCorpus({ corpus: meta, locationPhotos: locations([8, 8, 4]) }, spendOn("locationPhotos")).problems.join(" ")).toMatch(/at least 5 of each category \(short: stylised\)/);
    expect(validateCorpus({ corpus: meta, locationPhotos: locations([7, 7, 5]) }, spendOn("locationPhotos")).ok).toBe(false);
    expect(validateCorpus({ corpus: meta, peoplePhotos: people(9) }, spendOn("peoplePhotos")).ok).toBe(false);
    expect(validateCorpus({ corpus: meta, peoplePhotos: people(9) }, { ...spendOn("peoplePhotos"), allowPartial: true }).ok).toBe(true);
  });

  it("checks the file, the category, the licence and a picture used twice", () => {
    const bad = (over: Record<string, unknown>) => validateCorpus({ corpus: meta, locationPhotos: [...locations([7, 7, 5]), { id: "ph-x", category: "interior", file: "location-photos/x.jpg", licence: "mine", ...over }] }, spendOn("locationPhotos"));
    expect(bad({ file: "location-photos/x.heic" }).problems.join(" ")).toMatch(/HEIC is refused/);
    expect(bad({ file: "../outside.jpg" }).problems.join(" ")).toMatch(/relative path/);
    expect(bad({ category: "aerial" }).problems.join(" ")).toMatch(/category must be/);
    expect(bad({ licence: " " }).problems.join(" ")).toMatch(/licence is required/);
    expect(bad({ file: "location-photos/interior-0.jpg" }).problems.join(" ")).toMatch(/already ph-int-0's photo/);
    const across = validateCorpus({ corpus: meta, locationPhotos: locations([7, 7, 6]), peoplePhotos: [{ ...people(1)[0], file: "location-photos/interior-0.jpg" }] }, spendOn("peoplePhotos"));
    expect(across.problems.join(" ")).toMatch(/already ph-int-0's photo/);
  });

  it("cleans notes as the product does, and refuses notes the form would have cut", () => {
    expect(cleanNotes(undefined)).toEqual({ ok: true, notes: "" });
    // A zero-width space and runs of spaces flatten, as cleanText flattens them.
    expect(cleanNotes("  the other half​ of the room   is a bar ")).toEqual({ ok: true, notes: "the other half of the room is a bar" });
    // The reserved placeholder is never a note.
    expect(cleanNotes(" - ")).toEqual({ ok: true, notes: "" });
    expect(cleanNotes("x".repeat(300))).toMatchObject({ ok: true });
    expect(cleanNotes("x".repeat(301))).toEqual({ ok: false, why: "too_long" });
    expect(cleanNotes(42)).toEqual({ ok: false, why: "not_text" });
    const long = validateCorpus({ corpus: meta, locationPhotos: [{ ...locations([1, 0, 0])[0], notes: "y".repeat(301) }] }, { spend: false, allowPartial: false, needs: {} });
    expect(long.problems.join(" ")).toMatch(/notes longer than 300 characters/);
  });

  it("wants how a photo with people may be sent: consented (with a date) or AI-generated", () => {
    const one = (consent: unknown) => validateCorpus({ corpus: meta, peoplePhotos: [...people(9), { id: "pp-x", file: "people-photos/x.jpg", licence: "mine", consent }] }, spendOn("peoplePhotos"));
    expect(one({ kind: "ai-generated", confirmedBy: "w7" }).problems).toEqual([]);
    expect(one({ kind: "consented", confirmedBy: "w7" }).problems.join(" ")).toMatch(/confirmedOn/);
    expect(one({ kind: "scraped", confirmedBy: "w7" }).problems.join(" ")).toMatch(/ai-generated or consented/);
    expect(one({ kind: "ai-generated" }).problems.join(" ")).toMatch(/confirmedBy/);
    expect(one(undefined).ok).toBe(false);
  });

  it("refuses a template photo row for spend, and allows it in a dry run", () => {
    const rows = [...locations([7, 7, 5]), { _template: true, id: "ph-t", category: "stylised", file: "location-photos/t.jpg", licence: "<<FORMAT ONLY — x>>" }];
    expect(validateCorpus({ corpus: meta, locationPhotos: rows }, spendOn("locationPhotos")).problems.join(" ")).toMatch(/FORMAT-ONLY template row/);
    expect(validateCorpus({ corpus: meta, locationPhotos: rows }, { spend: false, allowPartial: false, needs: { locationPhotos: true } }).ok).toBe(true);
  });
});

describe("loadCorpus with photos", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "astra-corpus-"));
    mkdirSync(join(dir, "location-photos"));
    writeFileSync(join(dir, "corpus.json"), JSON.stringify({ ...meta, files: { locationPhotos: "location-photos.json" } }));
    writeFileSync(join(dir, "location-photos.json"), JSON.stringify(locations([7, 7, 6])));
    for (const p of locations([7, 7, 6])) writeFileSync(join(dir, p.file), `bytes of ${p.id}`);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const o = { spend: true, allowPartial: false, needs: { locationPhotos: true } };

  it("hashes every picture into the corpus hash: a changed photo is a changed corpus", () => {
    const before = loadCorpus(dir, o);
    expect(before.problems).toEqual([]);
    expect(Object.keys(before.hashes).filter((k) => k.startsWith("photo:"))).toHaveLength(20);
    writeFileSync(join(dir, "location-photos/interior-0.jpg"), "other bytes");
    expect(loadCorpus(dir, o).corpusHash).not.toBe(before.corpusHash);
  });

  it("a missing picture is a problem for a real run that needs it, a warning otherwise", () => {
    rmSync(join(dir, "location-photos/stylised-5.jpg"));
    expect(loadCorpus(dir, o).problems.join(" ")).toMatch(/ph-sty-5's photo location-photos\/stylised-5.jpg is missing/);
    const dry = loadCorpus(dir, { ...o, spend: false });
    expect(dry.ok).toBe(true);
    expect(dry.warnings.join(" ")).toMatch(/is missing/);
  });

  it("the template's photo files load for a dry run, and --spend refuses them", () => {
    const tpl = join(EVAL_DIR, "corpus-template");
    const dryRun = loadCorpus(tpl, { spend: false, allowPartial: false, needs: { locationPhotos: true, peoplePhotos: true } });
    expect(dryRun.ok).toBe(true);
    expect(dryRun.template).toBe(true);
    expect(dryRun.data.locationPhotos.length).toBeGreaterThan(0);
    expect(dryRun.data.peoplePhotos.length).toBeGreaterThan(0);
    expect(dryRun.warnings.join(" ")).not.toMatch(/is missing/);
    expect(loadCorpus(tpl, { spend: true, allowPartial: true, needs: { locationPhotos: true } }).problems.join(" ")).toMatch(/FORMAT-ONLY/);
  });
});
