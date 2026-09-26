// The tools Picacho exposes over MCP.
//
// Deliberately a thin face over the public v1 REST API rather than a second
// way into the generator. Every call an agent makes lands on the same server
// action a customer's curl would, which means one credit meter, one allowance
// check, one refund policy, and no surface where "the MCP path" can drift
// from "the API path" the docs describe.
//
// WHAT MAKES THIS WORTH SHIPPING, and it is one field. Picacho scores every
// character render against the character's own identity photo and returns
// that number. An agent driving a generic video API gets a file back and has
// no way to know whether the face is right; an agent driving this one gets
// `match_score` and can show it to the person. The descriptions below say
// so, because the description is the only documentation the model ever
// reads.
//
// NO PAID LOOPS (Press Tour cut 0, 2026-09-25). The first descriptions told
// the model to treat a low score as a reason to "adjust the prompt and call
// again" — an instruction to spend the person's credits, unasked, in a loop
// whose exit is a number the model does not control. The score is now
// reported, and another image is the person's decision. The protocol test
// fails if either text invites a re-roll again.
//
// Definitions kept pure and alias-free so the shapes can be unit-tested —
// a malformed inputSchema is invisible until a client silently stops offering
// the tool.

//
// PRESS TOUR (Cut 8, 2026-09-26; synthesis v2 #5). Seven more tools, listed
// and callable only while press_tour_mcp is on:
//   model and card  import_product, get_brand_kit, draft_ad_plan,
//                   get_ad_job, draft_post
//   card only       start_ad and approve_stills (the paid steps) and
//                   poll_ad_job, marked visibility ["app"] (MCP Apps) and
//                   refusing to run without the one-time code only the card
//                   receives (press/nonce.ts)
// THE MONEY RULE, pinned by protocol.test.ts: the only spender a MODEL can
// call is generate_image. Posting makes a draft and a link to Picacho's
// press line; there is no post or schedule tool and no publish scope.
//
// Every tool carries its scope (oauth/config.ts), ChatGPT's per-tool
// securitySchemes, and all three hints ChatGPT requires. `scope`, `spends`,
// `pressTour` and `visibility` are this file's own fields; wireTool() turns
// a definition into what tools/list sends.

import type { McpScope } from "./oauth/config";
import { PRESS_TOUR_INSTRUCTIONS, PRESS_TOUR_TOOL_DEFS } from "./press/tool-defs";

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  /** The permission a connected app needs to call it (API keys hold every one). */
  scope: McpScope;
  /** Spends the person's credits. */
  spends: boolean;
  /** Exists only while press_tour_mcp is on. */
  pressTour: boolean;
  /** MCP Apps: who may call it. ["app"] = Picacho's card only, never the model. */
  visibility: ("model" | "app")[];
  /** The card this tool's result is drawn in (render tools only). */
  resourceUri?: string;
  /** ChatGPT's short status lines (≤ 64 characters). */
  invoking?: string;
  invoked?: string;
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: "list_characters",
    title: "List characters",
    description:
      "List the saved characters on this Picacho account. Every generation is anchored to one of these, so call this first to get a character_id.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        characters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              reference_photo_count: { type: "number" },
            },
            required: ["id", "name"],
          },
        },
      },
      required: ["characters"],
    },
    // readOnlyHint tells a client this can be called without a confirmation
    // prompt. Only ever set on tools that cannot spend money.
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    scope: "read",
    spends: false,
    pressTour: false,
    visibility: ["model", "app"],
  },
  {
    name: "generate_image",
    title: "Generate a character image",
    description:
      "Render an image of one of this account's characters and return it with an identity score. " +
      "SPENDS A CREDIT on every call. The response carries match_score (0-100): how closely the " +
      "rendered face matches the character's own reference photo. Show the image and its score to " +
      "the person; a score is information for them, not a reason to render again, so only make " +
      "another image when the person asks for one. Send an idempotency_key with every call: if a " +
      "call times out, calling again with the same key returns the first image instead of charging " +
      "twice. Takes roughly 20-60 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "What to render. Describe the scene, action and framing — not the character's face or hair, which the character reference already supplies.",
          maxLength: 2000,
        },
        character_id: {
          type: "string",
          description: "From list_characters. Omit to render without a character.",
        },
        idempotency_key: {
          type: "string",
          description:
            "A unique string you make up for this one image, such as a random UUID. The same key with the same prompt returns the first result and is never charged twice; use a new key for each new image.",
          maxLength: 255,
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: {
          type: "string",
          description:
            "succeeded, or generating when a repeated idempotency_key's image is still rendering — fetch it with get_generation.",
        },
        image_url: { type: ["string", "null"] },
        final_prompt: {
          type: ["string", "null"],
          description: "The prompt that actually ran, after Picacho's drafting step.",
        },
        match_score: {
          type: ["number", "null"],
          description: "0-100 identity match against the character's reference photo. Null when not scored.",
        },
        credits_used: { type: ["number", "null"] },
      },
      required: ["id", "status"],
    },
    // Not read-only and not idempotent: every call bills. A client SHOULD put
    // a human in the loop before invoking it, and these hints are how it knows.
    // idempotentHint stays false even with idempotency_key: the key is
    // optional, and a call without one is a new, billed image.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    scope: "generate",
    spends: true,
    pressTour: false,
    visibility: ["model", "app"],
  },
  {
    name: "get_generation",
    title: "Fetch a generation",
    description:
      "Look up a generation by id — its status, image URL and identity score. Use this to retrieve a result whose original call timed out; the render still finishes server-side.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The generation id." } },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string" },
        image_url: { type: ["string", "null"] },
        match_score: { type: ["number", "null"] },
      },
      required: ["id", "status"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    scope: "read",
    spends: false,
    pressTour: false,
    visibility: ["model", "app"],
  },
  {
    name: "get_usage",
    title: "Check credits",
    description:
      "How many credits this account can still spend: what is left of the plan's allowance this period, plus the bonus and purchased credit balances, which are spent after it. Worth checking before a batch of generations, since each one spends.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        plan: { type: "string" },
        plan_label: { type: "string" },
        included_this_period: { type: "number" },
        used_this_period: { type: "number" },
        remaining_this_period: {
          type: "number",
          description: "Left of the plan's own allowance this period. Bonus and purchased credits are separate.",
        },
        bonus_credits: { type: "number" },
        purchased_credits: { type: "number" },
        period_started_at: { type: ["string", "null"] },
      },
      required: ["plan", "remaining_this_period"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    scope: "read",
    spends: false,
    pressTour: false,
    visibility: ["model", "app"],
  },
  ...PRESS_TOUR_TOOL_DEFS,
];

