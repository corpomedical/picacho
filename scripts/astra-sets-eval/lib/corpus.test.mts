import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canarySha, cleanNotes, isCalendarDate, loadCorpus, MATCH_PEOPLE_AUDIENCE, MATCH_PHOTO_RECIPIENTS, PEOPLE_PHOTO_RECIPIENTS, validateCorpus } from "./corpus.mts";
import { EVAL_DIR, REPO_ROOT } from "./util.mts";

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

  it("baselines carry each render's first attempt score: a row that still says scores (match_score, the better of two) is refused", () => {
    const row = { characterId: "char-a", engine: "gpt-image", source: "q", readOn: "2026-09-11" };
    const ok = validateCorpus({ corpus: meta, briefs: briefs(10), baselines: { identity: [{ ...row, firstAttemptScores: [80, 64] }] } }, spend);
    expect(ok.problems).toEqual([]);
    expect(ok.data.baselines?.identity[0].firstAttemptScores).toEqual([80, 64]);
    const old = validateCorpus({ corpus: meta, briefs: briefs(10), baselines: { identity: [{ ...row, scores: [80, 64] }] } }, spend);
    expect(old.problems.join(" ")).toMatch(/"scores" is now "firstAttemptScores".*not match_score/);
    expect(old.data.baselines?.identity).toEqual([]);
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
    const placeholderDate = [chars[0], { ...chars[1], consent: { kind: "real-person", confirmedBy: "AK", confirmedOn: "0000-00-00" } }];
    expect(validateCorpus({ corpus: meta, characters: placeholderDate }, { ...spend, needs: { characters: true } }).problems.join(" ")).toMatch(/confirmedOn 0000-00-00 is not a date/);
  });

  it("a FORMAT ONLY placeholder left anywhere in a row makes it a template row, a nested consent record included", () => {
    const needs = { ...spend, needs: { characters: true } };
    const leftInTraits = [chars[0], { ...chars[1], traits: { hair: "<<FORMAT ONLY — the saved trait>>" } }];
    const r = validateCorpus({ corpus: meta, characters: leftInTraits }, needs);
    expect(r.template).toBe(true);
    expect(r.problems.join(" ")).toMatch(/characters\[1\]: a FORMAT-ONLY template row cannot be spent on/);
  });

  it("a real date is a day that exists", () => {
    expect(isCalendarDate("2026-09-12")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    for (const d of ["0000-00-00", "2026-02-30", "2026-13-01", "2026-9-12", "1899-12-31"]) expect(isCalendarDate(d)).toBe(false);
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
// it may be sent to OpenAI and Anthropic).
const locations = (perCategory: number[]) =>
  ["interior", "exterior", "stylised"].flatMap((category, c) =>
    Array.from({ length: perCategory[c] }, (_, i) => ({ id: `ph-${category.slice(0, 3)}-${i}`, category, file: `location-photos/${category}-${i}.jpg`, licence: "my own photo" })),
  );
const covers = ["OpenAI", "Anthropic"];
const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `pp-${i}`, file: `people-photos/p-${i}.jpg`, licence: "my own photo", consent: { kind: i % 2 ? "consented" : "ai-generated", covers, confirmedBy: "writer-7", confirmedOn: "2026-09-12" } }));

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
    expect(one({ kind: "ai-generated", covers, confirmedBy: "w7" }).problems).toEqual([]);
    expect(one({ kind: "consented", covers, confirmedBy: "w7" }).problems.join(" ")).toMatch(/confirmedOn/);
    expect(one({ kind: "scraped", covers, confirmedBy: "w7" }).problems.join(" ")).toMatch(/ai-generated or consented/);
    expect(one({ kind: "ai-generated", covers }).problems.join(" ")).toMatch(/confirmedBy/);
    expect(one(undefined).ok).toBe(false);
    // A date that is no day: the template's placeholder kept, or a slip.
    expect(one({ kind: "consented", covers, confirmedBy: "w7", confirmedOn: "0000-00-00" }).problems.join(" ")).toMatch(/confirmedOn 0000-00-00 is not a date/);
    expect(one({ kind: "consented", covers, confirmedBy: "w7", confirmedOn: "2026-02-30" }).ok).toBe(false);
    expect(one({ kind: "ai-generated", covers, confirmedBy: "w7", confirmedOn: "0000-00-00" }).ok).toBe(false);
  });

  it("wants the consent to cover everyone the photo is sent to: OpenAI and Anthropic", () => {
    const one = (c: unknown) => validateCorpus({ corpus: meta, peoplePhotos: [...people(9), { id: "pp-x", file: "people-photos/x.jpg", licence: "mine", consent: { kind: "consented", covers: c, confirmedBy: "w7", confirmedOn: "2026-09-12" } }] }, spendOn("peoplePhotos"));
    expect(one(["OpenAI", "Anthropic"]).problems).toEqual([]);
    expect(one([" openai", "ANTHROPIC "]).problems).toEqual([]);
    expect(one(["OpenAI"]).problems.join(" ")).toMatch(/peoplePhotos\[9\]: consent.covers must name OpenAI and Anthropic.*\(missing: Anthropic\)/);
    expect(one(undefined).problems.join(" ")).toMatch(/missing: OpenAI, Anthropic/);
    expect(one("OpenAI and Anthropic").ok).toBe(false);
  });

  it("the recipients are the hosts the product's photo readers call: a new one fails here until the consent names it", () => {
    const owner: Record<string, string> = { "api.openai.com": "OpenAI", "api.anthropic.com": "Anthropic" };
    const hosts = new Set<string>();
    // The build (providers/astra.ts) and the picture check's readers (output-policy.ts).
    for (const f of ["src/lib/generations/providers/astra.ts", "src/lib/generations/output-policy.ts"]) {
      for (const m of readFileSync(join(REPO_ROOT, f), "utf8").matchAll(/https:\/\/([a-z0-9.-]+)/g)) hosts.add(m[1]);
    }
    expect([...hosts].filter((h) => !(h in owner))).toEqual([]);
    expect([...new Set([...hosts].map((h) => owner[h]))].sort()).toEqual([...PEOPLE_PHOTO_RECIPIENTS].sort());
  });

  it("the shipped template row stays a template row with only its _template line deleted: its consent placeholders are caught", () => {
    const [shipped] = JSON.parse(readFileSync(join(EVAL_DIR, "corpus-template/people-photos.json"), "utf8")) as Record<string, unknown>[];
    const { _template, ...row } = shipped;
    expect(_template).toBe(true);
    const filled = (consent: Record<string, unknown>, i: number) => ({ ...row, id: `pp-t${i}`, file: `people-photos/t-${i}.jpg`, licence: "generated for the test", consent });
    const shippedConsent = row.consent as Record<string, unknown>;
    // Everything filled but the consent block.
    const asShipped = validateCorpus({ corpus: meta, peoplePhotos: Array.from({ length: 10 }, (_, i) => filled(shippedConsent, i)) }, spendOn("peoplePhotos"));
    expect(asShipped.ok).toBe(false);
    expect(asShipped.template).toBe(true);
    expect(asShipped.problems.join(" ")).toMatch(/peoplePhotos\[0\]: a FORMAT-ONLY template row cannot be spent on/);
    // The pseudonym filled, the placeholder date and covers kept, the kind switched to consented.
    const halfFilled = { ...shippedConsent, kind: "consented", confirmedBy: "writer-7" };
    const half = validateCorpus({ corpus: meta, peoplePhotos: Array.from({ length: 10 }, (_, i) => filled(halfFilled, i)) }, spendOn("peoplePhotos"));
    expect(half.ok).toBe(false);
    expect(half.problems.join(" ")).toMatch(/FORMAT-ONLY template row/);
    // Fully filled, it is a real row.
    const done = { kind: "consented", covers, confirmedBy: "writer-7", confirmedOn: "2026-09-12" };
    expect(validateCorpus({ corpus: meta, peoplePhotos: Array.from({ length: 10 }, (_, i) => filled(done, i)) }, spendOn("peoplePhotos")).problems).toEqual([]);
  });

  it("refuses a template photo row for spend, and allows it in a dry run", () => {
    const rows = [...locations([7, 7, 5]), { _template: true, id: "ph-t", category: "stylised", file: "location-photos/t.jpg", licence: "<<FORMAT ONLY — x>>" }];
    expect(validateCorpus({ corpus: meta, locationPhotos: rows }, spendOn("locationPhotos")).problems.join(" ")).toMatch(/FORMAT-ONLY template row/);
    expect(validateCorpus({ corpus: meta, locationPhotos: rows }, { spend: false, allowPartial: false, needs: { locationPhotos: true } }).ok).toBe(true);
  });
});

