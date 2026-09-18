import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What the studio's chrome can be read against (the operator, 2026-09-18:
// "Sometimes on the menu left and top the text is unreadable from text
// color"). It was not the Screening Room: the studio's skin is its own dark
// literals in both themes. It was STATE — a tool the mode has nothing for, a
// disabled Shoot, a History with one revision — each drawn by fading the
// whole control to 35–40%, which took its ink to 1.4–2.1:1 against its own
// ground. And one colour that was always thin: #6b6f7a, the muted ink of the
// status bar, the dock's tabs and the section heads, at 3.2–3.5:1.
//
// Now there are three steps and each says one thing (the operator again, on
// a screenshot: "Even the available control is dimmed"):
//   picked      the ochres, #e0a468 and #f0cda6
//   available   #c6c9d1, 9.8:1 — every control that lights on hover, so a
//               choice you can make never reads as one you cannot
//   off / label #868b96, 4.75:1 — dim, and still above the floor
// A state is said in a COLOUR, never in an opacity.
//
// The maths here is WCAG 2.1's, on the source's own literals: nothing is
// measured in a browser, so this runs in the suite and catches the next one.

const dir = join(__dirname, "../../components/sets");
const frame = readFileSync(join(dir, "studio-frame.tsx"), "utf8");
const view = readFileSync(join(dir, "set-view.tsx"), "utf8");

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const channel = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG's contrast ratio, 1 (none) to 21 (black on white). */
export const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `fg` drawn at `alpha` over `bg`, as an opacity utility composites it. */
const over = (fg: string, alpha: number, bg: string) => {
  const [f, b] = [rgb(fg), rgb(bg)];
  return `#${f.map((c, i) => Math.round(alpha * c + (1 - alpha) * b[i]).toString(16).padStart(2, "0")).join("")}`;
};

/** The studio's own grounds (studio-frame.tsx). */
const BAR = "#191a20";
const PANEL = "#1f2026";
const PILL = "#2a2b33";
const OCHRE = "#e0a468";

/** Every text colour the chrome uses, the ground it sits on, and what it is. */
const INK: { ink: string; on: string; what: string; icon?: boolean }[] = [
  { ink: "#ecedf1", on: BAR, what: "the title and everything hovered" },
  { ink: "#c6c9d1", on: BAR, what: "a mode, a view or a tool you can pick" },
  { ink: "#c6c9d1", on: PANEL, what: "a dock tab, a shutter, an ISO, an aid you can pick" },
  { ink: "#9aa0ad", on: PANEL, what: "the panel's own prose" },
  { ink: "#868b96", on: BAR, what: "the shot count, Find anything, the status bar" },
  { ink: "#868b96", on: PANEL, what: "a tool this mode has nothing for, a section head" },
  { ink: "#e0a468", on: PILL, what: "the mode this page is in" },
  { ink: "#f0cda6", on: PANEL, what: "the dock tab that is open" },
];

/** What a control you can use must clear, over what a label must. */
const CONTROL_INK = "#c6c9d1";

describe("the studio's chrome can be read", () => {
  it("every ink meets WCAG on the ground it is drawn on", () => {
    for (const { ink, on, what, icon } of INK) {
      const need = icon ? 3 : 4.5;
      expect(ratio(ink, on), `${what}: ${ink} on ${on} is ${ratio(ink, on).toFixed(2)}:1, needs ${need}`).toBeGreaterThanOrEqual(need);
    }
  });

  it("a control you can use never wears the ink of one you cannot", () => {
    // The operator's screenshot, 2026-09-18: the shutter angles, the ISOs and
    // the viewfinder aids are all pickable, and all of them read as switched
    // off. Anything that lights on hover is a control, so its idle ink is the
    // control ink — nothing dimmer.
    for (const name of ["studio-frame.tsx", "set-view.tsx", "set-editor.tsx", "rig-panel.tsx", "sequencer.tsx"]) {
      const file = readFileSync(join(dir, name), "utf8");
      const wrong = [...file.matchAll(/text-\[(#[0-9a-f]{6})\] hover:text-\[#ecedf1\]/g)].map((m) => m[1]).filter((c) => c !== CONTROL_INK);
      expect(wrong, `${name} dims a control that can still be used`).toEqual([]);
    }
    expect(ratio(CONTROL_INK, PANEL)).toBeGreaterThanOrEqual(7);
  });

  it("names every colour the chrome actually uses, so a new one cannot slip in unmeasured", () => {
    const used = new Set([...frame.matchAll(/text-\[(#[0-9a-f]{6})\]/g)].map((m) => m[1]));
    const measured = new Set(INK.map((i) => i.ink));
    // The two dark inks are text ON the ochre and on a lit tile, measured with
    // their own ground below, not against the chrome's.
    for (const onOchre of ["#1b1c22", "#181a1f", "#14161a"]) used.delete(onOchre);
    expect([...used].filter((c) => !measured.has(c)), "a text colour in studio-frame.tsx that this test does not measure").toEqual([]);
  });

  it("the ochre a button is filled with carries dark text", () => {
    for (const m of frame.matchAll(/bg-\[#e0a468\][^"]*?text-\[(#[0-9a-f]{6})\]/g)) {
      expect(ratio(m[1], OCHRE), `${m[1]} on the ochre`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("a state is said in a colour, never by fading the whole control away", () => {
    // 35% of #9aa0ad over the rail is 1.9:1 — a shape, not a word. Any
    // `disabled:`/`aria-disabled:` opacity in the studio is this bug.
    for (const [file, name] of [
      [frame, "studio-frame.tsx"],
      [view, "set-view.tsx"],
      [readFileSync(join(dir, "set-editor.tsx"), "utf8"), "set-editor.tsx"],
      [readFileSync(join(dir, "rig-panel.tsx"), "utf8"), "rig-panel.tsx"],
      [readFileSync(join(dir, "sequencer.tsx"), "utf8"), "sequencer.tsx"],
      [readFileSync(join(dir, "scene-tree.tsx"), "utf8"), "scene-tree.tsx"],
      [readFileSync(join(dir, "command-palette.tsx"), "utf8"), "command-palette.tsx"],
    ] as const) {
      const fades = [...file.matchAll(/(?:disabled|aria-disabled):opacity-(\d+)/g)].filter((m) => m[1] !== "100");
      expect(fades.map((m) => m[0]), `${name} fades a control instead of colouring it`).toEqual([]);
    }
    // And the one that used to: a tool the mode has nothing for.
    expect(frame).toContain('const TOOL_OFF = "flex h-8 w-8 cursor-default items-center justify-center rounded-[6px] text-[#868b96]";');
    expect(over("#9aa0ad", 0.35, PANEL)).toBe("#4a4d55");
    expect(ratio(over("#9aa0ad", 0.35, PANEL), PANEL)).toBeLessThan(2);
  });

  it("what is drawn over the render is drawn for a bright one", () => {
    // The stage can be a daylight exterior: text over it is measured against
    // white, not against the chrome (the frame-line readout was 1.8:1).
    expect(view).toContain("tracking-[0.06em] text-onmedia");
    // (Only the readout: the same size and tracking is used inside the dock,
    // where the ground is the panel's and #9aa0ad reads at 6.6:1.)
    expect(view).not.toContain('absolute -top-[18px] left-0 right-0 flex justify-between gap-3 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.06em] text-[#9aa0ad]');
    // The lit chip's scrim carries the ochre over anything.
    expect(view).toContain("rounded-full border border-transparent bg-black/70");
  });
});
