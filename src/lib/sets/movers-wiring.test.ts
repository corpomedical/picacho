import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";

// The movers on the page and at the shot (movers.ts, 2026-09-23): a tap on
// a thing opens its card, the card drives it where the beat ends, the stage
// drives it there at once, the previz and the rehearsal drive it on the
// way, and the frame the beat is SHOT on — with every word written about
// it — is drawn from a set with it driven. Read as source, like the page's
// other tests: the page needs a browser to run.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const view = read("../../components/sets/set-view.tsx");
const card = read("../../components/sets/element-card.tsx");
const actions = read("actions.ts");

const fnOf = (source: string, head: string, next: string) => {
  const a = source.indexOf(head);
  expect(a, head).toBeGreaterThan(-1);
  const b = source.indexOf(next, a + head.length);
  expect(b, next).toBeGreaterThan(a);
  return source.slice(a, b);
};

describe("saying a thing moves", () => {
  it("is written on the thing's own card, into the beat being written", () => {
    for (const hook of ["data-el-drive", "data-el-drive-lay", "data-el-drive-turn", "data-el-drive-way", "data-el-drive-clear", "data-el-drive-cannot"]) {
      expect(card, hook).toContain(hook);
    }
    // Only inside a film, on a picked beat, and never while one renders.
    expect(view).toContain("thingKey && filmOpen && filmSel !== null && !filmBusy && !previz");
    expect(view).toContain("onClear: () => editMover(thingKey, () => null),");
    // A thing the set cannot move on its own says so instead (movers.ts canMove).
    expect(view).toContain("if (!canMove(own, spec)) return { can: false, words: null };");
  });

  it("lays where it ends with a tap on the ground, and its way with more", () => {
    const lay = fnOf(view, "layAddRef.current = (kind, p) => {", "editFilm((f) => ({");
    expect(lay).toContain('if (kind === "mover" || kind === "mover-way") {');
    expect(lay).toContain("editMover(key, (was) => ({ key, x: p.x, z: p.z, turnDeg: was?.turnDeg ?? 0, path: was?.path ?? [] }));");
    expect(lay).toContain("editMover(key, (was) => (was && was.path.length < PATH_MAX_POINTS ? { ...was, path: [...was.path, p] } : was));");
    // The beat's ceiling holds: a fourth thing is not taken (movers.ts MOVERS_PER_BEAT).
    expect(fnOf(view, "function editMover(", "function filmTexture(")).toContain("if (!was && bb.movers.length >= MOVERS_PER_BEAT) return bb;");
  });

  it("shows on the stage the moment it is written, and the set stands as arranged when the film is put away", () => {
    expect(view).toContain("apiRef.current?.placeThings(filmStagesNow[filmSel]?.movers ?? []);");
    expect(view).toContain("if (ready && !filmOpen && !cutOpen) apiRef.current?.placeThings([]);");
  });
});

describe("the stage drives it", () => {
  it("moves the thing's own blocks, and puts everything back where it was built", () => {
    const place = fnOf(view, "          placeThings(placements) {", "\n          },\n");
    expect(place).toContain("const turned = turnAbout({ x: was.x, z: was.z }, about, p.turnDeg);");
    expect(place).toContain("mesh.rotation.y = was.rotY + p.turnDeg * (Math.PI / 180);");
    // Everything not named this time goes home.
    expect(place).toContain("mesh.position.set(was.x, was.y, was.z);");
    // A rebuild makes new blocks: nothing is away from home any more.
    expect(fnOf(view, "          rebuild(next) {", "\n          },\n")).toContain("moved.clear();");
  });

  it("drives it through the previz and through every recorded frame", () => {
    const play = fnOf(view, "  async function playMove() {", "  /**\n   * Record the rehearsal");
    expect(play).toContain("if (movingFilm) api.placeThings(moversAlong(stages, bi, e));");
    // At the beat's end, exactly where its end frame is shot.
    expect(play).toContain("if (movingFilm) api.placeThings(staged.movers);");
    expect(play).toContain("if (movingFilm) api.placeThings([]);");
    const record = fnOf(view, "  async function recordRehearsal() {", "  /** The sequencer's Stop");
    expect(record).toContain("if (movingFilm) api.placeThings(moversAlong(stages, step.beat, step.e));");
    expect(record.indexOf("api.placeThings(moversAlong(")).toBeLessThan(record.indexOf("api.recordFrame(pose);"));
  });
});

describe("the frame a beat is shot on", () => {
  it("is drawn from the set with its movers moved, and is redrawn when they change", () => {
    const render = fnOf(view, "  async function renderFilm(", "  async function retryClip(");
    expect(render).toContain("api.rebuild(movedSpec(stagedSpec(spec, { light: rigRef.current.light, time: staged.time }, figure), els, staged.movers));");
    expect(render).toContain("movedHere !== drawn.movers");
    // And the server is told, so its words are about the same set.
    expect(render).toContain("movers: staged.movers,");
  });

  it("plans its sheets against that same set, in the film's one order", () => {
    expect(view).toContain("() => filmStagesNow.map((st) => movedSpec(spec, els, st.movers)),");
    expect(view).toContain("planFor(b.end, filmStagesNow[i]?.figure ?? mark, filmOrder, filmBeatSpecs[i]).riding");
    expect(view).toContain("for (const p of elementPlaces(filmBeatSpecs[i] ?? spec, els, cam))");
  });

  it("is described at the shot from the same set: which things are in it, which sheet is which, which way a car faces", () => {
    expect(actions).toContain("const shown = movedSpec(owned.spec, els, normalisePlacements(input.movers));");
    expect(actions).toContain("vehicles: findVehicles(shown),");
    expect(actions).toContain("spec: shown,");
    expect(actions).toContain("vehicles: vehicleWords(shown, layout?.camera),");
    expect(actions).toContain("gaze: layout ? gazeWords(layout.gaze, shown, layout.mark) : \"\",");
    expect(actions).toContain("const hasLookObjects = recorded && camera !== null && seesLookObjects(shown, camera);");
    // The THINGS stay the arrangement's, so a moved car keeps its key and its photos.
    expect(actions).toContain("const els = setElements(owned.spec);");
    // The clip's own words are about where the beat ENDS.
    expect(actions).toContain("const endShown = movedSpec(owned.spec, setElements(owned.spec), normalisePlacements(input.movers));");
    expect(actions).toContain('gazeWords(normaliseGaze(input.gaze, owned.spec.objects.length), endShown, endMark, "take")');
  });
});

describe("the words", () => {
  it("say the move in every language, with their placeholders", () => {
    const keys = ["driveTitle", "driveLay", "driveLaying", "driveMoves", "driveTurned", "driveWay", "driveWayLaying", "driveWayN", "driveTurn", "driveClear", "driveCannot"] as const;
    for (const m of [en, es, pt, itMsgs]) {
      for (const key of keys) {
        expect(m.sets.cast[key], key).toBeTruthy();
        for (const ph of en.sets.cast[key].match(/\{\w+\}/g) ?? []) expect(m.sets.cast[key], `${key} ${ph}`).toContain(ph);
      }
    }
  });
});
