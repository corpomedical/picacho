// The secrets the authorization server hands out, and the one proof it
// checks (PKCE S256). Every secret is 32 random bytes behind a prefix that
// makes it recognisable in a log or a paste, and is stored only as its
// SHA-256 hash: SHA-256 rather than a slow hash because these are 256-bit
// random values, not passwords (the api_keys reasoning in lib/api/keys.ts).
//
// Pure and alias-free (node:crypto only).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  ACCESS_TOKEN_PREFIX,
  AUTH_CODE_PREFIX,
  DCR_CLIENT_PREFIX,
  REFRESH_TOKEN_PREFIX,
  UI_NONCE_PREFIX,
} from "./config";

/** A new secret: the prefix and 43 url-safe characters. */
export function newSecret(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

export const newAccessToken = () => newSecret(ACCESS_TOKEN_PREFIX);
export const newRefreshToken = () => newSecret(REFRESH_TOKEN_PREFIX);
export const newAuthCode = () => newSecret(AUTH_CODE_PREFIX);
export const newUiNonce = () => newSecret(UI_NONCE_PREFIX);
/** A dynamically registered client's id: public, so shorter. */
export const newClientId = () => DCR_CLIENT_PREFIX + randomBytes(16).toString("base64url");

/** What the database keeps of a secret. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** A bearer credential's kind, by its prefix. Anything else is left to the API-key path. */
export function bearerKind(token: string): "access" | "refresh" | "code" | "other" {
  if (token.startsWith(ACCESS_TOKEN_PREFIX)) return "access";
  if (token.startsWith(REFRESH_TOKEN_PREFIX)) return "refresh";
  if (token.startsWith(AUTH_CODE_PREFIX)) return "code";
  return "other";
}

/** The token from an Authorization header ("Bearer x", any case), or "" when there is none. */
export function bearerFrom(header: string | null | undefined): string {
  const raw = (header ?? "").trim();
  return raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : raw;
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636), S256 only (OAuth 2.1; the MCP authorization spec)
// ---------------------------------------------------------------------------

/** A code_verifier: 43 to 128 unreserved characters. */
export function isValidVerifier(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
}

/** An S256 code_challenge: base64url of a SHA-256 digest, 43 characters, no padding. */
export function isValidChallenge(c: unknown): c is string {
  return typeof c === "string" && /^[A-Za-z0-9_-]{43}$/.test(c);
}

/** BASE64URL(SHA256(verifier)). */
export function s256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Whether the verifier proves the challenge, in constant time. */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (!isValidVerifier(verifier) || !isValidChallenge(challenge)) return false;
  const a = Buffer.from(s256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
