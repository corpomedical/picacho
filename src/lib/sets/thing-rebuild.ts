// A thing rebuilt from its photos (2026-09-24, "Doesn't Astra have the
// capability to create what you are asking for?" — "Do it"). Astra builds a
// set as simple shapes from words, so a car on the stage is a car, not THE
// car: the reference photos put on it (R1) reach the painter, never Astra.
// Here Astra is handed the thing's own blocks and its photos, and answers
// with new blocks for that thing alone — its silhouette, proportions,
// colours and materials as the photos show them, where it stood, facing the
// way it faced, at the length it had.
//
// The answer is only blocks: no words reach a render from it (a set's
// description is untouched). It is spliced into the working set in place of
// the thing's old blocks and then held to what the set already promises —
// one thing, not merged with a neighbour, of the same family, about the same
// length, and found again by its photos (elements.ts resolvePhotos,
// "changed") — or it is not kept at all.
//
// Pure and relative-import only: the test holds every request and splice.

import type { AstraInput, AstraJobRequest } from "../generations/providers/astra";
import { SET_SPEC_JSON_SCHEMA } from "./set-builder-prompt";
import { resolvePhotos, setElements, type ElementPhoto, type SetElement } from "./elements";
import { SET_LIMITS, normaliseSetSpec, type SetObject, type SetSpec, type Vec3 } from "./set-spec";
import { withMaterials } from "./stage-materials";

/** Blocks one rebuild may answer with: a detailed car is 30–50. */
export const THING_REBUILD_MAX_OBJECTS = 60;
/**
 * The answer's cap. 60 blocks at ~70 tokens each is ~4,200, and a photo
 * build's reasoning at low effort measured 4,007 for a whole place
 * (set-config.ts) — one thing asks for less.
 */
export const THING_REBUILD_MAX_OUTPUT_TOKENS = 10_000;
/** How far the rebuilt thing's length may move from the old one's: the photos give proportions, the set gives the scale. */
export const THING_REBUILD_LENGTH_RANGE = [0.8, 1.25] as const;
/** Everyone with Astra changes may ask once the first live rebuild is proved; admins only until then (the operator's proof rule). */
export const THING_REBUILD_OPEN_TO_ALL = false;
/**
 * The most of the thing's own blocks one rebuild sends, as thingRebuildInput
 * writes them (2026-09-25). A rebuild never sends the whole set, so it was
 * wrong to refuse one by the whole set's size (SET_EDIT_MAX_SPEC_CHARS
 * belongs to chat edits, which do), and nothing bounded one huge thing.
 * Worst case at this bound, every input token a cache write:
 *   text = the instructions (3,104 characters measured 2026-09-25)
 *     + 11,500 + ~400 of framing = 15,004 characters ≈ 6,699 tokens at 2.24
 *   + 4 photos × 2,300 tokens = 15,899 input tokens × $12.50/1M = $0.1987
 *   + 10,000 output tokens × $50/1M = $0.50
 *   = $0.6987, under the $0.70 thing-rebuild.test.ts pins.
 * Every thing in every fixture fits: the race-track car's 48 blocks are
 * 11,025 characters, a showroom car's 29 about 6,700, the rainy market's
 * stall 8,615, the beach's largest thing 3,807.
 */
export const THING_REBUILD_MAX_SENT_CHARS = 11_500;

export const THING_REBUILD_INSTRUCTIONS = `You rebuild ONE thing on a film set for a pre-visualisation tool, from photos of the real thing. You are given the thing's current blocks as JSON (simple 3D primitives) and 1 to 4 photos of it; the first photo is its front or its best view. Answer with NEW blocks for this thing only, as JSON matching the schema, so that from every side it matches the photos as closely as simple shapes allow.

The thing's own frame
- Units are metres. +Y is up. The ground is the plane y = 0. The middle of the thing's footprint is at x = 0, z = 0.
- An object's position is the CENTRE of its shape; rotation is in degrees, applied X then Y then Z. A positive X rotation turns +Y toward +Z; a positive Y rotation turns +Z toward +X; a positive Z rotation turns +X toward +Y. A sloped panel (a windscreen, a bonnet, a roof line) is a flat box tilted this way: check which edge rises before you choose the sign.
- size is the full [width, height, depth]. box: as stated. cylinder, cone, capsule: size x and z are the diameters, size y the height, along the shape's own Y before rotation. sphere: the three diameters. torus: a flat ring before rotation; size x is the outer diameter, size y the tube's thickness. Do not use plane.

Keep
- Where it stands and which way it faces: the same footprint, the same heading as the current blocks. A vehicle's front is where its current headlights are.
- Its length: the longest side of the footprint stays within 10% of the current blocks' (given below). Width and height follow the photos' proportions at that length.
- It rests on the ground: its lowest point is at y = 0, and a vehicle's tyres touch the ground.
- It is ONE thing: every block touches or overlaps another block of it, and nothing reaches more than 0.3 m outside the current footprint on any side.

Build
- Match the photos: the silhouette (roof line, bonnet, boot, wings, arches, spoilers, mirrors, legs, arms, handles — whatever this thing has), its proportions, and its colours as "#rrggbb" read from the photos under neutral light: the main colour, the trim, the glass, the wheels.
- material names what each block is made of, one of the schema's words: a car body is paint, glass is glass, a tyre is rubber, chrome trim is chrome. roughness and metalness 0–1 describe the finish.
- A vehicle keeps 4 to 6 wheels: dark cylinders of material rubber, 0.5–1.0 m across and 0.15–0.4 m wide, turned so each axle is horizontal and runs across the vehicle, as the current wheels do. Glowing white headlights (emissive) at its front and red tail lights (emissive) at its back.
- Use 15–${THING_REBUILD_MAX_OBJECTS} blocks. For identical rows (slats, spokes, vents), write the block once with repeat { count, offset }: copy i sits at position + i × offset; repeat is null otherwise. No block is longer than 6 m on any side.
- castShadow: true for the large blocks, false for small detail. emissive is a colour or null; emissiveIntensity 0–10.
- Plain shapes only: never copy a logo, badge, emblem, lettering, number plate characters or any text from the photos, even as a shape.
- Never model a person or an animal, even if one is in a photo.`;

