import { describe, expect, it } from "vitest";
import {
  BRAKE_USD,
  MAX_OUTPUT_TOKENS,
  RESERVE_UNITS,
  PRODUCER_UNIT_USD,
  costOfCallUsd,
  rateFor,
  unitsForCostUsd,
  transcribeCostUsd,
  speechCostUsd,
} from "./prices";
import { sentenceChunker } from "./sentences";
import { readSpokenInput, MAX_AUDIO_BYTES } from "./speech";
import { spotForTool, spotSelector, isSpot } from "./spots";
import { runNotesCommand, normalizeNotePath, MAX_NOTES, type Note, type NotesStore } from "./notes";
import { PRODUCER_TOOLS, composerHref, isVoiceAction, readSearchFilters, searchText, validatePreparedSend } from "./tools";
import { closeTail, visibleText, INTERRUPTED_ANSWER } from "./history";
import { parseProducerFrames } from "./sse";
import { producerAllowed, PRODUCER_NEEDS_ELITE, PRODUCER_NOT_OPEN, PRODUCER_SUSPENDED } from "./enabled";
import { VIDEO_MODELS, isDormantVideoModel, requiresReferenceImage } from "../generations/providers/video-models";

describe("prices", () => {
  it("prices Opus 5.5 at $4 / $20 with cache reads at $0.20 and writes at 1.25x", () => {
    // 20,000 cached + 1,000 fresh + 500 out — the draft's example call.
    const cost = costOfCallUsd(
      { cache_read_input_tokens: 20_000, input_tokens: 1_000, output_tokens: 500 },
      "claude-opus-5-5",
    );
    expect(cost).toBeCloseTo(0.004 + 0.004 + 0.01, 10);
    expect(costOfCallUsd({ cache_creation_input_tokens: 1_000_000 }, "claude-opus-5-5")).toBeCloseTo(5, 10);
  });

  it("prices a fallback by the model that answered, and an unknown one as the dearest", () => {
    const u = { input_tokens: 1_000_000 };
    expect(costOfCallUsd(u, "claude-opus-5")).toBeCloseTo(5, 10);
    expect(costOfCallUsd(u, "claude-sonnet-5")).toBeCloseTo(2, 10);
    expect(costOfCallUsd(u, "some-new-model")).toBeCloseTo(10, 10);
    expect(rateFor(undefined).output).toBe(50);
  });

  it("charges at least one unit, rounding up", () => {
    expect(unitsForCostUsd(0)).toBe(1);
    expect(unitsForCostUsd(0.021)).toBe(2);
    expect(unitsForCostUsd(0.054)).toBe(3);
  });

  it("keeps the worst call after the brake inside the reservation", () => {
    const worstAfterBrake =
      BRAKE_USD + costOfCallUsd({ input_tokens: 30_000, output_tokens: MAX_OUTPUT_TOKENS }, "claude-opus-5-5");
    expect(worstAfterBrake).toBeLessThanOrEqual(RESERVE_UNITS * PRODUCER_UNIT_USD);
  });
});

function memoryStore(initial: Note[] = []): NotesStore & { notes: Map<string, string> } {
  const notes = new Map(initial.map((n) => [n.path, n.content]));
  return {
    notes,
    async list() {
      return [...notes].map(([path, content]) => ({ path, content }));
    },
    async put(path, content) {
      notes.set(path, content);
    },
    async remove(path) {
      notes.delete(path);
    },
  };
}

