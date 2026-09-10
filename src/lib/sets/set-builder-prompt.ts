// What Astra is told when it builds a Set, and the schema its answer must
// fit (2026-09-10).
//
// Both are STABLE BYTES on purpose: they form the request's cacheable
// prefix, and the person's brief is the only thing appended after them. A
// per-request value anywhere in here would turn every build into a fresh
// cache write, which on GPT-6 Astra costs 1.25x plain input.
//
// The schema fixes the SHAPE only. Strict mode is kept to the keywords every
// structured-output model accepts (no min/max, no patterns); the bounds are
// stated in the descriptions for the model, and ENFORCED by
// normaliseSetSpec (set-spec.ts), which is the trust boundary. A bound that
// lived only here would be a bound nothing checks.
//
// The rules the model is given, and why each is there:
//   - Places only, never people. Astra never sees, names or describes the
//     character: the person arrives later, from the character's own photos,
//     through the ordinary image lane, which scores identity. A person in
//     the set would be a second, unscored face competing with the real one.
//   - No brands, logos or readable text. Real venues bake trademarks into
//     stills (the Lakers court and a game poster already turned up in our
//     own renders); the description is gated, the geometry cannot be read.
//   - Repeat instead of copying: output tokens are the whole cost of a
//     build ($50 per million), and a row of twelve lamps is one object.

import { SET_LIGHT_KINDS, SET_LIMITS, SET_SHAPES, SET_SKY_KINDS } from "./set-spec";

export const SET_BUILDER_INSTRUCTIONS = `You build film sets for a pre-visualisation tool. From the brief, build ONE location as simple 3D primitives, as JSON matching the schema.

Space
- Units are metres. +Y is up. The ground is the plane y = 0. The set is centred on the origin, and the main action happens near x = 0, z = 0.
- bounds.x and bounds.z are the full width and depth of the set (${SET_LIMITS.minExtent}–${SET_LIMITS.maxExtent}); bounds.height is its height (${SET_LIMITS.minHeight}–${SET_LIMITS.maxHeight}). Keep everything inside the bounds, except distant backdrop shapes.
- An object's position is the CENTRE of its shape; an object resting on the ground has position y = size y / 2. rotation is in degrees, applied X then Y then Z.
- size is the full [width, height, depth]. box: as stated. cylinder, cone, capsule: size x and z are the diameters, size y the height. sphere: the three diameters. torus: a flat ring lying on the ground plane before rotation; size x is the outer diameter, size y the thickness of the tube. plane: a flat horizontal rectangle, size x by size z (size y is ignored); use it for rugs, puddles, road markings.

What to build
- Model the PLACE only: architecture, furniture, props, vegetation, vehicles, terrain. Never model people, animals or characters, and never describe a person.
- Close the set, so no camera ever sees where it ends. There is NO fourth wall: from any mark the person can turn the camera all the way round, so the side your cameras stand on is built too. Bare floor meeting empty sky is the edge of a set, and a picture made from it will invent whatever it likes there.
- Indoors: four walls that meet at the corners with no gaps between them, and a ceiling. A glass wall or shop front is still a wall: model its frames and panes, and model what is outside the glass as you would an exterior.
- Outdoors: every street, path or open side ends in something — facades, the buildings of a cross street, trees, hills or a skyline — at or just beyond the bounds (distant buildings can be plain large boxes). A place that truly ends at a natural horizon (open sea, desert, plains) models that surface out to the horizon as large planes or terrain filling that whole side of the view (a plane is at most 200 m across: lay several side by side); it never leaves the bare floor.
- Where a person would stand, add a mark (1–${SET_LIMITS.maxMarks}). facingDeg is the direction they face around +Y: 0 faces +Z, 90 faces +X.
- No brand names, logos, readable text or real trademarks anywhere, including the title and description. Signs are blank shapes.
- Use 30–150 objects. For rows or grids of identical things (columns, lamps, chairs, shelves, windows, trees), write the object ONCE with repeat { count, offset }: copy i sits at position + i × offset. Use repeat: null otherwise. At most ${SET_LIMITS.maxInstances} shapes after repeats.
- Colours are "#rrggbb". Choose a believable palette for this specific place and time of day; do not default to greens or to flat pastel colours. roughness and metalness are 0–1. emissive (a colour, or null) is for things that glow: lamps, screens, windows at night; emissiveIntensity 0–10.
- castShadow: true for large or important objects, false for small clutter.

Light and air
- 2–6 lights. Outdoors: one sun (intensity 1–4) plus a hemisphere or ambient fill (0.2–1.5). Indoors or at night: point or spot lights at the real light sources (intensity roughly 5–60, higher for lights further from what they light), plus a hemisphere or ambient fill of 0.5–1 so every wall a camera can see still reads. The sketch has to show the whole place; the description carries the mood.
- position and target are metres; a sun's position gives its direction. angleDeg is a spot's half-angle (5–80). distance is where a point or spot light fades out, 0 for no cutoff. groundColor is for hemisphere lights, otherwise null.
- sky.kind is "color" (one colour), "gradient" (top colour, then horizon colour) or "night" (two dark colours). fog is optional (null, or colour plus near and far distances in metres).
- ground is the floor or terrain colour and roughness.

Cameras
- 2–5 cameras that frame the first mark with the set behind it, the way a cinematographer would: a wide establishing shot, a medium shot, and one low or high angle. Each has a short label (≤ 4 words), a position, a target (usually near the mark at chest height, y ≈ 1.3) and a vertical field of view fovDeg (${SET_LIMITS.minFovDeg}–70). Cameras stand inside the bounds and never inside an object.

Words
- title: at most 6 words.
- description: at most 50 words. A photographer's description of the place — materials, time of day, weather and light — that someone could use to photograph it. Never mention people, marks, cameras, the camera's position, or anything outside the place.`;

