// Who is calling /api/mcp (spec §4.2 "Checking tokens"): the credential
// sorted by its prefix.
//
//   pmcp_at_   an access token from Picacho's own sign-in for apps
//              (oauth/store.ts verifyAccessToken): known, unexpired,
//              unrevoked, its connection live, its app not disabled, and
//              minted for THIS resource (RFC 8707). Only while
//              press_tour_mcp is on.
//   pic_live_  (and anything else) the API-key path, unchanged
//              (lib/api/keys.ts): existing keys keep working whatever the
//              switch says, and hold every scope.
//
// Every failure says what the CLIENT should do with it (protocol.ts
// authFailureReply): 401 with a challenge naming the protected-resource
// document when signing in again would fix it; 403 when nothing would.
//
// Alias-free except for keys.ts's own `after` (next/server).

import type { SupabaseClient } from "@supabase/supabase-js";
import { API_ACCESS_OFF, authenticateApiRequest } from "../api/keys";
import type { PlanId } from "../plans";
import { MCP_SCOPES, type McpScope } from "./oauth/config";
import { verifyAccessToken } from "./oauth/store";
import { bearerFrom, bearerKind } from "./oauth/tokens";
import { bearerChallenge } from "./protocol";

export type McpCaller = {
  userId: string;
  plan: PlanId;
  via: "api_key" | "oauth";
  scopes: McpScope[];
  /** The connection (oauth_grants.id) an app came through; null for an API key. */
  grantId: string | null;
  /** Whether the account has API access (Elite, the per-account grant, or admin): the standing tools need it. */
  apiAccess: boolean;
};

export type McpAuthFailure = { status: 401 | 403; message: string; challenge: string | null };

// What a person reads, via the app, when sign-in fails. English (the wire
// form); no machinery words, nothing sold.
export const MCP_SIGN_IN_NEEDED = "Connect your Picacho account to use this.";
export const MCP_SIGN_IN_EXPIRED = "Your Picacho connection has expired or was removed. Connect again.";
export const MCP_SUSPENDED = "This account is suspended.";
export const MCP_UNAVAILABLE = "We couldn't check your Picacho connection just now. Try again in a moment.";
export const MCP_SCOPE_NEEDED = "This app needs permission to do that. Connect again and allow it.";

export const MCP_AUTH_MESSAGES = [MCP_SIGN_IN_NEEDED, MCP_SIGN_IN_EXPIRED, MCP_SUSPENDED, MCP_UNAVAILABLE, MCP_SCOPE_NEEDED] as const;

// Said with a 401 on the key path (a key missing, wrong or revoked), where
// making a key is the fix. Not with a 403: a new key does not lift a
// suspension.
const WHERE_KEYS_LIVE = "Create one in Picacho under Settings → Security → API keys.";

export type AuthContext = {
  /** press_tour_mcp: Picacho's sign-in for apps exists. */
  oauthEnabled: boolean;
  /** The resource this request came in on (oauth/config.ts resourceFor). */
  resource: string;
  /** Its protected-resource metadata document (oauth/config.ts prmUrlFor). */
  prmUrl: string;
  now?: () => Date;
};

/**
 * Resolves the Authorization header to a caller, or explains the failure
 * with its challenge.
 */
export async function authenticateMcp(
  db: SupabaseClient,
  authorizationHeader: string | null,
  ctx: AuthContext,
): Promise<{ caller: McpCaller; failure: null } | { caller: null; failure: McpAuthFailure }> {
  const token = bearerFrom(authorizationHeader);
  const kind = token ? bearerKind(token) : "other";
  const challenge = (error: "invalid_token" | null, description: string | null) =>
    ctx.oauthEnabled ? bearerChallenge({ resourceMetadata: ctx.prmUrl, error, description }) : "Bearer";

  if (kind === "refresh" || kind === "code" || (kind === "access" && !ctx.oauthEnabled)) {
    return {
      caller: null,
      failure: { status: 401, message: MCP_SIGN_IN_EXPIRED, challenge: challenge("invalid_token", "The access token is not valid here.") },
    };
  }

  if (kind === "access") {
    const checked = await verifyAccessToken(db, token, { resource: ctx.resource }, { now: ctx.now });
    if (!checked.ok) {
      if (checked.reason === "unavailable") return { caller: null, failure: { status: 401, message: MCP_UNAVAILABLE, challenge: challenge(null, null) } };
      const why =
        checked.reason === "expired"
          ? "The access token expired."
          : checked.reason === "wrong_resource"
            ? "The access token was issued for another resource."
            : "The access token is not valid.";
      return { caller: null, failure: { status: 401, message: MCP_SIGN_IN_EXPIRED, challenge: challenge("invalid_token", why) } };
    }
    type ProfileRow = { plan?: unknown; role?: unknown; status?: unknown; api_access?: unknown };
    let profile: ProfileRow | null = null;
    try {
      const { data } = await db.from("profiles").select("plan, role, status, api_access").eq("id", checked.token.userId).maybeSingle();
      profile = (data as ProfileRow | null) ?? null;
    } catch {
      return { caller: null, failure: { status: 401, message: MCP_UNAVAILABLE, challenge: challenge(null, null) } };
    }
    // A deleted account's connection went with it (the grant cascades); a
    // profile that is simply not there is treated the same way.
    if (!profile) return { caller: null, failure: { status: 401, message: MCP_SIGN_IN_EXPIRED, challenge: challenge("invalid_token", "The account is gone.") } };
    if (profile.status === "suspended") return { caller: null, failure: { status: 403, message: MCP_SUSPENDED, challenge: null } };
    const plan = (typeof profile.plan === "string" ? profile.plan : "none") as PlanId;
    return {
      caller: {
        userId: checked.token.userId,
        plan,
        via: "oauth",
        scopes: checked.token.scopes,
        grantId: checked.token.grantId,
        apiAccess: plan === "elite" || profile.api_access === true || profile.role === "admin",
      },
      failure: null,
    };
  }

  // The API-key path, exactly as before (lib/api/keys.ts).
  const { caller, error } = await authenticateApiRequest(db, authorizationHeader);
  if (!caller) {
    if (error.status === 403) return { caller: null, failure: { status: 403, message: error.message, challenge: null } };
    // No credential at all, with sign-in for apps on: the app should sign in.
    if (!token && ctx.oauthEnabled) {
      return { caller: null, failure: { status: 401, message: MCP_SIGN_IN_NEEDED, challenge: challenge(null, null) } };
    }
    return {
      caller: null,
      failure: {
        status: 401,
        message: `${error.message} ${WHERE_KEYS_LIVE}`,
        challenge: token ? challenge("invalid_token", "The credential is not valid.") : challenge(null, null),
      },
    };
  }
  return {
    caller: { userId: caller.userId, plan: caller.plan, via: "api_key", scopes: [...MCP_SCOPES], grantId: null, apiAccess: true },
    failure: null,
  };
}

/** The 403 for a caller without the scope a tool needs (RFC 6750 insufficient_scope, with the scope that would). */
export function scopeFailure(needed: McpScope, ctx: AuthContext): McpAuthFailure {
  return {
    status: 403,
    message: MCP_SCOPE_NEEDED,
    challenge: bearerChallenge({
      resourceMetadata: ctx.oauthEnabled ? ctx.prmUrl : null,
      error: "insufficient_scope",
      description: `This needs the ${needed} permission.`,
      scope: needed,
    }),
  };
}

/** The 403 for an app whose account lacks API access (the standing tools; lib/api/keys.ts's rule). */
export function apiAccessFailure(): McpAuthFailure {
  return { status: 403, message: API_ACCESS_OFF, challenge: null };
}
