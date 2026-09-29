import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STUDIO_ADD_KINDS,
  STUDIO_ASTRA_INSTRUCTIONS,
  STUDIO_ASTRA_TOP_LINE,
  STUDIO_FORMATS,
  STUDIO_OPS,
  STUDIO_PLAN_JSON_SCHEMA,
  STUDIO_PLAN_MAX_STEPS,
  STUDIO_SUMMARY_MAX_CHARS,
  STUDIO_TURNS_MAX,
  besidePosition,
  boxesOverlap,
  clearNote,
  clearSpot,
  knownOf,
  normaliseStudioSummary,
  normaliseStudioTurns,
  parseStudioAnswer,
  planActs,
  sideDirection,
  sizeFactors,
  studioAstraRequest,
  toThreeAxes,
  toThreeSizes,
  validateStudioPlan,
  type StudioStep,
} from "./studio-astra";

/** A small scene as the engine sends it: a red car, the stand-in, the shot camera (selected). */
const SCENE = {
  frame: 1,
  hour: 12,
  sky: "simple",
  format: "16:9",
  lens: 35,
  camera: "o3",
  aim: null,
  range: [1, 241],
  objects: [
    { id: "o1", name: "Red sports car", kind: "mesh", at: [0, 0, 0], size: [4.4, 1.9, 1.3], turn: 0 },
    { id: "o2", name: "Person stand-in", kind: "mesh", at: [3, 1, 0], size: [0.5, 0.3, 1.8], turn: 90 },
    { id: "o3", name: "Shot camera", kind: "camera", at: [0, -9, 1.6], size: [0.3, 0.5, 0.3], turn: 0, sel: true },
  ],
};
const KNOWN = knownOf(normaliseStudioSummary(SCENE));

/** Every field the strict schema asks for, "" / null unless given. */
function step(fields: Record<string, unknown>) {
  return { say: "", op: "", targets: [], kind: "", name: "", mode: "", x: null, y: null, z: null, of: "", side: "", value: null, value2: null, color: "", metallic: null, roughness: null, emission: "", ...fields };
}
const answer = (steps: unknown[], more: Record<string, unknown> = {}) => ({ reply: "On it.", question: "", options: [], steps, ...more });

describe("the tool vocabulary", () => {
  it("is the Studio's own operations, and every add kind is an Add menu entry", () => {
    expect(STUDIO_OPS).toEqual(
      expect.arrayContaining(["select", "add", "delete", "duplicate", "move", "rotate", "scale", "color", "hide", "show", "rename", "parent", "key", "hour", "sky", "lens", "format", "aim", "array", "mirror", "physics", "simulate", "bake", "frame", "range"]),
    );
    expect(Object.values(STUDIO_ADD_KINDS).sort()).toEqual(["box", "car", "cone", "cyl", "empty", "ico", "lamp", "person", "plane", "point", "sphere", "spot", "torus"]);
    // Every op the schema allows is described to the model.
    for (const op of STUDIO_OPS) expect(STUDIO_ASTRA_INSTRUCTIONS.includes(`${op}:`) || STUDIO_ASTRA_INSTRUCTIONS.includes(`${op},`), op).toBe(true);
  });

  it("the schema is strict: every property required, nothing extra", () => {
    const check = (node: Record<string, unknown>) => {
      if (node.type !== "object") return;
      expect(node.additionalProperties).toBe(false);
      expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort());
      for (const child of Object.values(node.properties as Record<string, Record<string, unknown>>)) {
        check(child);
        if (child.type === "array") check(child.items as Record<string, unknown>);
      }
    };
    check(STUDIO_PLAN_JSON_SCHEMA as unknown as Record<string, unknown>);
  });

  it("the request rides the one Astra client's shape: low effort, the schema, the capped scene and the request last", () => {
    const summary = normaliseStudioSummary(SCENE);
    const req = studioAstraRequest("paint the car blue", summary, [{ who: "person", text: "hi" }], "safety");
    expect(req.effort).toBe("low");
    expect(req.schemaName).toBe("helios_studio_plan");
    expect(typeof req.input).toBe("string");
    const input = req.input as string;
    expect(input).toContain(JSON.stringify(summary));
    expect(input).toContain("Person: hi");
    expect(input.endsWith("paint the car blue")).toBe(true);
    expect(req.instructions).toContain("use Render");
    expect(STUDIO_ASTRA_TOP_LINE).toBe("Astra edits this 3D scene. To make a picture or video, use Render.");
  });
});