describe("notes (memory tool)", () => {
  it("accepts only paths under /memories", () => {
    expect(normalizeNotePath("/memories/brand.md")).toBe("/memories/brand.md");
    expect(normalizeNotePath("/memories/../etc/passwd")).toBeNull();
    expect(normalizeNotePath("/etc/passwd")).toBeNull();
    expect(normalizeNotePath("/memories/a<script>")).toBeNull();
  });

  it("creates, views with line numbers, replaces and inserts", async () => {
    const s = memoryStore();
    expect((await runNotesCommand(s, { command: "view", path: "/memories" })).text).toMatch(/empty/);
    expect((await runNotesCommand(s, { command: "create", path: "/memories/brand.md", file_text: "gold hour\nno text" })).changed).toBe(true);
    const view = await runNotesCommand(s, { command: "view", path: "/memories/brand.md" });
    expect(view.text).toContain("     1\tgold hour");
    await runNotesCommand(s, { command: "str_replace", path: "/memories/brand.md", old_str: "gold hour", new_str: "golden hour" });
    await runNotesCommand(s, { command: "insert", path: "/memories/brand.md", insert_line: 0, insert_text: "Brand" });
    expect(s.notes.get("/memories/brand.md")).toBe("Brand\ngolden hour\nno text");
  });

  it("refuses an ambiguous replace and a missing one", async () => {
    const s = memoryStore([{ path: "/memories/a.md", content: "x x" }]);
    expect((await runNotesCommand(s, { command: "str_replace", path: "/memories/a.md", old_str: "x", new_str: "y" })).isError).toBe(true);
    expect((await runNotesCommand(s, { command: "str_replace", path: "/memories/a.md", old_str: "z", new_str: "y" })).isError).toBe(true);
  });

  it("never lets the model wipe every note at once", async () => {
    const s = memoryStore([{ path: "/memories/a.md", content: "1" }]);
    const r = await runNotesCommand(s, { command: "delete", path: "/memories" });
    expect(r.isError).toBe(true);
    expect(s.notes.size).toBe(1);
  });

  it("caps the number of notes", async () => {
    const s = memoryStore(Array.from({ length: MAX_NOTES }, (_, i) => ({ path: `/memories/n${i}.md`, content: "" })));
    expect((await runNotesCommand(s, { command: "create", path: "/memories/one-more.md", file_text: "" })).isError).toBe(true);
    // Overwriting an existing note is still fine.
    expect((await runNotesCommand(s, { command: "create", path: "/memories/n0.md", file_text: "new" })).isError).toBe(false);
  });

  it("renames without clobbering", async () => {
    const s = memoryStore([
      { path: "/memories/a.md", content: "A" },
      { path: "/memories/b.md", content: "B" },
    ]);
    expect((await runNotesCommand(s, { command: "rename", old_path: "/memories/a.md", new_path: "/memories/b.md" })).isError).toBe(true);
    await runNotesCommand(s, { command: "rename", old_path: "/memories/a.md", new_path: "/memories/c.md" });
    expect(s.notes.get("/memories/c.md")).toBe("A");
    expect(s.notes.has("/memories/a.md")).toBe(false);
  });
});

