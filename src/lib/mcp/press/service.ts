// Press Tour's MCP tools, run (tool-defs.ts defines them; the route
// dispatches here). A thin face over the SAME campaign engine the door uses
// (campaign-service.ts through runtime.ts): one quote, one allowance, one
// set of gates, one idempotency rule. Nothing here prices, plans or paints
// on its own.
//
// ORDER, every call: the route has already checked the switch, the
// credential, the scope and the person (runtime.ts pressCaller). Here: the
// arguments, then — for a paid step — the card's one-time code (nonce.ts),
// and only then the engine, which checks ownership and money again itself.
//
// IDEMPOTENCY. A plan's id comes from its idempotency_key (or from its
// choices and the day), so a repeated draft_ad_plan meets the same ad. A
// paid step's send id comes from the one-time code it used, so the same tap
// delivered twice meets the same rows and is charged once.
//
// Alias-free: service.test.ts drives it with a fake engine and an in-memory
// database.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mediaUrl } from "../../media/url";
import { PRODUCT_NOT_CONFIRMED, CAMPAIGN_CLOSED, priceChanged } from "../../press-tour/campaign-messages";
import type { CampaignResult, CampaignView } from "../../press-tour/campaign-types";
import { AI_TAG_TEXT } from "../../press-tour/film-messages";
import { BRAND_KIT_COLUMNS, PRODUCT_CARD_COLUMNS, brandKitFromRow, productCardFromRow, type ProductCard } from "../../press-tour/types";
import { toolError, toolResult, type ToolTextResult } from "../protocol";
import { adCardFromView, doorUrl, pressLineUrl, setUpProductCard, type AdCard } from "./card";
import {
  CHARACTER_REQUIRED,
  DECISIONS_INVALID,
  LENGTH_INVALID,
  NETWORKS_INVALID,
  NONCE_EXPIRED,
  NONCE_REQUIRED,
  NONCE_USED,
  NONCE_WRONG,
  PLAN_ID_REQUIRED,
  POST_IN_PICACHO,
  POST_NOT_READY,
  PRESS_MCP_FAILED,
  PRODUCT_DRAFT_READY,
  PRODUCT_NOT_FOUND_BY_URL,
  PRODUCT_READY,
  PRODUCT_REQUIRED,
  PRODUCT_URL_REQUIRED,
} from "./messages";
import { mintNonce, sameQuote, redeemNonce, type CardNonce, type NoncePurpose } from "./nonce";
import { UI_NONCE_META_KEY } from "./widget";

/** Who is asking, as runtime.ts found them: Press Tour open to them (never the trial through MCP). */
export type PressMcpCaller = { userId: string; via: "admin" | "plan"; grantId: string | null };

/** The campaign engine, bound to its real dependencies (runtime.ts) or to a fake (tests). */
export interface PressEngine {
  plan(input: {
    sendId: string;
    productId: string;
    characterId: string;
    brandKitId?: string | null;
    lengthSeconds?: 10 | 15 | 30;
    goal?: string;
  }): Promise<CampaignResult>;
  paint(input: { sendId: string; campaignId: string }): Promise<CampaignResult>;
  approve(input: { campaignId: string; shot: number }): Promise<CampaignResult>;
  keep(input: { campaignId: string; shot: number }): Promise<CampaignResult>;
  get(input: { campaignId: string }): Promise<CampaignResult>;
  /** Filming from the card: null until filming is open to this person (Cut 4's film step and its switch). */
  film: ((input: { sendId: string; campaignId: string; locale?: string }) => Promise<CampaignResult>) | null;
  /** A product page into a draft card (card-service.ts importProductFromUrl). */
  importProduct(input: { url: string; brandKitId: string | null }): Promise<{ error: null; card: ProductCard; labelCandidates: string[] } | { error: string }>;
  /** Whether this person's paid presses are open (campaign-service.ts campaignGate). */
  canSpend: boolean;
}

