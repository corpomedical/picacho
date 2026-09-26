// MCP framing — JSON-RPC 2.0 as the Model Context Protocol uses it.
//
// Hand-rolled rather than pulling in @modelcontextprotocol/sdk, for the same
// reason providers/anthropic.ts calls the Messages API with plain fetch:
// "no SDK, so no extra package install is needed". The surface this server
// needs is small and fixed — initialize, ping, tools/list, tools/call — and
// the SDK's value is mostly in transports (stdio, SSE, sessions) that a
// stateless HTTP route deliberately does not use.
//
// Alias-free and side-effect-free so it can be unit-tested. The route on top
// of it does auth, rate limiting and dispatch; everything about MESSAGE SHAPE
// lives here, because a server that frames a reply wrongly doesn't fail
// loudly — it just never connects, and there is nothing to read.

/**
 * Protocol versions this server speaks, newest first.
 *
 * Version negotiation, per the spec: if the client asks for one we support we
 * MUST echo it back; otherwise we MUST answer with one we do support, and the
 * client decides whether to continue. Note this is NOT an error case — a
 * server that 400s an unknown version breaks every client newer than itself.
 *
 * 2025-03-26 is listed because the transport spec says a client that sends no
 * MCP-Protocol-Version header should be assumed to be speaking it.
 *
 * 2025-11-25 added 2026-09-25 (Press Tour cut 0). Everything it changed that
 * touches a server like this one is optional or already true here: icons,
 * tasks, URL elicitation and sampling tools are capabilities this server
 * does not declare; input-validation failures already come back as tool
 * results with isError; a foreign Origin already gets 403; there is no SSE
 * stream for its polling change to apply to. Its authorization additions
 * (client metadata documents, scope step-up) matter only once OAuth exists
 * (cut 8). So speaking it needed nothing but this line — and a client on it
 * was, until now, refused with a hard 400 on the header.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
/** What to assume when the header is absent — the spec names this exact value. */
export const ASSUMED_PROTOCOL_VERSION = "2025-03-26";

export const JSON_RPC_VERSION = "2.0";

// Standard JSON-RPC error codes. Tool FAILURES do not use these — a tool that
// ran and failed returns a normal result with isError:true, so the model can
// read what went wrong and try something else. These are for messages the
// server could not process at all.
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;
// Implementation-defined, from JSON-RPC's reserved server range
// (-32000..-32099): the request was refused before it ran because its
// credential was missing, invalid, revoked, or not allowed to use the API.
// It rides an HTTP 401 or 403 — see authFailureReply.
export const RPC_UNAUTHORIZED = -32001;

export type RpcId = string | number | null;

// id is REQUIRED here, not optional: a message without one is a
// notification, and classifyMessage returns that as its own variant. Making
// the field optional on this type is what let the route hand `undefined` to
// a reply builder — which would have framed a response with no correlation
// id, so the client could never match it to its call.
export type RpcRequest = {
  jsonrpc: string;
  id: RpcId;
  method: string;
  params?: unknown;
};

export type RpcResponse =
  | { jsonrpc: string; id: RpcId; result: unknown }
  | { jsonrpc: string; id: RpcId; error: { code: number; message: string; data?: unknown } };

/**
 * Classifies an incoming message body.
 *
 * The distinction matters at the HTTP layer, not just here: a REQUEST gets a
 * JSON body back, while a NOTIFICATION or a response must be answered with
 * 202 Accepted and NO body. Returning a JSON-RPC reply to a notification is
 * the single most common way a hand-rolled server confuses a client, because
 * the client is not waiting for one and the correlation id is absent.
 */
