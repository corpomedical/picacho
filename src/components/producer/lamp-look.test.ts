import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LAMP_LOOK, LAMP_LOOKS, LAMP_LOOK_LABELS, lampMood, parseLampLook } from "./lamp-look";

describe("the lamp's look", () => {
  it("defaults to Two fireflies, the operator's pick", () => {
    expect(DEFAULT_LAMP_LOOK).toBe("fireflies");
    expect(LAMP_LOOK_LABELS.fireflies.name).toBe("Two fireflies");
  });

  it("offers exactly the three looks he named, each with a name and a line", () => {
    expect([...LAMP_LOOKS]).toEqual(["fireflies", "eclipse", "perfected"]);
    for (const look of LAMP_LOOKS) {
      expect(LAMP_LOOK_LABELS[look].name.length).toBeGreaterThan(0);
      expect(LAMP_LOOK_LABELS[look].line.length).toBeGreaterThan(0);
    }
  });

  it("reads a stored look, and anything else (no column yet, NULL, a retired look) as the default", () => {
    expect(parseLampLook("eclipse")).toBe("eclipse");
    expect(parseLampLook("perfected")).toBe("perfected");
    expect(parseLampLook("fireflies")).toBe("fireflies");
    for (const bad of [null, undefined, "", "orb", "ECLIPSE", 3, {}, ["eclipse"]]) {
      expect(parseLampLook(bad)).toBe("fireflies");
    }
  });

  it("maps the voice and the answer onto the four moods", () => {
    expect(lampMood("off", false)).toBe("idle");
    expect(lampMood("listening", false)).toBe("listening");
    expect(lampMood("hearing", false)).toBe("listening");
    expect(lampMood("sending", false)).toBe("thinking");
    expect(lampMood("off", true)).toBe("thinking");
    expect(lampMood("listening", true)).toBe("thinking");
    // Speaking wins over a reply still streaming in: the voice is what you hear.
    expect(lampMood("speaking", true)).toBe("talking");
    expect(lampMood("speaking", false)).toBe("talking");
  });

  // Each look's stylesheet must answer every class the lamp hands it, or a
  // mood silently shows nothing (CSS Modules gives undefined for a missing
  // class, and the lamp would sit in its idle look while it talks).
  it("every look styles every mood, the tab, and the turned tab edges", () => {
    for (const look of LAMP_LOOKS) {
      const css = readFileSync(join(__dirname, "looks", `${look}.module.css`), "utf8");
      for (const cls of ["look", "idle", "listening", "talking", "thinking", "tab", "tabBox", "roundBox", "left", "top", "bottom", "disc", "pool"]) {
        expect(css, `${look} .${cls}`).toMatch(new RegExp(`\\.${cls}(?![\\w-])`));
      }
    }
  });

  // The same for the pieces inside: every class a look's markup names in
  // lamp-looks.tsx is styled by that look's stylesheet.
  it("every piece a look's markup draws is styled", () => {
    const tsx = readFileSync(join(__dirname, "lamp-looks.tsx"), "utf8");
    const bodies = tsx.split(/\nfunction (Fireflies|Eclipse|Perfected)\(/).slice(1);
    const seen: string[] = [];
    for (let i = 0; i < bodies.length; i += 2) {
      const look = bodies[i].toLowerCase();
      seen.push(look);
      const css = readFileSync(join(__dirname, "looks", `${look}.module.css`), "utf8");
      const tokens = new Set([...bodies[i + 1].matchAll(/c\("([^"]+)"\)/g)].flatMap((m) => m[1].split(" ")));
      expect(tokens.size, look).toBeGreaterThan(0);
      for (const t of tokens) expect(css, `${look} .${t}`).toMatch(new RegExp(`\\.${t}(?![\\w-])`));
    }
    expect(seen.sort()).toEqual([...LAMP_LOOKS].sort());
  });
});
