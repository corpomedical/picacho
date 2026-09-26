import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  ESCALATION_CEILING_USD,
  ESCALATION_MODEL,
  ESCALATION_SCHEMA,
  escalateFrame,
  escalationRequest,
  sonnetUsd,
  type MessagesClient,
} from "./escalate";
import { ESCALATION_INSTRUCTIONS, type CardForReaders } from "./judge";

// The second reading, against a fake SDK client.

const CARD: CardForReaders = { name: "Solstad", expected: ["SOLSTAD"], noReadableText: false, dna: null, palette: [] };
const PIC = Buffer.from([0xff, 0xd8, 0xff, 1]);
const READING = {
  present: "yes",
  shape: "off",
  label: "off",
  logo: "unseen",
  colour: "ok",
  label_in_view: true,
  blurred: false,
  verdict: "mismatch",
  confidence: 81,
  note: "Different logo.",
};

function message(over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: ESCALATION_MODEL,
    content: [{ type: "text", text: JSON.stringify(READING), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 4487, output_tokens: 200 },
    ...over,
  } as unknown as Anthropic.Message;
}

function client(impl: () => Promise<Anthropic.Message>) {
  const create = vi.fn(async (body: Anthropic.MessageCreateParamsNonStreaming) => {
    void body;
    return impl();
  });
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}

describe("the request", () => {
  it("claude-sonnet-5, no thinking, schema-constrained, the fenced card, pictures inline, the frame last", () => {
    const req = escalationRequest({ references: [PIC, PIC, PIC, PIC], card: CARD, crop: PIC, frame: Buffer.from([7]) });
    expect(req.model).toBe("claude-sonnet-5");
    expect(req.thinking).toEqual({ type: "disabled" });
    expect(req.system).toBe(ESCALATION_INSTRUCTIONS);
    expect(req.output_config?.format).toEqual({ type: "json_schema", schema: ESCALATION_SCHEMA });
    const content = req.messages[0].content as (Anthropic.ImageBlockParam | Anthropic.TextBlockParam)[];
    const images = content.filter((b) => b.type === "image") as Anthropic.ImageBlockParam[];
    expect(images).toHaveLength(5); // 3 references, the crop, the frame
    expect((images.at(-1)!.source as Anthropic.Base64ImageSource).data).toBe(Buffer.from([7]).toString("base64"));
    expect(content.some((b) => b.type === "text" && b.text.includes('<untrusted_page source="card">'))).toBe(true);
  });

  it("with nothing to crop (confirming an absence) it sends the frame alone", () => {
    const req = escalationRequest({ references: [PIC], card: CARD, crop: null, frame: PIC });
    const content = req.messages[0].content as { type: string; text?: string }[];
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect(content.some((b) => b.text?.includes("CROP"))).toBe(false);
  });

  it("the schema allows nothing else and requires every field", () => {
    expect(ESCALATION_SCHEMA.additionalProperties).toBe(false);
    expect([...ESCALATION_SCHEMA.required].sort()).toEqual(Object.keys(ESCALATION_SCHEMA.properties).sort());
  });
});

describe("the answer", () => {
  it("parsed and priced from its usage ($2 / $10 per 1M)", async () => {
    const c = client(async () => message());
    const out = await escalateFrame({ references: [PIC], card: CARD, crop: PIC, frame: PIC }, { client: c.client });
    expect(out).toMatchObject({ ok: true, value: { present: "yes", verdict: "mismatch", confidence: 81, labelInView: true }, model: "claude-sonnet-5" });
    expect(out.usd).toBeCloseTo(sonnetUsd(4487, 200));
    expect(out.usd).toBeCloseTo(0.010974, 5);
    expect(c.create.mock.calls[0][0].model).toBe("claude-sonnet-5");
  });

  it("no client (no key) is not_configured and sends nothing", async () => {
    expect(await escalateFrame({ references: [PIC], card: CARD, crop: PIC, frame: PIC }, { client: null })).toEqual({ ok: false, reason: "not_configured", usd: 0 });
  });

  it("a refusal is unreadable", async () => {
    const c = client(async () => message({ stop_reason: "refusal" as Anthropic.Message["stop_reason"] }));
    expect(await escalateFrame({ references: [PIC], card: CARD, crop: PIC, frame: PIC }, { client: c.client })).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("an answer outside its shape is unreadable", async () => {
    const c = client(async () => message({ content: [{ type: "text", text: '{"verdict":"maybe"}', citations: null }] as Anthropic.Message["content"] }));
    expect(await escalateFrame({ references: [PIC], card: CARD, crop: PIC, frame: PIC }, { client: c.client })).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("a refused key, a busy service and a dropped connection read as kinds; a dropped one is booked at the ceiling", async () => {
    const refused = client(async () => Promise.reject(Object.assign(new Error("no"), { status: 401 })));
    expect(await escalateFrame({ references: [PIC], card: CARD, crop: PIC, frame: PIC }, { client: refused.client })).toEqual({ ok: false, reason: "refused", usd: 0 });
    const busy = client(async () => Promise.reject(Object.assign(new Error("slow"), { status: 529 })));
    expect(await escalateFrame({ references: [PIC], card: CARD, crop: PIC, frame: PIC }, { client: busy.client })).toMatchObject({ ok: false, reason: "busy" });
    const dropped = client(async () => Promise.reject(new Error("socket")));
    expect(await escalateFrame({ references: [PIC], card: CARD, crop: PIC, frame: PIC }, { client: dropped.client })).toEqual({
      ok: false,
      reason: "unavailable",
      usd: ESCALATION_CEILING_USD,
    });
  });
});
