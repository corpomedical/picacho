import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import raceTrack from "./fixtures-race-track.json";
import showroomOpen from "./fixtures-showroom-open.json";
import { normaliseSetSpec, type SetObject, type SetSpec } from "./set-spec";
import { resolvePhotos, setElements, type ElementPhoto } from "./elements";
import { SET_SPEC_JSON_SCHEMA } from "./set-builder-prompt";
import { worstCaseAstraUsd } from "../astra/prices";
import {
  THING_REBUILD_INSTRUCTIONS,
  THING_REBUILD_MAX_OBJECTS,
  THING_REBUILD_MAX_OUTPUT_TOKENS,
  THING_REBUILD_OPEN_TO_ALL,
  parseRebuildText,
  spliceThing,
  thingLocalBlocks,
  thingRebuildInput,
  thingRebuildRequest,
} from "./thing-rebuild";

// A thing rebuilt from its photos (2026-09-24): what Astra is sent, and how
// its answer is spliced into the set — kept only when it is still one
// thing of the same family, about the same length, found by its photos.

const load = (raw: unknown): SetSpec => {
  const n = normaliseSetSpec(raw);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const race = load(raceTrack);
const car = setElements(race).find((e) => e.kind === "car")!;
const photo = "data:image/jpeg;base64,/9j/4AAQ";

/** The car's own blocks as Astra would answer them, changed by `edit`. */
const answer = (edit: (o: SetObject) => SetObject = (o) => o) => thingLocalBlocks(race, car).map(edit);

describe("what Astra is sent", () => {
  it("is the thing's own blocks in its own frame, then its photos at detail high", () => {
    const local = thingLocalBlocks(race, car);
    expect(local).toHaveLength(car.members.length);
    expect(local.every((o) => o.repeat === null && o.material !== null)).toBe(true);
    // The footprint's middle is the origin; the ground stays the ground.
    const xs = local.map((o) => o.position[0]);
    expect(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2)).toBeLessThan(0.6);
    expect(Math.min(...local.map((o) => o.position[1] - o.size[1] / 2))).toBeGreaterThanOrEqual(-0.05);

    const input = thingRebuildInput(race, car, [photo, photo]);
    expect(Array.isArray(input)).toBe(true);
    const parts = (input as Exclude<typeof input, string>)[0].content;
    expect(parts[0].type).toBe("input_text");
    expect(parts.filter((p) => p.type === "input_image")).toEqual([
      { type: "input_image", image_url: photo, detail: "high" },
      { type: "input_image", image_url: photo, detail: "high" },
    ]);
    expect((parts[0] as { text: string }).text).toContain("The thing is a car.");
  });

  it("keeps its instructions stable, answers only blocks in the set's own object schema, at low effort", () => {
    const req = thingRebuildRequest(race, car, [photo], "safety");
    expect(req.instructions).toBe(THING_REBUILD_INSTRUCTIONS);
    // Nothing per request in the cacheable prefix.
    expect(THING_REBUILD_INSTRUCTIONS).not.toContain("current footprint is");
    expect(THING_REBUILD_INSTRUCTIONS).not.toContain(photo);
    expect(req.schema).toEqual({ type: "object", additionalProperties: false, required: ["objects"], properties: { objects: SET_SPEC_JSON_SCHEMA.properties.objects } });
    expect(req.effort).toBe("low");
    expect(req.maxOutputTokens).toBe(THING_REBUILD_MAX_OUTPUT_TOKENS);
    expect(req.safetyIdentifier).toBe("safety");
    // Plain shapes: no logos, no text, no people.
    expect(THING_REBUILD_INSTRUCTIONS).toMatch(/never copy a logo/);
    expect(THING_REBUILD_INSTRUCTIONS).toMatch(/Never model a person/);
  });

  it("costs at most $0.70 a rebuild, worst case", () => {
    // Every input token billed as a cache write; four photos at ≤ 2,048 px ≈ 2,300 tokens each
    // (set-config.ts: the photo-build rules and a 1536×1024 photo measured 2,150–2,280);
    // the instructions and the car's blocks at ~2.24 characters a token.
    const text = THING_REBUILD_INSTRUCTIONS.length + JSON.stringify(thingLocalBlocks(race, car)).length + 400;
    const inputTokens = Math.ceil(text / 2.24) + 4 * 2_300;
    expect(worstCaseAstraUsd(inputTokens, THING_REBUILD_MAX_OUTPUT_TOKENS)).toBeLessThan(0.7);
  });
});

describe("the answer", () => {
  it("is a list of blocks, or nothing", () => {
    expect(parseRebuildText('```json\n{"objects":[{"shape":"box"}]}\n```')).toHaveLength(1);
    expect(parseRebuildText("not json")).toBeNull();
    expect(parseRebuildText('{"objects":[]}')).toBeNull();
    expect(parseRebuildText(JSON.stringify({ objects: Array.from({ length: THING_REBUILD_MAX_OBJECTS + 1 }, () => ({})) }))).toBeNull();
  });
});

