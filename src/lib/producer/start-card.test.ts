import { describe, expect, it, vi } from "vitest";
import {
  ASK_FIRST_ABOVE_CREDITS,
  MAX_STARTS_PER_TURN,
  cardGenerationId,
  cardsIn,
  findCard,
  startRefusal,
  startResultText,
  type StartableCard,
} from "./start-card";
import { pressNote } from "./screen";
// run-tools' other tools reach the app's server helpers; these don't.
vi.mock("./look", () => ({ lookAtRender: async () => null }));
vi.mock("./store", () => ({ notesStore: () => null }));
vi.mock("./set-tools", () => ({ readSetTool: vi.fn(), fixSetTool: vi.fn(), undoSetTool: vi.fn() }));
import { runTool, type ToolContext } from "./run-tools";
import { PRODUCER_TOOLS, TOOL_NAMES } from "./tools";

// Hands-free (operator, 2026-10-01: "I asked she takes control so the user
// works hands free" → "Say price, then go" + "Press buttons on the page").

const card = (over: Partial<StartableCard> = {}): StartableCard => ({
  id: "c1",
  kind: "video",
  label: "Eva at the beach",
  prompt: "Eva walks along the beach at sunset",
  characterId: null,
  modelId: "kling",
  seconds: 5,
  credits: 4,
  generationId: null,
  ...over,
});

describe("finding her cards", () => {
  it("reads the lamp's and the chat page's saved cards, newest first wins", () => {
    const saved = cardsIn(
      [
        { text: "a", cards: [card({ id: "c1", credits: 1 })] },
        null,
        { cards: [{ id: "x" }] }, // no prompt: not a card
        { cards: [card({ id: "c1", credits: 7 })] },
      ],
      "cards",
    );
    expect(saved.map((c) => c.credits)).toEqual([1, 7]);
    expect(findCard(saved, "c1")?.credits).toBe(7);
    expect(findCard(saved, "nope")).toBeNull();
    expect(findCard(saved, 42)).toBeNull();
    expect(cardsIn([{ renders: [card({ id: "r1", generationId: "g" })] }], "renders")[0].generationId).toBe("g");
  });
});

describe("startRefusal", () => {
  it("starts a card it finds, once, up to the cap", () => {
    expect(startRefusal(card(), [])).toBeNull();
    expect(startRefusal(null, [])).toMatch(/no card/);
    expect(startRefusal(card({ kind: "ad" }), [])).toMatch(/Press Tour/);
    expect(startRefusal(card(), ["c1"])).toMatch(/already started/);
    expect(startRefusal(card({ generationId: "g1" }), [])).toMatch(/already been made/);
    expect(startRefusal(card({ id: "z" }), Array.from({ length: MAX_STARTS_PER_TURN }, (_, i) => `s${i}`))).toMatch(/At most/);
  });

  it("tells her the price in every outcome", () => {
    expect(startResultText(card(), { state: "started" })).toContain("4 credits");
    expect(startResultText(card({ kind: "image", credits: 1 }), { state: "done" })).toContain("1 credit)");
    expect(startResultText(card(), { state: "failed", error: "Not enough credits." })).toContain("Not enough credits.");
  });
});

describe("cardGenerationId", () => {
  it("is a stable UUID per person and card", () => {
    const a = cardGenerationId("u1", "thread:c1");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(cardGenerationId("u1", "thread:c1")).toBe(a);
    expect(cardGenerationId("u2", "thread:c1")).not.toBe(a);
    expect(cardGenerationId("u1", "thread:c2")).not.toBe(a);
  });
});

describe("start_render and press_button through runTool", () => {
  const call = (name: string, input: unknown) => ({ id: "t1", name, input });
  const ctx = (extra: Partial<ToolContext> = {}): ToolContext =>
    ({ supabase: null, admin: null, userId: "u1", ...extra }) as unknown as ToolContext;

  it("starts only a saved card, with the card's own price", async () => {
    const start = vi.fn(async () => ({ state: "started" as const, generationId: "g-1" }));
    const hands = { cards: () => [card()], startedThisTurn: [] as string[], start };
    const o = await runTool(ctx({ hands }), call(TOOL_NAMES.startRender, { card_id: "c1" }));
    expect(start).toHaveBeenCalledWith(card());
    expect(o.started).toEqual({ cardId: "c1", generationId: "g-1", state: "started" });
    expect(String(o.result.content)).toContain("4 credits");
    // The same card again in this answer: refused, nothing started.
    const again = await runTool(ctx({ hands }), call(TOOL_NAMES.startRender, { card_id: "c1" }));
    expect(again.result.is_error).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("says why when it couldn't start, and offers nothing where there are no hands", async () => {
    const hands = {
      cards: () => [card()],
      startedThisTurn: [] as string[],
      start: async () => ({ state: "failed" as const, generationId: "g", error: "Not enough credits." }),
    };
    const failed = await runTool(ctx({ hands }), call(TOOL_NAMES.startRender, { card_id: "c1" }));
    expect(failed.result.is_error).toBe(true);
    expect(failed.started).toBeUndefined();
    expect((await runTool(ctx(), call(TOOL_NAMES.startRender, { card_id: "c1" }))).result.is_error).toBe(true);
  });

  it("presses only where there's a browser", async () => {
    const o = await runTool(ctx({ canPress: true }), call(TOOL_NAMES.press, { words: "  Download  " }));
    expect(o.press).toEqual({ words: "Download" });
    expect((await runTool(ctx(), call(TOOL_NAMES.press, { words: "Download" }))).press).toBeUndefined();
    expect((await runTool(ctx({ canPress: true }), call(TOOL_NAMES.press, { words: " " }))).result.is_error).toBe(true);
  });

  it("keeps both tools free of union types (the API's strict-tool limit)", () => {
    for (const name of [TOOL_NAMES.startRender, TOOL_NAMES.press]) {
      const t = (PRODUCER_TOOLS as unknown as { name: string; strict?: boolean; input_schema: { properties: Record<string, { type?: unknown; anyOf?: unknown }> } }[]).find((x) => x.name === name)!;
      expect(t.strict).toBe(true);
      for (const p of Object.values(t.input_schema.properties)) expect(typeof p.type === "string" && !p.anyOf).toBe(true);
    }
    expect(ASK_FIRST_ABOVE_CREDITS).toBe(10);
  });
});

describe("pressNote", () => {
  it("tells her what her last press did, from the browser's report", () => {
    expect(pressNote({ words: "Download", outcome: "pressed" })).toContain("was pressed");
    expect(pressNote({ words: "Delete", outcome: "refused", why: "that one is theirs to press" })).toContain("NOT pressed: that one is theirs");
    expect(pressNote({ words: "Foo", outcome: "not found" })).toContain("wasn't found");
    expect(pressNote({ outcome: "pressed" })).toBeNull();
    expect(pressNote("pressed")).toBeNull();
  });
});