export type PressDeps = {
  /** The service-role client (every read names its owner). */
  db: SupabaseClient;
  engine: PressEngine;
  /** The origin the request came in on: links and pictures are made absolute on it. */
  origin: string;
  /** A person's repaint of one still (quote.ts repaintCredits). */
  repaintCredits: number;
  now?: () => Date;
  newNonce?: () => string;
};

type Args = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseUuid(raw: unknown): string | null {
  return typeof raw === "string" && UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

/** An id made by a rule (SHA-256 stamped as a version-8 UUID; campaign-machine.ts's shape). Same seed, same id. */
function derivedUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const nowOf = (deps: PressDeps) => (deps.now ? deps.now() : new Date());

// ---------------------------------------------------------------------------
// Reading the person's own things
// ---------------------------------------------------------------------------

/** Every spelling of a product page a person might paste, as import stores it (vetUrl upgrades http). */
function urlVariants(raw: string): string[] {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    try {
      u = new URL(`https://${raw.trim()}`);
    } catch {
      return [];
    }
  }
  if (u.protocol === "http:") u.protocol = "https:";
  u.hash = "";
  const href = u.href;
  const bare = href.endsWith("/") ? href.slice(0, -1) : `${href}/`;
  return [...new Set([href, bare])];
}

async function productByUrl(db: SupabaseClient, userId: string, url: string): Promise<ProductCard | null> {
  const variants = urlVariants(url);
  if (variants.length === 0) return null;
  try {
    const { data } = await db
      .from("products")
      .select(PRODUCT_CARD_COLUMNS)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("status", ["draft", "confirmed"])
      .in("source_url", variants)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return productCardFromRow(data);
  } catch {
    return null;
  }
}

async function productById(db: SupabaseClient, userId: string, id: string): Promise<ProductCard | null> {
  try {
    const { data } = await db.from("products").select(PRODUCT_CARD_COLUMNS).eq("id", id).eq("user_id", userId).is("deleted_at", null).maybeSingle();
    return productCardFromRow(data);
  } catch {
    return null;
  }
}

async function starOf(db: SupabaseClient, userId: string, characterId: string | undefined): Promise<{ name: string | null; photo: string | null }> {
  if (!characterId) return { name: null, photo: null };
  try {
    const { data } = await db
      .from("character_profiles")
      .select("name, reference_image_urls")
      .eq("id", characterId)
      .eq("user_id", userId)
      .maybeSingle();
    const r = data as { name?: unknown; reference_image_urls?: unknown } | null;
    const photos = Array.isArray(r?.reference_image_urls) ? r.reference_image_urls.filter((p): p is string => typeof p === "string" && p.length > 0) : [];
    return { name: typeof r?.name === "string" ? r.name : null, photo: photos[0] ? mediaUrl("character-references", photos[0]) : null };
  } catch {
    return { name: null, photo: null };
  }
}

// ---------------------------------------------------------------------------
// The card, and its one-time code
// ---------------------------------------------------------------------------

/**
 * Which paid step the card's next tap would take, if any. The Approve key
 * is minted `film` only when the card shows the Film key and its price
 * (film_open); otherwise `approve`, which records the choices and never
 * films (MONEY-4).
 */
function purposeFor(card: AdCard): NoncePurpose | null {
  if (card.next === "paint" && !card.short_by) return "paint";
  if (card.next === "decide") return card.film_open ? "film" : "approve";
  if (card.next === "film" && !card.short_by) return "film";
  return null;
}

/**
 * A tool result carrying the ad card: structuredContent for the model and
 * the card, and — in _meta, which only the card ever sees — a one-time code
 * for the next paid tap when there is one.
 */