// Part E's reference photos: every one goes through the picture check
// (OpenAI and Anthropic) and to both builders (OpenAI).
const matches = (n: number, over: (i: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ id: `mt-${i}`, file: `match-photos/m-${i}.jpg`, licence: "my own photo", containsPeople: false, ...over(i) }));

describe("match rows", () => {
  const spendOn = { spend: true, allowPartial: false, needs: { match: true } };

  it("accepts 30 reference photos, with or without their EXIF, and wants 30 for spend", () => {
    const r = validateCorpus({ corpus: meta, match: matches(30, (i) => (i % 2 ? { exif: { focal35mm: 26, focalMm: 5.7 } } : {})) }, spendOn);
    expect(r.problems).toEqual([]);
    // Left out, the orientation is the file's: only a stated one is held against it.
    expect(r.data.match[1].exif).toEqual({ focal35mm: 26, focalMm: 5.7, orientation: null });
    expect(r.data.match[0]).toMatchObject({ exif: null, consent: null, containsPeople: false });
    expect(validateCorpus({ corpus: meta, match: matches(29) }, spendOn).problems.join(" ")).toMatch(/match: 29 rows; the eval asks for 30/);
    expect(validateCorpus({ corpus: meta, match: matches(29) }, { ...spendOn, allowPartial: true }).ok).toBe(true);
  });

  it("checks the exif, the licence and containsPeople", () => {
    const one = (over: Record<string, unknown>) => validateCorpus({ corpus: meta, match: [...matches(29), { id: "mt-x", file: "match-photos/x.jpg", licence: "mine", containsPeople: false, ...over }] }, spendOn);
    expect(one({ exif: { focal35mm: 26, focalMm: null, orientation: 6 } }).problems).toEqual([]);
    expect(one({ exif: { focal35mm: 26, orientation: 9 } }).problems.join(" ")).toMatch(/exif is null or/);
    expect(one({ exif: { focal35mm: -1 } }).problems.join(" ")).toMatch(/exif is null or/);
    expect(one({ licence: "" }).problems.join(" ")).toMatch(/licence is required .*OpenAI and Anthropic/);
    expect(one({ containsPeople: "no" }).problems.join(" ")).toMatch(/containsPeople must be true or false/);
    expect(one({ file: "match-photos/x.heic" }).problems.join(" ")).toMatch(/HEIC is refused/);
  });

  it("a photo with people needs everyone's consent, or AI-generated people, covering OpenAI, Anthropic and the raters", () => {
    const one = (consent: unknown) => validateCorpus({ corpus: meta, match: [...matches(29), { id: "mt-x", file: "match-photos/x.jpg", licence: "mine", containsPeople: true, consent }] }, spendOn);
    const seen = ["OpenAI", "Anthropic", "raters"];
    const r = one({ kind: "consented", covers: seen, confirmedBy: "w7", confirmedOn: "2026-09-12" });
    expect(r.problems).toEqual([]);
    expect(r.data.match[29].consent).toEqual({ kind: "consented", covers: seen, confirmedBy: "w7", confirmedOn: "2026-09-12" });
    expect(one({ kind: "ai-generated", covers: seen, confirmedBy: "w7" }).problems).toEqual([]);
    expect(one(undefined).problems.join(" ")).toMatch(/match\[29\]: consent.kind must be ai-generated or consented/);
    expect(one({ kind: "consented", covers: seen, confirmedBy: "w7" }).problems.join(" ")).toMatch(/match\[29\]: consented people need consent.confirmedOn/);
    expect(one({ kind: "ai-generated", covers: ["OpenAI", "raters"], confirmedBy: "w7" }).problems.join(" ")).toMatch(/match\[29\]: consent.covers must name OpenAI, Anthropic and raters.*\(missing: Anthropic\)/);
    // The companies alone are not enough: every E sheet shows the photo to both raters.
    expect(one({ kind: "consented", covers, confirmedBy: "w7", confirmedOn: "2026-09-12" }).problems.join(" ")).toMatch(/match\[29\]: consent.covers must name OpenAI, Anthropic and raters, everyone who sees the photo \(missing: raters\)/);
    expect(MATCH_PHOTO_RECIPIENTS).toEqual(PEOPLE_PHOTO_RECIPIENTS);
    expect(MATCH_PEOPLE_AUDIENCE).toEqual([...PEOPLE_PHOTO_RECIPIENTS, "raters"]);
  });

  it("the shipped template's match row with people stays a template row, its covers placeholder naming the raters", () => {
    const shipped = (JSON.parse(readFileSync(join(EVAL_DIR, "corpus-template/match.json"), "utf8")) as Record<string, unknown>[]).find((r) => r.containsPeople === true) as Record<string, unknown>;
    expect(JSON.stringify(shipped.consent)).toMatch(/OpenAI, Anthropic and raters/);
    const { _template, ...row } = shipped;
    expect(_template).toBe(true);
    const r = validateCorpus({ corpus: meta, match: [...matches(29), { ...row, id: "mt-t", file: "match-photos/t.jpg", licence: "generated for the test" }] }, spendOn);
    expect(r.problems.join(" ")).toMatch(/match\[29\]: a FORMAT-ONLY template row cannot be spent on/);
  });

  it("no picture serves two rows, across match.json and the other photo files", () => {
    const r = validateCorpus({ corpus: meta, match: matches(30), locationPhotos: [{ id: "ph-a", category: "interior", file: "match-photos/m-3.jpg", licence: "mine" }] }, spendOn);
    expect(r.problems.join(" ")).toMatch(/locationPhotos\[0\]: match-photos\/m-3.jpg is already mt-3's photo/);
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
    const dryRun = loadCorpus(tpl, { spend: false, allowPartial: false, needs: { locationPhotos: true, peoplePhotos: true, match: true } });
    expect(dryRun.ok).toBe(true);
    expect(dryRun.template).toBe(true);
    expect(dryRun.data.locationPhotos.length).toBeGreaterThan(0);
    expect(dryRun.data.peoplePhotos.length).toBeGreaterThan(0);
    // E's reference photos: one with its lens in match.json, one with people and the lens in its own EXIF.
    expect(dryRun.data.match.map((m) => [m.containsPeople, m.exif === null])).toEqual([
      [false, false],
      [true, true],
    ]);
    expect(Object.keys(dryRun.hashes).filter((k) => k.startsWith("photo:match-photos/"))).toHaveLength(2);
    expect(dryRun.warnings.join(" ")).not.toMatch(/is missing/);
    expect(loadCorpus(tpl, { spend: true, allowPartial: true, needs: { locationPhotos: true } }).problems.join(" ")).toMatch(/FORMAT-ONLY/);
    expect(loadCorpus(tpl, { spend: true, allowPartial: true, needs: { match: true } }).problems.join(" ")).toMatch(/match\[0\]: a FORMAT-ONLY template row cannot be spent on/);
  });
});
