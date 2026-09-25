import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import raceTrack from "./fixtures-race-track.json";
import { editTextOf, editUndoOf, heldTextOf, openEditSeal, readEditText, sealEditText, sealedEditText, type EditText } from "./edit-seal";
import { holdEditedText } from "./editor-model";
import { normaliseSetSpec, SET_LIMITS, type SetSpec } from "./set-spec";

// Undo that gives back Astra's words too (Helios Cut 2, step 2, 2026-09-25):
// the server seals the words of the copy it handed Astra, the page carries
// the seal, and Undo may put those words back only when the seal opens —
// for this set, this person and exactly these words. Stateless, like
// live/actions.ts's sealed directions.

const SET = "22222222-2222-4222-8222-222222222222";
const OTHER_SET = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "44444444-4444-4444-8444-444444444444";

const n = normaliseSetSpec(raceTrack);
if (!n.ok) throw new Error("fixture");
const SPEC: SetSpec = n.spec;

beforeEach(() => {
  vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only-signing-secret");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("a set's words", () => {
  it("are its title, its description and its labels, marks' then cameras', each sorted, none empty", () => {
    const spec: SetSpec = {
      ...SPEC,
      marks: SPEC.marks.map((m, i) => ({ ...m, label: ["Zebra", "", "Apron"][i % 3] })),
      cameras: SPEC.cameras.map((c, i) => ({ ...c, label: ["Wide", "Close"][i % 2] })),
    };
    const text = editTextOf(spec);
    expect(text.title).toBe(SPEC.title);
    expect(text.description).toBe(SPEC.description);
    const marks = spec.marks.map((m) => m.label).filter(Boolean).sort();
    const cams = spec.cameras.map((c) => c.label).filter(Boolean).sort();
    expect(text.labels).toEqual([...marks, ...cams]);
  });
});

describe("the seal", () => {
  const text = editTextOf(SPEC);

  it("opens for the words it sealed, for this set and this person", () => {
    const seal = sealEditText(SET, USER, text);
    expect(seal).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(openEditSeal(SET, USER, text, seal)).toBe(true);
    // Whatever order the page sends the keys in.
    expect(openEditSeal(SET, USER, { labels: text.labels, description: text.description, title: text.title }, seal)).toBe(true);
  });

  it("refuses a changed title, description or label, another set, another person, and any other seal", () => {
    const seal = sealEditText(SET, USER, text);
    expect(openEditSeal(SET, USER, { ...text, title: `${text.title}!` }, seal)).toBe(false);
    expect(openEditSeal(SET, USER, { ...text, description: "A beach at dawn." }, seal)).toBe(false);
    expect(openEditSeal(SET, USER, { ...text, labels: [...text.labels, "Pit wall"] }, seal)).toBe(false);
    // The labels' order is sealed too (the race track has several, all different).
    expect(new Set(text.labels).size).toBeGreaterThan(1);
    expect(openEditSeal(SET, USER, { ...text, labels: [...text.labels].reverse() }, seal)).toBe(false);
    expect(openEditSeal(OTHER_SET, USER, text, seal)).toBe(false);
    expect(openEditSeal(SET, OTHER_USER, text, seal)).toBe(false);
    for (const bad of [null, undefined, 42, "", "x".repeat(32), `${seal}x`, seal?.slice(1)]) {
      expect(openEditSeal(SET, USER, text, bad), String(bad)).toBe(false);
    }
  });

  it("refuses everything with no key, and seals nothing", () => {
    const seal = sealEditText(SET, USER, text);
    vi.stubEnv("MEDIA_SIGNING_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(sealEditText(SET, USER, text)).toBeNull();
    expect(editUndoOf(SET, USER, SPEC)).toBeNull();
    expect(openEditSeal(SET, USER, text, seal)).toBe(false);
  });

  it("falls back to the service key, as the app's other seals do", () => {
    vi.stubEnv("MEDIA_SIGNING_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const seal = sealEditText(SET, USER, text);
    expect(seal).not.toBeNull();
    expect(openEditSeal(SET, USER, text, seal)).toBe(true);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "another-key");
    expect(openEditSeal(SET, USER, text, seal)).toBe(false);
  });
});

describe("what a page sends back", () => {
  it("is read to a set's words' shape, or not at all", () => {
    const text = editTextOf(SPEC);
    expect(readEditText(text)).toEqual(text);
    for (const bad of [
      null,
      "text",
      [],
      { ...text, title: 3 },
      { ...text, description: null },
      { ...text, labels: "Starting grid" },
      { ...text, labels: [1] },
      { ...text, title: "t".repeat(SET_LIMITS.titleChars + 1) },
      { ...text, description: "d".repeat(SET_LIMITS.descriptionChars + 1) },
      { ...text, labels: ["l".repeat(SET_LIMITS.labelChars + 1)] },
      { ...text, labels: Array.from({ length: SET_LIMITS.maxMarks + SET_LIMITS.maxCameras + 1 }, () => "x") },
    ]) {
      expect(readEditText(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("gives back the words only when the seal opens over exactly them", () => {
    const undo = editUndoOf(SET, USER, SPEC);
    expect(undo).not.toBeNull();
    expect(sealedEditText(SET, USER, undo)).toEqual(editTextOf(SPEC));
    expect(sealedEditText(SET, OTHER_USER, undo)).toBeNull();
    expect(sealedEditText(SET, USER, { ...undo, text: { ...undo!.text, description: "Lined with flags." } })).toBeNull();
    expect(sealedEditText(SET, USER, { text: undo!.text })).toBeNull();
    expect(sealedEditText(SET, USER, null)).toBeNull();
    expect(sealedEditText(SET, USER, "seal")).toBeNull();
  });
});

describe("sealed words, held first", () => {
  it("bring back the title and the description, and the labels they carried", () => {
    const before: SetSpec = { ...SPEC, marks: SPEC.marks.map((m, i) => (i === 0 ? { ...m, label: "Old grid" } : m)) };
    const sealed: EditText = editTextOf(before);
    // Astra's copy, now on the server: new words, and the old label gone.
    const astra: SetSpec = {
      ...SPEC,
      title: "Flagged circuit",
      description: "A race track lined with flags.",
      marks: SPEC.marks.map((m, i) => (i === 0 ? { ...m, label: "Flag line" } : m)),
    };
    const held = holdEditedText(before, [heldTextOf(sealed), astra, SPEC]);
    expect(held.title).toBe(before.title);
    expect(held.description).toBe(before.description);
    expect(held.marks[0].label).toBe("Old grid");
    // Without them: the server's words, and a label no stored copy carried is dropped.
    const kept = holdEditedText(before, [astra, SPEC]);
    expect(kept.title).toBe("Flagged circuit");
    expect(kept.description).toBe("A race track lined with flags.");
    expect(kept.marks[0].label).toBe("");
  });
});
