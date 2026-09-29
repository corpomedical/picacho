import { describe, expect, it } from "vitest";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";
import {
  ENGINES,
  FEATURED_PHOTO,
  KEEP_THE_SHOT,
  PHOTO_CATEGORIES,
  PHOTO_PRESETS,
  SHOT_CATEGORIES,
  SHOT_RECIPES,
  creditsFor,
  engineUsd,
  expectedUsd,
  presetBody,
  searchPresets,
} from "./catalog";
import { PIXVERSE_EFFECTS, VIDU_TEMPLATES, WAN_EFFECTS } from "./presets-data";

describe("the effects library", () => {
  it("prices by the engines' own pages and our credit rule", () => {
    expect(engineUsd("flux3", 5)).toBeCloseTo(0.15);
    expect(engineUsd("flux3", 40)).toBeCloseTo(0.45); // capped at the engine's 15 s
    expect(engineUsd("pixverse", null)).toBe(0.2);
    expect(engineUsd("wan", null)).toBe(0.35);
    expect(engineUsd("vidu", null)).toBe(0.5);
    expect(creditsFor(0.2)).toBe(1);
    expect(creditsFor(0.28)).toBe(1);
    expect(creditsFor(0.35)).toBe(2);
    expect(creditsFor(expectedUsd("shot", "flux3", 10))).toBe(2); // 0.30 + 0.08
  });

  it("offers the photo effects the providers accept, minus the ones Picacho leaves out", () => {
    expect(PHOTO_PRESETS.length).toBe(PIXVERSE_EFFECTS.length + WAN_EFFECTS.length + VIDU_TEMPLATES.length);
    expect(PHOTO_PRESETS.length).toBeGreaterThan(250);
    const ids = PHOTO_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const left of ["pixverse:Squid Game", "pixverse:Bikini Up", "wan:gun-shooting", "vidu:superman", "vidu:ghibli", "vidu:wish_sender"]) {
      expect(ids).not.toContain(left);
    }
    for (const p of PHOTO_PRESETS) expect(PHOTO_CATEGORIES).toContain(p.category);
    expect(FEATURED_PHOTO.length).toBeGreaterThanOrEqual(15);
  });

  it("builds each photo engine's request from its own schema", () => {
    const pv = PHOTO_PRESETS.find((p) => p.id === "pixverse:Dust Me Away")!;
    expect(presetBody(pv, "https://x/p.jpg", { width: 1024, height: 1536 })).toEqual({ image_url: "https://x/p.jpg", effect: "Dust Me Away", resolution: "720p", duration: "5" });
    const wan = PHOTO_PRESETS.find((p) => p.id === "wan:inflate")!;
    expect(presetBody(wan, "https://x/p.jpg", { width: 1024, height: 1536 })).toMatchObject({ effect_type: "inflate", aspect_ratio: "9:16", subject: expect.any(String) });
    const vidu = PHOTO_PRESETS.find((p) => p.id === "vidu:earth_zoom_out")!;
    expect(presetBody(vidu, "https://x/p.jpg", { width: 1920, height: 1080 })).toEqual({ input_image_urls: ["https://x/p.jpg"], template: "earth_zoom_out", aspect_ratio: "16:9" });
    expect(vidu.name).toBe("Earth Zoom Out");
  });

  it("finds effects by any word of their name or group", () => {
    expect(searchPresets("liquid metal").map((p) => p.id)).toEqual(expect.arrayContaining(["pixverse:Liquid Metal", "vidu:covered_liquid_metal"]));
    expect(searchPresets("zzz-nothing")).toEqual([]);
    expect(searchPresets("").length).toBe(PHOTO_PRESETS.length);
  });

  it("names every effect on a video in all four languages, and keeps the shot in every instruction", () => {
    for (const r of SHOT_RECIPES) expect(SHOT_CATEGORIES).toContain(r.category);
    for (const m of [en, es, pt, it_]) {
      expect(Object.keys(m.effects.shots).sort()).toEqual(SHOT_RECIPES.map((r) => r.id).sort());
    }
    expect(KEEP_THE_SHOT).toContain("faces");
    expect(ENGINES.flux3.endpoint).toBe("blackforestlabs/flux-3/edit-video");
  });
});
