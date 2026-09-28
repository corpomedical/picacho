import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import type { CampaignResult, CampaignStage } from "../press-tour/campaign-types";
import type { PreparedSend } from "./tools";

// Press Tour from the Producer (2026-09-28; the operator's "All three." of
// 2026-09-25: the door, the Producer and a mode in Generate). Alias-free, so
// it is unit-tested with a fake engine; press-runtime.ts binds the real one.
//
// NEVER SPENDS, like every other tool here. plan_press_ad plans through the
// door's own engine (campaign-service.ts planCampaign: the same quote, gates,
// allowance and idempotency). Planning is free. The person gets a card with
// the stills' price that opens the ad on the Press Tour page, where they
// press Paint themselves.

export type PressToolDeps = {
  /** The service role: every read names its owner. */
  db: SupabaseClient;
  /** Why Press Tour is closed to this person (its own sentence), or null when open. */
  closed: string | null;
  /** The engine's plan, bound to this person (source "producer"); null when closed. */
  plan: ((input: { sendId: string; productId: string; characterId: string; lengthSeconds: 10 | 15 | 30; goal?: string }) => Promise<CampaignResult>) | null;
  now?: () => Date;
};

export type PressToolAnswer = { text: string; card?: PreparedSend; isError?: boolean };

type Named = { id: string; name: string };