describe("checking her answer", () => {
  it("turns 'put a red lamp post left of the car and make it 4 m tall' into an add beside the car and a size", () => {
    const plan = validateStudioPlan(
      answer([
        step({ say: "Add a street lamp left of the car", op: "add", kind: "street_lamp", name: "Lamp post", of: "o1", side: "left", value: 1, color: "#C0282D" }),
        step({ say: "Make it 4 m tall", op: "size", targets: ["new:Lamp post"], z: 4 }),
      ]),
      KNOWN,
    );
    expect(plan.steps).toEqual<StudioStep[]>([
      { say: "Add a street lamp left of the car", op: "add", kind: "street_lamp", name: "Lamp post", at: null, place: { of: "o1", side: "left", gap: 1 }, color: "#c0282d" },
      { say: "Make it 4 m tall", op: "size", targets: ["new:lamp post"], v: { x: null, y: null, z: 4 } },
    ]);
    expect(planActs(plan)).toBe(true);
  });

  it("an id that isn't in the scene becomes a plain 'I can't find' step; the rest of the plan stays", () => {
    const plan = validateStudioPlan(
      answer([
        step({ say: "Paint the truck", op: "color", targets: ["o99"], color: "#112233" }),
        step({ say: "Paint the car", op: "color", targets: ["o1", "o77"], color: "#112233" }),
        step({ say: "Size a thing never made", op: "size", targets: ["new:ghost"], z: 2 }),
      ]),
      KNOWN,
    );
    expect(plan.steps[0]).toEqual({ op: "note", say: 'I can\'t find "o99" in the scene, so this step is skipped.' });
    expect(plan.steps[1]).toEqual({ say: "Paint the car", op: "color", targets: ["o1"], color: "#112233" });
    expect(plan.steps[2]).toEqual({ op: "note", say: 'I can\'t find "ghost" in the scene, so this step is skipped.' });
  });

  it("clamps every number to what the Studio takes", () => {
    const plan = validateStudioPlan(
      answer([
        step({ op: "move", targets: ["o1"], mode: "to", x: 1e9, y: -1e9, z: 3 }),
        step({ op: "hour", value: 99 }),
        step({ op: "lens", value: 2 }),
        step({ op: "key", targets: ["o1"], value: 5000 }),
        step({ op: "array", targets: ["o1"], value: 900, x: 1e6 }),
        step({ op: "physics", targets: ["o1"], kind: "active", value: -4 }),
        step({ op: "material", targets: ["o1"], metallic: 7, roughness: -1 }),
        step({ op: "range", value: 0, value2: 999 }),
        step({ op: "scale", targets: ["o1"], mode: "by", x: 0 }),
      ]),
      KNOWN,
    );
    const [move, hour, lens, key, array, physics, material, range, scale] = plan.steps as never as Record<string, unknown>[];
    expect(move.v).toEqual({ x: 500, y: -500, z: 3 });
    expect(hour.hour).toBe(24);
    expect(lens.mm).toBe(8);
    expect(key.frame).toBe(241);
    expect(array).toMatchObject({ count: 50, v: { x: 100, y: null, z: null } });
    expect(physics).toMatchObject({ type: "active", mass: 0.01 });
    expect(material).toMatchObject({ metallic: 1, roughness: 0 });
    expect(range).toMatchObject({ start: 1, end: 241 });
    expect(scale).toMatchObject({ v: { x: 0.01, y: null, z: null } });
  });

  it("drops unknown ops, bad colours, unusable steps, and a plan past its step cap", () => {
    const plan = validateStudioPlan(
      answer([
        step({ say: "Sculpt a face", op: "sculpt" }),
        step({ op: "color", targets: ["o1"], color: "red" }),
        step({ op: "sky", kind: "purple" }),
        step({ op: "format", kind: "3:2" }),
        step({ op: "add", kind: "dragon" }),
        step({ op: "format", kind: "9:16" }),
      ]),
      KNOWN,
    );
    expect(plan.steps).toEqual([
      { op: "note", say: "Skipped: Sculpt a face" },
      { op: "note", say: 'I can\'t add "dragon" here, so this step is skipped.' },
      { say: "format", op: "format", format: "9:16" },
    ]);
    const long = validateStudioPlan(answer(Array.from({ length: 90 }, () => step({ op: "frame", value: 10 }))), KNOWN);
    expect(long.steps).toHaveLength(STUDIO_PLAN_MAX_STEPS);
  });

  it("'camera' means the shot camera; aim, face and parent check their other object too", () => {
    const plan = validateStudioPlan(
      answer([
        step({ op: "move", targets: ["camera"], mode: "by", z: 1 }),
        step({ op: "aim", of: "o1" }),
        step({ op: "aim", of: "o404" }),
        step({ op: "rotate", targets: ["o2"], of: "camera" }),
        step({ op: "parent", targets: ["o2", "o1"], of: "o1" }),
        step({ op: "parent", targets: ["o2"], of: "" }),
      ]),
      KNOWN,
    );
    expect(plan.steps[0]).toMatchObject({ op: "move", targets: ["o3"], mode: "by", v: { x: null, y: null, z: 1 } });
    expect(plan.steps[1]).toMatchObject({ op: "aim", target: "o1" });
    expect(plan.steps[2]).toMatchObject({ op: "note" });
    expect(plan.steps[3]).toMatchObject({ op: "rotate", face: "o3", v: null });
    expect(plan.steps[4]).toMatchObject({ op: "parent", targets: ["o2"], parent: "o1" });
    expect(plan.steps[5]).toMatchObject({ op: "parent", targets: ["o2"], parent: null });
  });

  it("a question comes back with its options and no steps; a reply alone doesn't act", () => {
    const q = validateStudioPlan(answer([step({ op: "frame", value: 3 })], { question: "Which car?", options: ["Red sports car", "Blue sports car", ""] }), KNOWN);
    expect(q).toEqual({ reply: "On it.", question: "Which car?", options: ["Red sports car", "Blue sports car"], steps: [] });
    expect(planActs(q)).toBe(false);
    const said = validateStudioPlan(answer([], { reply: "Render makes pictures; I change the scene." }), KNOWN);
    expect(planActs(said)).toBe(false);
  });

  it("reads her text, and refuses what isn't the JSON asked for", () => {
    expect(parseStudioAnswer("not json", KNOWN)).toBeNull();
    expect(parseStudioAnswer("[1,2]", KNOWN)).toBeNull();
    const out = parseStudioAnswer(JSON.stringify(answer([step({ op: "hour", value: 18.4 })])), KNOWN)!;
    expect(out.plan.steps).toEqual([{ say: "hour", op: "hour", hour: 18.4 }]);
    // The engine checks the same answer again on Apply, against the scene then.
    const later = validateStudioPlan(out.answer, knownOf(normaliseStudioSummary({ ...SCENE, objects: [] })));
    expect(later.steps).toEqual([{ say: "hour", op: "hour", hour: 18.4 }]);
  });
});

