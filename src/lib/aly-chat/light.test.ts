import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lightChatToolsFrom, lightRulesFrom, lightTurnNote } from "./light-prompt";
import { PRODUCER_TOOLS, TOOL_NAMES } from "../producer/tools";

// Aly in Picacho Light, "start right away" (2026-09-29): the words a chat
// started in Light reads, its prepare_send wording, and the note each Light
// message carries.
//
// prompt.ts pulls in the app's "@/" modules, which the test runner can't
// load, so its CHAT_RULES text is read from the source itself (it has no
// interpolation): the test runs on the real words.
const source = readFileSync(join(__dirname, "prompt.ts"), "utf8");
const open = source.indexOf("export const CHAT_RULES = `") + "export const CHAT_RULES = `".length;
const CHAT_RULES = source.slice(open, source.indexOf("`;", open));

describe("Aly in Picacho Light", () => {
  it("tells her a render starts at once in Light, and nothing about pressing the button herself", () => {
    const rules = lightRulesFrom(CHAT_RULES);
    expect(rules).toContain("PICTURES AND VIDEOS (PICACHO LIGHT)");
    expect(rules).toContain("the render starts at once, spends its credits");
    expect(rules).not.toContain("they press the button on it themselves");
    expect(rules).not.toContain("You cannot start renders");
    expect(rules).toContain("Apart from the pictures and videos you make with prepare_send");
    expect(rules).toContain("in Picacho Light's chat");
    expect(rules).toContain("PICACHO LIGHT\nThe person uses Picacho Light");
    // The photo exception, and where a photo goes in.
    expect(rules).toContain("it waits on its card for them to tap Make it");
    expect(rules).toContain('"Change it first" on the card');
    // Everything else she is stays, documents and ads included (Light shows both).
    for (const part of ["web_search", "DOCUMENTS (THE SIDE PANEL)", "MEMORY", "FILES", "plan_press_ad"]) expect(rules).toContain(part);
    // The chat page's own words are untouched.
    expect(CHAT_RULES).toContain("they press the button on it themselves");
  });

  it("keeps every tool and only rewords prepare_send", () => {
    const base = PRODUCER_TOOLS as unknown as { name: string; description: string }[];
    const light = lightChatToolsFrom(base) as { name: string; description: string }[];
    expect(light.map((t) => t.name)).toEqual(base.map((t) => t.name));
    const prepare = light.find((t) => t.name === TOOL_NAMES.prepare)!;
    expect(prepare.description).toContain("STARTS the render at once");
    expect(prepare.description).not.toContain("does not render");
    for (const t of light) if (t.name !== TOOL_NAMES.prepare) expect(t).toBe(base.find((b) => b.name === t.name));
    // The lamp's own list keeps its wording.
    expect(base.find((t) => t.name === TOOL_NAMES.prepare)!.description).toContain("does not render");
  });

  it("says in each message whether its renders start at once, and Light's own video engine", () => {
    expect(lightTurnNote({})).toBe("[App note (Picacho Light): a picture or video you prepare in this turn starts at once.]");
    expect(lightTurnNote({ files: 2 })).toBe(
      "[App note (Picacho Light): they attached files to this message, so a picture or video you prepare in this turn waits on its card for them to tap Make it.]",
    );
    expect(lightTurnNote({ files: 0, video: { model: "kling", seconds: 5 } })).toBe(
      '[App note (Picacho Light): a picture or video you prepare in this turn starts at once; Light makes videos with video_model_id "kling" and seconds 5.]',
    );
    // Anything that isn't a model id or a sane length is left out.
    expect(lightTurnNote({ video: { model: "Kling; drop", seconds: 5 } })).not.toContain("video_model_id");
    expect(lightTurnNote({ video: { model: "kling", seconds: 999 } })).toContain('video_model_id "kling".');
  });
});
