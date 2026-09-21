import { describe, expect, it } from "vitest";
import en from "../i18n/messages/en";
import { afterShotWhy, beforeShoot, pageState, ridesState, statusWords, type ElementState } from "./element-status";

// What the page says about each thing with photos (R1, 2026-09-21): every
// state has its chip word and its sentence in the catalogue, the numbers
// reach the sentence, and the page's state follows the plan and the sheet.

const STATES: ElementState[] = ["rides", "draw", "drawing", "no-room", "alike", "behind", "out", "hidden", "model", "refused", "failed", "loose"];

describe("statusWords", () => {
  it("names a catalogue word and sentence for every state, with the sentence's numbers", () => {
    for (const state of STATES) {
      const w = statusWords(state, { sheet: 2, count: 2, max: 2, like: 1 });
      expect(en.sets.cast[w.short], state).toBeTruthy();
      expect(en.sets.cast[w.long], state).toBeTruthy();
      for (const ph of en.sets.cast[w.long].match(/\{(\w+)\}/g) ?? []) expect(w.params, `${state} ${ph}`).toHaveProperty(ph.slice(1, -1));
    }
    expect(statusWords("rides", { sheet: 1, count: 2 }).params).toEqual({ n: 1, count: 2 });
    expect(statusWords("no-room", { max: 2 }).params).toEqual({ max: 2 });
    expect(statusWords("alike", { like: 3 }).params).toEqual({ n: 3 });
  });

  it("wears the accent only while the sheet rides, drawn or about to be", () => {
    expect(STATES.filter(ridesState)).toEqual(["rides", "draw", "drawing"]);
  });
});

describe("pageState", () => {
  const none = { drawn: false, drawing: false, last: null } as const;
  it("follows the sheet when it rides", () => {
    expect(pageState("rode", { ...none, drawn: true })).toBe("rides");
    expect(pageState("rode", { ...none, drawing: true })).toBe("drawing");
    expect(pageState("rode", { ...none, last: "refused" })).toBe("refused");
    expect(pageState("rode", none)).toBe("draw");
  });
  it("keeps the plan's reason otherwise", () => {
    expect(pageState("alike", none)).toBe("alike");
    expect(pageState("hidden", none)).toBe("hidden");
    expect(pageState("model", none)).toBe("model");
    expect(pageState("not-sent", none)).toBe("failed");
  });
});

describe("after a shot and before one", () => {
  it("says why a thing in the frame didn't ride, and nothing for one that did or was out of it", () => {
    expect(afterShotWhy("rode")).toBeNull();
    expect(afterShotWhy("out")).toBeNull();
    expect(afterShotWhy("behind")).toBeNull();
    expect(afterShotWhy("no-room")).toBe("stNoRoomLong");
    expect(afterShotWhy("no-sheet")).toBe("stFailedLong");
  });
  it("draws only the riding sheets not drawn yet, in sheet order", () => {
    const riding = [
      { key: "c_1", hash: "a" },
      { key: "o_2", hash: "b" },
    ];
    expect(beforeShoot(riding, ["a"])).toEqual(["o_2"]);
    expect(beforeShoot(riding, new Set(["a", "b"]))).toEqual([]);
    expect(beforeShoot(riding, [])).toEqual(["c_1", "o_2"]);
  });
});
