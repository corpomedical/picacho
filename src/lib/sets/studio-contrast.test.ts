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
//   available   #d6d9e0, 11.5:1 — every control that lights on hover, so a
//               choice you can make never reads as one you cannot
//   prose       #c6c9d1, 9.8:1
//   off / label #9aa0ad, 6.2:1 — dim by a step, never by a half
//
// The whole scale went up one step on 2026-09-18, after the colours, the
// states and the typeface had each been fixed and the answer was still
// "Helios menus still look dimmed": nothing in the chrome is under 6:1 now,
// and what you can press is over 11:1.
// A state is said in a COLOUR, never in an opacity.
//
// None of that was THE cause. The frame lines' dark was: a 9,999 px shadow
// nothing clipped, laid over the whole chrome at 55% black in Shoot, Film
// and Cut — the colours were right in the source and at 45% on the screen
// (see "keeps the frame lines' dark on the stage" below).
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
  { ink: "#d6d9e0", on: BAR, what: "a mode, a view or a tool you can pick" },
  { ink: "#d6d9e0", on: PANEL, what: "a dock tab, a shutter, an ISO, an aid you can pick" },
  { ink: "#c6c9d1", on: PANEL, what: "the panel's own prose" },
  { ink: "#9aa0ad", on: BAR, what: "the shot count, Find anything, the status bar" },
  { ink: "#9aa0ad", on: PANEL, what: "a tool this mode has nothing for, a section head" },
  { ink: "#e0a468", on: PILL, what: "the mode this page is in" },
  { ink: "#f0cda6", on: PANEL, what: "the dock tab that is open" },
];

/** What a control you can use must clear, over what a label must. */
const CONTROL_INK = "#d6d9e0";

describe("the studio's chrome can be read", () => {
  it("every ink meets WCAG on the ground it is drawn on", () => {
    for (const { ink, on, what, icon } of INK) {
      // The studio's own floor, above WCAG's: it is a dark room full of small
      // type, and "dimmed" was the report three times over.
      const need = icon ? 4.5 : 6;
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
    expect(ratio(CONTROL_INK, PANEL)).toBeGreaterThanOrEqual(11);
  });

  it("names every colour the chrome actually uses, so a new one cannot slip in unmeasured", () => {
    const used = new Set([...frame.matchAll(/text-\[(#[0-9a-f]{6})\]/g)].map((m) => m[1]));
    const measured = new Set(INK.map((i) => i.ink));
    // The two dark inks are text ON the ochre and on a lit tile, measured with
    // their own ground below, not against the chrome's.
    for (const onOchre of ["#1b1c22", "#181a1f", "#14161a", "#1b1c20"]) used.delete(onOchre);
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
    expect(frame).toContain('const TOOL_OFF = "flex h-8 w-8 cursor-default items-center justify-center rounded-[6px] text-[#9aa0ad]";');
    expect(over("#9aa0ad", 0.35, PANEL)).toBe("#4a4d55");
    expect(ratio(over("#9aa0ad", 0.35, PANEL), PANEL)).toBeLessThan(2);
  });

  it("keeps its own face: the app's label rule does not reach into it", () => {
    // The Screening Room puts every small uppercase label in the app into DM
    // Mono, which is loaded at 400 and 500 only (theme/screening-fonts.ts).
    // It caught the studio's own chrome by class name — twenty labels at
    // 10–11px asking for `font-semibold`, landing on a weight that does not
    // exist — so the chrome read faint whatever colour it was given. The
    // studio is excepted by its two roots, and both roots carry the marker
    // the exception names (the operator, after the colours were raised:
    // "It still looks dimmed", 2026-09-18).
    const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
    expect(css).toContain('html.screening :is([data-set-workspace], [data-set-editor]) :where(.uppercase.tracking-widest, .uppercase.tracking-wider, .uppercase[class*="tracking-[0."]) {');
    expect(css.slice(css.indexOf("html.screening :is([data-set-workspace]"))).toContain("font-family: var(--font-sans);");
    expect(view).toContain("<div data-set-workspace");
    expect(readFileSync(join(dir, "set-editor.tsx"), "utf8")).toContain("data-set-editor>");
  });

  it("paints its own white, never the theme's", () => {
    // THE ONE THAT SURVIVED THREE COLOUR FIXES. Tailwind's `bg-white/5`
    // compiles to color-mix(in oklab, var(--color-white) 5%, transparent),
    // and --color-white is INVERTED in the app's dark theme (globals.css:
    // "Inverted on purpose … if you are painting over a photo or a video,
    // this is NOT the colour you want") — oklch(20.5%), a dark grey. The
    // Screening Room made dark the default inside /app, so every chip fill,
    // every tray and every hairline in the studio became 5-10% of a dark
    // grey on a dark ground: invisible. Nothing had an edge or a shape, and
    // no amount of raising the TEXT colour could answer it ("Helios menus
    // still look dimmed", three times, 2026-09-18). Read from the deployed
    // stylesheet, not guessed. The studio paints its own white now.
    for (const name of ["studio-frame.tsx", "set-view.tsx", "set-editor.tsx", "rig-panel.tsx", "sequencer.tsx", "scene-tree.tsx", "command-palette.tsx"]) {
      const file = readFileSync(join(dir, name), "utf8");
      const themed = [...file.matchAll(/\b(?:bg|border|ring|divide|outline|from|to|via)-white\/[[\d.\]]+/g)].map((m) => m[0]);
      expect(themed, `${name} paints with the theme's white, which is dark inside the app`).toEqual([]);
    }
    // And the studio's own hairline is a literal.
    expect(frame).toContain('export const STUDIO_HAIR = "border-[rgba(255,255,255,0.07)]";');
  });

  it("keeps the frame lines' dark on the stage", () => {
    // THE CAUSE, read off the operator's own screenshot (2026-09-18): the bar
    // measured #0c0b0e where the source says #191a20 and its words #4d4c4f
    // where it says #9aa0ad — ground and ink alike at 45% of themselves. The
    // dark round the frame lines is a box-shadow spread 9,999 px at 55%
    // black, and nothing round the stage clipped it: it covered the whole
    // page and, being positioned, painted OVER the bar, the rail and the
    // dock, which are not. Shoot, Film and Cut draw frame lines and Build
    // does not ("In Build mode the text is not dimmed, when switching to
    // shoot film and cut it gets dimmed"), and a still being viewed hides
    // them ("Sometimes"). No colour in the chrome could answer it, which is
    // why raising the colours never did. Measured in a harness, before and
    // after: the Build tab 3.2:1 → 12.3:1, the stage outside the lines still
    // at 45%.
    const shadow = view.indexOf("shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]");
    expect(shadow).toBeGreaterThan(-1);
    // Its element is the only child of a layer the stage's own size that clips.
    const clip = view.lastIndexOf('<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">', shadow);
    expect(clip).toBeGreaterThan(-1);
    const between = view.slice(clip, shadow);
    expect(between.match(/<div\b/g), "the lines sit directly inside the clip").toHaveLength(2);
    expect(between).toContain("ref={guideRef}");
    // And no other spread shadow anywhere in the studio to do it again.
    for (const name of ["studio-frame.tsx", "set-view.tsx", "set-editor.tsx", "rig-panel.tsx", "sequencer.tsx", "scene-tree.tsx", "command-palette.tsx"]) {
      const spreads = readFileSync(join(dir, name), "utf8").match(/0_0_0_\d{3,}px/g) ?? [];
      expect(spreads, name).toHaveLength(name === "set-view.tsx" ? 1 : 0);
    }
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
