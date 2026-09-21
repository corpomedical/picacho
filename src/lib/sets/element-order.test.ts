import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import raceTrack from "./fixtures-race-track.json";
import { LAYOUT_ELEMENT_KEY_RE, LAYOUT_ELEMENT_ORDER_MAX, normaliseElementOrder, normaliseSetLayout, normaliseSetSpec, type SetSpec } from "./set-spec";
import { ELEMENT_KEY_RE } from "./elements";

// The person's order for the things' sheets (R1, 2026-09-21, the cast
// strip): kept in the arrangement, cleaned like the rest of it, read by the
// shot when no film sends its own, and saved when the strip is reordered.

const spec = (() => {
  const n = normaliseSetSpec(raceTrack);
  if (!n.ok) throw new Error("fixture");
  return n.spec as SetSpec;
})();
const layout = { markId: spec.marks[0].id, mark: { x: 0, z: 0, facingDeg: 0 }, camera: null, pose: "stand", gaze: null };

describe("normaliseElementOrder", () => {
  it("keeps element keys only, each once, and no more than a set holds photos on", () => {
    expect(normaliseElementOrder(["c_89e319be_0_-1", "o_12345678_3_-4", "c_89e319be_0_-1", "figure", 7, "c_zz_1_1"])).toEqual(["c_89e319be_0_-1", "o_12345678_3_-4"]);
    const many = Array.from({ length: 40 }, (_, i) => `o_${String(i).padStart(8, "0")}_0_0`);
    expect(normaliseElementOrder(many)).toHaveLength(LAYOUT_ELEMENT_ORDER_MAX);
    expect(normaliseElementOrder("c_89e319be_0_-1")).toBeNull();
    expect(normaliseElementOrder(undefined)).toBeNull();
  });
  it("reads keys with the elements' own pattern", () => {
    expect(LAYOUT_ELEMENT_KEY_RE.source).toBe(ELEMENT_KEY_RE.source);
  });
});

describe("the arrangement", () => {
  it("keeps an order when one was set, and says nothing of it when none was", () => {
    expect(normaliseSetLayout({ ...layout, elementOrder: ["c_89e319be_0_-1"] }, spec)?.elementOrder).toEqual(["c_89e319be_0_-1"]);
    expect(normaliseSetLayout(layout, spec)).not.toHaveProperty("elementOrder");
    expect(normaliseSetLayout({ ...layout, elementOrder: [] }, spec)).not.toHaveProperty("elementOrder");
  });
});

describe("the page and the shot", () => {
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
  it("a reorder goes into the arrangement and is saved with it", () => {
    const re = view.slice(view.indexOf("function reorderElement("), view.indexOf("function openElementCard("));
    expect(re).toContain("layoutRef.current = { ...layoutRef.current, elementOrder: next };");
    expect(re).toContain("scheduleSave();");
    // What is saved is the ref, whole.
    expect(view).toContain("saveSetLayout(setId, { ...layoutRef.current, camera: api.pose() })");
    expect(view).toContain("elementOrder: initialLayout?.elementOrder ?? ([] as string[]),");
  });
  it("a still plans with the saved order; a film's own order wins when it sends one", () => {
    expect(actions).toContain("order: normaliseElementOrder(input.elementOrder) ?? layout?.elementOrder,");
    expect(view).toContain("(pose: Pose | null, m: Mark, order: readonly string[] = elementOrder) =>");
  });
  it("the strip drags with a mouse or a pen and moves with Alt+arrows; the card moves for a finger", () => {
    const strip = readFileSync(join(__dirname, "../../components/sets/cast-strip.tsx"), "utf8");
    expect(strip).toContain('if (!thing || e.button !== 0 || e.pointerType === "touch") return;');
    expect(strip).toContain('onReorder(chip.key, e.key === "ArrowLeft" ? at - 1 : at + 1);');
    const card = readFileSync(join(__dirname, "../../components/sets/element-card.tsx"), "utf8");
    expect(card).toContain("data-el-move");
  });
});
