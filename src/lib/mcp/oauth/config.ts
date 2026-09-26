// Picacho's own OAuth 2.1 authorization server for MCP (Press Tour Cut 8;
// spec §4.2 "option B", synthesis v2 #29 and #40). The constants and the
// small pure rules every endpoint shares: scopes, lifetimes, token prefixes,
// which redirect addresses count as a known host, and how the issuer and the
// protected resource are named for the host a request came in on.
//
// WHY OUR OWN SERVER (option B). Tokens are opaque random strings stored
// only as SHA-256 hashes (the api_keys pattern). A leaked Picacho MCP token
// is useless against PostgREST and Storage, which is the whole exposure
// option A (Supabase's OAuth server, whose tokens are ordinary user JWTs)
// would have carried.
//
// Pure and alias-free: the endpoints, the MCP route and the tests import it
// as it is.

import { CANONICAL_ORIGIN, KNOWN_APP_HOSTS } from "../../domains";

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

/**
 * What a connected app may do (spec §4.2 table, v2 #5: no publish or
 * schedule scope in v1 — posting through MCP only ever makes a draft and
 * hands back a link to the press line).
 *   read      credits, characters, brand kits, products, ad plans and jobs
 *   brand     add products (and later brand kits) from links the person shares
 *   generate  spend credits, always on something the person approved
 */
export const MCP_SCOPES = ["read", "brand", "generate"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export function isMcpScope(value: unknown): value is McpScope {
  return typeof value === "string" && (MCP_SCOPES as readonly string[]).includes(value);
}

/**
 * A space-separated scope parameter as a list, in MCP_SCOPES order.
 * `unknown` is set when any word is not a scope of ours (RFC 6749
 * invalid_scope); an empty or absent parameter is `[]`.
 */
export function parseScopeParam(raw: unknown): { scopes: McpScope[]; unknown: boolean } {
  if (raw === undefined || raw === null) return { scopes: [], unknown: false };
  if (typeof raw !== "string") return { scopes: [], unknown: true };
  const words = raw.split(/\s+/).filter(Boolean);
  const unknown = words.some((w) => !isMcpScope(w));
  return { scopes: MCP_SCOPES.filter((s) => words.includes(s)), unknown };
}

/** A scope list as the wire form (space-separated, stable order). */
export function scopeString(scopes: readonly McpScope[]): string {
  return MCP_SCOPES.filter((s) => scopes.includes(s)).join(" ");
}

/** Scopes as the database stores them: known words only, stable order, no repeats. */
export function normaliseScopes(raw: unknown): McpScope[] {
  if (!Array.isArray(raw)) return [];
  return MCP_SCOPES.filter((s) => raw.includes(s));
}

// ---------------------------------------------------------------------------
// Lifetimes and shapes
// ---------------------------------------------------------------------------

export const ACCESS_TOKEN_PREFIX = "pmcp_at_";
export const REFRESH_TOKEN_PREFIX = "pmcp_rt_";
export const AUTH_CODE_PREFIX = "pmcp_ac_";
export const DCR_CLIENT_PREFIX = "pmcp_c_";
export const UI_NONCE_PREFIX = "pmcp_un_";

/** Access tokens last an hour (spec §4.2). */
export const ACCESS_TOKEN_TTL_S = 60 * 60;
/** Refresh tokens last 30 days and rotate on every use. */
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;
/** An authorization code: 5 minutes, single use. */
export const AUTH_CODE_TTL_S = 5 * 60;
/** A pending authorization waits this long for sign-in, two-step and the person's answer. */
export const PENDING_TTL_S = 15 * 60;
/** A client metadata document is read again after a day. */
export const CIMD_CACHE_S = 24 * 60 * 60;
/** A client metadata document: at most 5 KB, read in at most 5 s, no redirects (spec §4.2). */
export const CIMD_MAX_BYTES = 5 * 1024;
export const CIMD_TIMEOUT_MS = 5_000;
/** Dynamic registrations per address per hour (spec §4.2). */
export const DCR_PER_IP_PER_HOUR = 10;
/** Token-endpoint calls per address per minute: far above any real client, a floor under a loop. */
export const TOKEN_CALLS_PER_IP_PER_MINUTE = 120;
/** Authorization requests per address per minute. */
export const AUTHORIZE_CALLS_PER_IP_PER_MINUTE = 30;
/** A widget's one-time code for a spend: 15 minutes (spec §4.3 confirm_token TTL). */
export const UI_NONCE_TTL_S = 15 * 60;

export const MAX_REDIRECT_URIS = 10;
export const MAX_URI_LENGTH = 512;
export const MAX_STATE_LENGTH = 1024;
export const MAX_CLIENT_NAME = 100;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const MCP_PATH = "/api/mcp";
export const PRM_PATH = "/.well-known/oauth-protected-resource";
export const AS_METADATA_PATH = "/.well-known/oauth-authorization-server";
export const AUTHORIZE_PATH = "/api/oauth/authorize";
export const TOKEN_PATH = "/api/oauth/token";
export const REGISTER_PATH = "/api/oauth/register";
export const REVOKE_PATH = "/api/oauth/revoke";
export const CONSENT_DECISION_PATH = "/api/oauth/consent";
/** The consent page. The ONLY place sign-in may return to for a connection (resume.ts). */
export const CONSENT_PAGE_PATH = "/oauth/authorize";

// ---------------------------------------------------------------------------
// Known hosts (v2 #29: "verified" = an exact redirect allowlist)
// ---------------------------------------------------------------------------

/**
 * The redirect addresses of the two hosts Picacho is built for, exactly.
 * A client whose every redirect is one of these is "verified": the consent
 * page shows the host's name with a check mark, and it may ask for every
 * scope. Claude's documented callback (and its claude.com twin);
 * ChatGPT's stable callback, used when the server returns `iss` (we do).
 */
export const VERIFIED_REDIRECT_URIS: readonly string[] = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
];

