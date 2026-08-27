import { describe, expect, it } from "vitest";
import { CINEMA_PRESETS, getCinemaPreset, applyCinemaPreset, isProvenPreset, resolvePresetBlocks } from "./cinema-presets";

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

describe("resolvePresetBlocks (stacking)", () => {
  const move = CINEMA_PRESETS.find((p) => p.category === "move" && isProvenPreset(p))!;
  const move2 = CINEMA_PRESETS.filter((p) => p.category === "move" && isProvenPreset(p))[1]!;
  const look = CINEMA_PRESETS.find((p) => p.category === "look" && isProvenPreset(p))!;

  it("stacks one preset per category in fixed craft order (camera before light)", () => {
    // Arming order must not matter — look-then-move still compiles move first.
    expect(resolvePresetBlocks([look.id, move.id])).toBe(`${move.block}\n\n${look.block}`);
  });

  it("two of the same category: first id wins, no doubled block", () => {
    expect(resolvePresetBlocks([move.id, move2.id])).toBe(move.block);
  });

  it("unknown and unproven ids drop out silently", () => {
    const draft = CINEMA_PRESETS.find((p) => !isProvenPreset(p));
    const ids = ["no-such-preset", ...(draft ? [draft.id] : []), look.id];
    expect(resolvePresetBlocks(ids)).toBe(look.block);
    expect(resolvePresetBlocks(["nothing", "here"])).toBeNull();
  });
});