async function cardResult(deps: PressDeps, caller: PressMcpCaller, view: CampaignView, error: string | null = null): Promise<ToolTextResult> {
  const [star, product] = await Promise.all([
    starOf(deps.db, caller.userId, view.characterIds[0]),
    productById(deps.db, caller.userId, view.productId),
  ]);
  const card = adCardFromView(view, {
    origin: deps.origin,
    charged: caller.via !== "admin",
    filmOpen: deps.engine.film !== null,
    starName: star.name,
    productName: product?.name || null,
    posterFallback: star.photo,
    repaintCredits: deps.repaintCredits,
  });
  let nonce: CardNonce | null = null;
  const purpose = purposeFor(card);
  if (purpose && deps.engine.canSpend && view.quote) {
    nonce = await mintNonce(
      deps.db,
      { userId: caller.userId, campaignId: view.id, purpose, quote: view.quote, grantId: caller.grantId },
      { now: deps.now, newNonce: deps.newNonce },
    );
  }
  const result: ToolTextResult = toolResult(card as unknown as Record<string, unknown>);
  if (error) {
    result.isError = true;
    result.content = [{ type: "text", text: `${error} ${card.summary}`.trim() }];
  }
  if (nonce) result._meta = { [UI_NONCE_META_KEY]: nonce };
  return result;
}

/** The ad as it stands, with a message (a refused tap still leaves the card current). */
async function refreshedWith(deps: PressDeps, caller: PressMcpCaller, campaignId: string, message: string): Promise<ToolTextResult> {
  const now = await deps.engine.get({ campaignId });
  if (!now.ok) return toolError(message);
  return cardResult(deps, caller, now.campaign, message);
}

