// Who is asking to connect: the rules for an OAuth client (spec §4.2
// "Client identity"; synthesis v2 #29).
//
//   CIMD first. The client_id is an https URL of a JSON document that
//   names the client and its redirect addresses (client ID metadata
//   documents, MCP authorization 2025-11-25). It is read through
//   press-tour/safe-fetch.ts (at most 5 KB, 5 s, no redirects), its
//   client_id must be the URL itself, and it is kept for a day.
//   DCR as the fallback (RFC 7591), rate-limited per address.
//
// TRUST, by redirect address only (never by a name a client chose):
//   verified    every redirect is exactly one of the hosts' own callbacks
//               (config.ts VERIFIED_REDIRECT_URIS / PATTERNS): all scopes,
//               and the consent page names the host with a check mark;
//   loopback    every redirect is this computer (RFC 8252: Claude Code and
//               other desktop tools): all scopes, no check mark — the code
//               can only ever land on the person's own machine;
//   unverified  anything else: `read` only, whatever it asks for.
//
// Public clients only: no client secrets are issued or accepted
// (token_endpoint_auth_method "none"; PKCE S256 is the proof).
//
// Pure and alias-free, except fetchClientDocument, which takes the fetcher.

import {
  CIMD_MAX_BYTES,
  CIMD_TIMEOUT_MS,
  MAX_CLIENT_NAME,
  MAX_REDIRECT_URIS,
  MAX_URI_LENGTH,
  MCP_SCOPES,
  VERIFIED_REDIRECT_PATTERNS,
  VERIFIED_REDIRECT_URIS,
  parseScopeParam,
  type McpScope,
} from "./config";

export type ClientKind = "dcr" | "cimd";
export type ClientTrust = "verified" | "loopback" | "unverified";

/** A registered or fetched client, as every endpoint reads it. */
export type OAuthClient = {
  clientId: string;
  kind: ClientKind;
  name: string;
  redirectUris: string[];
  trust: ClientTrust;
  disabled: boolean;
  /** CIMD: when the document was last read (ISO), for the day-long cache. */
  fetchedAt: string | null;
};

// ---------------------------------------------------------------------------
// Redirect addresses
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

/** A loopback redirect (RFC 8252 §7.3): http to this computer, any port. */
export function isLoopbackRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Whether a redirect address may be registered at all: https (no fragment,
 * no user:password), or loopback http. Private-use schemes are not accepted
 * in v1: neither host uses one, and each is a phishing surface of its own.
 */
export function isAcceptableRedirect(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > MAX_URI_LENGTH) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return u.hostname.length > 0;
  return isLoopbackRedirect(uri);
}

/**
 * Whether a redirect in an authorization request is one the client
 * registered. Exact string match; for loopback, the port may differ (RFC
 * 8252 §7.3: the port is chosen when the tool starts listening).
 */
export function redirectMatches(registered: readonly string[], requested: unknown): requested is string {
  if (typeof requested !== "string" || !isAcceptableRedirect(requested)) return false;
  if (registered.includes(requested)) return true;
  if (!isLoopbackRedirect(requested)) return false;
  const want = new URL(requested);
  return registered.some((r) => {
    if (!isLoopbackRedirect(r)) return false;
    const have = new URL(r);
    return (
      have.protocol === want.protocol &&
      have.hostname.toLowerCase() === want.hostname.toLowerCase() &&
      have.pathname === want.pathname &&
      have.search === want.search
    );
  });
}

function isVerifiedRedirect(uri: string): boolean {
  return VERIFIED_REDIRECT_URIS.includes(uri) || VERIFIED_REDIRECT_PATTERNS.some((re) => re.test(uri));
}

/** The trust a set of redirect addresses earns (see the header). */
export function clientTrust(redirectUris: readonly string[]): ClientTrust {
  if (redirectUris.length === 0) return "unverified";
  if (redirectUris.every(isVerifiedRedirect)) return "verified";
  if (redirectUris.every(isLoopbackRedirect)) return "loopback";
  return "unverified";
}

/** The scopes a client of this trust may ever be granted. */
export function allowedScopesFor(trust: ClientTrust): McpScope[] {
  return trust === "unverified" ? ["read"] : [...MCP_SCOPES];
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** A client's display name: printable, one line, bounded. Never trusted for anything but display. */
export function cleanClientName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  // Control characters, bidi overrides and zero-width characters out: a name
  // is printed on the consent page next to the question.
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > MAX_CLIENT_NAME ? `${cleaned.slice(0, MAX_CLIENT_NAME - 1)}…` : cleaned;
}

// ---------------------------------------------------------------------------
// Dynamic registration (RFC 7591)
// ---------------------------------------------------------------------------

export type DcrMetadata = {
  redirectUris: string[];
  name: string;
  clientUri: string | null;
  scopes: McpScope[];
  softwareId: string | null;
};

export type DcrError = { error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string };

const GRANT_TYPES = ["authorization_code", "refresh_token"];

