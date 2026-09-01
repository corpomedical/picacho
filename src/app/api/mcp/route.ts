import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { API_RATE_LIMIT_PER_MINUTE, authenticateApiRequest } from "@/lib/api/keys";
import { rateLimited } from "@/lib/rate-limit";
import { runApiImageGeneration } from "@/lib/api/generate";
import { getOrigin } from "@/lib/origin";
import { absolutizeMediaUrl } from "@/lib/media/url";
import {
  classifyMessage,
  isAcceptableProtocolHeader,
  isAllowedOrigin,
  negotiateProtocolVersion,
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
  rpcError,
  rpcResult,
  SUPPORTED_PROTOCOL_VERSIONS,
  toolError,
  toolResult,
  type ToolTextResult,
} from "@/lib/mcp/protocol";
import { getMcpTool, MCP_INSTRUCTIONS, MCP_SERVER_INFO, MCP_TOOLS } from "@/lib/mcp/tools";

// POST /api/mcp — Picacho as an MCP server.
//
// One endpoint, Streamable HTTP, stateless. It wraps the SAME v1 API a
// customer's curl hits, so an agent and a script share one credit meter, one
// allowance check and one refund policy. Nothing here can generate by a route
// the documented API cannot.
//
// STATELESS ON PURPOSE. The transport allows a server to hand out an
// Mcp-Session-Id and keep state between calls; this one does not, because
// there is nothing to keep — every tool call authenticates from its own
// Authorization header and reads the caller's own rows. On serverless that
// also means no session can be stranded on an instance that has since been
// recycled, which is the failure mode a session would otherwise introduce
// for zero benefit.
//
// NO SSE. The spec lets a server answer a POSTed request with either a JSON
// object or an SSE stream, and requires clients to support both. JSON is the
// honest choice here: nothing streams. An image render is one bounded 20-60s
// call, and pretending otherwise would add a transport mode with no message
// to put on it.

export const runtime = "nodejs";
// Same ceiling as the REST generation route, and for the same reason: a slow
// provider should be cut off by us, mid-render, rather than by the platform
// mid-write.
export const maxDuration = 300;

function jsonRpc(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    // Answering a POSTed request with application/json is one of the two
    // framings the transport permits; the other is an SSE stream.
    headers: { "content-type": "application/json" },
  });
}

// The MCP endpoint must exist for GET as well as POST. 405 is the spec's own
// answer for "this server offers no server-initiated stream", which is true:
// there are no notifications to push.
export async function GET() {
  return NextResponse.json(
    { error: "This MCP endpoint does not offer an SSE stream. POST JSON-RPC messages instead." },
    { status: 405, headers: { allow: "POST" } },
  );
}

// Session termination. There are no sessions, so there is nothing to delete —
// and the spec names 405 as the response for exactly that.
export async function DELETE() {
  return NextResponse.json(
    { error: "This MCP endpoint is stateless; there is no session to terminate." },
    { status: 405, headers: { allow: "POST" } },
  );
}

