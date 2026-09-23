import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Film's missing pieces from its approved boards (canvas pages H and I,
// 2026-09-16): "hover a move to fly it here — free", "Space plays the
// move", and the stage's hint that says so. A move tile did nothing until
// it was picked, and Film showed no hint at all. Read as source: client
// components do not load here.

const dir = join(__dirname, "../../components/sets");
const view = readFileSync(join(dir, "set-view.tsx"), "utf8");
const panel = readFileSync(join(dir, "rig-panel.tsx"), "utf8");
const between = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = source.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("hovering a move", () => {
  const preview = between(view, "function previewFilmMove(move: FilmMove | null) {", "\n  }\n\n  /**\n   * Write one thing's mover");

  it("flies it from its beat's start, over and over, after a moment's rest, and keeps nothing", () => {
    expect(preview).toContain("if (!api || !ready || previz || filmBusyRef.current) return;");
    // The same laying as a pick, from where the stage stood before any hover.
    expect(preview).toContain("const home = p.home ?? api.pose();");
    expect(preview).toContain("const laid = layFilmMove(api, move, home);");
    expect(preview).toMatch(/p\.timer = setTimeout\(\(\) => \{[\s\S]*\}, MOVE_PREVIEW_REST_MS\);/);
    expect(preview).toMatch(/while \(alive\(\)\) \{\s*api\.goTo\(laid\.from\);\s*await tweenPose\(api, laid\.from, laid\.end, MOVE_FLIGHT_MS, move, alive\);/);
    // Nothing is edited: the film, the selection and the stage's state stay.
    for (const writes of ["editFilm(", "setFilm(", "setFilmSel(", "keepStage(", "setPreviz(", "setPoseNow(", "setFovDeg("]) {
      expect(preview, writes).not.toContain(writes);
    }
    // Reduced motion: the move's end, not a flight.
    expect(preview).toContain('window.matchMedia?.("(prefers-reduced-motion: reduce)").matches');
  });

  it("puts the stage back when the pointer leaves, and a newer hover or a stop grounds the flight", () => {
    expect(preview).toMatch(/if \(move === null\) \{\s*stopMovePreview\(\);\s*return;\s*\}/);
    const stop = between(view, "const stopMovePreview = useCallback(() => {", "}, []);");
    expect(stop).toContain("p.token += 1;");
    expect(stop).toContain("if (p.home) apiRef.current?.goTo(p.home);");
    expect(stop).toContain("p.home = null;");
    // A grounded flight moves the camera no further.
    expect(between(view, "function tweenPose(", "\n}\n")).toMatch(/if \(!alive\(\)\) \{\s*resolve\(\);\s*return;\s*\}/);
  });

  it("lands before a pick, a play, a keyframe, a beat's end or a jump to a beat, and when the moves close", () => {
    const pick = between(view, "function filmMove(move: FilmMove) {", "\n  }\n");
    expect(pick.indexOf("stopMovePreview();")).toBeGreaterThan(-1);
    expect(pick.indexOf("stopMovePreview();")).toBeLessThan(pick.indexOf("layFilmMove(api, move, flyingFrom ?? api.pose())"));
    expect(pick.indexOf("layFilmMove(")).toBeLessThan(pick.indexOf("keepStage();"));
    for (const [from, to] of [
      ["async function playMove() {", "keepStage();"],
      ["function filmSetBeatEnd(i: number) {", "const pose = apiRef.current?.pose();"],
      ["function filmGoTo(i: number) {", "keepStage();"],
      ["// K keeps the view on the stage as the next beat's end", "const pose = apiRef.current?.pose();"],
    ]) {
      expect(between(view, from, to), from).toContain("stopMovePreview();");
    }
    expect(view).toMatch(/useEffect\(\(\) => \{\s*if \(!filmOpen \|\| !rigOpen\) stopMovePreview\(\);\s*\}, \[filmOpen, rigOpen, stopMovePreview\]\);/);
    expect(view).toContain("useEffect(() => stopMovePreview, [stopMovePreview]);");
    // A pick and a hover lay a move one way.
    expect(view.match(/layFilmMove\(api, move, /g)).toHaveLength(2);
    expect(view).toContain("onPreview: previewFilmMove,");
  });

  it("is a mouse's alone in the rig, shows the move's line, and a sweep across the moves is one hover", () => {
    const tile = between(panel, "function Tile({", "\n}\n");
    expect(tile).toContain('onPointerEnter={onHover ? (e) => e.pointerType === "mouse" && onHover(true) : undefined}');
    expect(tile).toContain('onPointerLeave={onHover ? (e) => e.pointerType === "mouse" && onHover(false) : undefined}');
    const hover = between(panel, "const hoverMove = (move: FilmMove, over: boolean) => {", "\n  };\n");
    expect(hover).toMatch(/if \(over\) \{\s*setHovered\(move\);\s*film\?\.onPreview\(move\);\s*return;\s*\}/);
    expect(hover).toMatch(/leaveRef\.current = setTimeout\(\(\) => \{[\s\S]*previewRef\.current\?\.\(null\);\s*\}, PREVIEW_LEAVE_MS\);/);
    // Closing the panel ends it.
    expect(panel).toMatch(/useEffect\(\s*\(\) => \(\) => \{\s*if \(leaveRef\.current\) clearTimeout\(leaveRef\.current\);\s*previewRef\.current\?\.\(null\);\s*\},\s*\[\],\s*\);/);
    expect(panel).toContain("onHover={(over) => hoverMove(m, over)}");
    expect(panel).toContain("const lineMove = film ? (hovered ?? film.move) : null;");
    expect(panel).toContain("{r.moves[lineMove]}</span> — {r.moveLines[lineMove]}");
  });
});

describe("Space", () => {
  const keys = between(view, "// Space plays the move while the film dock is open", "// The moves closing, or the page going");

  it("plays the move while the film dock is open, when nothing in particular has the focus", () => {
    expect(keys).toContain("if (!filmOpen) return;");
    expect(keys).toContain('if (e.key !== " " || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;');
    expect(keys).toContain('if (el && el !== document.body && el.tagName !== "CANVAS") return;');
    expect(keys).toMatch(/e\.preventDefault\(\);\s*playMoveRef\.current\(\);/);
    expect(keys).toContain("playMoveRef.current = () => void playMove();");
  });
});

describe("the Film hint", () => {
  it("says the stage's keys above the dock, on a screen with a mouse", () => {
    const hint = between(view, "{/* the stage's keys, above the dock (canvas pages H and I)", "</span>");
    expect(hint).toContain("absolute bottom-full left-0 mb-2 hidden");
    expect(hint).toContain("md:pointer-fine:block");
    expect(hint).toContain("{rigOpen ? s.filmHintMoves : s.filmHint}");
  });
});
