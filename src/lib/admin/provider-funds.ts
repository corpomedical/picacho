// Every provider Picacho pays per use, with what is left and where to top up
// (operator, 2026-10-02: "I can only see Fal balance on my admin area. I need
// to see all my providers balance, plus the link to refill.").
//
// Only three providers let a server read the balance: fal (account/billing,
// Admin-scope key), ElevenLabs (user/subscription, a key with User → Read) and
// HeyGen (v3 users/me). OpenAI, Anthropic and Google publish no balance
// endpoint an API key may call (OpenAI's dashboard/billing routes take a
// browser session only), BytePlus's QueryBalanceAcct needs the AK/SK pair
// signed for its billing service, and Modal bills a card monthly. Those rows
// carry the refill link alone, never a guessed number.
//
// Best-effort throughout: a provider that is down or refuses the key becomes a
// row that says why, never an error that takes the admin page with it.

import { getFalBalance, type FalBalance } from "../generations/providers/fal-ledger";
import { fetchWithTimeout } from "../generations/providers/fetch-with-timeout";

export type FundsReading =
  /** A live number: `amount` in `unit` ("USD" or "credits"), and `of` when there is a ceiling. */
  | { kind: "live"; amount: number; unit: "USD" | "credits"; of?: number; note?: string; low: boolean }
  /** The provider can be read, and this read failed: why, in words. */
  | { kind: "error"; reason: string }
  /** The provider publishes no balance a server can read. */
  | { kind: "link-only" }
  /** Not set up on this server (its key is missing). */
  | { kind: "not-connected" };

export type ProviderFunds = {
  id: string;
  name: string;
  /** What Picacho uses it for, in one line. */
  usedFor: string;
  /** Where the operator adds money or checks the balance. */
  refillUrl: string;
  reading: FundsReading;
};

const TIMEOUT_MS = 8_000;

const has = (v: string | undefined) => Boolean(v?.trim());

/** ElevenLabs' user/subscription body → credits left of the month's allowance. */
export function readElevenLabs(body: unknown, now: Date): FundsReading {
  const b = body as { character_count?: unknown; character_limit?: unknown; next_character_count_reset_unix?: unknown };
  if (typeof b?.character_count !== "number" || typeof b?.character_limit !== "number") {
    return { kind: "error", reason: "No credit count in ElevenLabs' answer." };
  }
  const left = Math.max(0, b.character_limit - b.character_count);
  const reset = typeof b.next_character_count_reset_unix === "number" ? new Date(b.next_character_count_reset_unix * 1000) : null;
  const note =
    reset && reset.getTime() > now.getTime()
      ? `resets ${reset.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`
      : undefined;
  return { kind: "live", amount: left, unit: "credits", of: b.character_limit, note, low: left < b.character_limit * 0.1 };
}

/**
 * HeyGen's v3 users/me body. The API wallet (USD) is what API renders draw
 * on; an account without one falls back to its plan's premium credits.
 */
export function readHeygen(body: unknown): FundsReading {
  const d = (body as { data?: Record<string, unknown> })?.data as
    | {
        wallet?: { remaining_balance?: unknown; currency?: unknown };
        subscription?: { credits?: { premium_credits?: { remaining?: unknown }; add_on_credits?: { remaining?: unknown } } };
      }
    | undefined;
  const wallet = d?.wallet?.remaining_balance;
  if (typeof wallet === "number") {
    return { kind: "live", amount: wallet, unit: "USD", note: "API wallet", low: false };
  }
  const premium = d?.subscription?.credits?.premium_credits?.remaining;
  const addOn = d?.subscription?.credits?.add_on_credits?.remaining;
  if (typeof premium === "number" || typeof addOn === "number") {
    return {
      kind: "live",
      amount: (typeof premium === "number" ? premium : 0) + (typeof addOn === "number" ? addOn : 0),
      unit: "credits",
      note: "plan + add-on credits",
      low: false,
    };
  }
  return { kind: "error", reason: "No balance in HeyGen's answer." };
}

async function elevenLabs(now: Date): Promise<FundsReading> {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) return { kind: "not-connected" };
  try {
    const res = await fetchWithTimeout(
      "https://api.elevenlabs.io/v1/user/subscription",
      { headers: { "xi-api-key": key }, cache: "no-store" },
      TIMEOUT_MS,
    );
    const body = (await res.json().catch(() => null)) as { detail?: { status?: string } } | null;
    if (!res.ok) {
      // Verified 2026-10-02: the live key answers 401 missing_permissions —
      // it was made without User → Read. The fix is a tick on the key.
      return body?.detail?.status === "missing_permissions"
        ? { kind: "error", reason: "The ElevenLabs key needs the User → Read permission to show this." }
        : { kind: "error", reason: `ElevenLabs returned ${res.status}.` };
    }
    return readElevenLabs(body, now);
  } catch (err) {
    return { kind: "error", reason: err instanceof Error ? err.message : "ElevenLabs unreachable." };
  }
}

