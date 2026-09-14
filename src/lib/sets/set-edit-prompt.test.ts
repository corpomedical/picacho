import { describe, expect, it } from "vitest";
import { SET_EDITOR_INSTRUCTIONS, setEditInput, setEditRequest } from "./set-edit-prompt";
import { SET_SPEC_JSON_SCHEMA, SET_SPEC_SCHEMA_NAME } from "./set-builder-prompt";
import { SET_BUILD_EFFORT, SET_BUILD_MAX_OUTPUT_TOKENS } from "./set-config";
import { normaliseSetSpec, type SetSpec } from "./set-spec";

// The edit request is a build with the answer's shape already known: same
// strict schema, same caps, its own instructions. The test pins those parts,
// so a drive-by change to the request is a seen change.

const spec = (): SetSpec => {
  const n = normaliseSetSpec({
    title: "Yard",
    description: "A concrete yard.",
    bounds: { x: 20, z: 20, height: 8 },
    objects: [{ shape: "box", position: [0, 0.5, 0], size: [1, 1, 1], color: "#aa3322" }],
  });
  if (!n.ok) throw new Error("spec invalid");
  return n.spec;
};

describe("setEditRequest", () => {
  it("carries the build's schema and caps, and the editor's instructions", () => {
    const req = setEditRequest(spec(), "make the box blue", "sha-person");
    expect(req.schemaName).toBe(SET_SPEC_SCHEMA_NAME);
    expect(req.schema).toBe(SET_SPEC_JSON_SCHEMA);
    expect(req.maxOutputTokens).toBe(SET_BUILD_MAX_OUTPUT_TOKENS);
    expect(req.effort).toBe(SET_BUILD_EFFORT);
    expect(req.instructions).toBe(SET_EDITOR_INSTRUCTIONS);
    expect(req.safetyIdentifier).toBe("sha-person");
  });

  it("hands the model the working spec as data, then the request", () => {
    const s = spec();
    const input = setEditInput(s, "make the box blue");
    expect(input).toContain(JSON.stringify(s));
    expect(input.indexOf(JSON.stringify(s))).toBeLessThan(input.indexOf("make the box blue"));
  });

  it("tells the model to return the full revised JSON, never a diff", () => {
    expect(SET_EDITOR_INSTRUCTIONS).toContain("FULL revised location");
    expect(SET_EDITOR_INSTRUCTIONS).toContain("Change only what the request asks for");
  });
});
