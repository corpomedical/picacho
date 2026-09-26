import { createHash, randomBytes } from "node:crypto";

// Connecting an account (spec §2.4 oauth_states; v2 #29's binding rule):
//   - the state is 32 random bytes; only its sha256 is stored, with the
//     person who pressed Connect, the network, the PKCE verifier (X) and a
//     checked return path; it lives 10 minutes and is used once;
//   - the callback accepts it only from the SAME signed-in person, so a
//     link someone else started can never attach their account to yours
//     (or yours to theirs);
//   - the redirect address is exact: NEXT_PUBLIC_SITE_URL +
//     /api/social/<network>/callback, registered as-is at each network.
//
// Alias-free (vitest has no '@/').

import { isNetwork, type Network } from "../press-tour/publish-types";
import type { Credentials, OAuthAdapter } from "./adapter";

export const STATE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_RETURN = "/app/press-tour";

const b64url = (buf: Buffer): string => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

/** A fresh state (sent to the network) and its hash (stored). */
export function newState(random: (n: number) => Buffer = randomBytes): { state: string; hash: string } {
  const state = b64url(random(32));
  return { state, hash: stateHash(state) };
}

export function stateHash(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

/** PKCE (RFC 7636, S256): a 64-character verifier and its challenge. */
export function newPkce(random: (n: number) => Buffer = randomBytes): { verifier: string; challenge: string } {
  const verifier = b64url(random(48));
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier, "ascii").digest());
}

/** A path inside the app to come back to, or the door. Never another site, never "//". */
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_RETURN;
  const s = raw.trim();
  if (s.length === 0 || s.length > 200) return DEFAULT_RETURN;
  if (!s.startsWith("/app") || s.includes("//") || s.includes("\\") || /[\u0000-\u001f\s]/.test(s)) return DEFAULT_RETURN;
  if (!/^\/app(?:[/?#]|$)/.test(s)) return DEFAULT_RETURN;
  return s;
}

/** The site's origin from NEXT_PUBLIC_SITE_URL (https, no path), or null when it is missing or unusable. */
export function siteOrigin(env: Record<string, string | undefined>): string | null {
  const raw = env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) return null;
    if (u.hostname.endsWith(".vercel.app")) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The exact redirect address registered at the network. */
export function redirectUri(origin: string, network: Network): string {
  return `${origin}/api/social/${network}/callback`;
}

/** The app's credentials at a network, or null when either variable is missing. */
export function credentialsFor(adapter: Pick<OAuthAdapter, "envKeys">, env: Record<string, string | undefined>): Credentials | null {
  const clientId = env[adapter.envKeys.id]?.trim();
  const clientSecret = env[adapter.envKeys.secret]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** The stored state, as the callback checks it. */
export type StoredState = {
  userId: string;
  network: string;
  pkceVerifier: string | null;
  returnTo: string;
  expiresAt: string;
  usedAt: string | null;
};

/**
 * Pure: may this callback use this state? The state must exist, be unused
 * (the store takes it atomically, so a second use finds used_at set), be
 * unexpired, be for this network, and belong to the person signed in now.
 */
export function checkState(
  stored: StoredState | null,
  input: { network: Network; sessionUserId: string | null; now: Date },
): { ok: true } | { ok: false; code: "expired" | "session" } {
  if (!stored || !isNetwork(stored.network) || stored.network !== input.network) return { ok: false, code: "expired" };
  const exp = Date.parse(stored.expiresAt);
  if (!Number.isFinite(exp) || exp <= input.now.getTime()) return { ok: false, code: "expired" };
  if (!input.sessionUserId || input.sessionUserId.toLowerCase() !== stored.userId.toLowerCase()) return { ok: false, code: "session" };
  return { ok: true };
}