export function classifyMessage(
  body: unknown,
): { kind: "request"; message: RpcRequest } | { kind: "notification"; method: string } | { kind: "invalid"; reason: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    // Arrays are rejected on purpose: JSON-RPC batching was REMOVED in MCP
    // 2025-06-18, and silently processing a batch would be inventing a
    // feature the negotiated protocol says does not exist.
    return { kind: "invalid", reason: "Body must be a single JSON-RPC message object." };
  }
  const m = body as Record<string, unknown>;
  if (m.jsonrpc !== JSON_RPC_VERSION) {
    return { kind: "invalid", reason: 'Missing or wrong "jsonrpc" version — must be "2.0".' };
  }
  if (typeof m.method !== "string" || !m.method) {
    return { kind: "invalid", reason: 'Missing "method".' };
  }
  // Absent id means notification. null is NOT absent — but JSON-RPC treats a
  // null id as a request whose id is null, so it is answered.
  if (!("id" in m)) return { kind: "notification", method: m.method };
  const id = m.id;
  if (id !== null && typeof id !== "string" && typeof id !== "number") {
    return { kind: "invalid", reason: '"id" must be a string, a number, or null.' };
  }
  return { kind: "request", message: { jsonrpc: JSON_RPC_VERSION, id, method: m.method, params: m.params } };
}

export function rpcResult(id: RpcId, result: unknown): RpcResponse {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

export function rpcError(id: RpcId, code: number, message: string, data?: unknown): RpcResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/**
 * Picks the protocol version to answer `initialize` with.
 *
 * Echo what was asked for when we speak it; otherwise answer with our latest
 * and let the client decide. Deliberately never throws and never errors: an
 * unknown version is a NEGOTIATION, not a failure.
 */
export function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}

/**
 * Whether an MCP-Protocol-Version HTTP header is acceptable.
 *
 * The transport spec is explicit that an invalid or unsupported value here
 * MUST be a 400 — unlike the initialize parameter above, which negotiates.
 * Absent is fine and means 2025-03-26.
 */
export function isAcceptableProtocolHeader(header: string | null): boolean {
  if (header === null || header.trim() === "") return true;
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(header.trim());
}

/**
 * Origin check, which the transport spec makes a MUST to stop DNS rebinding.
 *
 * A real MCP client is not a browser and sends no Origin at all, so absent is
 * allowed. When one IS present it must be our own site or one of the hosts
 * Picacho runs inside (HOST_APP_ORIGINS; Press Tour cut 8) — anything else is
 * precisely the case being defended against, a page on another origin
 * driving this endpoint. (This endpoint takes no cookies: a credential is
 * always a bearer header, so a host's origin gains nothing ambient.)
 */
export function isAllowedOrigin(origin: string | null, siteOrigin: string | null): boolean {
  if (!origin) return true;
  try {
    const o = new URL(origin).origin;
    // The hosts Picacho is built for (spec §4.2): their web apps may reach
    // this endpoint from the browser. Exact origins, no wildcards.
    if (HOST_APP_ORIGINS.includes(o)) return true;
    if (!siteOrigin) return false;
    return o === new URL(siteOrigin).origin;
  } catch {
    return false;
  }
}

/** Browser origins of the hosts Picacho runs inside (Claude, ChatGPT), allowed by isAllowedOrigin. */
export const HOST_APP_ORIGINS: readonly string[] = ["https://claude.ai", "https://claude.com", "https://chatgpt.com"];

/** JSON-RPC error for a resource that is not there (MCP resources spec). */
export const RPC_RESOURCE_NOT_FOUND = -32002;

export type ToolTextResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  /**
   * For the host's view only (MCP Apps: "not intended for model context";
   * ChatGPT: "delivered only to the component"): Picacho's card reads its
   * one-time code for a paid tap here (press/nonce.ts), and ChatGPT reads
   * mcp/www_authenticate here to offer sign-in.
   */
  _meta?: Record<string, unknown>;
};

/**
 * A successful tool result.
 *
 * Structured data is returned BOTH ways on purpose: the spec says a tool that
 * returns structuredContent should also serialise it into a text block, so a
 * client that predates structured content still shows the model something
 * useful rather than an empty result.
 */
