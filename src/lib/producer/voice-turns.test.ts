import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gatePromptFor } from "./gate";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

// "Sometimes its picking my voice as background noise or a phone video"
// (2026-09-26, on a computer): the judge is told what the app is for, what she
// was saying when they cut in, and that they kept talking once she went quiet.
describe("what the judge is told when they talk over her", () => {
  const base = {
    name: "Aly",
    recent: [{ who: "assistant" as const, text: "Three shots for Eva. Want me to set up the first?" }],
    words: "Wait, make it four",
    confidence: -0.1,
    nearness: 0.9,
    whileAnswering: true,
    sinceAssistant: 0,
  };

  it("reads her own words and the talk-over only when there are some", () => {
    const withHer = gatePromptFor({ ...base, herWords: "First, neon rain at night, five seconds. Second, a jazz club", talkedOver: true });
    expect(withHer).toContain(
      'What Aly was saying out loud when this was heard (the end of it): "First, neon rain at night, five seconds. Second, a jazz club"',
    );
    expect(withHer).toContain("They started talking while Aly was speaking and kept talking after Aly went quiet.");
    const plain = gatePromptFor(base);
    expect(plain).not.toContain("was saying out loud");
    expect(plain).not.toContain("kept talking after");
  });

  it("knows people describe scenes to it, and that her own words in the mic aren't theirs", () => {
    const gate = read("./gate.ts");
    expect(gate).toContain(
      "they often say out loud what they want to make: a scene, a shot, a look, what a character does or says. That is said to the assistant, even though it can sound like a description, narration or a line from a script.",
    );
    expect(gate).toContain("If the words go beyond the assistant's own words with something of the person's");
  });

  it("an admin sees why a line was let be", () => {
    const route = read("../../app/api/producer/route.ts");
    expect(route).toContain("if (!isAdmin) return { text: message };");
    expect(route.match(/emit\("ignored", ignoredEvent\(\)\);/g)?.length).toBe(3);
    expect(route).not.toContain('emit("ignored", { text: message });');
  });
});

// "Her voice changes tones from sentence to sentence. She also sounds ai"
// (2026-09-26).
describe("her voice, one piece to the next", () => {
  const speech = read("./speech.ts");
  const route = read("../../app/api/producer/route.ts");

  it("is steadier and is told the words after each piece", () => {
    expect(speech).toContain("stability: 0.5,");
    expect(speech).toContain("style: 0,");
    expect(speech).toContain("next_text: nextText.trim().slice(0, 300)");
    expect(route).toContain("const url = await speakHuman(piece, humanVoice.elevenLabsVoiceId, before, after);");
  });

  it("says what she said before a lookup right away, and never voices a piece after she's cut off", () => {
    const toolStart = route.indexOf('event.content_block.type === "tool_use"');
    expect(route.slice(toolStart, toolStart + 300)).toContain("sayAllNow();");
    expect(route).toContain("if (upstream.signal.aborted) return;");
  });

  it("keeps her own voice through a failed piece: two tries, and a fallback for that piece only", () => {
    expect(route).toContain("for (let attempt = 0; attempt < 2; attempt++) {");
    expect(route).toContain("if (++humanFailures >= 2) humanBroken = true;");
  });

  it("is asked to speak, not to write: no stock reactions, numbers in words", () => {
    const state = read("./state.ts");
    expect(state).not.toContain("open with a short first sentence");
    expect(state).not.toMatch(/oh, nice/);
    expect(state).toContain("Say numbers, money, dates and times as a person would");
  });
});
