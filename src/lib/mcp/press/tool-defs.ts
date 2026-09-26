// Press Tour's MCP tools (spec §4.3 as changed by synthesis v2 #5; Cut 8).
// Definitions only: press/service.ts runs them, tools.ts lists them.
//
// The model can: read a product from its page into a DRAFT card
// (import_product), read the brand kits and products (get_brand_kit), plan
// an ad and show Picacho's card with its quote (draft_ad_plan), see where an
// ad is (get_ad_job), and save where it should be posted, getting back the
// link to Picacho's press line (draft_post). It cannot spend: painting the
// stills (start_ad) and approving them (approve_stills, which is also where
// filming starts once Cut 4's film step is wired) are card-only tools that
// need the one-time code only the card receives. poll_ad_job is the card's
// own way to follow a job without re-drawing itself.
//
// Descriptions are the only documentation a model reads: they say plainly
// that the model cannot start a paid step, and never invite another call
// on a verdict. No plans, prices in money, upgrade or checkout wording.
//
// Pure and alias-free.

import type { McpTool } from "../tools";
import { PRESS_WIDGET_URI } from "./widget";
import { AI_TAG_TEXT } from "../../press-tour/film-messages";

/** The languages the ad's AI-generated tag is written in. */
const TAG_LOCALES = Object.keys(AI_TAG_TEXT);

const VERDICT = { type: "string", enum: ["match", "didnt_match", "not_readable", "product_missing", "not_checked", "no_one_in_shot"] };

/** The ad card (press/card.ts AdCard): the structuredContent of every ad tool. */
export const AD_CARD_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    kind: { type: "string", const: "press_tour_ad" },
    version: { type: "number" },
    plan_id: { type: ["string", "null"], description: "The ad's id; pass it to get_ad_job and draft_post." },
    stage: { type: ["string", "null"] },
    title: { type: ["string", "null"] },
    star: { type: ["string", "null"] },
    product: { type: ["string", "null"] },
    cut: {
      type: ["object", "null"],
      properties: { shots: { type: "number" }, seconds: { type: "number" }, aspect: { type: "string" } },
    },
    checks: { type: "string" },
    poster_url: { type: ["string", "null"] },
    stills: {
      type: "array",
      items: {
        type: "object",
        properties: {
          shot: { type: "number" },
          role: { type: "string" },
          span: { type: "array", items: { type: "number" } },
          image_url: { type: ["string", "null"] },
          face: VERDICT,
          product: { type: "string", description: "A verdict, or not_planned when the shot has no product in it." },
          reason: { type: ["string", "null"] },
          decision: { type: "string", enum: ["pending", "approved", "kept"] },
          painting: { type: "boolean" },
          house_repainted: { type: "boolean" },
        },
        required: ["shot", "face", "product", "decision"],
      },
    },
    quote: {
      type: ["object", "null"],
      description: "The price in credits, as Picacho quotes it everywhere.",
      properties: {
        total: { type: "number" },
        paint: { type: "number" },
        animate: { type: "number" },
        paint_paid: { type: "boolean" },
        film_paid: { type: "boolean" },
        balance_now: { type: "number" },
        balance_after_next_step: { type: "number" },
        repaint_credits: { type: "number" },
        policy: { type: "string" },
      },
    },
    product_verdict: { type: ["string", "null"] },
    blocker: { type: ["string", "null"] },
    error: { type: ["string", "null"] },
    next: {
      type: "string",
      enum: ["paint", "wait", "decide", "film", "film_in_picacho", "set_up_product", "finish_in_picacho", "post", "closed"],
      description: "What happens next. paint, decide and film are the person's taps on Picacho's card; you cannot do them.",
    },
    short_by: { type: ["object", "null"], properties: { needed: { type: "number" }, have: { type: "number" } } },
    film_open: { type: "boolean" },
    open_url: { type: "string" },
    press_line_url: { type: ["string", "null"] },
    summary: { type: "string" },
  },
  required: ["kind", "next", "open_url", "summary"],
};