async function heygen(): Promise<FundsReading> {
  const key = process.env.HEYGEN_API_KEY?.trim();
  if (!key) return { kind: "not-connected" };
  try {
    const res = await fetchWithTimeout(
      "https://api.heygen.com/v3/users/me",
      { headers: { "x-api-key": key }, cache: "no-store" },
      TIMEOUT_MS,
    );
    if (!res.ok) return { kind: "error", reason: `HeyGen returned ${res.status}.` };
    return readHeygen(await res.json().catch(() => null));
  } catch (err) {
    return { kind: "error", reason: err instanceof Error ? err.message : "HeyGen unreachable." };
  }
}

async function fal(worstRenderUsd: number, known?: FalBalance): Promise<FundsReading> {
  if (!has(process.env.FAL_KEY) && !has(process.env.FAL_ADMIN_KEY)) return { kind: "not-connected" };
  const b = known ?? (await getFalBalance());
  if (!b.ok) return { kind: "error", reason: b.error };
  return { kind: "live", amount: b.balanceUsd, unit: "USD", low: b.balanceUsd < worstRenderUsd * 10 };
}

/**
 * Every paid provider, in the order they cost money. `worstRenderUsd` is the
 * priciest single render (maxSingleRenderCostUsd), passed in so fal's "low"
 * matches the line the fal panel and the hourly alert already use: under ten
 * of those. A page that has already read fal's balance passes it as `fal`
 * so the account is not asked twice.
 */
export async function loadProviderFunds(
  worstRenderUsd: number,
  opts: { now?: Date; fal?: FalBalance } = {},
): Promise<ProviderFunds[]> {
  const now = opts.now ?? new Date();
  const [falReading, elevenReading, heygenReading] = await Promise.all([
    fal(worstRenderUsd, opts.fal),
    elevenLabs(now),
    heygen(),
  ]);
  const linkOr = (present: boolean): FundsReading => (present ? { kind: "link-only" } : { kind: "not-connected" });
  const env = process.env;
  return [
    {
      id: "fal",
      name: "fal.ai",
      usedFor: "Video, pictures, voices and lip sync",
      refillUrl: "https://fal.ai/dashboard/usage-billing/billing",
      reading: falReading,
    },
    {
      id: "openai",
      name: "OpenAI",
      usedFor: "GPT-6 Luna chat, GPT pictures, Whisper and spoken replies",
      refillUrl: "https://platform.openai.com/settings/organization/billing/overview",
      reading: linkOr(has(env.OPENAI_API_KEY)),
    },
    {
      id: "anthropic",
      name: "Anthropic",
      usedFor: "Claude chat, Aly, prompt drafts and Director's Cut",
      refillUrl: "https://platform.claude.com/settings/billing",
      reading: linkOr(has(env.ANTHROPIC_API_KEY) || has(env.DIRECTORS_CUT_ANTHROPIC_API_KEY)),
    },
    {
      id: "elevenlabs",
      name: "ElevenLabs",
      usedFor: "Aly's voice and character voices",
      refillUrl: "https://elevenlabs.io/app/subscription",
      reading: elevenReading,
    },
    {
      id: "byteplus",
      name: "BytePlus",
      usedFor: "Seedance direct and real-person checks",
      refillUrl: "https://console.byteplus.com/finance/overview",
      reading: linkOr(has(env.BYTEPLUS_ARK_API_KEY) || has(env.BYTEPLUS_ACCESS_KEY_ID)),
    },
    {
      id: "google",
      name: "Google Cloud",
      usedFor: "Gemini chat and product checks (Gemini + Cloud Vision)",
      refillUrl: "https://console.cloud.google.com/billing",
      reading: linkOr(has(env.GEMINI_API_KEY) || has(env.GOOGLE_VISION_API_KEY)),
    },
    {
      id: "heygen",
      name: "HeyGen",
      usedFor: "Edit Bay exports (HyperFrames renders)",
      refillUrl: "https://app.heygen.com/settings/api",
      reading: heygenReading,
    },
    {
      id: "modal",
      name: "Modal",
      usedFor: "Helios Studio's Cycles renders",
      refillUrl: "https://modal.com/settings/usage",
      reading: linkOr(has(env.MODAL_CYCLES_URL) && has(env.MODAL_KEY) && has(env.MODAL_SECRET)),
    },
  ];
}
