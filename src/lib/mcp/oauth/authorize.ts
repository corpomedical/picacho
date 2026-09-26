// The authorization request (GET /api/oauth/authorize), checked (spec §4.2
// "Authorize page"; OAuth 2.1 §4.1; RFC 8707; RFC 9207).
//
// THE ORDER IS THE RULE. Until the client and its redirect address are
// known good, nothing is ever sent back to that address: an unknown client
// or a redirect it did not register gets Picacho's own error page (an open
// redirector is exactly what a phisher wants). After that, every problem
// goes back to the client's redirect with `error`, `state` and `iss`.
//
// What a good request becomes is a PENDING AUTHORIZATION, stored on the
// server; only its id travels through sign-in (resume.ts).
//
// Pure and alias-free.

import { allowedScopesFor, redirectMatches, type OAuthClient } from "./clients";
import { MAX_STATE_LENGTH, canonicalResource, parseScopeParam, type McpScope } from "./config";
import { isValidChallenge } from "./tokens";

/** What the consent page shows when nothing can be sent back to the app (codes, never text). */
export type AuthorizePageError = "unknown_client" | "bad_redirect" | "client_disabled" | "unavailable";

export type PendingInput = {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string;
  scopes: McpScope[];
};

export type AuthorizeCheck =
  | { kind: "page_error"; code: AuthorizePageError }
  | { kind: "redirect_error"; redirectUri: string; error: string; description: string; state: string | null }
  | { kind: "ok"; pending: PendingInput };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Checks one authorization request. `client` is what the client_id
 * resolved to (null: unknown). `origin` is the host the request came in on
 * (which resources a token may be minted for).
 */
export function checkAuthorizeRequest(params: Record<string, unknown>, client: OAuthClient | null, origin: string): AuthorizeCheck {
  if (!client) return { kind: "page_error", code: "unknown_client" };
  const redirectUri = params.redirect_uri;
  if (!redirectMatches(client.redirectUris, redirectUri)) return { kind: "page_error", code: "bad_redirect" };
  if (client.disabled) return { kind: "page_error", code: "client_disabled" };

  const rawState = str(params.state);
  // An over-long state is refused outright rather than cut: the app would
  // not recognise a shortened one.
  if (rawState !== null && rawState.length > MAX_STATE_LENGTH) {
    return { kind: "redirect_error", redirectUri, error: "invalid_request", description: "state is too long.", state: null };
  }
  const state = rawState && rawState.length > 0 ? rawState : null;
  const fail = (error: string, description: string): AuthorizeCheck => ({ kind: "redirect_error", redirectUri, error, description, state });

  if (params.response_type !== "code") return fail("unsupported_response_type", 'Only response_type "code" is supported.');
  if (params.code_challenge_method !== "S256") return fail("invalid_request", "PKCE with code_challenge_method S256 is required.");
  if (!isValidChallenge(params.code_challenge)) return fail("invalid_request", "code_challenge must be an S256 challenge (43 characters).");

  const resource = canonicalResource(params.resource, origin);
  if (!resource) {
    return fail("invalid_target", "resource must name this server's MCP endpoint, for example https://picacho.ai/api/mcp.");
  }

  const asked = parseScopeParam(params.scope);
  if (asked.unknown) return fail("invalid_scope", "Unknown scope. This server offers: read brand generate.");
  // An unverified client is held to `read`, whatever it asked for; no
  // scope named means everything the client may have.
  const allowed = allowedScopesFor(client.trust);
  const scopes = (asked.scopes.length > 0 ? asked.scopes : allowed).filter((s) => allowed.includes(s));
  if (scopes.length === 0) return fail("invalid_scope", "This app may only ask to read your account.");

  return {
    kind: "ok",
    pending: { clientId: client.clientId, redirectUri, state, codeChallenge: params.code_challenge, resource, scopes },
  };
}

/** The redirect back to the app with a code (OAuth 2.1 §4.1.2; RFC 9207 `iss`). */
export function successRedirect(redirectUri: string, input: { code: string; state: string | null; issuer: string }): string {
  const u = new URL(redirectUri);
  u.searchParams.set("code", input.code);
  if (input.state !== null) u.searchParams.set("state", input.state);
  u.searchParams.set("iss", input.issuer);
  return u.toString();
}

/** The redirect back to the app with an error (every error carries `iss`, RFC 9207). */
export function errorRedirect(
  redirectUri: string,
  input: { error: string; description?: string; state: string | null; issuer: string },
): string {
  const u = new URL(redirectUri);
  u.searchParams.set("error", input.error);
  if (input.description) u.searchParams.set("error_description", input.description);
  if (input.state !== null) u.searchParams.set("state", input.state);
  u.searchParams.set("iss", input.issuer);
  return u.toString();
}
