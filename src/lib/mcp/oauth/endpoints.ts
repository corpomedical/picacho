// The authorization server's endpoints, as plain functions (the route files
// under app/api/oauth and app/.well-known only read the request, find the
// host and the switch, and hand over the real clients). Everything that
// decides anything is here, alias-free, so oauth.test.ts drives the whole
// flow — register, authorize, consent, token, refresh, revoke — against an
// in-memory database.
//
// THE SWITCH. The whole server exists only while press_tour_mcp is on
// (fail-closed: a failed read is off). With it off every endpoint answers
// 404 as if it had never been built, except revocation, which always works:
// turning a feature off must never stop anyone disconnecting from it.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkAuthorizeRequest, errorRedirect } from "./authorize";
import { validateDcrRequest, type DocumentFetcher } from "./clients";
import {
  AUTHORIZE_CALLS_PER_IP_PER_MINUTE,
  CONSENT_PAGE_PATH,
  DCR_PER_IP_PER_HOUR,
  TOKEN_CALLS_PER_IP_PER_MINUTE,
  canonicalResource,
  issuerFor,
  scopeString,
} from "./config";
import type { ConsentErrorCode } from "./messages";
import { consentPath } from "./resume";
import { createPending, decidePending, exchangeCode, refreshTokens, registerClient, resolveClient, revokeToken } from "./store";

export type EndpointDeps = {
  /** The service-role client. */
  db: SupabaseClient;
  /** The origin the request came in on (lib/origin.ts getOrigin). */
  origin: string;
  /** press_tour_mcp, read fail-closed. */
  enabled: boolean;
  /** rate-limit.ts rateLimited (true = over; fails closed). */
  rateLimited: (key: string, scope: string, windowSeconds: number, max: number) => Promise<boolean>;
  /** rate-limit.ts hashedRateKey. */
  hashKey: (value: string | null | undefined, scope: string) => string;
  /** How a client metadata document is read (press-tour/safe-fetch.ts). */
  fetchDocument: DocumentFetcher;
  now?: () => Date;
};

export type JsonAnswer = { status: number; body: Record<string, unknown> | null; headers: Record<string, string> };

/**
 * The address a rate limit counts by (fixer 2026-09-26, SEC-1). An IPv4
 * address as it is; an IPv6 address by its /64, the block one household or
 * one server is handed, so walking through the addresses of one network
 * never walks past the limit; an IPv4-mapped IPv6 address as the IPv4 one.
 * Anything unreadable counts as itself (still limited, never unlimited).
 */
