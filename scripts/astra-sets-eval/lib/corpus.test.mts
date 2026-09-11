import { describe, expect, it } from "vitest";
import { canarySha, validateCorpus } from "./corpus.mts";

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
