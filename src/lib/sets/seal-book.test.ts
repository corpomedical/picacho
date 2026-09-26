import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import raceTrack from "./fixtures-race-track.json";
import { editUndoOf, openEditSeal, type EditUndo } from "./edit-seal";
import { editTextOf, patchObject } from "./editor-model";
import { fileSeal, sameWords, sealFor, wordsKey, type SealBook } from "./seal-book";
import { normaliseSetSpec, type SetSpec } from "./set-spec";

// The page's book of sealed words (Helios Cut 4, step A6, 2026-09-26): every
// seal the server hands is filed under the words it seals, and a save of a
// copy with those words sends it — so a step back in Build over an Astra
// change brings back the words it replaced. The page never makes or checks
// a seal; only the server can (edit-seal.ts).

const SET = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

const n = normaliseSetSpec(raceTrack);
if (!n.ok) throw new Error("fixture");
const SPEC: SetSpec = n.spec;
const FLAGGED: SetSpec = { ...SPEC, title: "Flagged circuit", description: "A race track lined with a row of flags along the pit wall." };

beforeEach(() => vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only-signing-secret"));
afterEach(() => vi.unstubAllEnvs());

describe("the page's seal book", () => {
  it("finds the server's seal for a copy by its words, whichever copy of them it holds", () => {
    const book: SealBook = new Map();
    const before = editUndoOf(SET, USER, SPEC)!;
    const after = editUndoOf(SET, USER, FLAGGED)!;
    fileSeal(book, before);
    fileSeal(book, after);
    expect(sealFor(book, SPEC)).toBe(before);
    expect(sealFor(book, FLAGGED)).toBe(after);
    // A hand edit moves and recolours, never writes: same words, same seal.
    const moved = patchObject(SPEC, 0, { color: "#123456" });
    if (!moved.ok) throw new Error("patch");
    const handMoved = moved.spec;
    expect(handMoved.objects[0].color).toBe("#123456");
    expect(sameWords(handMoved, SPEC)).toBe(true);
    expect(sealFor(book, handMoved)).toBe(before);
    // And what it finds opens on the server for exactly those words.
    const found = sealFor(book, handMoved)!;
    expect(openEditSeal(SET, USER, found.text, found.seal)).toBe(true);
    expect(found.text).toEqual(editTextOf(handMoved));
  });

  it("finds nothing for words the server never sealed", () => {
    const book: SealBook = new Map();
    fileSeal(book, editUndoOf(SET, USER, SPEC));
    expect(sealFor(book, FLAGGED)).toBeNull();
    // A label counts as words too.
    const relabelled: SetSpec = { ...SPEC, cameras: SPEC.cameras.map((c, i) => (i === 0 ? { ...c, label: "Pit exit" } : c)) };
    expect(sameWords(relabelled, SPEC)).toBe(false);
    expect(sealFor(book, relabelled)).toBeNull();
  });

  it("keys the words exactly as the server seals them: the same labels in any order of marks and cameras", () => {
    const shuffled: SetSpec = { ...SPEC, marks: [...SPEC.marks].reverse(), cameras: [...SPEC.cameras].reverse() };
    expect(wordsKey(shuffled)).toBe(wordsKey(SPEC));
    const book: SealBook = new Map();
    fileSeal(book, editUndoOf(SET, USER, SPEC));
    expect(sealFor(book, shuffled)).not.toBeNull();
  });

  it("files nothing for no seal, or anything that isn't one", () => {
    const book: SealBook = new Map();
    for (const bad of [null, undefined, { text: null, seal: "x" }, { text: { title: 1, description: "", labels: [] }, seal: "x" }, { text: editTextOf(SPEC) }]) {
      fileSeal(book, bad as unknown as EditUndo | null);
    }
    expect(book.size).toBe(0);
    // With no signing key the server hands none, and the book stays empty.
    vi.stubEnv("MEDIA_SIGNING_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    fileSeal(book, editUndoOf(SET, USER, SPEC));
    expect(book.size).toBe(0);
  });
});