export function rateBucket(ip: string | null | undefined): string | null {
  if (!ip) return null;
  let s = ip.trim().toLowerCase();
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    s = end > 0 ? s.slice(1, end) : s.slice(1);
  }
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":")) return s || null;
  const v4 = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4 && /^(?:0{0,4}:){0,5}(?::|0{0,4}:)?ffff:$|^::ffff:$/.test(v4[1])) return v4[2];
  let body = s;
  if (v4) {
    // An embedded dotted quad is the last two groups.
    const q = v4[2].split(".").map(Number);
    if (q.some((n) => n > 255)) return s;
    body = `${v4[1]}${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
  }
  const halves = body.split("::");
  if (halves.length > 2) return s;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return s;
  const groups = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return s;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

/** OAuth answers are never cached (RFC 6749 §5.1). */
const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };
const json = (status: number, body: Record<string, unknown> | null, headers: Record<string, string> = {}): JsonAnswer => ({
  status,
  body,
  headers: { "content-type": "application/json", ...NO_STORE, ...headers },
});
const NOT_FOUND = () => json(404, { error: "not_found" });

// ---------------------------------------------------------------------------
// Dynamic client registration (RFC 7591)
// ---------------------------------------------------------------------------

export async function handleRegister(input: { body: unknown; ip: string | null }, deps: EndpointDeps): Promise<JsonAnswer> {
  if (!deps.enabled) return NOT_FOUND();
  if (await deps.rateLimited(deps.hashKey(rateBucket(input.ip), "oauth-register"), "oauth-register", 60 * 60, DCR_PER_IP_PER_HOUR)) {
    return json(429, { error: "too_many_requests", error_description: "Too many registrations from this address. Try again later." });
  }
  const checked = validateDcrRequest(input.body);
  if (!checked.ok) return json(400, { error: checked.error, error_description: checked.description });
  const client = await registerClient(deps.db, checked.metadata, { ipHash: input.ip ? deps.hashKey(input.ip, "oauth-register-ip") : null }, { now: deps.now });
  if (!client) return json(503, { error: "temporarily_unavailable", error_description: "Try again in a moment." });
  const issuedAt = Math.floor((deps.now ? deps.now() : new Date()).getTime() / 1000);
  return json(201, {
    client_id: client.clientId,
    client_id_issued_at: issuedAt,
    client_name: client.name,
    redirect_uris: client.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    // What this client may ever be granted: an unverified one reads only.
    scope: scopeString(client.trust === "unverified" ? ["read"] : ["read", "brand", "generate"]),
  });
}

// ---------------------------------------------------------------------------
// Authorization endpoint
// ---------------------------------------------------------------------------

export type RedirectAnswer = { status: 303 | 404 | 429; location: string | null };

/** The consent page with one of its dead-end codes (never text on the URL). */
export function consentErrorPath(code: ConsentErrorCode): string {
  return `${CONSENT_PAGE_PATH}?error=${code}`;
}

/**
 * GET /api/oauth/authorize. A good request is stored as a pending
 * authorization and the browser goes to the consent page with its id; a bad
 * one goes back to the app (once the app and its redirect are known good)
 * or to our own page.
 */
export async function handleAuthorize(input: { params: Record<string, unknown>; ip: string | null }, deps: EndpointDeps): Promise<RedirectAnswer> {
  if (!deps.enabled) return { status: 404, location: null };
  if (await deps.rateLimited(deps.hashKey(rateBucket(input.ip), "oauth-authorize"), "oauth-authorize", 60, AUTHORIZE_CALLS_PER_IP_PER_MINUTE)) {
    return { status: 429, location: null };
  }
  const issuer = issuerFor(deps.origin);
  const client = await resolveClient(deps.db, input.params.client_id, { fetchDocument: deps.fetchDocument, now: deps.now });
  if (client === "unavailable") return { status: 303, location: consentErrorPath("unavailable") };
  const check = checkAuthorizeRequest(input.params, client, deps.origin);
  if (check.kind === "page_error") return { status: 303, location: consentErrorPath(check.code) };
  if (check.kind === "redirect_error") {
    return {
      status: 303,
      location: errorRedirect(check.redirectUri, { error: check.error, description: check.description, state: check.state, issuer }),
    };
  }
  const id = await createPending(deps.db, check.pending, { now: deps.now });
  if (!id) {
    return {
      status: 303,
      location: errorRedirect(check.pending.redirectUri, {
        error: "temporarily_unavailable",
        description: "Try again in a moment.",
        state: check.pending.state,
        issuer,
      }),
    };
  }
  return { status: 303, location: consentPath(id) };
}

// ---------------------------------------------------------------------------
// The consent form's answer
// ---------------------------------------------------------------------------

/** The consent form's anti-forgery value: bound to the pending authorization AND the signed-in account. */
export function consentFormToken(pendingId: string, userId: string, secret: string): string {
  return createHmac("sha256", `mcp-consent:${secret}`).update(`${pendingId}:${userId}`).digest("base64url");
}

export function consentFormTokenValid(token: unknown, pendingId: string, userId: string, secret: string): boolean {
  if (typeof token !== "string" || !secret) return false;
  const want = Buffer.from(consentFormToken(pendingId, userId, secret));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

export type ConsentAnswer = { kind: "redirect"; location: string } | { kind: "page_error"; code: ConsentErrorCode } | { kind: "not_found" };

/**
 * POST /api/oauth/consent. The session says who; the form's token proves the
 * form was ours, for this request and this account; the pending
 * authorization is answered once. `allowed` is whether this account may
 * connect apps at all (checked again here, not just when the page drew).
 */
export async function handleConsentDecision(
  input: { pendingId: string | null; userId: string | null; approve: boolean; formToken: unknown; secret: string; allowed: boolean },
  deps: EndpointDeps,
): Promise<ConsentAnswer> {
  if (!deps.enabled) return { kind: "not_found" };
  if (!input.pendingId) return { kind: "page_error", code: "expired" };
  if (!input.userId) return { kind: "page_error", code: "expired" };
  if (!consentFormTokenValid(input.formToken, input.pendingId, input.userId, input.secret)) return { kind: "page_error", code: "failed" };
  if (input.approve && !input.allowed) return { kind: "page_error", code: "not_open" };
  const decided = await decidePending(
    deps.db,
    { pendingId: input.pendingId, userId: input.userId, approve: input.approve, issuer: issuerFor(deps.origin) },
    { now: deps.now },
  );
  if (!decided.ok) {
    return { kind: "page_error", code: decided.reason === "other_user" ? "other_account" : decided.reason === "unavailable" ? "unavailable" : "expired" };
  }
  return { kind: "redirect", location: decided.redirect };
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

/** A token request's form fields as strings (anything else is absent). */
export function formFields(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * POST /api/oauth/token: authorization_code (PKCE S256) and refresh_token
 * (rotation, reuse detection), both audience-bound (RFC 8707). Public
 * clients only: a client secret or assertion is refused rather than ignored,
 * so a client that believes it authenticated is told it did not.
 */
export async function handleToken(input: { form: Record<string, string>; ip: string | null }, deps: EndpointDeps): Promise<JsonAnswer> {
  if (!deps.enabled) return NOT_FOUND();
  if (await deps.rateLimited(deps.hashKey(rateBucket(input.ip), "oauth-token"), "oauth-token", 60, TOKEN_CALLS_PER_IP_PER_MINUTE)) {
    return json(429, { error: "slow_down", error_description: "Too many requests. Try again in a minute." });
  }
  const f = input.form;
  if (f.client_secret || f.client_assertion) {
    return json(401, { error: "invalid_client", error_description: 'This server only accepts public clients (token_endpoint_auth_method "none").' });
  }
  const resource = f.resource === undefined ? null : (canonicalResource(f.resource, deps.origin) ?? "invalid");
  let answer;
  if (f.grant_type === "authorization_code") {
    answer = await exchangeCode(
      deps.db,
      { code: f.code, clientId: f.client_id, redirectUri: f.redirect_uri, codeVerifier: f.code_verifier, resource },
      { now: deps.now },
    );
  } else if (f.grant_type === "refresh_token") {
    answer = await refreshTokens(deps.db, { refreshToken: f.refresh_token, clientId: f.client_id, scope: f.scope, resource }, { now: deps.now });
  } else {
    return json(400, { error: "unsupported_grant_type", error_description: "Use authorization_code or refresh_token." });
  }
  if (!answer.ok) return json(answer.status, { error: answer.error, error_description: answer.error_description });
  return json(200, answer.body);
}

// ---------------------------------------------------------------------------
// Revocation (RFC 7009)
// ---------------------------------------------------------------------------

/** POST /api/oauth/revoke: always 200 (an unknown token is not an error), whatever the switch says. */
export async function handleRevoke(input: { form: Record<string, string> }, deps: EndpointDeps): Promise<JsonAnswer> {
  await revokeToken(deps.db, { token: input.form.token, clientId: input.form.client_id }, { now: deps.now });
  return json(200, null);
}
