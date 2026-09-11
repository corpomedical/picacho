import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  SET_BUILDER_INSTRUCTIONS,
  SET_PHOTO_RULES,
  SET_SPEC_JSON_SCHEMA,
  photoBuildInput,
  setBuildInput,
} from "./set-builder-prompt";
import { normaliseSetSpec } from "./set-spec";
import rainyMarket from "./fixtures-rainy-market.json";

// What Astra is told, and the schema it must answer in. Two failures this
// guards against: a schema OpenAI's strict mode rejects (every build would
// fail with a 400 the moment someone adds a field without listing it as
// required), and a rule that decides what reaches a render quietly
// disappearing from the instructions.

type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  anyOf?: Schema[];
};

function objectSchemas(s: Schema, path: string, out: { path: string; s: Schema }[] = []) {
  if (s.type === "object") out.push({ path, s });
  for (const [k, v] of Object.entries(s.properties ?? {})) objectSchemas(v, `${path}.${k}`, out);
  if (s.items) objectSchemas(s.items, `${path}[]`, out);
  for (const [i, v] of (s.anyOf ?? []).entries()) objectSchemas(v, `${path}|${i}`, out);
  return out;
}

describe("the set schema", () => {
  const objects = objectSchemas(SET_SPEC_JSON_SCHEMA as unknown as Schema, "$");

  it("is valid strict structured output everywhere: closed objects, every property required", () => {
    expect(objects.length).toBeGreaterThan(5);
    for (const { path, s } of objects) {
      expect(s.additionalProperties, `${path} must set additionalProperties: false`).toBe(false);
      expect([...(s.required ?? [])].sort(), `${path}: required must list every property`).toEqual(
        Object.keys(s.properties ?? {}).sort(),
      );
    }
  });

  it("asks for exactly the fields the normaliser reads", () => {
    const r = normaliseSetSpec(rainyMarket);
    if (!r.ok) throw new Error("fixture");
    const read = Object.keys(r.spec).filter((k) => k !== "version").sort();
    expect(Object.keys(SET_SPEC_JSON_SCHEMA.properties).sort()).toEqual(read);
  });
});

describe("the builder's rules", () => {
  it("keeps people out of the set, and brands out of everything", () => {
    expect(SET_BUILDER_INSTRUCTIONS).toContain("Never model people, animals or characters, and never describe a person.");
    expect(SET_BUILDER_INSTRUCTIONS).toContain("No brand names, logos, readable text or real trademarks anywhere");
  });

  it("closes the set, so no camera sees where it ends", () => {
    // Measured 2026-09-10: without this rule 7 of 16 eye-level directions
    // (two sets, eight each) showed bare ground meeting sky; with it, 0 of 16,
    // judged blind by three judges per set. The image model invents whatever
    // it likes in a gap, and a set exists so the place stays the same.
    expect(SET_BUILDER_INSTRUCTIONS).toContain("Close the set, so no camera ever sees where it ends.");
    // Both interiors built on the first closed-set rule (production,
    // 2026-09-11) left out the wall behind their cameras — the theatre's
    // fourth wall. A camera here turns all the way round.
    expect(SET_BUILDER_INSTRUCTIONS).toContain("There is NO fourth wall");
  });

  it("appends only the person's brief after the stable prefix", () => {
    expect(setBuildInput("a quiet harbour at dawn")).toBe("Brief: a quiet harbour at dawn");
  });
});

describe("the cached prefix both kinds of build share", () => {
  // The instructions plus the schema are the request's cacheable prefix, and
  // a photo build sends them unchanged so it reads the cache a text build
  // wrote. Recorded 2026-09-11 BEFORE Sets from a photo touched this file:
  // any byte that moves here is a fresh cache write on every build of both
  // kinds, and must be a decision, not an accident.
  it("is byte for byte what it was before photo builds existed", () => {
    const prefix = SET_BUILDER_INSTRUCTIONS + JSON.stringify(SET_SPEC_JSON_SCHEMA);
    expect(prefix.length).toBe(8132);
    expect(createHash("sha256").update(prefix).digest("hex")).toBe(
      "6556a49f578d641e0e96f4e4cb8db9a07c18d3d466177fce838f4305367309c9",
    );
  });
});

