import { describe, expect, it } from "vitest";
import {
  ASSUMED_PROTOCOL_VERSION,
  classifyMessage,
  isAcceptableProtocolHeader,
  isAllowedOrigin,
  JSON_RPC_VERSION,
  LATEST_PROTOCOL_VERSION,
  negotiateProtocolVersion,
  rpcError,
  rpcResult,
  SUPPORTED_PROTOCOL_VERSIONS,
  toolError,
  toolResult,
} from "./protocol";
import { getMcpTool, isSpendingTool, MCP_TOOLS } from "./tools";

// MCP framing (2026-09-01).
//
// This layer fails silently by nature. A server that mis-frames a reply does
// not throw and does not log — the client simply never finishes its handshake
// and shows "could not connect", with nothing on either side saying why. So
// the shapes are pinned here rather than discovered against a real client.

describe("classifyMessage", () => {
  it("reads a request", () => {
    const c = classifyMessage({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { a: 1 } });
    expect(c).toEqual({
      kind: "request",
      message: { jsonrpc: "2.0", id: 1, method: "tools/list", params: { a: 1 } },
    });
  });

  it("REGRESSION: a message with no id is a NOTIFICATION, not a request", () => {
    // notifications/initialized arrives on every single connection and
    // carries no id. Replying to it with a JSON-RPC object — which is what
    // happens if this branch is missed — sends the client a response it is
    // not waiting for and cannot correlate.
    expect(classifyMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual({
      kind: "notification",
      method: "notifications/initialized",
    });
  });

  it("treats an explicit null id as a request, because JSON-RPC does", () => {
    const c = classifyMessage({ jsonrpc: "2.0", id: null, method: "ping" });
    expect(c.kind).toBe("request");
  });

  it("accepts a string id unchanged — ids are not numbers", () => {
    const c = classifyMessage({ jsonrpc: "2.0", id: "abc-1", method: "ping" });
    expect(c.kind === "request" && c.message.id).toBe("abc-1");
  });

  it("REGRESSION: rejects a JSON-RPC batch", () => {
    // Batching was REMOVED in MCP 2025-06-18. Quietly processing an array
    // would be inventing a feature the negotiated protocol says is gone.
    expect(classifyMessage([{ jsonrpc: "2.0", id: 1, method: "ping" }]).kind).toBe("invalid");
  });

  it("rejects anything that is not a JSON-RPC 2.0 message", () => {
    for (const junk of [null, undefined, 7, "ping", {}, { jsonrpc: "1.0", method: "ping" }]) {
      expect(classifyMessage(junk).kind, String(junk)).toBe("invalid");
    }
    expect(classifyMessage({ jsonrpc: "2.0", id: 1 }).kind).toBe("invalid");
    expect(classifyMessage({ jsonrpc: "2.0", id: {}, method: "ping" }).kind).toBe("invalid");
  });
});

describe("version negotiation", () => {
  it("echoes a version we speak", () => {
    for (const v of SUPPORTED_PROTOCOL_VERSIONS) {
      expect(negotiateProtocolVersion(v)).toBe(v);
    }
  });

  it("REGRESSION: an unknown version negotiates, it does not fail", () => {
    // The spec says answer with a version we DO support and let the client
    // decide. A server that errors here breaks every client newer than it.
    expect(negotiateProtocolVersion("2099-01-01")).toBe(LATEST_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(42)).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("but the HTTP HEADER is strict, which is the opposite rule", () => {
    // Same value, two different requirements: unsupported in the initialize
    // PARAMETER negotiates; unsupported in the header is a specified 400.
    expect(isAcceptableProtocolHeader(null)).toBe(true);
    expect(isAcceptableProtocolHeader("")).toBe(true);
    expect(isAcceptableProtocolHeader(LATEST_PROTOCOL_VERSION)).toBe(true);
    expect(isAcceptableProtocolHeader(ASSUMED_PROTOCOL_VERSION)).toBe(true);
    expect(isAcceptableProtocolHeader("2099-01-01")).toBe(false);
    expect(isAcceptableProtocolHeader("garbage")).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  const site = "https://picacho.ai";

  it("allows a client that sends no Origin — real MCP clients are not browsers", () => {
    expect(isAllowedOrigin(null, site)).toBe(true);
  });

  it("SECURITY: refuses another origin, which is the DNS-rebinding case", () => {
    expect(isAllowedOrigin("https://evil.example", site)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3000", site)).toBe(false);
    expect(isAllowedOrigin("null", site)).toBe(false);
  });

  it("allows our own origin, ignoring path and trailing slash", () => {
    expect(isAllowedOrigin(site, site)).toBe(true);
    expect(isAllowedOrigin("https://picacho.ai/", `${site}/api/mcp`)).toBe(true);
  });

  it("fails closed when we do not know our own origin", () => {
    expect(isAllowedOrigin("https://picacho.ai", null)).toBe(false);
  });
});

describe("reply framing", () => {
  it("carries the id back, so the client can correlate", () => {
    expect(rpcResult("x1", { ok: true })).toEqual({
      jsonrpc: JSON_RPC_VERSION,
      id: "x1",
      result: { ok: true },
    });
  });

  it("omits data when there is none, rather than sending undefined", () => {
    expect(rpcError(1, -32601, "Unknown method")).toEqual({
      jsonrpc: JSON_RPC_VERSION,
      id: 1,
      error: { code: -32601, message: "Unknown method" },
    });
    expect(rpcError(1, -32600, "Bad", { a: 1 })).toEqual({
      jsonrpc: JSON_RPC_VERSION,
      id: 1,
      error: { code: -32600, message: "Bad", data: { a: 1 } },
    });
  });
});

describe("tool results", () => {
  it("returns structured data BOTH ways", () => {
    // The spec asks a tool returning structuredContent to also serialise it
    // into a text block, so a client that predates structured content still
    // shows the model something instead of an empty result.
    const r = toolResult({ match_score: 91 });
    expect(r.structuredContent).toEqual({ match_score: 91 });
    expect(JSON.parse(r.content[0].text)).toEqual({ match_score: 91 });
    expect(r.isError).toBeUndefined();
  });

  it("REGRESSION: a failed tool is a RESULT with isError, not a protocol error", () => {
    // This distinction is the whole reason an agent can recover. A protocol
    // error aborts the call and the model never learns why; isError hands it
    // the reason as text so it can adjust and try again.
    const e = toolError("You're out of credits.");
    expect(e.isError).toBe(true);
    expect(e.content[0].text).toContain("out of credits");
  });
});

describe("tool definitions", () => {
  it("every tool has a usable JSON Schema", () => {
    for (const t of MCP_TOOLS) {
      expect(t.name, "name").toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.description.length, `${t.name} description`).toBeGreaterThan(30);
      expect(t.inputSchema.type, `${t.name} inputSchema`).toBe("object");
      expect(t.inputSchema).toHaveProperty("properties");
    }
  });

  it("names are unique and resolvable", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(getMcpTool(n)).not.toBeNull();
    expect(getMcpTool("nope")).toBeNull();
  });

  it("MONEY: exactly one tool spends credits, and it is not marked read-only", () => {
    // readOnlyHint is what tells a client it may skip the confirmation
    // prompt. Marking a billing tool read-only would let an agent spend a
    // customer's credits in a loop with no human in the way.
    const spending = MCP_TOOLS.filter((t) => isSpendingTool(t.name)).map((t) => t.name);
    expect(spending).toEqual(["generate_image"]);
    expect(getMcpTool("generate_image")!.annotations?.readOnlyHint).toBe(false);
    for (const readOnly of ["list_characters", "get_generation", "get_usage"]) {
      expect(getMcpTool(readOnly)!.annotations?.readOnlyHint, readOnly).toBe(true);
    }
  });

  it("tells the model that generate_image costs money and returns a score", () => {
    // The description is the only documentation a model ever reads.
    const d = getMcpTool("generate_image")!.description;
    expect(d).toContain("SPENDS A CREDIT");
    expect(d).toContain("match_score");
  });
});