const PLAN_ID = { type: "string", description: "The ad's plan_id, from draft_ad_plan." };
const UI_NONCE = { type: "string", description: "Picacho's card supplies this; it cannot be made up.", maxLength: 200 };

export const PRESS_TOUR_TOOL_DEFS: McpTool[] = [
  {
    name: "import_product",
    title: "Read a product from its page",
    description:
      "Read a product's public page into a DRAFT product card in Picacho: its name, photos and the words printed on it. " +
      "Nothing is spent. The person then confirms the card in Picacho (they tick the words on the label and confirm they " +
      "may advertise the product); an ad can only be painted from a confirmed card. A page read before returns the same " +
      "card without reading it again. Takes up to a minute.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The address of the product's own page.", maxLength: 2048 },
        brand_kit_id: { type: "string", description: "Optional: a brand kit from get_brand_kit to file it under." },
      },
      required: ["url"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        product: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            status: { type: "string", enum: ["draft", "confirmed"] },
            source_url: { type: ["string", "null"] },
            label_words_found: { type: "number" },
          },
          required: ["id", "status"],
        },
        next: { type: "string", enum: ["confirm_in_picacho", "ready"] },
        open_url: { type: "string" },
        summary: { type: "string" },
      },
      required: ["product", "next", "open_url"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    scope: "brand",
    spends: false,
    pressTour: true,
    visibility: ["model", "app"],
    invoking: "Reading the product page…",
    invoked: "Product card drafted",
  },
  {
    name: "get_brand_kit",
    title: "Brand kits and products",
    description:
      "The account's brand kits (name, colours, tone, tagline, call to action) and its product cards (draft or confirmed), " +
      "with their ids. Use a confirmed product's id with draft_ad_plan.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        brand_kits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              status: { type: "string" },
              palette: { type: "array", items: { type: "string" } },
              tone: { type: ["string", "null"] },
              tagline: { type: ["string", "null"] },
              default_cta: { type: ["string", "null"] },
            },
            required: ["id", "name"],
          },
        },
        products: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              status: { type: "string" },
              source_url: { type: ["string", "null"] },
            },
            required: ["id", "name", "status"],
          },
        },
      },
      required: ["brand_kits", "products"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: "read",
    spends: false,
    pressTour: true,
    visibility: ["model", "app"],
  },
  {
    name: "draft_ad_plan",
    title: "Plan a Press Tour ad",
    description:
      "Plan a 9:16 Press Tour ad: one of the account's characters stars, a confirmed product co-stars. Returns the shots " +
      "and Picacho's quote in credits, shown on Picacho's card. NOTHING IS SPENT HERE, and you cannot start the paid steps: " +
      "the stills are painted, and later filmed, only when the person taps the card. Planning the same ad again with the " +
      "same idempotency_key (or the same choices on the same day) returns the same plan. Name the product by product_id, " +
      "or by its page address as product_url when Picacho already has it.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "The star, from list_characters." },
        product_id: { type: "string", description: "A confirmed product, from get_brand_kit or import_product." },
        product_url: { type: "string", description: "Instead of product_id: the product page's address.", maxLength: 2048 },
        length_seconds: { type: "number", enum: [10, 15, 30], description: "The ad's length. 15 when left out." },
        goal: { type: "string", description: "What the ad should do, in the person's words.", maxLength: 500 },
        brand_kit_id: { type: "string", description: "Optional brand kit, from get_brand_kit." },
        idempotency_key: {
          type: "string",
          description: "Optional: a string you make up for this one plan. The same key returns the same plan.",
          maxLength: 255,
        },
      },
      required: ["character_id"],
      additionalProperties: false,
    },
    outputSchema: AD_CARD_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: "read",
    spends: false,
    pressTour: true,
    visibility: ["model", "app"],
    resourceUri: PRESS_WIDGET_URI,
    invoking: "Planning the ad…",
    invoked: "Ad planned",
  },
  {
    name: "get_ad_job",
    title: "Where an ad is",
    description:
      "Where a Press Tour ad is: its stage, each still with its face and product check, the quote in credits and what " +
      "happens next. Shown on Picacho's card. Nothing is spent.",
    inputSchema: {
      type: "object",
      properties: { plan_id: PLAN_ID },
      required: ["plan_id"],
      additionalProperties: false,
    },
    outputSchema: AD_CARD_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: "read",
    spends: false,
    pressTour: true,
    visibility: ["model", "app"],
    resourceUri: PRESS_WIDGET_URI,
  },
  {
    name: "draft_post",
    title: "Choose where the ad goes",
    description:
      "Save which networks a Press Tour ad should go to and get the link to Picacho's press line. Nothing is posted: the " +
      "person checks each post and sends it from the press line in Picacho.",
    inputSchema: {
      type: "object",
      properties: {
        plan_id: PLAN_ID,
        networks: {
          type: "array",
          items: { type: "string", enum: ["x", "tiktok", "instagram", "threads"] },
          minItems: 1,
          maxItems: 4,
        },
      },
      required: ["plan_id", "networks"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        networks: { type: "array", items: { type: "string" } },
        ready: { type: "boolean" },
        press_line_url: { type: "string" },
        summary: { type: "string" },
      },
      required: ["plan_id", "networks", "press_line_url"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: "generate",
    spends: false,
    pressTour: true,
    visibility: ["model", "app"],
  },
  // ---- Picacho's card only ---------------------------------------------------
  {
    name: "start_ad",
    title: "Paint the stills",
    description:
      "Picacho's card calls this when the person taps Paint. It spends the stills line of the quote. It needs the card's " +
      "one-time code and cannot be called by a model.",
    inputSchema: {
      type: "object",
      properties: { plan_id: PLAN_ID, ui_nonce: UI_NONCE },
      required: ["plan_id", "ui_nonce"],
      additionalProperties: false,
    },
    outputSchema: AD_CARD_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    scope: "generate",
    spends: true,
    pressTour: true,
    visibility: ["app"],
  },
  {
    name: "approve_stills",
    title: "Approve the stills",
    description:
      "Picacho's card calls this when the person approves or keeps each still (and, once filming opens here, presses " +
      "Film, which spends the film line of the quote). It needs the card's one-time code and cannot be called by a model.",
    inputSchema: {
      type: "object",
      properties: {
        plan_id: PLAN_ID,
        ui_nonce: UI_NONCE,
        decisions: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              shot: { type: "number", minimum: 1, maximum: 12 },
              choice: { type: "string", enum: ["approve", "keep"] },
            },
            required: ["shot", "choice"],
            additionalProperties: false,
          },
        },
        // The card's language: the finished ad's small AI-generated tag is
        // written in it when this tap films (film-messages.ts AI_TAG_TEXT).
        locale: { type: "string", enum: TAG_LOCALES },
      },
      required: ["plan_id", "ui_nonce"],
      additionalProperties: false,
    },
    outputSchema: AD_CARD_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    scope: "generate",
    spends: true,
    pressTour: true,
    visibility: ["app"],
  },
  {
    name: "poll_ad_job",
    title: "Follow an ad",
    description: "Picacho's card calls this to follow an ad while it is being painted or filmed. Nothing is spent.",
    inputSchema: {
      type: "object",
      properties: { plan_id: PLAN_ID },
      required: ["plan_id"],
      additionalProperties: false,
    },
    outputSchema: AD_CARD_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: "read",
    spends: false,
    pressTour: true,
    visibility: ["app"],
  },
];

/** What the model is told at connection time about Press Tour (appended while press_tour_mcp is on). */
export const PRESS_TOUR_INSTRUCTIONS =
  "Press Tour makes a 9:16 ad in which one of the person's characters stars and their product co-stars. import_product " +
  "reads a product page into a draft card that the person confirms in Picacho. draft_ad_plan plans the ad and shows " +
  "Picacho's card with the quote in credits. Painting the stills and filming start only when the person taps that card; " +
  "you cannot start them. get_ad_job shows where an ad is. Posting happens on Picacho's press line: draft_post saves the " +
  "networks and returns its link, and posts nothing.";