describe("the scene summary", () => {
  it("checks every field and drops what isn't an object", () => {
    const s = normaliseStudioSummary({
      ...SCENE,
      hour: 30,
      format: "7:3",
      sky: "neon",
      objects: [...SCENE.objects, { id: "bad", name: "x", kind: "mesh", at: [0, 0, 0], size: [1, 1, 1] }, { id: "o9", name: "\u0000Sneaky\nname", kind: "mesh", at: [1e9, 0, 0], size: [1, 1, 1], turn: 12.345, sel: "yes" }],
    });
    expect(s.hour).toBe(24);
    expect(s.format).toBe("16:9");
    expect(s.sky).toBe("simple");
    expect(s.objects.map((o) => o.id)).toEqual(["o3", "o1", "o2", "o9"]);
    expect(s.objects[3]).toEqual({ id: "o9", name: "Sneaky name", kind: "mesh", at: [5000, 0, 0], size: [1, 1, 1], turn: 12 });
  });

  it("is capped: the selection and the camera stay, the rest is cut and counted", () => {
    const many = Array.from({ length: 800 }, (_, i) => ({ id: `o${100 + i}`, name: `Building ${i} with a long descriptive name`, kind: "mesh", at: [i, i, 0], size: [8, 8, 20], turn: 0 }));
    const sel = { id: "o5000", name: "Chosen", kind: "mesh", at: [1, 1, 0], size: [1, 1, 1], turn: 0, sel: true };
    const s = normaliseStudioSummary({ ...SCENE, objects: [...many, SCENE.objects[2], sel] });
    expect(JSON.stringify(s).length).toBeLessThanOrEqual(STUDIO_SUMMARY_MAX_CHARS);
    expect(s.objects[0].id).toBe("o3");
    expect(s.objects[1].id).toBe("o5000");
    expect(s.camera).toBe("o3");
    expect(s.omitted).toBe(802 - s.objects.length);
    expect(s.omitted).toBeGreaterThan(0);
  });

  it("keeps the last few turns, each cut short", () => {
    const turns = normaliseStudioTurns([...Array.from({ length: 10 }, (_, i) => ({ who: i % 2 ? "astra" : "person", text: `turn ${i} ${"x".repeat(400)}` })), { who: "system", text: "no" }]);
    expect(turns).toHaveLength(STUDIO_TURNS_MAX);
    expect(turns[0].text.startsWith("turn 4")).toBe(true);
    expect(turns.every((t) => t.text.length <= 300)).toBe(true);
  });
});

