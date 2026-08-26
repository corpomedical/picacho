import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./templates";

// Same proof-not-promise rule as cinema-presets: every template card shows a
// real sample render of its own prompt (Eva as the character), and a
// template without its picture on disk must fail the build rather than ship
// a broken image slot. Samples: video templates from Seedance 2.0 renders,
// image templates from the identity-preserving edit lane (2026-08-26 —
// round one on Flux was rejected in review for losing the character).

describe("generation templates", () => {
  it("ids are unique and kebab-case", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("every template has its sample picture checked in", async () => {
    const fs = await import("node:fs");
    for (const t of TEMPLATES) {
      expect(fs.existsSync(`public/templates/${t.id}.jpg`), `missing sample for ${t.id}`).toBe(true);
    }
  });
});