describe("tools", () => {
  const cast = [{ id: "c1", name: "Eva" }];
  let n = 0;
  const id = () => `id${++n}`;
  const textModel = VIDEO_MODELS.find((m) => !requiresReferenceImage(m) && !isDormantVideoModel(m.id))!;
  const photoModel = VIDEO_MODELS.find((m) => requiresReferenceImage(m) && !isDormantVideoModel(m.id));

  it("declares strict schemas that list every property as required", () => {
    for (const t of PRODUCER_TOOLS) {
      if (!("input_schema" in t)) continue;
      const schema = t.input_schema as unknown as { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean };
      expect(t.strict).toBe(true);
      expect(schema.additionalProperties).toBe(false);
      expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    }
  });

  it("prepares a video at the catalogue's price and builds the composer link", () => {
    const d = textModel.durations[textModel.durations.length - 1];
    const r = validatePreparedSend(
      { kind: "video", character_id: "c1", prompt: "Eva at dawn", video_model_id: textModel.id, seconds: d.seconds, label: "Dawn" },
      cast,
      id,
    );
    expect("card" in r).toBe(true);
    if (!("card" in r)) return;
    expect(r.card.credits).toBe(d.creditWeight);
    expect(r.card.characterName).toBe("Eva");
    const url = new URL(r.card.href, "https://x.test");
    expect(url.pathname).toBe("/app/generate");
    expect(url.searchParams.get("model")).toBe(textModel.id);
    expect(url.searchParams.get("seconds")).toBe(String(d.seconds));
    expect(url.searchParams.get("character")).toBe("c1");
    expect(url.searchParams.get("prompt")).toBe("Eva at dawn");
  });

  it("refuses someone else's character, an unknown model, a length the model lacks, and dormant models", () => {
    const base = { kind: "video", prompt: "x", label: "x", seconds: null } as Record<string, unknown>;
    expect("error" in validatePreparedSend({ ...base, character_id: "not-mine", video_model_id: textModel.id }, cast, id)).toBe(true);
    expect("error" in validatePreparedSend({ ...base, character_id: null, video_model_id: "nope" }, cast, id)).toBe(true);
    expect("error" in validatePreparedSend({ ...base, character_id: null, video_model_id: textModel.id, seconds: 7777 }, cast, id)).toBe(true);
    expect("error" in validatePreparedSend({ ...base, character_id: null, video_model_id: "seedance-2-fast" }, cast, id)).toBe(true);
  });

  it("needs a character for a model that starts from a picture", () => {
    if (!photoModel) return;
    const r = validatePreparedSend(
      { kind: "video", character_id: null, prompt: "x", label: "x", video_model_id: photoModel.id, seconds: null },
      cast,
      id,
    );
    expect("error" in r).toBe(true);
  });

  it("prices an image at one credit and leaves model and length off its link", () => {
    const r = validatePreparedSend(
      { kind: "image", character_id: null, prompt: "a still", label: "Still", video_model_id: "kling", seconds: 10 },
      cast,
      id,
    );
    if (!("card" in r)) throw new Error("expected a card");
    expect(r.card.credits).toBe(1);
    expect(composerHref(r.card)).toBe("/app/generate?type=image&prompt=a+still");
  });

  it("clamps search filters and strips filter syntax from words", () => {
    const f = readSearchFilters({ text: "  red dress ", limit: 500, days: -3, score_below: "abc", kind: "gif" });
    expect(f).toMatchObject({ text: "red dress", limit: 20, days: 1, scoreBelow: null, kind: null });
    expect(searchText('red,dress"),or(user_id.eq.x')).toBe("red dress or user id.eq.x");
    expect(searchText("100% _cool_")).toBe("100 cool");
  });
});

describe("history", () => {
  it("closes a tail that ends on the app's note", () => {
    const out = closeTail([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "system", content: "note" },
    ]);
    expect(out).toEqual([{ role: "assistant", content: [{ type: "text", text: INTERRUPTED_ANSWER }] }]);
  });

  it("answers every unanswered tool call", () => {
    const out = closeTail([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "" },
          { type: "tool_use", id: "t1", name: "x", input: {} },
          { type: "tool_use", id: "t2", name: "y", input: {} },
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    expect((out[0].content as unknown as { tool_use_id: string }[]).map((b) => b.tool_use_id)).toEqual(["t1", "t2"]);
  });

  it("leaves a finished conversation alone", () => {
    expect(closeTail([])).toEqual([]);
    expect(closeTail([{ role: "assistant", content: [{ type: "text", text: "done" }] }])).toEqual([]);
    expect(closeTail([{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] }])).toEqual([]);
  });

  it("shows only text blocks", () => {
    expect(visibleText([{ type: "thinking", thinking: "secret" }, { type: "text", text: "Hello" }])).toBe("Hello");
  });
});

describe("stream parsing", () => {
  it("keeps event names, skips bad frames, and returns the tail", () => {
    const { events, rest } = parseProducerFrames(
      'event: status\ndata: {"text":"Searching"}\n\nevent: delta\ndata: {broken\n\nevent: card\ndata: {"id":"a"}\n\nevent: del',
    );
    expect(events).toEqual([
      { event: "status", data: { text: "Searching" } },
      { event: "card", data: { id: "a" } },
    ]);
    expect(rest).toBe("event: del");
  });
});

