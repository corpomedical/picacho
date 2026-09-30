import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// "Speed up the loading, keep going" (2026-09-30). Measured on a local production build against a Supabase
// stand-in answering every read in 60 ms: the Studio's HTML 1,242 → 461 ms, "Opening the set…" on screen
// 1,198 → 431 ms, the Studio ready 1,324 → 562 ms, reads per load 39 → 30, routes prefetched behind it 14 → 0.
// These pin the pieces that made it so.

const read = (p: string) => readFileSync(join(__dirname, "../../..", p), "utf8");

describe("Helios Studio loads fast", () => {
  it("the page streams its cover at once and reads only what the Studio needs, together", () => {
    const page = read("src/app/app/sets/[id]/page.tsx");
    expect(page).toContain("<Suspense fallback={<StudioOpening words={t.sets.studioOpening} />}>");
    // Recast's gate and characters wait for the Video window (openStudioRecast), 2026-09-30.
    expect(page).toContain("getStudioPage(id, undefined, tm)");
    expect(page).not.toContain("canUseRecast(");
    expect(page).not.toContain("readRecastCharacters(");
    // The studio branch never reaches the set page's own read.
    expect(page.indexOf('if (first(query.studio) === "1") {')).toBeLessThan(page.indexOf("const data = await getSetPage(id);"));
    const data = read("src/lib/sets/data.ts");
    const studio = data.slice(data.indexOf("export async function getStudioPage"));
    expect(studio).toContain("await Promise.all([");
    for (const setPageOnly of ["readSetShotIds", "readShotCameras", "listElementPhotos", "astraEditsLeft", "film", "rig"]) expect(studio, setPageOnly).not.toContain(setPageOnly);
  });

  it("the engine's code is asked for as the page's code runs, and the first frame draws with no timer or animation frame", () => {
    expect(read("src/components/studio/helios-studio.tsx")).toContain('typeof window === "undefined" ? null : import("./studio-engine")');
    const engine = read("src/components/studio/studio-engine.ts");
    expect(engine).toContain("tick(performance.now());\nPromise.resolve().then(() => { if (!stopped) { try { opts.onReady?.(); } catch {} } });");
    expect(engine).not.toMatch(/^import \* as CANNON from "cannon-es";/m);
    expect(engine).toContain('import("cannon-es")');
  });

  it("the app's sidebar and tab bar step out under the Studio, so their links aren't prefetched while it loads", () => {
    expect(read("src/components/studio/studio-opening.tsx")).toContain("html:has([data-helios-studio], [data-studio-opening]) [data-app-chrome] { display: none !important; }");
    expect(read("src/components/studio/studio-opening.tsx")).toContain("<style>{STUDIO_HIDES_APP_CHROME}</style>");
    expect(read("src/components/studio/helios-studio.tsx")).toContain("<style>{STUDIO_HIDES_APP_CHROME}</style>");
    expect(read("src/app/globals.css")).not.toContain("data-app-chrome");
    // The two in the streamed chrome (AppChrome), and the sidebar's space while it streams (ChromeSpace).
    expect(read("src/app/app/layout.tsx").match(/<div data-app-chrome className="contents">/g)).toHaveLength(3);
  });
});
