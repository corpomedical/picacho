import { describe, expect, it } from "vitest";
import { SET_EDITOR_INSTRUCTIONS, SET_EDIT_MEANING_MAX_CHARS, editFrameLine, editFrameOf, editMeaningOf, setEditInput, setEditRequest } from "./set-edit-prompt";
import { SET_BRAND_RULE, SET_BUILDER_INSTRUCTIONS, SET_SPEC_JSON_SCHEMA, SET_SPEC_SCHEMA_NAME } from "./set-builder-prompt";
import { SET_BUILD_EFFORT, SET_BUILD_MAX_OUTPUT_TOKENS } from "./set-config";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import raceTrackFixture from "./fixtures-race-track.json";
import { withMaterials } from "./stage-materials";

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
    // The set goes as data, with the material words the stage draws it with (withMaterials).
    expect(input).toContain(JSON.stringify(withMaterials(s)));
    expect(input.indexOf(JSON.stringify(withMaterials(s)))).toBeLessThan(input.indexOf("make the box blue"));
  });

  it("tells the model to return the full revised JSON, never a diff", () => {
    expect(SET_EDITOR_INSTRUCTIONS).toContain("FULL revised location");
    expect(SET_EDITOR_INSTRUCTIONS).toContain("Change only what the request asks for");
  });

  // Helios Cut 4, step A8 (2026-09-26): the builder's own brand rule, the
  // same bytes, so an edit never writes a brand into the description every
  // still reads. 1,127 → 1,256 characters; the Astra-edit ceiling moves with
  // it (lib/astra/prices.test.ts).
  it("carries the builder's brand rule, word for word", () => {
    const rule = "No brand names, logos, readable text or real trademarks anywhere, including the title and description. Signs are blank shapes.";
    expect(SET_BRAND_RULE).toBe(rule);
    expect(SET_BUILDER_INSTRUCTIONS).toContain(`\n- ${rule}\n`);
    expect(SET_EDITOR_INSTRUCTIONS).toContain(`\n- ${rule}\n- Update the description only if the change makes it wrong`);
    expect(SET_EDITOR_INSTRUCTIONS.length).toBe(1256);
  });
});

// Names on things (Helios Cut 4, step B1, 2026-09-26): the whole-set edit
// never carries them, so its worst case and its 16,000 characters don't
// move; editSetWithAstra carries them back (editor-actions.test.ts).
describe("a named set", () => {
  it("sends exactly the bytes of its unnamed twin", () => {
    const n = normaliseSetSpec(raceTrackFixture);
    if (!n.ok) throw new Error("fixture");
    const named: SetSpec = { ...n.spec, objects: n.spec.objects.map((o, i) => ({ ...o, name: `block ${i}` })) };
    expect(setEditInput(named, "make the car blue")).toBe(setEditInput(n.spec, "make the car blue"));
    expect(JSON.stringify(setEditRequest(named, "make the car blue", "safety"))).toBe(JSON.stringify(setEditRequest(n.spec, "make the car blue", "safety")));
    expect(setEditInput(named, "make the car blue")).not.toContain('"name"');
  });
});

describe("a set from before the material words", () => {
  it("is handed to the edit with the words the stage draws it with", () => {
    const r = normaliseSetSpec(raceTrackFixture);
    if (!r.ok) throw new Error("fixture");
    expect(r.spec.objects.every((o) => o.material === null)).toBe(true);
    const input = setEditInput(r.spec, "paint the car blue");
    const sent = JSON.parse(input.slice("The current set:\n".length, input.indexOf("\n\nThe change request:")));
    expect(sent.objects).toHaveLength(r.spec.objects.length);
    for (const o of sent.objects) expect(typeof o.material).toBe("string");
    expect(sent.ground.material).toBe("asphalt");
    expect(input.endsWith("\n\nThe change request:\npaint the car blue")).toBe(true);
  });
});

// What the set's chat adds (Helios Cut 2, step 10, 2026-09-25 — operator:
// "Run, keep going."): the reader's meaning and where the person stands.
// Without them the request is what it was, to the byte.
describe("the chat's meaning and frame", () => {
  const frame = { mark: { x: 1.5, z: -2, facingDeg: 270 }, camera: { position: [3, 1.45, 4] as [number, number, number], target: [1.5, 1, -2] as [number, number, number] } };

  it("changes nothing without them: the input and the whole request are today's, byte for byte", () => {
    const s = spec();
    const today = `The current set:\n${JSON.stringify(withMaterials(s))}\n\nThe change request:\nmake the box blue`;
    expect(setEditInput(s, "make the box blue")).toBe(today);
    expect(setEditInput(s, "make the box blue", {})).toBe(today);
    expect(setEditInput(s, "make the box blue", { meaning: "" })).toBe(today);
    expect(setEditRequest(s, "make the box blue", "sha", undefined)).toEqual(setEditRequest(s, "make the box blue", "sha"));
    expect(setEditRequest(s, "make the box blue", "sha").input).toBe(today);
  });

  it("puts the meaning after the request, labelled as the page's reading, then the frame", () => {
    const input = setEditInput(spec(), "make it pop", { meaning: "make the box a brighter red", frame });
    expect(input.endsWith(
      "\n\nThe change request:\nmake it pop\n\n" +
        "What they mean, as read by the page (not their words): make the box a brighter red\n" +
        "Where the person stands now (never add a person): x 1.5, z -2, facing 270°. The camera now: (3, 1.45, 4) → (1.5, 1, -2).",
    )).toBe(true);
    expect(setEditRequest(spec(), "make it pop", "sha", { frame }).input).toContain(editFrameLine(frame));
  });

  it("holds a frame to the set: numbers only, the figure on the set, the camera where a set's camera may stand", () => {
    const s = spec();
    expect(editFrameOf(frame, s)).toEqual(frame);
    expect(editFrameOf({ mark: { x: 1.23456, z: 0.004, facingDeg: -90 }, camera: null }, s)).toEqual({ mark: { x: 1.23, z: 0, facingDeg: 270 }, camera: null });
    for (const bad of [null, "x", [], {}, { mark: { x: "1", z: 0, facingDeg: 0 } }, { mark: { x: Infinity, z: 0, facingDeg: 0 } }, { mark: { x: 11, z: 0, facingDeg: 0 } }]) {
      expect(editFrameOf(bad, s), JSON.stringify(bad)).toBeNull();
    }
    const camera = (position: unknown, target: unknown = [0, 1, 0]) => editFrameOf({ mark: frame.mark, camera: { position, target } }, s)?.camera ?? null;
    expect(camera([0, 1.5, 6])).toEqual({ position: [0, 1.5, 6], target: [0, 1, 0] });
    expect(camera([0, 17, 6])).toBeNull(); // above twice the set's 8 m
    expect(camera([0, -1, 6])).toBeNull(); // under the ground
    expect(camera([25, 1.5, 0])).toBeNull(); // past the footprint and its 10 m
    expect(camera([0, 1.5, 6], [0, 1, 999])).toBeNull();
    expect(camera([0, 1, 0], [0, 1, 0])).toBeNull(); // looking at itself
    expect(camera([0, 1.5])).toBeNull();
  });

  it("holds the meaning to its cap, and anything but words to nothing", () => {
    expect(editMeaningOf("  a  red   car ")).toBe("a red car");
    expect(Array.from(editMeaningOf("x ".repeat(400))).length).toBeLessThanOrEqual(SET_EDIT_MEANING_MAX_CHARS);
    expect(editMeaningOf(42)).toBe("");
    expect(editMeaningOf(undefined)).toBe("");
  });
});