describe("voice", () => {
  it("prices hearing at OpenAI's rate and speech at the stated ceiling", () => {
    // gpt-4o-mini-transcribe $0.003/min.
    expect(transcribeCostUsd(10)).toBeCloseTo((10 / 60) * 0.003, 10);
    expect(transcribeCostUsd(600)).toBeCloseTo(0.003, 10); // capped at a minute
    // gpt-4o-mini-tts: $0.05 per minute, the minute at 12 characters a second:
    // 300 characters = 25 s = $0.05 × 25/60.
    expect(speechCostUsd(300)).toBeCloseTo(0.05 * (25 / 60), 10);
    expect(speechCostUsd(720)).toBeCloseTo(0.05, 10);
  });

  it("knows exactly three voice actions", () => {
    expect(isVoiceAction("end_voice")).toBe(true);
    expect(isVoiceAction("mute_replies")).toBe(true);
    expect(isVoiceAction("unmute_replies")).toBe(true);
    expect(isVoiceAction("stop")).toBe(false);
    const tool = PRODUCER_TOOLS.find((t) => "name" in t && t.name === "voice_control");
    expect(tool).toBeTruthy();
  });

  it("releases whole sentences as they stream, and the rest at the end", () => {
    const c = sentenceChunker();
    const out: string[] = [];
    for (const piece of ["Sure. Here", "'s the plan for Friday, three shots in all. The ", "first is a close-up at golden hour", " and the second walks the market"]) {
      out.push(...c.push(piece));
    }
    expect(out).toEqual(["Sure. Here's the plan for Friday, three shots in all."]);
    expect(c.flush()).toEqual(["The first is a close-up at golden hour and the second walks the market"]);
    expect(c.flush()).toEqual([]);
  });

  it("breaks a long run with no sentence end at a space", () => {
    const c = sentenceChunker();
    const long = "word ".repeat(200);
    const out = c.push(long);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((p) => p.length <= 600)).toBe(true);
  });

  it("reads a recording only in an allowed format and size", () => {
    expect(readSpokenInput(undefined)).toBeNull();
    expect(readSpokenInput({ data: "AAAA", mime: "video/mp4", seconds: 3 })).toEqual({
      error: "That recording's format isn't supported.",
    });
    const ok = readSpokenInput({ data: Buffer.from("hello").toString("base64"), mime: "audio/webm;codecs=opus", seconds: 999 });
    expect(ok && "input" in ok && ok.input.seconds).toBe(60);
    const big = Buffer.alloc(MAX_AUDIO_BYTES + 1).toString("base64");
    expect(readSpokenInput({ data: big, mime: "audio/webm", seconds: 5 })).toEqual({
      error: "That was too long. Keep it under a minute.",
    });
  });
});

describe("spots", () => {
  it("maps what the Producer does to where it lights", () => {
    expect(spotForTool("prepare_send")).toBe("composer");
    expect(spotForTool("search_renders")).toBe("renders");
    expect(spotForTool("look_at_render")).toBe("render");
    expect(spotForTool("memory")).toBe("notes");
    expect(spotForTool("anything else")).toBeNull();
  });

  it("finds one render by id, and never builds a selector from a bad id", () => {
    const id = "00000000-0000-4000-8000-000000000002";
    expect(spotSelector("render", id)).toBe(`[data-producer-render="${id}"]`);
    expect(spotSelector("render", '"] body [x="')).toBe('[data-producer-spot="render"]');
    expect(spotSelector("composer")).toBe('[data-producer-spot="composer"]');
    expect(isSpot("composer")).toBe(true);
    expect(isSpot("<script>")).toBe(false);
  });
});

describe("who may use it", () => {
  it("admins always; Elite only once opened and in good standing; nobody suspended", () => {
    expect(producerAllowed({ role: "admin", plan: "starter" }, false).error).toBeNull();
    expect(producerAllowed({ role: "admin", status: "suspended" }, true).error).toBe(PRODUCER_SUSPENDED);
    expect(producerAllowed({ plan: "elite" }, false).error).toBe(PRODUCER_NOT_OPEN);
    expect(producerAllowed({ plan: "elite", plan_status: null }, true).error).toBeNull();
    expect(producerAllowed({ plan: "elite", plan_status: "active" }, true).error).toBeNull();
    expect(producerAllowed({ plan: "elite", plan_status: "past_due" }, true).error).toBe(PRODUCER_NEEDS_ELITE);
    expect(producerAllowed({ plan: "studio" }, true).error).toBe(PRODUCER_NEEDS_ELITE);
    expect(producerAllowed(null, true).error).toBe(PRODUCER_NEEDS_ELITE);
  });
});