describe("the photo rules", () => {
  it("put camera 1 where the photographer stood, with the photo's vertical field of view", () => {
    expect(SET_PHOTO_RULES).toContain("cameras[0] is the photographer");
    expect(SET_PHOTO_RULES).toContain("VERTICAL field of view");
    // The normaliser clamps cameras to the bounds + 10 m: the bounds must reach the camera.
    expect(SET_PHOTO_RULES).toContain("Choose bounds that contain this position.");
  });

  it("pin which way camera 1 looks, so the set is never the photo's mirror image", () => {
    // The first real photo build came back mirrored: three.js is right-handed,
    // and a camera looking toward +Z sees +X on its left.
    expect(SET_PHOTO_RULES).toContain("Put cameras[0] on the +Z side of the set, looking toward -Z");
    expect(SET_PHOTO_RULES).toContain("whatever is on the left of the photo goes at negative x");
    expect(SET_PHOTO_RULES).toContain("Never mirror the photo.");
  });

  it("put the structure first in the shape budget", () => {
    expect(SET_PHOTO_RULES).toContain("List the floor, walls, ceiling and whatever closes each side first");
    expect(SET_PHOTO_RULES).toContain("repeat small props fewer times rather than leave out anything structural");
  });

  it("never let a person in the photo be modelled, identified or described", () => {
    expect(SET_PHOTO_RULES).toContain("Never model a person.");
    expect(SET_PHOTO_RULES).toContain("Never identify, name or describe anyone");
  });

  it("keep brands, text and the real place's name out", () => {
    expect(SET_PHOTO_RULES).toContain("Signs, posters and screens are blank shapes");
    expect(SET_PHOTO_RULES).toContain("do not name the real place, business, street or address");
  });

  it("close what the photo does not show, and let the photo outrank the notes", () => {
    expect(SET_PHOTO_RULES).toContain("Close every side it does not show");
    expect(SET_PHOTO_RULES).toContain("follow the photo");
  });

  it("stay inside the input-token budget set-config.ts prices", () => {
    // ≤ 2,000 characters ≈ ≤ 500 tokens, the figure in SET_PHOTO_BUILD_INPUT_TOKENS.
    expect(SET_PHOTO_RULES.length).toBeLessThanOrEqual(2_000);
  });
});

describe("photoBuildInput", () => {
  const photo = "data:image/jpeg;base64,/9j/AAAA";
  type Part = { type: string; text?: string; image_url?: string; detail?: string };
  const parts = (input: unknown): Part[] => {
    const messages = input as { role: string; content: Part[] }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    return messages[0].content;
  };

  it("is one user message: the rules, then the photo at detail high", () => {
    const p = parts(photoBuildInput(photo, ""));
    expect(p).toHaveLength(2);
    expect(p[0]).toEqual({ type: "input_text", text: SET_PHOTO_RULES });
    expect(p[1]).toEqual({ type: "input_image", image_url: photo, detail: "high" });
  });

  it("adds the photographer's notes only when there are any, and the tail last", () => {
    const withNotes = parts(photoBuildInput(photo, "It is night.", "TAIL"));
    expect(withNotes).toHaveLength(4);
    expect(withNotes[2]).toEqual({ type: "input_text", text: "Notes from the photographer: It is night." });
    expect(withNotes[3]).toEqual({ type: "input_text", text: "TAIL" });
    const noNotes = parts(photoBuildInput(photo, "", "TAIL"));
    expect(noNotes).toHaveLength(3);
    expect(noNotes[2]).toEqual({ type: "input_text", text: "TAIL" });
    expect(noNotes.some((p) => p.text?.startsWith("Notes from the photographer:"))).toBe(false);
  });

  it("gives a retry the same first two parts as the first attempt, so they share a prefix", () => {
    const first = parts(photoBuildInput(photo, "n"));
    const retry = parts(photoBuildInput(photo, "n", "Your previous set was open"));
    expect(retry.slice(0, 2)).toEqual(first.slice(0, 2));
  });

  it("never sends the placeholder brief a photo build's row holds", () => {
    expect(JSON.stringify(photoBuildInput(photo, ""))).not.toContain("Brief:");
  });
});
