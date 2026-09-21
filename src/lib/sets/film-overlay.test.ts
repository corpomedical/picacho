import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FilmPose } from "./film";
import { nearestLens } from "./build-scene";
import { layMove, poseAlong } from "./moves";
import { FILM_CONE_MAX_M, FILM_CONE_MIN_M, FILM_EYE_M, FILM_PATH_SAMPLES, filmCone, planFilmOverlay } from "./film-overlay";
import type { Vec3 } from "./set-spec";

// Film's overlay on the stage (canvas pages H and I): the path the camera
// takes, the keyframes numbered on it, and what the selected beat's two
// lenses see. The geometry is held here; the stage draws it.

const MARK = { x: 0, z: 0, facingDeg: 0 };
const BOUNDS = { x: 40, z: 40, height: 12 };
const START: FilmPose = { position: [0, 1.6, 2.4], target: [0, 1.45, 0], fovDeg: 53.13 };
const near = (a: Vec3, b: Vec3, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const SQUARE = { bandAspect: 1, heightShare: 1 };

describe("planFilmOverlay", () => {
  const end1 = layMove("dolly-zoom", START, MARK, BOUNDS);
  const end2 = layMove("arc-left", end1, MARK, BOUNDS);
  const beats = [
    { end: end1, move: "dolly-zoom" as const },
    { end: end2, move: "arc-left" as const },
  ];

  it("draws the path through every keyframe, along each beat's own move", () => {
    const plan = planFilmOverlay({ start: START, beats, selected: null, mark: MARK, frame: SQUARE });
    expect(plan.path).toHaveLength(2 * FILM_PATH_SAMPLES + 1);
    expect(near(plan.path[0], START.position)).toBe(true);
    expect(near(plan.path[FILM_PATH_SAMPLES], end1.position)).toBe(true);
    expect(near(plan.path[plan.path.length - 1], end2.position)).toBe(true);
    // Beat 2 arcs round her: halfway along, the path is where the previz flies, not the straight chord.
    const mid = plan.path[FILM_PATH_SAMPLES + FILM_PATH_SAMPLES / 2];
    expect(near(mid, poseAlong("arc-left", end1, end2, 0.5).position)).toBe(true);
    const chord: Vec3 = [(end1.position[0] + end2.position[0]) / 2, (end1.position[1] + end2.position[1]) / 2, (end1.position[2] + end2.position[2]) / 2];
    expect(dist(mid, chord)).toBeGreaterThan(0.1);
  });

  it("numbers the start 1 and each beat's end after it, with the lens the page names and the distance to her eyes", () => {
    const plan = planFilmOverlay({ start: START, beats, selected: 1, mark: MARK, frame: SQUARE });
    expect(plan.keys.map((k) => [k.number, k.selected])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(plan.keys[0].lensMm).toBe(nearestLens(START.fovDeg));
    expect(plan.keys[0].lensMm).toBe(24);
    expect(plan.keys[0].distanceM).toBeCloseTo(Math.hypot(0, 1.6 - FILM_EYE_M, 2.4), 9);
    // The dolly zoom's far end: a longer lens, further away.
    expect(plan.keys[1].lensMm).toBeGreaterThan(plan.keys[0].lensMm);
    expect(plan.keys[1].distanceM).toBeGreaterThan(plan.keys[0].distanceM);
  });

  it("draws from beat 1's end when the start has no recorded camera, numbered as ever", () => {
    const plan = planFilmOverlay({ start: null, beats, selected: 0, mark: MARK, frame: SQUARE });
    expect(plan.keys.map((k) => k.number)).toEqual([2, 3]);
    expect(plan.path).toHaveLength(FILM_PATH_SAMPLES + 1);
    expect(near(plan.path[0], end1.position)).toBe(true);
    // Beat 1 selected: only its end's lens is known.
    expect(plan.cones).toHaveLength(1);
    expect(plan.cones[0].selected).toBe(true);
    expect(planFilmOverlay({ start: null, beats: [], selected: null, mark: MARK, frame: SQUARE })).toEqual({ path: [], keys: [], cones: [] });
    const one = planFilmOverlay({ start: START, beats: [], selected: null, mark: MARK, frame: SQUARE });
    expect(one.path).toEqual([]);
    expect(one.keys.map((k) => k.number)).toEqual([1]);
  });

  it("shows the selected beat's two lenses, its end solid, and no lenses without a selection", () => {
    const plan = planFilmOverlay({ start: START, beats, selected: 1, mark: MARK, frame: SQUARE });
    expect(plan.cones.map((c) => [c.apex, c.selected])).toEqual([
      [end1.position, false],
      [end2.position, true],
    ]);
    expect(planFilmOverlay({ start: START, beats, selected: null, mark: MARK, frame: SQUARE }).cones).toEqual([]);
    expect(planFilmOverlay({ start: START, beats, selected: 5, mark: MARK, frame: SQUARE }).cones).toEqual([]);
  });
});

describe("filmCone", () => {
  const centre = (c: ReturnType<typeof filmCone>): Vec3 =>
    [0, 1, 2].map((i) => c.corners.reduce((sum, p) => sum + p[i], 0) / 4) as unknown as Vec3;

  it("reaches the frame the lens draws at the distance it aims, in the picture's shape", () => {
    const cone = filmCone(START, { bandAspect: 2.39, heightShare: 1 }, true);
    const aim = dist(START.position, START.target);
    expect(near(centre(cone), START.target, 1e-9)).toBe(true);
    const [tl, tr, br, bl] = cone.corners;
    const width = dist(tl, tr);
    const height = dist(tr, br);
    expect(height).toBeCloseTo(2 * aim * Math.tan((START.fovDeg * Math.PI) / 360), 9);
    expect(width / height).toBeCloseTo(2.39, 9);
    expect(dist(bl, br)).toBeCloseTo(width, 9);
    // Top is up: the top corners are higher than the bottom ones.
    expect(tl[1]).toBeGreaterThan(bl[1]);
    expect(tr[1]).toBeGreaterThan(br[1]);
    // As the camera sees it: the left corners are on the camera's left.
    const forward = [START.target[0] - START.position[0], START.target[1] - START.position[1], START.target[2] - START.position[2]];
    const leftward = [tl[0] - tr[0], tl[1] - tr[1], tl[2] - tr[2]];
    // The camera looks down −z here, so its left is −x.
    expect(forward[2]).toBeLessThan(0);
    expect(leftward[0]).toBeLessThan(0);
  });

  it("draws a band's share of the render's height, and keeps its reach inside the limits", () => {
    const band = filmCone(START, { bandAspect: 2.39, heightShare: 0.5 }, false);
    const full = filmCone(START, { bandAspect: 2.39, heightShare: 1 }, false);
    expect(dist(band.corners[1], band.corners[2])).toBeCloseTo(dist(full.corners[1], full.corners[2]) / 2, 9);
    const touching = filmCone({ ...START, target: START.position }, SQUARE, false);
    expect(dist(touching.apex, centre(touching))).toBeCloseTo(FILM_CONE_MIN_M, 9);
    const far = filmCone({ ...START, target: [0, 1.45, -500] }, SQUARE, false);
    expect(dist(far.apex, centre(far))).toBeCloseTo(FILM_CONE_MAX_M, 9);
    // Looking straight down still gives a frame.
    const down = filmCone({ position: [0, 10, 0], target: [0, 0, 0], fovDeg: 40 }, SQUARE, false);
    expect(down.corners.every((p) => p.every(Number.isFinite))).toBe(true);
    expect(dist(down.corners[0], down.corners[1])).toBeGreaterThan(0);
  });
});

// The stage draws the plan (set-view.tsx, a client component, read as
// source). What matters most: the overlay is the person's alone. It lives
// in a scene of its own, drawn over the live view, so the frame and the
// snapshot a still is shot from, which draw the set's scene, cannot hold it
// (checked in the worktree: both came back byte for byte the same with the
// overlay on and off, while the live view differed).
describe("the stage's overlay", () => {
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  const between = (from: string, to: string) => {
    const start = view.indexOf(from);
    expect(start, from).toBeGreaterThan(-1);
    const end = view.indexOf(to, start + from.length);
    expect(end, to).toBeGreaterThan(start);
    return view.slice(start, end);
  };

  it("is a scene of its own, drawn after the live view, that no frame or snapshot draws", () => {
    expect(view).toContain("const overlayScene = new THREE.Scene();");
    expect(view.match(/renderer\.render\(overlayScene, camera\)/g)).toHaveLength(1);
    const live = between("const renderLive = () => {", "\n        };\n");
    expect(live.indexOf("renderer.render(overlayScene, camera);")).toBeGreaterThan(live.indexOf("composer.render();"));
    // Or the picked thing's box alone (R1, 2026-09-21), in the same scene.
    expect(live).toMatch(
      /if \(overlayRoot\.visible \|\| \(pickRoot\.visible && pickRoot\.children\.length > 0\)\) \{\s*renderer\.autoClear = false;\s*renderer\.render\(overlayScene, camera\);\s*renderer\.autoClear = true;\s*\}/,
    );
    for (const name of ["frame(opts) {", "snapshot(px, opts) {"]) {
      const body = between(name, "\n          },\n");
      expect(body, name).not.toMatch(/overlay/i);
      expect(body, name).toContain("renderer.render(scene, ");
    }
    // Nothing of it is added to the set's scene.
    expect(view).not.toMatch(/scene\.add\(overlay/);
    const flat = between("setFilmOverlay(plan, names) {", "holdFilmOverlay(reason, on) {");
    expect(flat).toContain("const flat = { transparent: true, depthTest: false, depthWrite: false, toneMapped: false } as const;");
  });

  it("names the keyframes in a layer of its own, from text alone, where the grade preview cannot tint them", () => {
    const label = between("function overlayKeyLabel(name: string, selected: boolean): HTMLDivElement {", "\n}\n");
    expect(label).toContain("text.textContent = name;");
    expect(label).not.toContain("innerHTML");
    expect(label).toContain("pointer-events:none");
    expect(view).toContain("overlayHostRef.current?.appendChild(labelLayer.domElement);");
    const host = view.indexOf("<div ref={hostRef}");
    const layer = view.indexOf("<div ref={overlayHostRef}");
    expect(layer).toBeGreaterThan(host);
    expect(view.slice(layer, view.indexOf("/>", layer))).toContain("pointer-events-none absolute inset-0");
    // Freed with the stage.
    expect(between("cleanup = () => {", "};")).toMatch(/clearOverlay\(\);\s*labelLayer\.domElement\.remove\(\);/);
  });

  it("is drawn while the film dock is open, and steps aside while the camera flies", () => {
    const plan = between("// Film's overlay (canvas pages H and I): the move's path through the set,", "// The moves closing, or the page going");
    expect(plan).toMatch(/if \(!filmOpen\) \{\s*api\.setFilmOverlay\(null, \[\]\);\s*return;\s*\}/);
    expect(plan).toContain("start: shots.find((sh) => sh.generationId === film.startId)?.pose ?? null,");
    expect(plan).toContain("frame: { bandAspect: fr.bandAspect, heightShare: fr.heightShare },");
    expect(plan).toContain('apiRef.current?.holdFilmOverlay("previz", previz);');
    expect(between("const stopMovePreview = useCallback(() => {", "}, []);")).toContain('apiRef.current?.holdFilmOverlay("hover", false);');
    expect(between("function previewFilmMove(move: FilmMove | null) {", "MOVE_PREVIEW_REST_MS);")).toMatch(
      /p\.home = home;\s*api\.holdFilmOverlay\("hover", true\);/,
    );
    // A keyframe's name is a pattern, the same in all four languages ("2 · 85 mm · 8,5 m" in Spanish).
    expect(plan).toContain("formatMsg(s.filmKeyLabel, { n: k.number, lens: formatMsg(s.lensMm, { mm: k.lensMm }), m: metres.format(k.distanceM) })");
    expect(plan).toContain("new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })");
    const hold = between("holdFilmOverlay(reason, on) {", "\n          },\n");
    expect(hold).toContain("showOverlay();");
    expect(view).toContain("overlayRoot.visible = overlayOn && overlayHolds.size === 0;");
  });
});

