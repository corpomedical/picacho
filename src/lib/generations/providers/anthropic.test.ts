// The draft step's prose-refusal check (draftWithClaude in anthropic.ts). A
// reply that OPENS by declining is thrown, so the pipeline falls back to the
// person's own typed words instead of posting the refusal as the prompt (a
// fal 422 on 2026-09-09 carried "I can't rewrite this prompt…" as the
// prompt). Until 2026-10-01 a "Sorry, …" or "Sorry. …" opening slipped
// through: the pattern's one trailing \b needed a word character right after
// the comma or full stop.
//
// Relative imports only (vitest cannot resolve "@/"). Every call goes to a
// stubbed fetch; nothing reaches Anthropic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftWithClaude } from "./anthropic";

// Anthropic's answer for a draft that ended normally.
const replies = (text: string) => async () =>
  new Response(JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a draft that opens by declining", () => {
  it.each([
    "Sorry, I can't help with that.",
    "Sorry. No.",
    "I'm sorry, but…",
    "I apologise…",
    // The reply that reached fal as the prompt on 2026-09-09.
    "I can't rewrite this prompt. The core instruction asks for something I won't depict.",
    // Typographic apostrophes.
    "I\u2019m sorry, but I can\u2019t help with that.",
    // Read on the trimmed reply.
    "\n  Sorry, I can't help with that.",
  ])("is thrown, never returned as the prompt: %j", async (reply) => {
    vi.stubGlobal("fetch", replies(reply));
    await expect(draftWithClaude("Write the prompt.")).rejects.toThrow("Claude declined to draft this prompt");
  });
});

describe("a draft that describes a scene", () => {
  it.each([
    "Sorrel leaves in the rain, close-up, soft morning light.",
    "A cinematic medium shot of Lina at a Paris café terrace at dusk, warm tungsten light, shallow depth of field.",
    // A refusal's words later in the text, as dialogue, are not an opening.
    'Lina shouts "I can\'t believe it!" as confetti falls over the square.',
    'A shopkeeper flips the sign on the door: "Sorry, we\'re closed."',
    // Opens with an I, but not with "I can't".
    "Inside a dim jazz club, a saxophonist leans into the spotlight.",
  ])("comes back as the prompt: %j", async (reply) => {
    vi.stubGlobal("fetch", replies(reply));
    await expect(draftWithClaude("Write the prompt.")).resolves.toBe(reply);
  });
});