describe("Blender axes in the Studio", () => {
  it("maps X, Y, Z (Z up) to three.js (Y up): y → −z, z → y", () => {
    expect(toThreeAxes({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 3, z: -2 });
    expect(toThreeAxes({ x: null, y: null, z: 4 })).toEqual({ x: null, y: 4, z: null });
    expect(toThreeSizes({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 3, z: 2 });
  });

  it("'4 m tall' scales the whole thing in proportion; given axes scale alone", () => {
    expect(sizeFactors({ x: 1, y: 4.2, z: 0.2 }, { x: null, y: 4, z: null })).toEqual({ x: 4 / 4.2, y: 4 / 4.2, z: 4 / 4.2 });
    expect(sizeFactors({ x: 2, y: 2, z: 2 }, { x: 4, y: null, z: 1 })).toEqual({ x: 2, y: 1.25, z: 0.5 });
    expect(sizeFactors({ x: 0, y: 0, z: 0 }, { x: 1, y: null, z: null })).toBeNull();
  });

  it("places a thing beside another as the shot camera sees it, with the gap between the boxes", () => {
    // A camera looking along −Z: its right is +X, "towards the camera" is +Z.
    const car = { min: [-2, 0, -1] as [number, number, number], max: [2, 1.3, 1] as [number, number, number] };
    const own: [number, number, number] = [0.4, 4.2, 0.4];
    expect(besidePosition(car, own, "left", 1, [1, 0], [0, 1])).toEqual([-3.2, 0, 0]);
    expect(besidePosition(car, own, "right", 1, [1, 0], [0, 1])).toEqual([3.2, 0, 0]);
    expect(besidePosition(car, own, "front", 0.5, [1, 0], [0, 1])).toEqual([0, 0, 1.7]);
    expect(besidePosition(car, own, "on", 1, [1, 0], [0, 1])).toEqual([0, 1.3, 0]);
  });

  it("every format and add kind Astra names is one the Studio has (read from the engine's source)", () => {
    const engine = readFileSync(join(__dirname, "../../components/studio/studio-engine.ts"), "utf8");
    const formats = engine.match(/const FORMATS = \{([^}]*)\}/)![1];
    for (const label of Object.values(STUDIO_FORMATS)) expect(formats, label).toContain(`"${label}"`);
    const add = engine.slice(engine.indexOf("const ADD = {"), engine.indexOf("function addKind("));
    for (const key of Object.values(STUDIO_ADD_KINDS)) expect(add, key).toMatch(new RegExp(`\\n  ${key}: \\{`));
  });
});

// Stage 5 ("Fix walls."): the race track's own trap — a 20 m wall along
// x −4…0 right beside its car — with the shot camera out at +x, +z.
describe("keeping what Astra places clear of walls and in view", () => {
  type B = { min: [number, number, number]; max: [number, number, number] };
  const WALL = { min: [-4, 0, -68], max: [0, 20, 68], name: "the wall" } as B & { name: string };
  const CAR = { min: [-1, 0, -2.3], max: [1, 1.5, 2.3], name: '"Car 1"' } as B & { name: string };
  const lampAt = (x: number, z: number): B => ({ min: [x - 0.45, 0, z - 0.2], max: [x + 0.45, 4, z + 0.2] });
  const shift = (b: B, dx: number, dz: number): B => ({ min: [b.min[0] + dx, b.min[1], b.min[2] + dz], max: [b.max[0] + dx, b.max[1], b.max[2] + dz] });
  const LEFT: [number, number] = [-1, 0];
  const TOWARD: [number, number] = [0.75, 0.65];
  // From the camera out at +x the wall hides anything whose middle is at x < 0.
  const seen = (b: B) => (b.min[0] + b.max[0]) / 2 > 0;

  it("a lamp put inside the wall slides out towards the shot camera, where it can be seen, and stays on the ground", () => {
    const r = clearSpot({ box: lampAt(-3.5, 2.1), obstacles: [WALL, CAR], dirs: [LEFT, TOWARD], visible: seen });
    expect(r).toMatchObject({ dir: 1, inside: "the wall", hidden: false, stuck: false });
    const moved = shift(lampAt(-3.5, 2.1), r.dx, r.dz);
    expect(moved.min[1]).toBe(0);
    expect(boxesOverlap(moved, WALL)).toBe(false);
    expect(boxesOverlap(moved, CAR)).toBe(false);
    expect(seen(moved)).toBe(true);
    expect(clearNote(r, ["further left", "towards the shot camera"])).toBe(`placed ${r.moved.toFixed(1).replace(/\.0$/, "")} m towards the shot camera so it isn't inside the wall`);
  });

  it("searches the asked-for side first", () => {
    const barrier = { min: [4, 0, -60], max: [4.6, 1.4, 60], name: "the wall" } as B & { name: string };
    const r = clearSpot({ box: lampAt(4.3, 0), obstacles: [barrier], dirs: [[1, 0], TOWARD], visible: () => true });
    expect(r).toMatchObject({ dir: 0, moved: 0.75, hidden: false });
    expect(clearNote(r, ["further right", "towards the shot camera"])).toBe("placed 0.8 m further right so it isn't inside the wall");
  });

  it("free but hidden behind the wall: moved to where the camera sees it, and says why", () => {
    const r = clearSpot({ box: lampAt(-6, 2), obstacles: [WALL], dirs: [LEFT, TOWARD], visible: seen });
    expect(r).toMatchObject({ dir: 1, inside: null, hidden: false });
    expect(seen(shift(lampAt(-6, 2), r.dx, r.dz))).toBe(true);
    expect(clearNote(r, ["further left", "towards the shot camera"])).toMatch(/^placed [\d.]+ m towards the shot camera so the wall doesn't hide it from the shot camera$/);
  });

  it("clear and seen: nothing moves and nothing is said", () => {
    const r = clearSpot({ box: lampAt(5, 0), obstacles: [WALL, CAR], dirs: [LEFT, TOWARD], visible: seen });
    expect(r).toEqual({ dx: 0, dz: 0, moved: 0, dir: -1, inside: null, hidden: false, stuck: false });
    expect(clearNote(r, [])).toBe("");
  });

  it("no spot the camera sees: a free thing stays and says so; one inside a wall goes to the nearest free spot", () => {
    const hiddenFree = clearSpot({ box: lampAt(-6, 2), obstacles: [WALL], dirs: [LEFT, TOWARD], visible: () => false });
    expect(hiddenFree).toMatchObject({ moved: 0, hidden: true, stuck: false });
    expect(clearNote(hiddenFree, [])).toBe("it's behind the wall from the shot camera, and there's no clear spot nearby");
    const inWall = clearSpot({ box: lampAt(-3.5, 2.1), obstacles: [WALL], dirs: [LEFT, TOWARD], visible: () => false });
    expect(inWall).toMatchObject({ dir: 0, moved: 1, hidden: true });
    expect(clearNote(inWall, ["further left", "towards the shot camera"])).toBe("placed 1 m further left so it isn't inside the wall; from the shot camera it's still behind the wall");
  });

  it("walled in on every side within reach: it stays where it was put", () => {
    const hall = { min: [-50, 0, -50], max: [50, 30, 50], name: "the wall" } as B & { name: string };
    const r = clearSpot({ box: lampAt(0, 0), obstacles: [hall], dirs: [LEFT, TOWARD], visible: () => true });
    expect(r).toMatchObject({ moved: 0, stuck: true, inside: "the wall" });
    expect(clearNote(r, [])).toBe("it's inside the wall and there's no free spot within 12 m, so it stays there");
  });

  it("the sides are the shot camera's", () => {
    expect(sideDirection("left", [1, 0], [0, 1])).toEqual([-1, -0]);
    expect(sideDirection("front", [1, 0], [0, 1])).toEqual([0, 1]);
    expect(sideDirection("behind", [1, 0], [0, 1])).toEqual([-0, -1]);
  });
});

// Stage 8: a resize is checked like an add or a move.
describe("a thing Astra resizes", () => {
  it("that grows into the wall is slid clear towards the shot camera", () => {
    const WALL = { min: [-4, 0, -68] as [number, number, number], max: [0, 20, 68] as [number, number, number], name: "the wall" };
    // A 1 m box at x 1.5, made 4 m wide in place: it now reaches x −0.5, into the wall.
    const grown = { min: [-0.5, 0, -2] as [number, number, number], max: [3.5, 4, 2] as [number, number, number] };
    const r = clearSpot({ box: grown, obstacles: [WALL], dirs: [[0.75, 0.65]], visible: () => true });
    expect(r).toMatchObject({ inside: "the wall", hidden: false, stuck: false });
    expect(grown.min[0] + r.dx).toBeGreaterThanOrEqual(0);
    expect(clearNote(r, ["towards the shot camera"])).toMatch(/^placed [\d.]+ m towards the shot camera so it isn't inside the wall$/);
  });

  it("the engine runs that check after its size and scale steps, inside the same undo (read from the source)", () => {
    const engine = readFileSync(join(__dirname, "../../components/studio/studio-engine.ts"), "utf8");
    for (const op of ["scale", "size"]) {
      const at = engine.indexOf(`case "${op}": act = () =>`);
      const body = engine.slice(at, engine.indexOf("break;", at));
      expect(body, op).toContain("moveCmd(it,");
      expect(body.indexOf("keepClear(it, [], [])"), op).toBeGreaterThan(body.indexOf("moveCmd(it,"));
    }
  });
});
