// Product checks: the second reading (spec §1.8 "Escalation").
//
// When the words (T1) and the first reader (T2) disagree, or T2 says
// "mismatch" with nothing to back it, one frame's evidence goes to a
// different model: Claude Sonnet 5, through the Anthropic SDK the repo
// already depends on (@anthropic-ai/sdk, as the Producer and the editor use
// it). At most MAX_ESCALATIONS_PER_AD per ad (product-lock.ts); once they
// are spent, an unresolved frame is "Not readable".
//
// It is shown what T2 was shown — the reference photos, the fenced card, the
// crop — plus the whole frame, and it answers the same fields as T2 and one
// more: is there a product in the product's role at all (so a single still
// with no product found can be confirmed as missing, v2 #16).
//
// THE MONEY. claude-sonnet-5 is $2 per 1M input tokens and $10 per 1M
// output tokens (the constraints brief, read at platform.claude.com/docs/
// en/about-claude/pricing; the same figures in the SDK reference of
// 2026-06-24). Pictures go at most ESCALATION_IMAGE_EDGE on the long edge
// so a reading stays near the brief's 4,487 input tokens ≈ $0.011. A
// reading is priced from the usage it reports.
//
// FENCED, like judge.ts: pictures are data, the card is fenced, the answer
// is schema-constrained JSON bounded again by parseEscalation. No thinking
// (Sonnet 5 takes {type: "disabled"}), no tools.
//
// NEVER THROWS: a missing key, a refusal, a timeout or an unreadable answer
// is { ok: false, reason }.
//
// Relative imports only: tested with a fake client.

import type Anthropic from "@anthropic-ai/sdk";
import { ESCALATION_INSTRUCTIONS, cardBrief, jsonFromText, parseEscalation, type CardForReaders, type ReaderAnswer } from "./judge";
import type { EscalationReading } from "./product-lock";

export const ESCALATION_MODEL = "claude-sonnet-5";
export const ESCALATION_TIMEOUT_MS = 30_000;
export const ESCALATION_MAX_TOKENS = 1024;
/** Pictures are sent at most this big on their long edge (crop.ts prepares them). */
export const ESCALATION_IMAGE_EDGE = 768;
export const SONNET_INPUT_USD_PER_M = 2;
export const SONNET_OUTPUT_USD_PER_M = 10;
/** What a reading is booked at with no usage: 8,000 in + 1,024 out. */
export const ESCALATION_CEILING_USD = (8000 * SONNET_INPUT_USD_PER_M + ESCALATION_MAX_TOKENS * SONNET_OUTPUT_USD_PER_M) / 1_000_000;

/** The one method of the SDK client this uses (tests pass a fake). */
export type MessagesClient = {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming, options?: { timeout?: number; maxRetries?: number }): Promise<Anthropic.Message>;
  };
};

const ASPECT = { type: "string", enum: ["ok", "off", "unseen"] };

/** The answer's JSON schema (structured outputs: every field required, nothing else allowed). */
export const ESCALATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    present: { type: "string", enum: ["yes", "no", "unclear"] },
    shape: ASPECT,
    label: ASPECT,
    logo: ASPECT,
    colour: ASPECT,
    label_in_view: { type: "boolean" },
    blurred: { type: "boolean" },
    verdict: { type: "string", enum: ["match", "mismatch", "not_readable"] },
    confidence: { type: "integer" },
    note: { type: "string" },
  },
  required: ["present", "shape", "label", "logo", "colour", "label_in_view", "blurred", "verdict", "confidence", "note"],
} as const;

type Block = Anthropic.ImageBlockParam | Anthropic.TextBlockParam;

const picture = (bytes: Buffer): Anthropic.ImageBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: bytes.toString("base64") },
});

/** Pure: the request. `crop` is null when nothing was found to crop (a confirmation of absence). */
export function escalationRequest(input: {
  references: readonly Buffer[];
  card: CardForReaders;
  crop: Buffer | null;
  frame: Buffer;
}): Anthropic.MessageCreateParamsNonStreaming {
  const content: Block[] = [];
  input.references.slice(0, 3).forEach((bytes, i) => {
    content.push({ type: "text", text: i === 0 ? "Reference photo 1 of the product (the front):" : `Reference photo ${i + 1} of the product:` });
    content.push(picture(bytes));
  });
  content.push({ type: "text", text: `The product card:\n${cardBrief(input.card)}` });
  if (input.crop) {
    content.push({ type: "text", text: "The CROP round the product:" });
    content.push(picture(input.crop));
  }
  content.push({ type: "text", text: "The whole FRAME:" });
  content.push(picture(input.frame));
  return {
    model: ESCALATION_MODEL,
    max_tokens: ESCALATION_MAX_TOKENS,
    thinking: { type: "disabled" },
    system: ESCALATION_INSTRUCTIONS,
    output_config: { format: { type: "json_schema", schema: ESCALATION_SCHEMA as unknown as { [key: string]: unknown } } },
    messages: [{ role: "user", content }],
  };
}

export function sonnetUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * SONNET_INPUT_USD_PER_M + outputTokens * SONNET_OUTPUT_USD_PER_M) / 1_000_000;
}

/** The second reading of one frame. */
export async function escalateFrame(
  input: { references: readonly Buffer[]; card: CardForReaders; crop: Buffer | null; frame: Buffer },
  deps: { client: MessagesClient | null; timeoutMs?: number },
): Promise<ReaderAnswer<EscalationReading>> {
  if (!deps.client) return { ok: false, reason: "not_configured", usd: 0 };
  let message: Anthropic.Message;
  try {
    message = await deps.client.messages.create(escalationRequest(input), {
      timeout: Math.max(1, Math.min(ESCALATION_TIMEOUT_MS, deps.timeoutMs ?? ESCALATION_TIMEOUT_MS)),
      maxRetries: 1,
    });
  } catch (err) {
    const status = (err as { status?: unknown } | null)?.status;
    if (status === 401 || status === 403) {
      console.error(`[product-lock] second reading: the key was refused (${status})`);
      return { ok: false, reason: "refused", usd: 0 };
    }
    if (status === 429 || status === 529) {
      console.warn(`[product-lock] second reading: busy (${status})`);
      return { ok: false, reason: "busy", usd: 0 };
    }
    // No status: a timeout or a dropped connection, which may still bill.
    console.warn(`[product-lock] second reading: ${typeof status === "number" ? `answered ${status}` : "no answer"}`);
    return { ok: false, reason: "unavailable", usd: typeof status === "number" ? 0 : ESCALATION_CEILING_USD };
  }
  const usage = message.usage;
  const usd = usage ? sonnetUsd(usage.input_tokens ?? 0, usage.output_tokens ?? 0) : ESCALATION_CEILING_USD;
  if (message.stop_reason === "refusal") {
    console.warn("[product-lock] second reading: declined");
    return { ok: false, reason: "unreadable", usd };
  }
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const value = parseEscalation(jsonFromText(text));
  if (!value) {
    console.warn("[product-lock] second reading: the answer did not fit its shape");
    return { ok: false, reason: "unreadable", usd };
  }
  return { ok: true, value, usd, model: ESCALATION_MODEL };
}