/**
 * A registration request, checked. token_endpoint_auth_method is always
 * answered as "none" whatever was asked (RFC 7591 §3.2.1 lets the server
 * choose): no secret is ever issued.
 */
export function validateDcrRequest(body: unknown): { ok: true; metadata: DcrMetadata } | ({ ok: false } & DcrError) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_client_metadata", description: "The registration must be a JSON object." };
  }
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return { ok: false, error: "invalid_redirect_uri", description: `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} addresses.` };
  }
  if (!uris.every(isAcceptableRedirect)) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: "Every redirect_uri must be https (no fragment), or http on this computer (127.0.0.1, [::1] or localhost).",
    };
  }
  if (b.grant_types !== undefined) {
    if (!Array.isArray(b.grant_types) || !b.grant_types.every((g) => typeof g === "string" && GRANT_TYPES.includes(g))) {
      return { ok: false, error: "invalid_client_metadata", description: "grant_types may only be authorization_code and refresh_token." };
    }
  }
  if (b.response_types !== undefined) {
    if (!Array.isArray(b.response_types) || !b.response_types.every((r) => r === "code")) {
      return { ok: false, error: "invalid_client_metadata", description: 'response_types may only be "code".' };
    }
  }
  const scope = parseScopeParam(b.scope);
  if (scope.unknown) {
    return { ok: false, error: "invalid_client_metadata", description: `scope may only use: ${MCP_SCOPES.join(" ")}.` };
  }
  let clientUri: string | null = null;
  if (typeof b.client_uri === "string" && b.client_uri.length <= MAX_URI_LENGTH) {
    try {
      const u = new URL(b.client_uri);
      if (u.protocol === "https:") clientUri = u.href;
    } catch {
      clientUri = null;
    }
  }
  const softwareId = typeof b.software_id === "string" && b.software_id.length <= 128 ? b.software_id : null;
  return {
    ok: true,
    metadata: {
      redirectUris: [...new Set(uris as string[])],
      name: cleanClientName(b.client_name, "An app"),
      clientUri,
      scopes: scope.scopes,
      softwareId,
    },
  };
}

// ---------------------------------------------------------------------------
// Client ID metadata documents
// ---------------------------------------------------------------------------

/** Whether a client_id is a metadata document address: https, a path, no fragment, no user:password. */
export function isCimdClientId(clientId: unknown): clientId is string {
  if (typeof clientId !== "string" || clientId.length > MAX_URI_LENGTH) return false;
  let u: URL;
  try {
    u = new URL(clientId);
  } catch {
    return false;
  }
  return u.protocol === "https:" && !u.hash && !u.username && !u.password && u.pathname.length > 1 && u.href === clientId;
}

/**
 * A fetched document, checked against the address it came from. Its
 * client_id must be that address exactly; its redirects are held to the
 * registration rules; it must allow a public client ("none").
 */
export function validateCimdDocument(
  doc: unknown,
  url: string,
): { ok: true; name: string; redirectUris: string[] } | { ok: false; description: string } {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, description: "The client document is not a JSON object." };
  const d = doc as Record<string, unknown>;
  if (d.client_id !== url) return { ok: false, description: "The client document's client_id is not its own address." };
  const uris = d.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS || !uris.every(isAcceptableRedirect)) {
    return { ok: false, description: "The client document's redirect_uris are missing or not acceptable." };
  }
  // A public client: "none" in the plural list (SEP-3149), the singular
  // legacy field, or neither (the default is client_secret_basic in RFC
  // 7591, but a metadata document with no secret can only be public).
  const plural = d.token_endpoint_auth_methods_supported;
  const singular = d.token_endpoint_auth_method;
  const methods = Array.isArray(plural) ? plural : typeof singular === "string" ? [singular] : ["none"];
  if (!methods.includes("none")) {
    return { ok: false, description: 'The client must be able to use token_endpoint_auth_method "none".' };
  }
  return { ok: true, name: cleanClientName(d.client_name, new URL(url).hostname), redirectUris: [...new Set(uris as string[])] };
}

/** The fetch a metadata document is read through (safe-fetch.ts in production, a fake in tests). */
export type DocumentFetcher = (url: string, opts: { maxBytes: number; timeoutMs: number }) => Promise<{ status: number; text: string | null }>;

/** Reads and checks a client metadata document. Null when it cannot be read or does not hold. */
export async function fetchClientDocument(
  url: string,
  fetcher: DocumentFetcher,
): Promise<{ name: string; redirectUris: string[] } | null> {
  if (!isCimdClientId(url)) return null;
  let text: string | null;
  try {
    const res = await fetcher(url, { maxBytes: CIMD_MAX_BYTES, timeoutMs: CIMD_TIMEOUT_MS });
    if (res.status !== 200) return null;
    text = res.text;
  } catch {
    return null;
  }
  if (!text) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  const checked = validateCimdDocument(doc, url);
  return checked.ok ? { name: checked.name, redirectUris: checked.redirectUris } : null;
}