function planIdOf(args: Args): string | null {
  return parseUuid(args?.plan_id);
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

function productResult(deps: PressDeps, card: ProductCard, labelWords: number): ToolTextResult {
  const confirmed = card.status === "confirmed";
  const open = doorUrl(deps.origin, null);
  return toolResult({
    product: {
      id: card.id,
      name: card.name,
      status: confirmed ? "confirmed" : "draft",
      source_url: card.sourceUrl,
      label_words_found: labelWords,
    },
    next: confirmed ? "ready" : "confirm_in_picacho",
    open_url: open,
    summary: confirmed ? PRODUCT_READY : `${PRODUCT_DRAFT_READY} ${open}`,
  });
}

/** import_product: a page into a DRAFT card; a page read before returns its card without another read. */
export async function importProduct(deps: PressDeps, caller: PressMcpCaller, args: Args): Promise<ToolTextResult> {
  const url = typeof args?.url === "string" ? args.url.trim() : "";
  if (!url || url.length > 2048) return toolError(PRODUCT_URL_REQUIRED);
  const brandKitId = args?.brand_kit_id === undefined ? null : parseUuid(args.brand_kit_id);
  if (args?.brand_kit_id !== undefined && !brandKitId) return toolError(PRODUCT_URL_REQUIRED);
  const known = await productByUrl(deps.db, caller.userId, url);
  if (known) return productResult(deps, known, known.labelStrings.length);
  const read = await deps.engine.importProduct({ url, brandKitId });
  if (read.error !== null) return toolError(read.error);
  return productResult(deps, read.card, read.labelCandidates.length);
}

/** get_brand_kit: the brand kits and product cards, compact, with ids. */
export async function getBrandKit(deps: PressDeps, caller: PressMcpCaller): Promise<ToolTextResult> {
  const [kits, products] = await Promise.all([
    deps.db
      .from("brand_kits")
      .select(BRAND_KIT_COLUMNS)
      .eq("user_id", caller.userId)
      .is("deleted_at", null)
      .in("status", ["draft", "confirmed"])
      .order("updated_at", { ascending: false })
      .limit(12),
    deps.db
      .from("products")
      .select(PRODUCT_CARD_COLUMNS)
      .eq("user_id", caller.userId)
      .is("deleted_at", null)
      .in("status", ["draft", "confirmed"])
      .order("updated_at", { ascending: false })
      .limit(24),
  ]);
  const brandKits = (Array.isArray(kits.data) ? kits.data : []).map(brandKitFromRow).flatMap((k) =>
    k ? [{ id: k.id, name: k.name, status: k.status, palette: k.palette, tone: k.tone, tagline: k.tagline, default_cta: k.defaultCta }] : [],
  );
  const cards = (Array.isArray(products.data) ? products.data : []).map(productCardFromRow).flatMap((p) =>
    p ? [{ id: p.id, name: p.name, status: p.status, source_url: p.sourceUrl }] : [],
  );
  return toolResult({ brand_kits: brandKits, products: cards });
}

/** draft_ad_plan: plans the ad (free) and shows the card with its quote. */
export async function draftAdPlan(deps: PressDeps, caller: PressMcpCaller, args: Args): Promise<ToolTextResult> {
  const characterId = parseUuid(args?.character_id);
  if (!characterId) return toolError(CHARACTER_REQUIRED);
  const length = args?.length_seconds === undefined ? 15 : args.length_seconds;
  if (length !== 10 && length !== 15 && length !== 30) return toolError(LENGTH_INVALID);
  const goal = typeof args?.goal === "string" && args.goal.trim() ? args.goal.trim().slice(0, 500) : undefined;
  const brandKitId = args?.brand_kit_id === undefined ? null : parseUuid(args.brand_kit_id);
  if (args?.brand_kit_id !== undefined && !brandKitId) return toolError(PRODUCT_REQUIRED);

  let product: ProductCard | null = null;
  if (args?.product_id !== undefined) {
    const id = parseUuid(args.product_id);
    if (!id) return toolError(PRODUCT_REQUIRED);
    product = await productById(deps.db, caller.userId, id);
    if (!product) return toolError(PRODUCT_REQUIRED);
  } else if (typeof args?.product_url === "string" && args.product_url.trim()) {
    product = await productByUrl(deps.db, caller.userId, args.product_url);
    if (!product) return toolError(PRODUCT_NOT_FOUND_BY_URL);
  } else {
    return toolError(PRODUCT_REQUIRED);
  }

  if (product.status !== "confirmed") {
    const star = await starOf(deps.db, caller.userId, characterId);
    const card = setUpProductCard({ origin: deps.origin, productName: product.name || null, starName: star.name, posterFallback: star.photo });
    return toolResult(card as unknown as Record<string, unknown>);
  }

  const key =
    typeof args?.idempotency_key === "string" && args.idempotency_key.trim() && args.idempotency_key.length <= 255
      ? `key:${args.idempotency_key.trim()}`
      : `choices:${product.id}:${characterId}:${length}:${goal ?? ""}:${brandKitId ?? ""}:${nowOf(deps).toISOString().slice(0, 10)}`;
  const sendId = derivedUuid(`mcp-plan:${caller.userId}:${key}`);
  const planned = await deps.engine.plan({
    sendId,
    productId: product.id,
    characterId,
    brandKitId,
    lengthSeconds: length,
    goal,
  });
  if (!planned.ok) {
    if (planned.error === PRODUCT_NOT_CONFIRMED) {
      const star = await starOf(deps.db, caller.userId, characterId);
      return toolResult(setUpProductCard({ origin: deps.origin, productName: product.name || null, starName: star.name, posterFallback: star.photo }) as unknown as Record<string, unknown>);
    }
    return toolError(planned.error);
  }
  if (caller.grantId) {
    // Which connection started it (press_campaigns.mcp_grant_id). Best effort.
    try {
      await deps.db
        .from("press_campaigns")
        .update({ mcp_grant_id: caller.grantId })
        .eq("id", planned.campaign.id)
        .eq("user_id", caller.userId)
        .is("mcp_grant_id", null);
    } catch {
      /* a missing tag never fails the plan */
    }
  }
  return cardResult(deps, caller, planned.campaign);
}

/** get_ad_job and poll_ad_job: the ad as it stands. */
export async function getAdJob(deps: PressDeps, caller: PressMcpCaller, args: Args): Promise<ToolTextResult> {
  const campaignId = planIdOf(args);
  if (!campaignId) return toolError(PLAN_ID_REQUIRED);
  const got = await deps.engine.get({ campaignId });
  if (!got.ok) return toolError(got.error);
  return cardResult(deps, caller, got.campaign);
}

/** The card's code, used; or the refusal to hand back with a refreshed card. */
async function spendCode(
  deps: PressDeps,
  caller: PressMcpCaller,
  campaignId: string,
  value: unknown,
  purpose: NoncePurpose | readonly NoncePurpose[],
): Promise<
  { ok: true; hash: string; purpose: NoncePurpose; quote: { total: number; paint: number; animate: number; version: number } } | { ok: false; result: ToolTextResult }
> {
  if (typeof value !== "string" || !value) return { ok: false, result: toolError(NONCE_REQUIRED) };
  const used = await redeemNonce(deps.db, { value, userId: caller.userId, campaignId, purpose }, { now: deps.now });
  if (used.ok) return used;
  if (used.reason === "missing") return { ok: false, result: toolError(NONCE_REQUIRED) };
  if (used.reason === "unavailable") return { ok: false, result: toolError(PRESS_MCP_FAILED) };
  if (used.reason === "wrong") return { ok: false, result: toolError(NONCE_WRONG) };
  return { ok: false, result: await refreshedWith(deps, caller, campaignId, used.reason === "used" ? NONCE_USED : NONCE_EXPIRED) };
}

/** start_ad (the card only): paints the stills, with the card's code. */
export async function startAd(deps: PressDeps, caller: PressMcpCaller, args: Args): Promise<ToolTextResult> {
  const campaignId = planIdOf(args);
  if (!campaignId) return toolError(PLAN_ID_REQUIRED);
  const code = await spendCode(deps, caller, campaignId, args?.ui_nonce, "paint");
  if (!code.ok) return code.result;
  const current = await deps.engine.get({ campaignId });
  if (!current.ok) return toolError(current.error);
  // The price the card showed must be the price now (N3).
  if (current.campaign.quote && !sameQuote(code.quote, current.campaign.quote)) {
    return cardResult(deps, caller, current.campaign, priceChanged(current.campaign.quote.paint));
  }
  const painted = await deps.engine.paint({ sendId: derivedUuid(`mcp-paint:${code.hash}`), campaignId });
  if (!painted.ok) return refreshedWith(deps, caller, campaignId, painted.error);
  return cardResult(deps, caller, painted.campaign);
}

type Decision = { shot: number; choice: "approve" | "keep" };

function parseDecisions(raw: unknown): Decision[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 12) return null;
  const out: Decision[] = [];
  for (const d of raw) {
    const r = d as { shot?: unknown; choice?: unknown } | null;
    if (!r || typeof r.shot !== "number" || !Number.isInteger(r.shot) || r.shot < 1 || r.shot > 12) return null;
    if (r.choice !== "approve" && r.choice !== "keep") return null;
    if (out.some((o) => o.shot === r.shot)) return null;
    out.push({ shot: r.shot, choice: r.choice });
  }
  return out;
}

