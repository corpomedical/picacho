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
// `match_score` and can decide to try again. Tools that hand a model a
// number it can act on are worth more than tools that hand it a URL, and the
// descriptions below say so, because the description is the only
// documentation the model ever reads.
//
// Definitions kept pure and alias-free so the shapes can be unit-tested —
// a malformed inputSchema is invisible until a client silently stops offering
// the tool.

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
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
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "generate_image",
    title: "Generate a character image",
    description:
      "Render an image of one of this account's characters and return it with an identity score. " +
      "SPENDS A CREDIT. The response carries match_score (0-100): how closely the rendered face " +
      "matches the character's own reference photo. Treat a low score as a signal to adjust the " +
      "prompt and call again rather than accepting the result — that number is the point of this " +
      "tool. Takes roughly 20-60 seconds.",
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
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string" },
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
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_usage",
    title: "Check credits",
    description:
      "How many credits this account has left in the current period, plus any purchased credits. Worth checking before a batch of generations, since each one spends.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        plan: { type: "string" },
        included_this_period: { type: "number" },
        used_this_period: { type: "number" },
        remaining_this_period: { type: "number" },
        purchased_credits: { type: "number" },
      },
      required: ["plan", "remaining_this_period"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export function getMcpTool(name: string): McpTool | null {
  return MCP_TOOLS.find((t) => t.name === name) ?? null;
}

/** Tools that spend credits — the ones a client should confirm before calling. */
export function isSpendingTool(name: string): boolean {
  const tool = getMcpTool(name);
  return tool ? tool.annotations?.readOnlyHint !== true : false;
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
  "Start with list_characters to get a character_id. Generations spend credits — check get_usage before a batch, " +
  "and prefer adjusting the prompt over re-rolling the same one when a score comes back low.";