const vec3 = (description: string) => ({
  type: "array",
  description,
  items: { type: "number" },
});

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/** The strict JSON schema for the Responses API's text.format. */
export const SET_SPEC_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "bounds", "sky", "ground", "fog", "lights", "objects", "marks", "cameras"],
  properties: {
    title: { type: "string", description: "At most 6 words." },
    description: { type: "string", description: "At most 50 words; the place only." },
    bounds: {
      type: "object",
      additionalProperties: false,
      required: ["x", "z", "height"],
      properties: { x: { type: "number" }, z: { type: "number" }, height: { type: "number" } },
    },
    sky: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "colors"],
      properties: {
        kind: { type: "string", enum: [...SET_SKY_KINDS] },
        colors: { type: "array", items: { type: "string" }, description: "1–3 #rrggbb colours." },
      },
    },
    ground: {
      type: "object",
      additionalProperties: false,
      required: ["color", "roughness"],
      properties: { color: { type: "string" }, roughness: { type: "number" } },
    },
    fog: nullable({
      type: "object",
      additionalProperties: false,
      required: ["color", "near", "far"],
      properties: { color: { type: "string" }, near: { type: "number" }, far: { type: "number" } },
    }),
    lights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "color", "intensity", "position", "target", "groundColor", "angleDeg", "distance"],
        properties: {
          kind: { type: "string", enum: [...SET_LIGHT_KINDS] },
          color: { type: "string" },
          intensity: { type: "number" },
          position: vec3("[x, y, z] metres"),
          target: vec3("[x, y, z] metres"),
          groundColor: nullable({ type: "string" }),
          angleDeg: { type: "number" },
          distance: { type: "number" },
        },
      },
    },
    objects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "shape",
          "position",
          "rotation",
          "size",
          "color",
          "roughness",
          "metalness",
          "emissive",
          "emissiveIntensity",
          "castShadow",
          "repeat",
        ],
        properties: {
          shape: { type: "string", enum: [...SET_SHAPES] },
          position: vec3("Centre [x, y, z], metres"),
          rotation: vec3("[x, y, z] degrees"),
          size: vec3("Full [width, height, depth], metres"),
          color: { type: "string" },
          roughness: { type: "number" },
          metalness: { type: "number" },
          emissive: nullable({ type: "string" }),
          emissiveIntensity: { type: "number" },
          castShadow: { type: "boolean" },
          repeat: nullable({
            type: "object",
            additionalProperties: false,
            required: ["count", "offset"],
            properties: {
              count: { type: "integer" },
              offset: vec3("[x, y, z] metres between copies"),
            },
          }),
        },
      },
    },
    marks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "x", "z", "facingDeg"],
        properties: {
          label: { type: "string", description: "At most 4 words, the place not the person." },
          x: { type: "number" },
          z: { type: "number" },
          facingDeg: { type: "number" },
        },
      },
    },
    cameras: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "position", "target", "fovDeg"],
        properties: {
          label: { type: "string", description: "At most 4 words." },
          position: vec3("[x, y, z] metres"),
          target: vec3("[x, y, z] metres"),
          fovDeg: { type: "number" },
        },
      },
    },
  },
} as const;

export const SET_SPEC_SCHEMA_NAME = "picacho_set";

/** The only per-request text: the person's brief, already gated. */
export function setBuildInput(brief: string): string {
  return `Brief: ${brief}`;
}