describe("the splice", () => {
  it("puts the new blocks where the old ones stood, keeps the car's number, and its photos find it", () => {
    const r = spliceThing(race, car, answer((o) => (o.material === "paint" ? { ...o, color: "#1d4fb8" } : o)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const els = setElements(r.spec);
    const now = els.find((e) => e.key === r.key)!;
    expect(now.kind).toBe("car");
    expect(now.ordinal).toBe(car.ordinal);
    expect(Math.hypot(now.centre[0] - car.centre[0], now.centre[2] - car.centre[2])).toBeLessThan(0.05);
    expect(r.key).not.toBe(car.key);
    const probe: ElementPhoto = { refId: "11111111-1111-4111-8111-111111111111", anchor: car.key, slot: 1, at: 0, url: "" };
    expect(resolvePhotos(els, [probe]).held[0]).toMatchObject({ key: r.key, how: "changed" });
    // Every other thing is as it was.
    const others = (s: SetSpec, skip: string) => setElements(s).filter((e) => e.key !== skip).map((e) => e.key).sort();
    expect(others(r.spec, r.key)).toEqual(others(race, car.key));
    // The rest of the set too: its description, marks and cameras.
    expect(r.spec.description).toBe(race.description);
    expect(r.spec.cameras).toEqual(race.cameras);
  });

  it("refuses a thing a third longer, one without its wheels, and a block left standing apart", () => {
    // A third longer, every block grown with it, so it is still one thing (and no block passes 6 m, where a shape becomes structure).
    const grow = (o: SetObject): SetObject => ({ ...o, position: [o.position[0] * 1.3, o.position[1], o.position[2] * 1.3], size: [o.size[0] * 1.3, o.size[1], o.size[2] * 1.3] });
    const longer = spliceThing(race, car, answer(grow));
    expect(longer).toEqual({ ok: false, why: "length" });
    const wheelless = spliceThing(
      race,
      car,
      answer().filter((o) => !(o.shape === "cylinder" && o.material === "rubber")),
    );
    expect(wheelless.ok).toBe(false);
    const apart = spliceThing(race, car, [...answer(), { ...answer()[0], position: [40, 0.5, 40] }]);
    expect(apart).toEqual({ ok: false, why: "split" });
  });

  it("splits a row that was only partly the thing, and takes only the thing's copies", () => {
    const show = load(showroomOpen);
    const els = setElements(show);
    const partly = els.find((e) => e.members.some(([oi]) => (show.objects[oi].repeat?.count ?? 1) > 1 && !e.members.every(([o]) => o === oi)));
    const target = partly ?? els[0];
    const r = spliceThing(show, target, thingLocalBlocks(show, target));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const count = (s: SetSpec) => s.objects.reduce((n, o) => n + (o.repeat?.count ?? 1), 0);
    expect(count(r.spec)).toBe(count(show));
  });

  it("refuses more blocks than the set can draw", () => {
    const many = Array.from({ length: 50 }, () => ({ ...answer()[0], repeat: { count: 50, offset: [0.01, 0, 0] } }));
    expect(spliceThing(race, car, many)).toEqual({ ok: false, why: "too-many" });
  });
});

// The card's row and the page's side, read as source like the page's other tests.
describe("the card", () => {
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  const card = readFileSync(join(__dirname, "../../components/sets/element-card.tsx"), "utf8");
  const actions = readFileSync(join(__dirname, "editor-actions.ts"), "utf8");

  it("offers the rebuild to admins while the first live one is owed, and never during a film", () => {
    expect(THING_REBUILD_OPEN_TO_ALL).toBe(false);
    expect(actions).toContain("if (!THING_REBUILD_OPEN_TO_ALL && !access.isAdmin) return { error: THING_REBUILD_ADMINS_ONLY };");
    expect(view).toContain("thingKey && (THING_REBUILD_OPEN_TO_ALL || modelsOn) && !filmOpen && !cutOpen");
    for (const hook of ["data-el-rebuild", "data-el-rebuild-go", "data-el-rebuild-note", "data-el-rebuild-undo"]) expect(card, hook).toContain(hook);
  });

  it("is one of the month's Astra changes, asked after the photos are found", () => {
    const fn = actions.slice(actions.indexOf("export async function rebuildThingFromPhotos"));
    expect(fn.indexOf("return { error: THING_REBUILD_NO_PHOTOS }")).toBeLessThan(fn.indexOf("await astraChangeSlot(access)"));
    expect(fn.indexOf("await astraChangeSlot(access)")).toBeLessThan(fn.indexOf("await askAstra("));
  });

  it("follows the thing to its new key, and its Undo takes it back", () => {
    expect(view).toContain("moveThingKey(key, to);");
    expect(view).toContain("moveThingKey(to, from);");
    expect(view).toContain("specBeforeEditRef.current = before;");
  });
});