export function toolResult(structured: Record<string, unknown>): ToolTextResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

/**
 * A `WWW-Authenticate: Bearer …` challenge (RFC 6750 §3; RFC 9728 §5.1).
 * `resourceMetadata` names the protected-resource document, which is how
 * Claude and ChatGPT find the authorization server; `error` is
 * invalid_token (a credential was sent and failed) or insufficient_scope
 * (it is fine but may not do this), with the scope that would. Quoted
 * values are stripped of quotes and backslashes rather than escaped.
 */
export function bearerChallenge(p: {
  resourceMetadata?: string | null;
  error?: "invalid_token" | "insufficient_scope" | null;
  description?: string | null;
  scope?: string | null;
} = {}): string {
  const q = (v: string) => `"${v.replace(/["\\\r\n]/g, "")}"`;
  const parts: string[] = [];
  if (p.resourceMetadata) parts.push(`resource_metadata=${q(p.resourceMetadata)}`);
  if (p.error) parts.push(`error=${q(p.error)}`);
  if (p.error && p.description) parts.push(`error_description=${q(p.description)}`);
  if (p.scope) parts.push(`scope=${q(p.scope)}`);
  return parts.length > 0 ? `Bearer ${parts.join(", ")}` : "Bearer";
}

/**
 * The HTTP answer to a request whose credential failed (Press Tour cut 0,
 * 2026-09-25; cut 8, 2026-09-26).
 *
 * This used to be HTTP 200 carrying a tool result with isError. That told
 * the MODEL, which cannot fix a key, and hid the failure from the CLIENT,
 * which can: Claude offers to connect an account only on a 401 carrying
 * WWW-Authenticate. So a missing, invalid or revoked credential is HTTP 401
 * with a WWW-Authenticate challenge (RFC 6750), and one that is fine but not
 * allowed is 403: with an insufficient_scope challenge when a wider consent
 * would fix it, with none when nothing the person signs into would
 * (suspended, API access off).
 *
 * THE CHALLENGE. Plain `Bearer` while Picacho's own sign-in for apps is off
 * (press_tour_mcp): it would point clients at documents that answer 404,
 * and Claude would try discovery against them and fail (critique #40). With
 * it on, `challenge` carries resource_metadata.
 *
 * THE BODY. A JSON-RPC error with the request's id and the reason — unless
 * `asToolResult`, for a challenge: then the body is a tool result with
 * isError and `_meta["mcp/www_authenticate"]`, which is how ChatGPT learns
 * to show its sign-in (OpenAI, "Triggering authentication UI"). Claude acts
 * on the status line and header; ChatGPT on this body; the same answer
 * serves both.
 */
export function authFailureReply(
  id: RpcId,
  failure: { status: 401 | 403; message: string; challenge?: string | null },
  opts: { asToolResult?: boolean } = {},
): { status: 401 | 403; headers: Record<string, string>; body: RpcResponse } {
  const challenge = failure.challenge ?? (failure.status === 401 ? "Bearer" : null);
  const headers: Record<string, string> = challenge ? { "www-authenticate": challenge } : {};
  const body =
    opts.asToolResult && failure.challenge
      ? rpcResult(id, {
          content: [{ type: "text", text: failure.message }],
          isError: true,
          _meta: { "mcp/www_authenticate": [failure.challenge] },
        })
      : rpcError(id, RPC_UNAUTHORIZED, failure.message);
  return { status: failure.status, headers, body };
}

/**
 * A tool that ran and failed.
 *
 * NOT a JSON-RPC error. The distinction is the whole reason an agent can work
 * with this: a protocol error aborts the call and the model never sees why,
 * while isError:true hands the model the reason as text it can relay to the
 * person — out of credits, blocked by a rule, a refused provider. It is not
 * an invitation to call a spending tool again: that is the person's decision
 * (tools.ts says so to the model).
 */
export function toolError(message: string): ToolTextResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