export async function POST(request: Request) {
  const siteOrigin = await getOrigin();

  // DNS-rebinding guard, which the transport spec makes a MUST. A real MCP
  // client is not a browser and sends no Origin at all; when one IS present
  // it has to be ours, because the attack being described is a page on
  // another origin driving this endpoint.
  if (!isAllowedOrigin(request.headers.get("origin"), siteOrigin)) {
    return NextResponse.json({ error: "Origin not allowed." }, { status: 403 });
  }

  // Unlike the initialize PARAMETER, which negotiates, an unsupported value
  // in this header is specified as a hard 400.
  const protocolHeader = request.headers.get("mcp-protocol-version");
  if (!isAcceptableProtocolHeader(protocolHeader)) {
    return NextResponse.json(
      {
        error: `Unsupported MCP-Protocol-Version: ${protocolHeader}`,
        supported: [...SUPPORTED_PROTOCOL_VERSIONS],
      },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRpc(rpcError(null, RPC_PARSE_ERROR, "Body must be valid JSON."), 400);
  }

  const classified = classifyMessage(body);
  if (classified.kind === "invalid") {
    return jsonRpc(rpcError(null, RPC_INVALID_REQUEST, classified.reason), 400);
  }

  // A notification carries no id and expects NO reply — 202 with an empty
  // body. Returning a JSON-RPC object here is the classic way a hand-rolled
  // server confuses a client: nothing is waiting for it and there is no id to
  // correlate it against. notifications/initialized lands here on every
  // single connection, so getting this wrong breaks every client.
  if (classified.kind === "notification") {
    return new Response(null, { status: 202 });
  }

  const { id, method, params } = classified.message;
  const p = (params ?? {}) as Record<string, unknown>;

  // ---- methods that need no credential ---------------------------------
  //
  // initialize and ping are answered before authentication on purpose. A
  // client that cannot complete a handshake cannot show the user WHY its key
  // was rejected — it just fails to connect. Neither method reads any data or
  // spends anything.
  if (method === "initialize") {
    return jsonRpc(
      rpcResult(id, {
        protocolVersion: negotiateProtocolVersion(p.protocolVersion),
        // listChanged is false: this tool list is a constant in the source,
        // so there is no change to notify anyone about.
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: MCP_INSTRUCTIONS,
      }),
    );
  }
  if (method === "ping") {
    return jsonRpc(rpcResult(id, {}));
  }
  if (method === "tools/list") {
    return jsonRpc(rpcResult(id, { tools: MCP_TOOLS }));
  }
  if (method !== "tools/call") {
    return jsonRpc(rpcError(id, RPC_METHOD_NOT_FOUND, `Unknown method: ${method}`));
  }

  // ---- tools/call ------------------------------------------------------
  const toolName = typeof p.name === "string" ? p.name : "";
  const tool = getMcpTool(toolName);
  if (!tool) {
    // A protocol error, not a tool error: the call never happened, so there
    // is no execution result to report.
    return jsonRpc(rpcError(id, RPC_INVALID_PARAMS, `Unknown tool: ${toolName || "(none)"}`));
  }
  const args = (p.arguments ?? {}) as Record<string, unknown>;

  const supabase = createAdminClient();
  const { caller, error: authError } = await authenticateApiRequest(
    supabase,
    request.headers.get("authorization"),
  );
  if (!caller) {
    // Reported as a TOOL error rather than a JSON-RPC one so the model is
    // actually told what to fix. A protocol error at this point surfaces to
    // the user as a failed call with no explanation, and the fix — set an API
    // key — is something a person has to do.
    return jsonRpc(
      rpcResult(id, toolError(`${authError.message} Create one in Picacho under Settings > API.`)),
    );
  }

  // The same per-user limit the REST API enforces, on the same counter — so
  // an agent cannot get a second allowance by coming through this door.
  if (await rateLimited(caller.userId, "api", 60, API_RATE_LIMIT_PER_MINUTE)) {
    return jsonRpc(
      rpcResult(
        id,
        toolError(
          `Rate limit reached (${API_RATE_LIMIT_PER_MINUTE} requests per minute). Wait a moment and try again.`,
        ),
      ),
    );
  }

  try {
    const result = await callTool(toolName, args, {
      supabase,
      userId: caller.userId,
      plan: caller.plan,
      origin: siteOrigin,
    });
    return jsonRpc(rpcResult(id, result));
  } catch (err) {
    // An unexpected throw is ours, not the model's. Logged with the tool name
    // so it is diagnosable, and reported as a tool error so the conversation
    // can continue rather than dying on a protocol fault.
    console.error(`MCP tool ${toolName} threw:`, err);
    return jsonRpc(
      rpcResult(id, toolError("Something went wrong running that tool. Try again in a moment.")),
    );
  }
}

type ToolContext = {
  supabase: ReturnType<typeof createAdminClient>;
  userId: string;
  plan: string;
  origin: string;
};

async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolTextResult> {
  if (name === "list_characters") {
    const { data } = await ctx.supabase
      .from("character_profiles")
      .select("id, name, reference_image_urls")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false });
    return toolResult({
      characters: (data ?? []).map((c) => ({
        id: c.id as string,
        name: c.name as string,
        reference_photo_count: ((c.reference_image_urls as string[] | null) ?? []).length,
      })),
    });
  }

  if (name === "get_usage") {
    // Deliberately the SAME helpers the REST route uses, not a second
    // implementation. The first version of this summed credits_used since the
    // raw current_period_start, which is wrong twice over: getMonthlyUsageWith
    // exists because that column is a BILLING period anchor — on an annual
    // plan it is a year ago, so the window covered twelve months of usage —
    // and the included allowance has to add bonus_credits, which a comped
    // account lives on entirely. An agent asking "how many credits do I have"
    // must get the same answer the API and the app give.
    const { PLAN_LIMITS, PLAN_LABELS } = await import("@/lib/plans");
    const { getMonthlyUsageWith } = await import("@/lib/generations/core");
    const { data: profile } = await ctx.supabase
      .from("profiles")
      .select("plan, bonus_credits, purchased_credits, current_period_start")
      .eq("id", ctx.userId)
      .single();
    const plan = ctx.plan as keyof typeof PLAN_LIMITS;
    const used = await getMonthlyUsageWith(
      ctx.supabase,
      ctx.userId,
      profile?.current_period_start as string | null | undefined,
    );
    const included = (PLAN_LIMITS[plan] ?? 0) + ((profile?.bonus_credits ?? 0) as number);
    return toolResult({
      plan: ctx.plan,
      plan_label: PLAN_LABELS[plan] ?? ctx.plan,
      included_this_period: included,
      used_this_period: used,
      remaining_this_period: Math.max(0, included - used),
      purchased_credits: (profile?.purchased_credits ?? 0) as number,
      period_started_at: (profile?.current_period_start as string | null) ?? null,
    });
  }

  if (name === "get_generation") {
    const genId = typeof args.id === "string" ? args.id : "";
    if (!genId) return toolError("An id is required.");
    // Filtered by user_id explicitly. A service client does not get RLS, and
    // "select by id" against one is an IDOR waiting to happen — the same
    // reasoning the REST routes record.
    const { data } = await ctx.supabase
      .from("generations")
      .select("id, status, result_url, match_score, credits_used, prompt_input, content_type")
      .eq("id", genId)
      .eq("user_id", ctx.userId)
      // Deleted generations are gone, not merely hidden. Without this an
      // agent could still fetch a render the person had deleted — and the
      // media URL is a capability URL that never expires, so "deleted" would
      // have meant "removed from the list".
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return toolError("No generation with that id on this account.");
    return toolResult({
      id: data.id as string,
      status: data.status as string,
      content_type: data.content_type as string,
      image_url: data.result_url ? absolutizeMediaUrl(data.result_url as string, ctx.origin) : null,
      match_score: (data.match_score as number | null) ?? null,
      credits_used: (data.credits_used as number | null) ?? null,
    });
  }

  if (name === "generate_image") {
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    if (!prompt) return toolError("A prompt is required.");
    if (prompt.length > 2000) {
      return toolError("That prompt is longer than 2000 characters — trim it and try again.");
    }
    const characterId = typeof args.character_id === "string" ? args.character_id : null;

    const result = await runApiImageGeneration({
      supabase: ctx.supabase,
      userId: ctx.userId,
      prompt,
      characterId,
      origin: ctx.origin,
    });

    if (result.status !== "succeeded") {
      // A refused or failed render is a TOOL error: the model is told why in
      // words it can act on — out of credits, blocked by a rule, provider
      // refusal — instead of getting a protocol fault it cannot interpret.
      return toolError(result.error ?? "That generation didn't complete.");
    }

    return toolResult({
      id: result.id,
      status: result.status,
      image_url: result.imageUrl,
      final_prompt: result.prompt,
      match_score: result.matchScore,
      credits_used: result.creditsUsed,
    });
  }

  return toolError(`Unknown tool: ${name}`);
}