/** The answer's strict schema: the set's own object schema, and nothing else. */
export const THING_REBUILD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["objects"],
  properties: { objects: SET_SPEC_JSON_SCHEMA.properties.objects },
} as const;
export const THING_REBUILD_SCHEMA_NAME = "picacho_thing";

const cm = (n: number) => Math.round(n * 100) / 100;

/** A copy of an object on its own: no repeat, at its copy's place. */
function copyOf(o: SetObject, copy: number): SetObject {
  const step: Vec3 = o.repeat?.offset ?? [0, 0, 0];
  return { ...o, repeat: null, position: [o.position[0] + step[0] * copy, o.position[1] + step[1] * copy, o.position[2] + step[2] * copy] };
}

/** The thing's blocks, each copy on its own, in its own frame: the footprint's middle at x = 0, z = 0. */
export function thingLocalBlocks(spec: SetSpec, el: SetElement): SetObject[] {
  const sent = withMaterials(spec);
  const [cx, , cz] = el.centre;
  return el.members.map(([oi, copy]) => {
    const o = copyOf(sent.objects[oi], copy);
    return {
      ...o,
      position: [cm(o.position[0] - cx), cm(o.position[1]), cm(o.position[2] - cz)],
      size: o.size.map(cm) as Vec3,
      rotation: o.rotation.map(cm) as Vec3,
    };
  });
}

/**
 * Where a rebuilt thing is now, found the way its photos find it
 * (spliceThing's own probe): its key and how many blocks it has, or null
 * when no thing on `spec` answers to `oldKey`. The page uses it when it
 * learns of a rebuild by reading the saved set back (astra-follow.ts)
 * rather than from the rebuild's own answer.
 */
export function rebuiltThingIn(spec: SetSpec, oldKey: string): { key: string; blocks: number } | null {
  const els = setElements(spec);
  const probe: ElementPhoto = { refId: "00000000-0000-4000-8000-000000000000", anchor: oldKey, slot: 1, at: 0, url: "" };
  const key = resolvePhotos(els, [probe]).held[0]?.key;
  const el = key === undefined ? undefined : els.find((e) => e.key === key);
  return el ? { key: el.key, blocks: el.members.length } : null;
}

const kindWord = (el: SetElement) => (el.kind === "car" ? "a car" : el.kind === "vehicle" ? "a vehicle" : "an object");

/** The one user message: what the thing is, its size, its blocks, then its photos (bytes, as data URLs). */
export function thingRebuildInput(spec: SetSpec, el: SetElement, photoDataUrls: readonly string[]): AstraInput {
  const size = [0, 1, 2].map((i) => cm(el.max[i] - el.min[i]));
  const length = Math.max(size[0], size[2]);
  const along = size[0] >= size[2] ? "x" : "z";
  const text =
    `The thing is ${kindWord(el)}. Its current footprint is ${size[0]} m along x by ${size[2]} m along z, and it stands ${size[1]} m tall; ` +
    `its length is ${length} m, along ${along}.\n` +
    `Its current blocks:\n${JSON.stringify(thingLocalBlocks(spec, el))}\n\n` +
    `The photos of the real thing follow.`;
  return [
    {
      role: "user",
      content: [{ type: "input_text", text }, ...photoDataUrls.map((url) => ({ type: "input_image" as const, image_url: url, detail: "high" as const }))],
    },
  ];
}

