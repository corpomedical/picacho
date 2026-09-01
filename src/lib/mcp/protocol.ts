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
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
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
 * allowed. When one IS present it must be our own site — that is precisely
 * the case being defended against, a page on another origin driving this
 * endpoint with the user's ambient credentials.
 */
export function isAllowedOrigin(origin: string | null, siteOrigin: string | null): boolean {
  if (!origin) return true;
  if (!siteOrigin) return false;
  try {
    return new URL(origin).origin === new URL(siteOrigin).origin;
  } catch {
    return false;
  }
}

export type ToolTextResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
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
 * A tool that ran and failed.
 *
 * NOT a JSON-RPC error. The distinction is the whole reason an agent can work
 * with this: a protocol error aborts the call and the model never sees why,
 * while isError:true hands the model the reason as text so it can correct
 * itself and try again — which for this server is the point, since the most
 * common failure is a render that came back under the identity threshold.
 */
export function toolError(message: string): ToolTextResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
