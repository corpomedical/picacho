import { describe, expect, it } from "vitest";
import {
  JOB_SLOTS,
  MENUS,
  PRODUCTS,
  claudeThinkingOff,
  claudeUsd,
  isOffered,
  parseModelControls,
  pickedJobModel,
} from "./registry";
import { menuItems, offLock } from "./menus";
import { FREE_TIER_VIDEO_MODEL_ID } from "../plans";

const defaults = { video: "kling", picture: "gpt-image" };

describe("the stored choices", () => {
  it("keep only picks a job offers and menus that exist", () => {
    const c = parseModelControls(
      JSON.stringify({
        jobs: { policy_reader: "gpt-5.4", face_check: "gpt-6-luna", claude_writer: "claude-opus-5-5", nope: "x" },
        off: { video: ["veo", "veo", 3], nonsense: ["a"] },
      }),
    );
    expect(c.jobs).toEqual({ policy_reader: "gpt-5.4", claude_writer: "claude-opus-5-5" });
    expect(c.off).toEqual({ video: ["veo"] });
  });

  it("read as no choice when the row is missing or broken", () => {
    expect(parseModelControls(null)).toEqual({ jobs: {}, off: {} });
    expect(parseModelControls("{not json")).toEqual({ jobs: {}, off: {} });
    expect(pickedJobModel(parseModelControls(null), "policy_reader")).toBeNull();
    expect(isOffered(parseModelControls(null), "video", "veo")).toBe(true);
  });
});

describe("the switches only offer models that answer the job's request", () => {
  it("never offers gpt-5.5 or gpt-6 to the readers that send temperature 0 and a seed (both refuse it)", () => {
    for (const key of ["policy_reader", "studio_readers"]) {
      const ids = JOB_SLOTS.find((s) => s.key === key)!.options.map((o) => o.id);
      expect(ids).toEqual(["gpt-5.4-mini", "gpt-5.4"]);
    }
  });

  it("every job's default is one of its options, and every product exists", () => {
    const products = new Set(PRODUCTS.map((p) => p.key));
    for (const s of JOB_SLOTS) {
      expect(s.options.map((o) => o.id)).toContain(s.default);
      for (const p of s.products) expect(products.has(p)).toBe(true);
    }
    for (const m of MENUS) expect(products.has(m.product)).toBe(true);
  });

  it("spells thinking off the way each Claude model accepts it", () => {
    expect(claudeThinkingOff("claude-sonnet-5")).toEqual({ thinking: { type: "disabled" } });
    expect(claudeThinkingOff("claude-opus-5-5")).toEqual({});
  });

  it("prices each Claude model at its own rate", () => {
    expect(claudeUsd("claude-sonnet-5", 1_000_000, 0)).toBe(2);
    expect(claudeUsd("claude-opus-5-5", 0, 1_000_000)).toBe(20);
  });
});

describe("menu locks", () => {
  const none = parseModelControls(null);

  it("keep the free tier's model, the defaults and the default take engine on", () => {
    expect(offLock("video", FREE_TIER_VIDEO_MODEL_ID, none, defaults)).toMatch(/Free accounts/);
    expect(offLock("video", "kling", none, defaults)).toMatch(/default video model/);
    expect(offLock("picture", "gpt-image", none, defaults)).toMatch(/default picture model/);
    expect(offLock("helios_takes", "omni", none, defaults)).toMatch(/default/);
    expect(offLock("video", "veo", none, defaults)).toBeNull();
  });

  it("keep the last Recast engine for a job, and the last music engine", () => {
    const restage = menuItems("recast").filter((i) => i.group === "restage").map((i) => i.id);
    expect(restage.length).toBe(2);
    const oneOff = parseModelControls(JSON.stringify({ off: { recast: [restage[0]] } }));
    expect(offLock("recast", restage[1], oneOff, defaults)).toMatch(/last one/);
    const elevenOff = parseModelControls(JSON.stringify({ off: { music: ["eleven"] } }));
    expect(offLock("music", "ace", elevenOff, defaults)).toMatch(/last one/);
  });

  it("every menu lists items", () => {
    for (const m of MENUS) expect(menuItems(m.key).length).toBeGreaterThan(0);
  });
});