/** A version-8 UUID from a rule (the MCP's shape): the same choices on the same day meet the same ad. */
export function producerPlanSendId(userId: string, choices: string): string {
  const bytes = createHash("sha256").update(`producer-plan:${userId}:${choices}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The name as the person says it: exact (any case) first, then the one name that contains it. */
export function pickByName<T extends Named>(rows: readonly T[], said: string | null): T | null {
  if (rows.length === 0) return null;
  const want = (said ?? "").trim().toLowerCase();
  if (!want) return rows[0];
  const exact = rows.find((r) => r.name.trim().toLowerCase() === want);
  if (exact) return exact;
  const partial = rows.filter((r) => r.name.toLowerCase().includes(want));
  return partial.length === 1 ? partial[0] : null;
}

async function characters(db: SupabaseClient, userId: string): Promise<Named[]> {
  const { data } = await db.from("character_profiles").select("id, name").eq("user_id", userId).order("created_at", { ascending: false }).limit(60);
  return ((data ?? []) as { id?: unknown; name?: unknown }[])
    .filter((r) => typeof r.id === "string")
    .map((r) => ({ id: r.id as string, name: typeof r.name === "string" && r.name ? r.name : "Untitled" }));
}

/** Confirmed, not refused, with photos still held: the products an ad can be planned on (door-view.ts planBlock). */
async function readyProducts(db: SupabaseClient, userId: string): Promise<Named[]> {
  const { data } = await db
    .from("products")
    .select("id, name, status, category, image_paths")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(24);
  return ((data ?? []) as { id?: unknown; name?: unknown; status?: unknown; category?: unknown; image_paths?: unknown }[])
    .filter((r) => typeof r.id === "string" && r.status === "confirmed" && r.category !== "regulated" && Array.isArray(r.image_paths) && r.image_paths.length > 0)
    .map((r) => ({ id: r.id as string, name: typeof r.name === "string" && r.name ? r.name : "Untitled product" }));
}

const list = (rows: readonly Named[]) => rows.map((r) => r.name).join(", ");

export async function planPressAd(deps: PressToolDeps, userId: string, input: Record<string, unknown>): Promise<PressToolAnswer> {
  if (deps.closed !== null || !deps.plan) {
    return { text: `Press Tour isn't open to this person yet (${deps.closed ?? "closed"}). Say so plainly; don't plan it another way.`, isError: true };
  }
  const length = input.length_seconds === 10 || input.length_seconds === 30 ? input.length_seconds : 15;
  const goal = typeof input.goal === "string" && input.goal.trim() ? input.goal.trim().slice(0, 500) : undefined;
  const [cast, products] = await Promise.all([characters(deps.db, userId), readyProducts(deps.db, userId)]);
  if (cast.length === 0) return { text: "They have no characters yet. An ad stars one of their characters: they create one first.", isError: true };
  if (products.length === 0) {
    return {
      text: "They have no product ready for an ad. On the Press Tour page they add the product (a link or 3-5 photos), check its card and save it; then an ad can be planned.",
      isError: true,
    };
  }
  const star = pickByName(cast, typeof input.character === "string" ? input.character : null);
  if (!star) return { text: `No single character matches that name. Their characters: ${list(cast)}.`, isError: true };
  const product = pickByName(products, typeof input.product === "string" ? input.product : null);
  if (!product) return { text: `No single ready product matches that name. Their ready products: ${list(products)}.`, isError: true };

  const day = (deps.now ? deps.now() : new Date()).toISOString().slice(0, 10);
  const sendId = producerPlanSendId(userId, `${product.id}:${star.id}:${length}:${goal ?? ""}:${day}`);
  const planned = await deps.plan({ sendId, productId: product.id, characterId: star.id, lengthSeconds: length, goal });
  if (!planned.ok) return { text: `The ad couldn't be planned: ${planned.error}`, isError: true };
  const ad = planned.campaign;
  const paint = ad.quote?.paint ?? 0;
  const shots = ad.stills.length;
  const card: PreparedSend = {
    id: ad.id,
    label: `${star.name} in ${product.name}`,
    kind: "ad",
    characterId: star.id,
    characterName: star.name,
    prompt: ad.angle ?? "",
    modelId: null,
    modelName: null,
    seconds: ad.lengthSeconds,
    credits: paint,
    href: `/app/press-tour?campaign=${encodeURIComponent(ad.id)}`,
  };
  return {
    text:
      `Planned a ${ad.lengthSeconds} s Press Tour ad: ${star.name} with ${product.name}, ${shots} shots` +
      (ad.angle ? `, angle "${ad.angle}"` : "") +
      `. Nothing is painted or charged. Painting the ${shots} stills costs ${paint} credits; the person sees that on the card and presses Paint on the Press Tour page themselves. Filming is priced there after they approve the stills.`,
    card,
  };
}

const STAGE_WORDS: Readonly<Record<CampaignStage, string>> = {
  draft: "being planned",
  planned: "planned, stills not painted yet",
  painting: "painting its stills",
  checking_keyframes: "checking its stills",
  awaiting_approval: "waiting on them to decide on the stills",
  animating: "filming",
  checking_shots: "checking its shots",
  assembling: "being cut",
  signing: "being finished",
  ready: "ready to post",
  failed: "stopped",
  cancelled: "closed by them",
  expired: "closed after waiting 7 days",
};

export async function readPressAds(deps: PressToolDeps, userId: string, input: Record<string, unknown>): Promise<PressToolAnswer> {
  if (deps.closed !== null) return { text: `Press Tour isn't open to this person yet (${deps.closed}).`, isError: true };
  const n = typeof input.limit === "number" && Number.isFinite(input.limit) ? Math.min(10, Math.max(1, Math.round(input.limit))) : 5;
  const { data, error } = await deps.db
    .from("press_campaigns")
    .select("id, stage, product_id, length_seconds, error, updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(n);
  if (error) return { text: "Their ads couldn't be read just now.", isError: true };
  const rows = (data ?? []) as { id: string; stage: CampaignStage; product_id: string | null; length_seconds: number | null; error: string | null; updated_at: string }[];
  if (rows.length === 0) return { text: "They have no Press Tour ads yet." };
  const ids = [...new Set(rows.map((r) => r.product_id).filter((x): x is string => typeof x === "string"))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: prods } = await deps.db.from("products").select("id, name").eq("user_id", userId).in("id", ids);
    for (const p of (prods ?? []) as { id: string; name: string | null }[]) names.set(p.id, p.name || "Untitled product");
  }
  const lines = rows.map((r) => {
    const what = `${names.get(r.product_id ?? "") ?? "a product"}, ${r.length_seconds ?? "?"} s`;
    const where = STAGE_WORDS[r.stage] ?? r.stage;
    const why = r.stage === "failed" && r.error ? ` Why: ${r.error}` : "";
    return `- ${r.updated_at.slice(0, 10)} · ${what} · ${where}.${why} Open: /app/press-tour?campaign=${r.id}`;
  });
  return { text: lines.join("\n") };
}