export function getMcpTool(name: string): McpTool | null {
  return MCP_TOOLS.find((t) => t.name === name) ?? null;
}

/** Tools that spend credits: generate_image, and Press Tour's two card-only paid steps. */
export function isSpendingTool(name: string): boolean {
  return getMcpTool(name)?.spends === true;
}

/** Whether the model may call it (MCP Apps visibility includes "model"). */
export function isModelCallable(tool: McpTool): boolean {
  return tool.visibility.includes("model");
}

/** What tools/list sends for one tool: the protocol's fields, MCP Apps' _meta.ui, ChatGPT's securitySchemes. */
export function wireTool(tool: McpTool): Record<string, unknown> {
  const securitySchemes = [{ type: "oauth2", scopes: [tool.scope] }];
  const meta: Record<string, unknown> = { securitySchemes };
  const ui: Record<string, unknown> = {};
  if (tool.resourceUri) {
    ui.resourceUri = tool.resourceUri;
    meta["openai/outputTemplate"] = tool.resourceUri;
  }
  if (tool.pressTour) ui.visibility = tool.visibility;
  if (Object.keys(ui).length > 0) meta.ui = ui;
  if (tool.visibility.includes("app") && tool.pressTour) meta["openai/widgetAccessible"] = true;
  if (!tool.visibility.includes("model")) meta["openai/visibility"] = "private";
  if (tool.invoking) meta["openai/toolInvocation/invoking"] = tool.invoking;
  if (tool.invoked) meta["openai/toolInvocation/invoked"] = tool.invoked;
  const out: Record<string, unknown> = {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
  if (tool.outputSchema) out.outputSchema = tool.outputSchema;
  if (tool.annotations) out.annotations = tool.annotations;
  out.securitySchemes = securitySchemes;
  out._meta = meta;
  return out;
}

/** tools/list: the four standing tools, plus Press Tour's while press_tour_mcp is on. */
export function listedTools(opts: { pressTour: boolean }): Record<string, unknown>[] {
  return MCP_TOOLS.filter((t) => opts.pressTour || !t.pressTour).map(wireTool);
}

export const MCP_SERVER_INFO = {
  name: "picacho",
  title: "Picacho",
  version: "1.0.0",
} as const;

// Shown to the model once, at connection time. Says the thing that is
// genuinely different about this server rather than restating the tool list.
export const MCP_INSTRUCTIONS =
  "Picacho renders images of a saved character and verifies the result: every character render comes back with " +
  "match_score, a 0-100 measure of how closely the rendered face matches that character's reference photo. " +
  "Start with list_characters to get a character_id. Every generate_image call spends a credit: check get_usage " +
  "before a batch, show the person each image with its score, and only make another when they ask. Send an " +
  "idempotency_key with each generate_image call so a retried call is never charged twice.";

/** What initialize tells the model: the standing text, and Press Tour's while press_tour_mcp is on. */
export function mcpInstructions(opts: { pressTour: boolean }): string {
  return opts.pressTour ? `${MCP_INSTRUCTIONS} ${PRESS_TOUR_INSTRUCTIONS}` : MCP_INSTRUCTIONS;
}
