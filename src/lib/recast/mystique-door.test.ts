import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The door's decisions, pinned as source: its own page and nav word (the
// operator's siting call, 2026-09-17), admins only behind the switch, no
// machinery in its words — and a NAME that lives in exactly two places, so
// the working title can change without touching a stored id.

const root = join(__dirname, "..", "..");
const door = readFileSync(join(root, "components", "mystique", "mystique-door.tsx"), "utf8");
const viewer = readFileSync(join(root, "components", "mystique", "take-viewer.tsx"), "utf8");
const sidebar = readFileSync(join(root, "components", "app-sidebar.tsx"), "utf8");
const layout = readFileSync(join(root, "app", "app", "layout.tsx"), "utf8");
const page = readFileSync(join(root, "app", "app", "mystique", "page.tsx"), "utf8");

const section = (lang: string) => {
  const text = readFileSync(join(root, "lib", "i18n", "messages", `${lang}.ts`), "utf8");
  return text.match(/\n  mystique: \{[\s\S]*?\n  \},/)?.[0] ?? "";
};
const keysOf = (s: string) => [...s.matchAll(/\n    (\w+): /g)].map((m) => m[1]);

describe("the Mystique door", () => {
  it("hangs in the nav behind its own visibility, at its own path", () => {
    expect(sidebar).toContain('href: "/app/mystique"');
    expect(sidebar).toContain("mystiqueVisible");
    expect(layout).toContain("const mystiqueVisible = isAdmin && (await isRecastEnabled(supabase))");
  });

  it("its page declares the check's budget and refuses everyone it is not for", () => {
    expect(page).toContain("export const maxDuration = 300");
    expect(page).toContain('profile?.role !== "admin"');
    expect(page.indexOf('profile?.role !== "admin"')).toBeLessThan(page.indexOf("getRecastHome("));
    expect(page).toContain("isRecastEnabled");
  });

  it("keeps the machinery off the wall: its words name no engine, model or rival", () => {
    const spoken = [...section("en").matchAll(/: "([^"]+)"/g)].map((mm) => mm[1]).join(" ");
    expect(spoken.length).toBeGreaterThan(400);
    expect(spoken).not.toMatch(/kling|wan\b|luma|dreamactor|fal\b|engine|model|provider|genjutsu|higgsfield/i);
  });

  it("says the same keys in all four languages", () => {
    const en = keysOf(section("en"));
    expect(en.length).toBeGreaterThan(60);
    for (const lang of ["es", "it", "pt"]) expect(keysOf(section(lang)), lang).toEqual(en);
  });

  it("uses every word it was given, and no word it was not", () => {
    const used = new Set([...`${door}\n${viewer}\n${page}`.matchAll(/\b(?:m|t\.mystique)\.(\w+)/g)].map((x) => x[1]));
    for (const key of keysOf(section("en"))) expect(used.has(key), `unused word: ${key}`).toBe(true);
    const known = new Set(keysOf(section("en")));
    for (const key of used) expect(known.has(key), `missing word: ${key}`).toBe(true);
  });

  it("quotes from the uploaded file and charges what it quoted", () => {
    expect(door).toContain("inspectRecastClip(");
    expect(door).toContain("startRecastTakes(");
    // The button's number is the server's quote, never a browser estimate.
    expect(door).not.toContain("recastCreditCost");
    expect(door).toContain("!canTake");
  });

  it("offers the person's own finished videos as performances", () => {
    expect(door).toContain("motions.map");
    expect(door).toContain("pickMotion");
    // The library reads through our own media route, so a canvas can sample
    // frames from it without being tainted.
    const data = readFileSync(join(root, "lib", "recast", "data.ts"), "utf8");
    expect(data).toContain("videoUrl: url");
    expect(data).toContain("toMediaUrl");
  });

  it("shows the brief it is about to send, composed the way the server composes it", () => {
    expect(door).toContain("composeRecastBrief");
    expect(door).toContain("briefShow");
  });

  it("wipes only where the two films share a frame", () => {
    expect(viewer).toContain('job === "scene" && sourceUrl !== null');
    expect(viewer).toContain("clipPath");
  });

  it("promises the lock only when the lock is actually on", () => {
    expect(door).toContain("{lockOn && <p");
    expect(page).toContain("isRecastLockOn");
  });

  it("says a long take is made in parts, and how long it waits, before it is paid for", () => {
    // lib/generations/chain.ts (2026-09-19): past 15 s, Into the clip is
    // rendered in chained parts. The door says so under the trim, from the
    // same count the server plans with.
    expect(door).toContain("chainPieceCount(clipWindow.end - clipWindow.start) > 1");
    expect(door).toContain("RECAST_ENGINES[engine].chains");
    expect(door).toContain("formatMsg(m.longTake, {");
    for (const lang of ["en", "es", "it", "pt"]) {
      const words = section(lang).match(/\n    longTake: "([^"]+)"/)?.[1] ?? "";
      expect(words, lang).toContain("{parts}");
      expect(words, lang).toContain("{minutes}");
      expect(section(lang), lang).toMatch(/\n    sceneLimit: "[^"]*30 s"/);
    }
  });

  it("the working title lives in the route and the dictionary — never in the lane", () => {
    const laneDir = join(root, "lib", "recast");
    for (const file of readdirSync(laneDir)) {
      if (file.endsWith(".test.ts")) continue;
      const text = readFileSync(join(laneDir, file), "utf8");
      // Comments may say what the door is called; identifiers and strings may not.
      const code = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code.replace(/revalidatePath\("\/app\/mystique"\)/g, ""), file).not.toMatch(/mystique/i);
    }
    expect(existsSync(join(root, "app", "app", "mystique", "page.tsx"))).toBe(true);
  });
});