export function thingRebuildRequest(spec: SetSpec, el: SetElement, photoDataUrls: readonly string[], safetyIdentifier: string | undefined): AstraJobRequest {
  return {
    instructions: THING_REBUILD_INSTRUCTIONS,
    input: thingRebuildInput(spec, el, photoDataUrls),
    schemaName: THING_REBUILD_SCHEMA_NAME,
    schema: THING_REBUILD_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: THING_REBUILD_MAX_OUTPUT_TOKENS,
    effort: "low",
    safetyIdentifier,
  };
}

/** Astra's answer as a list of raw blocks, or null. Tolerates a stray code fence. Untrusted until spliceThing normalises it. */
export function parseRebuildText(text: string): unknown[] | null {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const list = raw && typeof raw === "object" && Array.isArray((raw as { objects?: unknown }).objects) ? (raw as { objects: unknown[] }).objects : null;
  if (!list || list.length === 0 || list.length > THING_REBUILD_MAX_OBJECTS) return null;
  return list;
}

export type RebuildRefusal = "empty" | "too-many" | "split" | "merged" | "family" | "length" | "lost";

export type RebuildResult = { ok: true; spec: SetSpec; key: string; blocks: number } | { ok: false; why: RebuildRefusal };

const family = (k: SetElement["kind"]) => (k === "object" ? "object" : "vehicle");

/**
 * The working set with the thing's old blocks out and the new ones in, at
 * the place in the list its first block had (so it keeps its number among
 * its kind), then held to what the set promises. A repeated object that is
 * only partly this thing (a row of barriers the car touched) is split into
 * its copies, and only the thing's copies go.
 */
export function spliceThing(spec: SetSpec, el: SetElement, raw: readonly unknown[]): RebuildResult {
  const [cx, , cz] = el.centre;
  // Back to the set's frame. A position that is not three numbers is left for the normaliser to refuse or default.
  const world = raw.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const p = (entry as { position?: unknown }).position;
    if (!Array.isArray(p) || p.length !== 3 || !p.every((n) => typeof n === "number" && Number.isFinite(n))) return entry;
    return { ...entry, position: [p[0] + cx, p[1], p[2] + cz] };
  });
  // The trust boundary: the new blocks go through the set's own normaliser on their own first.
  const alone = normaliseSetSpec({ ...spec, objects: world });
  if (!alone.ok) return { ok: false, why: "empty" };
  const fresh = alone.spec.objects;

  const mine = new Map<number, Set<number>>();
  for (const [oi, copy] of el.members) mine.set(oi, (mine.get(oi) ?? new Set()).add(copy));
  const objects: SetObject[] = [];
  let start = -1;
  spec.objects.forEach((o, oi) => {
    const taken = mine.get(oi);
    if (!taken) {
      objects.push(o);
      return;
    }
    if (start < 0) {
      start = objects.length;
      objects.push(...fresh);
    }
    const count = o.repeat?.count ?? 1;
    for (let copy = 0; copy < count; copy++) if (!taken.has(copy)) objects.push(copyOf(o, copy));
  });
  if (start < 0) return { ok: false, why: "lost" };
  const instances = objects.reduce((n, o) => n + (o.repeat?.count ?? 1), 0);
  if (objects.length > SET_LIMITS.maxObjects || instances > SET_LIMITS.maxInstances) return { ok: false, why: "too-many" };
  const whole = normaliseSetSpec({ ...spec, objects });
  if (!whole.ok || whole.spec.objects.length !== objects.length) return { ok: false, why: "too-many" };
  const next = whole.spec;

  // One thing, exactly the new blocks: none left out as structure or apart, none joined to a neighbour.
  const ids = new Set<string>();
  for (let i = start; i < start + fresh.length; i++) for (let copy = 0; copy < (next.objects[i].repeat?.count ?? 1); copy++) ids.add(`${i}:${copy}`);
  const els = setElements(next);
  const holders = els.filter((e) => e.members.some(([oi, copy]) => ids.has(`${oi}:${copy}`)));
  if (holders.length !== 1) return { ok: false, why: "split" };
  const thing = holders[0];
  if (thing.members.length !== ids.size) return { ok: false, why: thing.members.length > ids.size ? "merged" : "split" };
  if (els.length !== setElements(spec).length) return { ok: false, why: "merged" };
  if (family(thing.kind) !== family(el.kind)) return { ok: false, why: "family" };
  const lengthOf = (e: SetElement) => Math.max(e.max[0] - e.min[0], e.max[2] - e.min[2]);
  const ratio = lengthOf(thing) / Math.max(0.01, lengthOf(el));
  if (ratio < THING_REBUILD_LENGTH_RANGE[0] || ratio > THING_REBUILD_LENGTH_RANGE[1]) return { ok: false, why: "length" };
  // Its photos find it again, as they find any thing changed where it stood.
  const probe: ElementPhoto = { refId: "00000000-0000-4000-8000-000000000000", anchor: el.key, slot: 1, at: 0, url: "" };
  if (resolvePhotos(els, [probe]).held[0]?.key !== thing.key) return { ok: false, why: "lost" };
  return { ok: true, spec: next, key: thing.key, blocks: ids.size };
}
