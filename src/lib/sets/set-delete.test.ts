import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLEAR_PHOTO_SOURCE } from "./photo";

// Deleting a set empties it of the person's words and the set itself
// (actions.ts deleteSet). Columns added after the delete was written — the
// Build editor's working copy, the film with its beats' words, the rig —
// stayed behind on the row, and the set's shot records (each still's words,
// what each take was made from) stayed with it (2026-09-16). Read as source:
// a "use server" module does not load here.

const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
const del = actions.slice(actions.indexOf("export async function deleteSet("), actions.indexOf("\n}\n", actions.indexOf("export async function deleteSet(")));

/** The keys of an object literal written in the source, from its opening brace. */
function literalKeys(source: string, from: number): string[] {
  const open = source.indexOf("{", from);
  let depth = 0;
  let close = open;
  for (; close < source.length; close++) {
    if (source[close] === "{") depth++;
    else if (source[close] === "}" && --depth === 0) break;
  }
  const body = source.slice(open + 1, close).replace(/\/\/[^\n]*/g, "");
  return [...body.matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
}

describe("deleting a set", () => {
  it("clears every column the database has for a set, but the ones kept as a record", () => {
    // The columns production has (scripts/verify-db.mjs, the manifest checked against the live database).
    const manifest = readFileSync(join(__dirname, "../../../scripts/verify-db.mjs"), "utf8");
    const list = manifest.slice(manifest.indexOf("location_sets: ["), manifest.indexOf("],", manifest.indexOf("location_sets: [")));
    const columns = [...list.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(columns.length).toBeGreaterThan(15);

    const main = literalKeys(del, del.indexOf(".update({"));
    const work = literalKeys(actions, actions.indexOf("const CLEAR_SET_WORK = "));
    // The clip's reading (astra-recce.sql) is cleared through recce-store.ts,
    // the one module that names its column, in a write of its own (2026-09-17).
    const store = readFileSync(join(__dirname, "recce-store.ts"), "utf8");
    const recce = literalKeys(store, store.indexOf(".update({", store.indexOf("export async function clearSetRecce(")));
    expect(recce).toEqual(["recce_read"]);
    expect(del).toContain("await clearSetRecce(admin, setId, userId);");
    const cleared = new Set([...main, ...Object.keys(CLEAR_PHOTO_SOURCE), ...work, ...recce]);
    // Kept on purpose: whose it was, and the build's own bookkeeping — the
    // monthly cap counts a deleted build that did not fail, and what it cost
    // stays on the record. None of it is the person's words or the set.
    const kept = ["user_id", "status", "attempts", "failure", "cost_usd"];
    expect([...columns].sort()).toEqual([...new Set([...cleared, ...kept])].sort());
    expect(work).toEqual(["edited_spec", "film", "rig"]);
  });

  it("clears them, and removes the set's shot records, only once the set is marked gone, for this person's set", () => {
    const gone = del.indexOf("if (!gone?.length) continue;");
    const clear = del.indexOf(".update(CLEAR_SET_WORK)");
    const shots = del.indexOf('.from("location_set_shots").delete().eq("set_id", setId).eq("user_id", userId);');
    expect(gone).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(gone);
    expect(shots).toBeGreaterThan(gone);
    expect(del.slice(clear, del.indexOf(";", clear))).toContain('.eq("user_id", userId)');
    // A failure is said, and the delete stands.
    expect(del.slice(shots, del.indexOf("return { error: null };", shots))).not.toMatch(/return \{ error: /);
  });

  it("removes the set's presses with it, once the set is marked gone (press.ts, 2026-09-25)", () => {
    // A press's stored answer can quote the person's words (a brand rule's block).
    const gone = del.indexOf("if (!gone?.length) continue;");
    const presses = del.indexOf("await clearSetPresses(admin, setId, userId);");
    expect(presses).toBeGreaterThan(gone);
    expect(gone).toBeGreaterThan(-1);
  });

  it("leaves the stills and takes to History", () => {
    expect(del).not.toMatch(/\.from\("generations"\)/);
  });
});
