// The one-time code behind every paid key on Picacho's card (synthesis v2
// #5): the only way start_ad and approve_stills run.
//
// WHY. A model can call any tool a host shows it. Those two tools are marked
// app-only (visibility ["app"]), so a host that follows MCP Apps never shows
// them to the model — but "never" is the host's promise, not ours. The code
// is ours: it is minted only into a tool result's _meta, which hosts hand to
// the card and never to the model (MCP Apps; OpenAI's reference: "_meta …
// hidden from the model"), and a paid tool refuses to run without it. So a
// spend needs the card, and the card needs a person's tap.
//
// WHAT IT BINDS: the account, the ad, the step, and the quote the card is
// showing (total, paint, film, version). A price that moved since the card
// was drawn is not the price the person tapped. The step is `paint`, or for
// the Approve key `approve` (the card showed no Film key: the tap records
// the choices and films nothing) or `film` (the card showed the Film key
// and its price: the only code that may film). A card drawn while filming
// was closed can never film, even if filming opens before it is tapped
// (fixer 2026-09-26, MONEY-4).
//
// SINGLE USE, IN ONE STATEMENT. Using a code is a conditional UPDATE
// (`where used_at is null and expires_at > now`); the rows it returns say
// whether THIS call used it. A second tap gets "already used" and the card
// shows the ad as it is. (The step's own ids are made from the code too, so
// even a race between two deliveries cannot charge twice.)
//
// Stored as SHA-256 hashes, 15 minutes each, in mcp_ui_nonces (RLS on,
// zero policies). Alias-free.

import type { SupabaseClient } from "@supabase/supabase-js";
import { UI_NONCE_TTL_S } from "../oauth/config";
import { hashSecret, newUiNonce } from "../oauth/tokens";
import type { PressQuote } from "../../press-tour/campaign-types";

export const NONCE_TABLE = "mcp_ui_nonces";
export type NoncePurpose = "paint" | "approve" | "film";

export type NonceQuote = Pick<PressQuote, "total" | "paint" | "animate" | "version">;

/** What the card receives in _meta. */
export type CardNonce = { value: string; purpose: NoncePurpose; expires_at: string };

export type NonceDeps = { now?: () => Date; newNonce?: () => string };
const nowOf = (deps?: NonceDeps) => (deps?.now ? deps.now() : new Date());

/** Mints a code for one step of one ad. Null when it could not be stored (the card then shows no paid key). */
export async function mintNonce(
  db: SupabaseClient,
  input: { userId: string; campaignId: string; purpose: NoncePurpose; quote: NonceQuote; grantId: string | null },
  deps?: NonceDeps,
): Promise<CardNonce | null> {
  const value = deps?.newNonce ? deps.newNonce() : newUiNonce();
  const now = nowOf(deps);
  const expiresAt = new Date(now.getTime() + UI_NONCE_TTL_S * 1000).toISOString();
  try {
    // Housekeeping first, the person's own expired codes only (cheap, indexed).
    await db.from(NONCE_TABLE).delete().eq("user_id", input.userId).lt("expires_at", now.toISOString());
    const { error } = await db.from(NONCE_TABLE).insert({
      nonce_hash: hashSecret(value),
      user_id: input.userId,
      campaign_id: input.campaignId,
      purpose: input.purpose,
      quote_total: input.quote.total,
      quote_paint: input.quote.paint,
      quote_animate: input.quote.animate,
      quote_version: input.quote.version,
      grant_id: input.grantId,
      created_at: now.toISOString(),
      expires_at: expiresAt,
    });
    if (error) return null;
  } catch {
    return null;
  }
  return { value, purpose: input.purpose, expires_at: expiresAt };
}

export type NonceUse =
  | { ok: true; hash: string; purpose: NoncePurpose; quote: NonceQuote }
  | { ok: false; reason: "missing" | "used" | "expired" | "wrong" | "unavailable" };

const isPurpose = (v: unknown): v is NoncePurpose => v === "paint" || v === "approve" || v === "film";

/**
 * Uses a code, once. It must be this account's, for this ad and one of
 * these steps, unexpired and unused; the answer says which step it was
 * minted for. `wrong` covers another account's code, another ad's and
 * another step's alike (one answer, nothing learned).
 */
export async function redeemNonce(
  db: SupabaseClient,
  input: { value: unknown; userId: string; campaignId: string; purpose: NoncePurpose | readonly NoncePurpose[] },
  deps?: NonceDeps,
): Promise<NonceUse> {
  if (typeof input.value !== "string" || input.value.length < 20 || input.value.length > 200) return { ok: false, reason: "missing" };
  const purposes: NoncePurpose[] = Array.isArray(input.purpose) ? [...input.purpose] : [input.purpose as NoncePurpose];
  const hash = hashSecret(input.value);
  const now = nowOf(deps).toISOString();
  try {
    const { data, error } = await db
      .from(NONCE_TABLE)
      .update({ used_at: now })
      .eq("nonce_hash", hash)
      .eq("user_id", input.userId)
      .eq("campaign_id", input.campaignId)
      .in("purpose", purposes)
      .is("used_at", null)
      .gt("expires_at", now)
      .select("purpose, quote_total, quote_paint, quote_animate, quote_version");
    if (error) return { ok: false, reason: "unavailable" };
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    if (row && isPurpose(row.purpose)) {
      return {
        ok: true,
        hash,
        purpose: row.purpose,
        quote: {
          total: Number(row.quote_total),
          paint: Number(row.quote_paint),
          animate: Number(row.quote_animate),
          version: Number(row.quote_version),
        },
      };
    }
    // Why not: read once, for the one answer that helps the card.
    const { data: seen } = await db
      .from(NONCE_TABLE)
      .select("user_id, campaign_id, purpose, used_at, expires_at")
      .eq("nonce_hash", hash)
      .maybeSingle();
    const s = seen as Record<string, unknown> | null;
    if (!s || s.user_id !== input.userId || s.campaign_id !== input.campaignId || !purposes.includes(s.purpose as NoncePurpose)) {
      return { ok: false, reason: "wrong" };
    }
    if (s.used_at) return { ok: false, reason: "used" };
    return { ok: false, reason: "expired" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Whether the quote now is the quote the code was minted for. */
export function sameQuote(minted: NonceQuote, now: NonceQuote | null): boolean {
  return !!now && minted.total === now.total && minted.paint === now.paint && minted.animate === now.animate && minted.version === now.version;
}