/**
 * approve_stills (the card only): the person's choice on each still (free),
 * then — only when the card the person tapped showed the Film key and its
 * price (a `film` code), filming is open here, and every still is decided —
 * the film step, with the card's code (it spends the film line). A card
 * drawn while filming was closed records the choices and hands back a fresh
 * card, never a charge the person was never shown (MONEY-4).
 */
export async function approveStills(deps: PressDeps, caller: PressMcpCaller, args: Args): Promise<ToolTextResult> {
  const campaignId = planIdOf(args);
  if (!campaignId) return toolError(PLAN_ID_REQUIRED);
  const decisions = parseDecisions(args?.decisions);
  if (!decisions) return toolError(DECISIONS_INVALID);
  const code = await spendCode(deps, caller, campaignId, args?.ui_nonce, ["approve", "film"]);
  if (!code.ok) return code.result;

  let latest: CampaignView | null = null;
  for (const d of decisions) {
    const r = d.choice === "approve" ? await deps.engine.approve({ campaignId, shot: d.shot }) : await deps.engine.keep({ campaignId, shot: d.shot });
    if (!r.ok) return refreshedWith(deps, caller, campaignId, r.error);
    latest = r.campaign;
  }
  if (!latest) {
    const got = await deps.engine.get({ campaignId });
    if (!got.ok) return toolError(got.error);
    latest = got.campaign;
  }
  const allDecided = latest.stage === "awaiting_approval" && latest.stills.length > 0 && latest.stills.every((s) => s.decision !== "pending");
  // Only a tap on a card that showed the Film key and its price may film.
  if (code.purpose !== "film" || !deps.engine.film || !allDecided || (latest.shots ?? []).length > 0) return cardResult(deps, caller, latest);
  if (latest.quote && !sameQuote(code.quote, latest.quote)) {
    return cardResult(deps, caller, latest, priceChanged(latest.quote.animate));
  }
  // The card's language names the tag's (campaign-service.ts filmShots, as the door's Film press does); anything else is English.
  const locale = typeof args?.locale === "string" && Object.prototype.hasOwnProperty.call(AI_TAG_TEXT, args.locale) ? args.locale : undefined;
  const filmed = await deps.engine.film({ sendId: derivedUuid(`mcp-film:${code.hash}`), campaignId, ...(locale ? { locale } : {}) });
  if (!filmed.ok) return refreshedWith(deps, caller, campaignId, filmed.error);
  return cardResult(deps, caller, filmed.campaign);
}

