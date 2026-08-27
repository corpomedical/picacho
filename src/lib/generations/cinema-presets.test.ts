import { describe, expect, it } from "vitest";
import { CINEMA_PRESETS, getCinemaPreset, applyCinemaPreset, isProvenPreset } from "./cinema-presets";

// Structural pins for the preset catalog. The QUALITY of each block is
// proven by its validation render (see the module comment) — what tests can
// pin is the contract around them: ids stay stable and well-formed, blocks
// stay non-trivial fixed text, and application is deterministic and safe
// for stale ids.

describe("CINEMA_PRESETS catalog", () => {
  it("ids are unique, kebab-case, and stable-looking", () => {
    const ids = CINEMA_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("every preset has a substantial fixed block and a valid category", () => {
    for (const p of CINEMA_PRESETS) {
      expect(p.block.length).toBeGreaterThan(60);
      expect(p.block.length).toBeLessThan(500);
      expect(["move", "look", "fx"]).toContain(p.category);
      // Blocks are single-purpose instructions, never templates.
      expect(p.block).not.toContain("{");
    }
  });

  it("each PROVEN preset has its proof-render thumbnail checked in", async () => {
    const fs = await import("node:fs");
    for (const p of CINEMA_PRESETS.filter(isProvenPreset)) {
      expect(fs.existsSync(`public/presets/${p.id}.jpg`), `missing thumbnail for ${p.id}`).toBe(true);
    }
  });

  it("unproven drafts are invisible to the product until validated", () => {
    const drafts = CINEMA_PRESETS.filter((p) => !isProvenPreset(p));
    // The 2026-08-27 batch ships drafted-but-unvalidated (fal balance low —
    // "add it and we test later"). If this list is empty, the validation
    // ran: delete this assertion block, keep the gating ones below.
    for (const p of drafts) {
      // Server refuses to arm them — a crafted id gets a no-op, not a block.
      expect(getCinemaPreset(p.id)).toBeNull();
      expect(applyCinemaPreset("Eva at the beach", p.id)).toBe("Eva at the beach");
    }
  });
});

describe("applyCinemaPreset", () => {
  it("appends the block after a blank line, exactly as the matrix fired it", () => {
    const preset = CINEMA_PRESETS[0];
    expect(applyCinemaPreset("Eva walks through the rain", preset.id)).toBe(
      `Eva walks through the rain\n\n${preset.block}`,
    );
  });

  it("is a silent no-op for unknown or stale ids (deleted presets must never fail a render)", () => {
    expect(applyCinemaPreset("Eva walks", "dolly-zoom")).toBe("Eva walks");
    expect(applyCinemaPreset("Eva walks", "nonsense-id")).toBe("Eva walks");
    expect(applyCinemaPreset("Eva walks", null)).toBe("Eva walks");
    expect(applyCinemaPreset("Eva walks", undefined)).toBe("Eva walks");
    expect(applyCinemaPreset("Eva walks", "")).toBe("Eva walks");
  });

  it("getCinemaPreset resolves shipped ids and rejects the cut one", () => {
    expect(getCinemaPreset("golden-hour")?.category).toBe("look");
    expect(getCinemaPreset("crash-zoom")?.category).toBe("move");
    // dolly-zoom was cut in validation (the vertigo warp never visibly
    // happened) — it must stay gone until a render proves it.
    expect(getCinemaPreset("dolly-zoom")).toBeNull();
  });
});
