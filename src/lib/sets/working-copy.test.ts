import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The set the server holds a shot against is the set the page draws
// (found reviewing Helios, 2026-09-17). The Build editor saves a WORKING
// copy in `edited_spec`; the page draws `edited_spec ?? spec` (data.ts
// `drawn`) and the words reader reads the same. The shot's own server
// action read only `spec`, so after a hand edit or an Astra change the
// sketch showed one set while the words, the mark, the eye-line, the rack
// and the look's boxes were held against another — the description of a
// car that had been removed, a mark cleared against objects that had
// moved, an eye-line on a thing that only exists in the copy.
//
// Read as source: these are "use server" modules, which cannot load here.

const read = (name: string) => readFileSync(join(__dirname, name), "utf8");

/** The body of a function, from its signature to the next top-level close. */
function bodyOf(source: string, signature: string): string {
  const at = source.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", at);
  return source.slice(at, end === -1 ? undefined : end);
}

describe("the set a shot is held against", () => {
  it("actions.ts reads the working copy, defensively, and prefers it", () => {
    const body = bodyOf(read("actions.ts"), "async function readyOwnedSpec(");
    expect(body).toContain('.select("edited_spec")');
    // Its own read, so a column that is not there yet cannot break the shot.
    expect(body.indexOf('.select("status, spec")')).toBeLessThan(body.indexOf('.select("edited_spec")'));
    expect(body).toContain("if (edited.ok) return { error: null, spec: edited.spec };");
    // The owner's own row, live, in both reads.
    expect(body.match(/\.eq\("user_id", userId\)/g)).toHaveLength(2);
    expect(body.match(/\.is\("deleted_at", null\)/g)).toHaveLength(2);
  });

  it("the words reader reads it the same way", () => {
    const body = bodyOf(read("words-actions.ts"), "async function readyOwnedSpec(");
    expect(body).toContain('.select("edited_spec")');
    expect(body).toContain("if (edited.ok) return { error: null, spec: edited.spec };");
  });

  it("the page holds the layout, the shots and the look offer against the set it draws", () => {
    const data = read("data.ts");
    expect(data).toContain("const drawn = editedSpec ?? spec;");
    expect(data).toContain("const layout = drawn && row.layout ? normaliseSetLayout(row.layout, drawn) : null;");
    // The look offer: `spec` would offer a look cut from objects the editor has moved or removed.
    const lends = data.slice(data.indexOf("const lendsLook = (id: string)"), data.indexOf("const byId = new Map"));
    expect(lends).toContain("seesLookObjects(drawn, camera)");
    expect(lends).not.toContain("seesLookObjects(spec, camera)");
  });

  it("no Sets action holds a set against Astra's original while the page draws another", () => {
    // Every read of the set's spec in the actions goes through readyOwnedSpec
    // (or is the build's own write, which has no working copy yet).
    const actions = read("actions.ts");
    const reads = [...actions.matchAll(/\.select\("([^"]*spec[^"]*)"\)/g)].map((m) => m[1]);
    expect(reads).toEqual(["status, spec", "edited_spec"]);
  });
});
