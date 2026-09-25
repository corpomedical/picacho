import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The one-door decision (board K, "Its own door" → "Build A as Recce",
// 2026-09-17), pinned as source: the clip enters Picacho through the Recce
// page alone, the Sets home knows nothing of it, and the door's copy keeps
// the machinery off the wall.

const root = join(__dirname, "..", "..");
const door = readFileSync(join(root, "components", "recce", "recce-door.tsx"), "utf8");
const home = readFileSync(join(root, "components", "sets", "sets-home.tsx"), "utf8");
const sidebar = readFileSync(join(root, "components", "app-sidebar.tsx"), "utf8");
// The door's path lives in the sidebar's one list of tools since the Tools
// door (2026-09-25); the sidebar still carries the visibility gate.
const tools = readFileSync(join(root, "lib", "nav", "tools.ts"), "utf8");
const page = readFileSync(join(root, "app", "app", "recce", "page.tsx"), "utf8");

describe("the Recce door", () => {
  it("is the only way in: the Sets home carries no clip entry", () => {
    expect(home).not.toMatch(/recce|clip/i);
    expect(door).toContain("submitSetRecceBuild");
    expect(door).toContain("prepareClip");
  });

  it("hangs in the nav behind its own visibility, at its own path", () => {
    expect(tools).toContain('href: "/app/recce"');
    expect(sidebar).toContain("recceVisible");
  });

  it("its page declares the read's budget and refuses everyone it is not for", () => {
    expect(page).toContain("export const maxDuration = 300");
    expect(page).toContain("isRecceEnabled");
    expect(page).toContain('profile?.role !== "admin"');
  });

  it("keeps the machinery off the wall: the door's own words never say set, build or Astra", () => {
    // The door speaks t.recce; this pins the DICTIONARY, where the words live.
    const en = readFileSync(join(root, "lib", "i18n", "messages", "en.ts"), "utf8");
    const section = en.match(/\n  recce: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    const spoken = [...section.matchAll(/: "([^"]+)"/g)].map((m) => m[1]).join(" ");
    expect(spoken.length).toBeGreaterThan(200);
    expect(spoken).not.toMatch(/\bset\b|\bbuild\b|Astra/i);
  });

  it("a finished read opens the studio", () => {
    expect(door).toContain("/app/sets/${x.id}");
  });
});
