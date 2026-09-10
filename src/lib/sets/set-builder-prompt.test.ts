import { describe, expect, it } from "vitest";
import { SET_BUILDER_INSTRUCTIONS, SET_SPEC_JSON_SCHEMA, setBuildInput } from "./set-builder-prompt";
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
  });

  it("appends only the person's brief after the stable prefix", () => {
    expect(setBuildInput("a quiet harbour at dawn")).toBe("Brief: a quiet harbour at dawn");
  });
});