const NETWORKS = ["x", "tiktok", "instagram", "threads"] as const;

/** draft_post: saves where the ad goes and hands back the press line's link. Posts nothing. */
export async function draftPost(deps: PressDeps, caller: PressMcpCaller, args: Args): Promise<ToolTextResult> {
  const campaignId = planIdOf(args);
  if (!campaignId) return toolError(PLAN_ID_REQUIRED);
  const raw = args?.networks;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > NETWORKS.length) return toolError(NETWORKS_INVALID);
  if (!raw.every((n) => typeof n === "string" && (NETWORKS as readonly string[]).includes(n))) return toolError(NETWORKS_INVALID);
  const networks = NETWORKS.filter((n) => raw.includes(n));
  const got = await deps.engine.get({ campaignId });
  if (!got.ok) return toolError(got.error);
  const stage = got.campaign.stage;
  if (stage === "failed" || stage === "cancelled" || stage === "expired") return toolError(CAMPAIGN_CLOSED);
  try {
    const { error } = await deps.db
      .from("press_campaigns")
      .update({ platforms: networks })
      .eq("id", campaignId)
      .eq("user_id", caller.userId)
      .is("deleted_at", null);
    if (error) return toolError(PRESS_MCP_FAILED);
  } catch {
    return toolError(PRESS_MCP_FAILED);
  }
  const ready = stage === "ready";
  return toolResult({
    plan_id: campaignId,
    networks,
    ready,
    press_line_url: pressLineUrl(deps.origin, campaignId),
    summary: ready ? POST_IN_PICACHO : `${POST_IN_PICACHO} ${POST_NOT_READY}`,
  });
}

/** One Press Tour tool, by name. */
export async function runPressTool(name: string, args: Args, deps: PressDeps, caller: PressMcpCaller): Promise<ToolTextResult> {
  switch (name) {
    case "import_product":
      return importProduct(deps, caller, args);
    case "get_brand_kit":
      return getBrandKit(deps, caller);
    case "draft_ad_plan":
      return draftAdPlan(deps, caller, args);
    case "get_ad_job":
    case "poll_ad_job":
      return getAdJob(deps, caller, args);
    case "start_ad":
      return startAd(deps, caller, args);
    case "approve_stills":
      return approveStills(deps, caller, args);
    case "draft_post":
      return draftPost(deps, caller, args);
    default:
      return toolError(`Unknown tool: ${name}`);
  }
}
