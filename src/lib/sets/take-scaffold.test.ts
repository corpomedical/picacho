import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripSetTakeScaffold } from "./take-scaffold";
import { buildSetTakePrompt, SET_TAKE_FIXED_SENTENCES } from "./take";
import { FILM_MOVES, FILM_TEXTURES } from "./moves";
import { rackWords } from "./furniture";
import { gazeWords, type Gaze } from "./people";
import { SET_SHAPES, type SetObject } from "./set-spec";

// A take's brand check reads the person's words only (Helios Cut 1,
// operator 2026-09-25: "GO ahead"). A still's already did (setShot); a
// take's judged Picacho's fixed take sentences — "One continuous shot, no
// cuts…", the move, the textures, the rack, the eye-line, "Keep the
// person…" — as if the person had written them, against his 16 rules.

const DIRECTION = "she walks to the red Ferrari";
const SAID = "she walks to the red Ferrari.";

const thing = (shape: (typeof SET_SHAPES)[number], size: [number, number, number]) => ({ shape, size }) as unknown as SetObject;
const objects = SET_SHAPES.map((shape, i) => thing(shape, [1.24 + i, 0.5, 12]));
const spec = { objects };
const mark = { x: 0, z: 0, facingDeg: 0 };
const gazes: Gaze[] = [
  { at: "camera" },
  { at: "object", index: 0 },
  { at: "object", index: objects.length - 1 },
  { at: "point", x: 0, z: 3.33 },
  { at: "point", x: 0, z: -2 },
  { at: "point", x: 4, z: 0 },
  { at: "point", x: -4, z: 0.2 },
];

describe("stripSetTakeScaffold", () => {
  it("leaves the direction alone, for every move", () => {
    for (const move of FILM_MOVES) expect(stripSetTakeScaffold(buildSetTakePrompt(DIRECTION, { move })), move).toBe(SAID);
  });

  it("for every texture, together and alone", () => {
    for (const t of FILM_TEXTURES) expect(stripSetTakeScaffold(buildSetTakePrompt(DIRECTION, { textures: [t] })), t).toBe(SAID);
    expect(stripSetTakeScaffold(buildSetTakePrompt(DIRECTION, { textures: [...FILM_TEXTURES] }))).toBe(SAID);
  });

  it("for a rack to the figure and to a thing of every shape", () => {
    const racks = [rackWords({ to: "figure" }, spec), ...objects.map((_, index) => rackWords({ to: "object", index }, spec))];
    for (const rack of racks) {
      expect(rack).not.toBe("");
      expect(stripSetTakeScaffold(buildSetTakePrompt(DIRECTION, { rack })), rack).toBe(SAID);
    }
  });

  it("for an eye-line at the camera, at a thing and out of the frame", () => {
    for (const g of gazes) {
      const gaze = gazeWords(g, spec, mark, "take");
      expect(gaze).toMatch(/^By the end of the shot they look/);
      expect(stripSetTakeScaffold(buildSetTakePrompt(DIRECTION, { gaze })), gaze).toBe(SAID);
    }
  });

  it("strips the silent default to nothing", () => {
    expect(stripSetTakeScaffold(buildSetTakePrompt(""))).toBe("");
  });

  it("keeps a direction whole that merely opens like one of Picacho's sentences", () => {
    for (const own of ["During the move she laughs.", "Camera: she waves.", "By the end of the shot they look tired.", "Keep the person calm."]) {
      expect(stripSetTakeScaffold(buildSetTakePrompt(own)), own).toBe(own);
    }
  });

  it("covers every sentence the take can write: built with everything, only the direction is left", () => {
    for (const move of FILM_MOVES) {
      for (const g of gazes) {
        const prompt = buildSetTakePrompt(DIRECTION, {
          move,
          textures: [...FILM_TEXTURES],
          rack: rackWords({ to: "object", index: 2 }, spec),
          gaze: gazeWords(g, spec, mark, "take"),
        });
        expect(stripSetTakeScaffold(prompt), `${move} ${JSON.stringify(g)}`).toBe(SAID);
      }
    }
    // And the fixed sentences are the ones the builder writes.
    for (const fixed of SET_TAKE_FIXED_SENTENCES) expect(buildSetTakePrompt("") + " " + buildSetTakePrompt("x")).toContain(fixed);
  });
});

describe("the wiring, read as source", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
  const actions = read("actions.ts");
  const take = actions.slice(actions.indexOf("export async function takeInSet("), actions.indexOf("// Delete\n"));
  const still = actions.slice(actions.indexOf("async function shootStill("), actions.indexOf("export type TakeResult"));
  const generations = read("../generations/actions.ts");
  const pipeline = read("../generations/pipeline.ts");

  it("the take's clip is known by the frames' mark in server memory, never a form field (review, 2026-09-25)", () => {
    // No request can claim to be a take: the only mark is the one takeWork
    // sets around its own runGeneration call (server-built.ts).
    expect(take).not.toContain("set_take");
    expect(still).not.toContain("set_take");
    expect(generations).not.toContain("set_take");
    expect(take).toContain("withServerBuiltFrames(() => runGeneration(fd))");
    // A still keeps its own form mark, set_shot.
    expect(still).toContain('fd.set("set_shot", "1");');
  });

  it("runGeneration hands that mark, for video only, to the pipeline", () => {
    expect(generations).toContain('const heliosTake = contentType === "video" && serverBuiltFrames();');
    expect(generations).toContain("setTake: heliosTake,");
    // Declared before the pipeline is called.
    expect(generations.indexOf("const heliosTake =")).toBeLessThan(generations.indexOf("setTake: heliosTake,"));
  });

  it("the pipeline's brand check reads the take through its own strip", () => {
    expect(pipeline).toContain('import { stripSetTakeScaffold } from "@/lib/sets/take-scaffold";');
    expect(pipeline).toContain(
      "const brandText = options.setShot ? stripSetShotScaffold(reviewedPrompt) : options.setTake ? stripSetTakeScaffold(reviewedPrompt) : reviewedPrompt;",
    );
  });
});