/**
 * ChatGPT's per-connection callback, used when a server does not return
 * `iss`; exact host and path shape, one id segment.
 */
export const VERIFIED_REDIRECT_PATTERNS: readonly RegExp[] = [/^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/];

/** The host a verified redirect belongs to, for the consent page's check mark. */
export function verifiedHostOf(redirectUri: string): string | null {
  if (!VERIFIED_REDIRECT_URIS.includes(redirectUri) && !VERIFIED_REDIRECT_PATTERNS.some((re) => re.test(redirectUri))) {
    return null;
  }
  try {
    return new URL(redirectUri).hostname;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Issuer and resource, per host
// ---------------------------------------------------------------------------

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/** An origin the app is served on: one of KNOWN_APP_HOSTS over https, or a local dev server. */
export function isAppOrigin(origin: string): boolean {
  if (isLocalOrigin(origin)) return true;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && KNOWN_APP_HOSTS.includes(u.host.toLowerCase());
  } catch {
    return false;
  }
}

/** The origin with no trailing slash, or the canonical one when it is not the app's. */
function appOrigin(origin: string): string {
  if (!isAppOrigin(origin)) return CANONICAL_ORIGIN;
  const u = new URL(origin);
  return `${u.protocol}//${u.host.toLowerCase()}`;
}

/**
 * The authorization server's issuer. ONE issuer for every production host
 * (https://picacho.ai): ChatGPT compares `iss` by exact string, and a second
 * issuer per domain would be a second authorization server. A local dev
 * server is its own issuer, so the flow can be walked end to end on it.
 */
export function issuerFor(origin: string): string {
  return isLocalOrigin(origin) ? appOrigin(origin) : CANONICAL_ORIGIN;
}

/**
 * The protected resource for the host the request came in on (RFC 9728,
 * RFC 8707): https://picacho.ai/api/mcp or https://picacho.io/api/mcp. An
 * unknown host is answered as the canonical one. Only
 * https://picacho.ai/api/mcp is ever published (ChatGPT forbids moving the
 * origin later); picacho.io works for a person who added it by hand.
 */
export function resourceFor(origin: string): string {
  return `${appOrigin(origin)}${MCP_PATH}`;
}

/** Every resource a token may be minted for, from any host: the app's hosts' /api/mcp, plus this dev origin. */
export function allowedResources(origin: string): string[] {
  const out = KNOWN_APP_HOSTS.map((h) => `https://${h}${MCP_PATH}`);
  if (isLocalOrigin(origin)) out.push(`${appOrigin(origin)}${MCP_PATH}`);
  return out;
}

/** A requested `resource` parameter, canonicalised (no trailing slash), or null when it is not ours. */
export function canonicalResource(raw: unknown, origin: string): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URI_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.hash || u.search || u.username || u.password) return null;
  const path = u.pathname.replace(/\/+$/, "");
  const candidate = `${u.protocol}//${u.host.toLowerCase()}${path}`;
  return allowedResources(origin).includes(candidate) ? candidate : null;
}

/** The protected-resource metadata document's address for this host (named in every 401). */
export function prmUrlFor(origin: string): string {
  return `${appOrigin(origin)}${PRM_PATH}${MCP_PATH}`;
}

/** Whether a host's name is one the app serves (hostOf helper for the route files). */
export function isKnownHost(origin: string): boolean {
  const host = hostOf(origin);
  return host !== null && KNOWN_APP_HOSTS.includes(host);
}
