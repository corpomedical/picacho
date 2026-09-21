import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";

// Leaving while a film renders (found reviewing Helios, fixed 2026-09-18).
// A film renders from the page, beat after beat (set-view.tsx renderFilm).
// Closing the tab ended it; a link inside the app did not — the page
// unmounted and the chain went on rendering and CHARGING beats nobody was
// watching, while the confirm promised it stops after the beat it is on.
// Read as source: the page needs a browser and a stage.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const render = view.slice(view.indexOf("  async function renderFilm("), view.indexOf("\n  }\n", view.indexOf("  async function renderFilm(")));

describe("leaving mid-film", () => {
  it("the page knows when it has gone", () => {
    expect(view).toContain("const aliveRef = useRef(true);");
    // Set on every mount as well as cleared on every unmount (2026-09-21):
    // cleared only, the flag read "gone" after React ran the effect again,
    // and every film render stopped before its first beat.
    expect(view).toMatch(/useEffect\(\(\) => \{[\s\S]*?aliveRef\.current = true;\s*return \(\) => \{\s*aliveRef\.current = false;\s*\};\s*\}, \[\]\);/);
    expect(view).not.toMatch(/useEffect\(\s*\(\) => \(\) => \{\s*aliveRef\.current = false;/);
  });

  it("stops the chain before the next beat, never in the middle of one", () => {
    const loop = render.indexOf("for (const job of plan.jobs) {");
    const stop = render.indexOf("if (!aliveRef.current) break;");
    expect(loop).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(loop);
    // Before anything that spends, and before the beat is even framed.
    expect(stop).toBeLessThan(render.indexOf("setFilmBusy({ beat: i, clipOnly:", loop));
    expect(stop).toBeLessThan(render.indexOf("result = await takeInSet(setId, {"));
    // The beat in flight is still kept: its save comes after the call.
    expect(render.indexOf("keep({", stop)).toBeGreaterThan(render.indexOf("result = await takeInSet(setId, {"));
  });

  it("does not drive a stage the page has disposed", () => {
    const tail = render.slice(render.indexOf("} finally {"));
    expect(tail).toContain("if (aliveRef.current && apiRef.current) {");
    expect(tail.indexOf("api.placeMark(layoutRef.current.mark);")).toBeGreaterThan(tail.indexOf("if (aliveRef.current && apiRef.current) {"));
  });

  it("keeps the promise the confirm makes", () => {
    expect(en.sets.filmLeaveConfirm).toContain("stops after the beat it's on");
  });
});
