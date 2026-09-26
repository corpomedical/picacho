import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { API_RATE_LIMIT_PER_MINUTE } from "@/lib/api/keys";
import { rateLimited } from "@/lib/rate-limit";
import { runApiImageGeneration } from "@/lib/api/generate";
import { parseIdempotencyKey } from "@/lib/api/idempotency";
import { apiUsageSummary, type UsageProfile } from "@/lib/api/usage";
import { getOrigin } from "@/lib/origin";
import { absolutizeMediaUrl, toMediaUrl } from "@/lib/media/url";
import { readPressTourSwitches } from "@/lib/press-tour/enabled";
import {
  authFailureReply,
  classifyMessage,
  isAcceptableProtocolHeader,
  isAllowedOrigin,
  negotiateProtocolVersion,
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
  RPC_RESOURCE_NOT_FOUND,
  rpcError,
  rpcResult,
  SUPPORTED_PROTOCOL_VERSIONS,
  toolError,
  toolResult,
  type RpcId,
  type ToolTextResult,
} from "@/lib/mcp/protocol";
import { getMcpTool, isSpendingTool, listedTools, mcpInstructions, MCP_SERVER_INFO } from "@/lib/mcp/tools";
import { apiAccessFailure, authenticateMcp, scopeFailure, type AuthContext, type McpAuthFailure } from "@/lib/mcp/auth";
import { prmUrlFor, resourceFor } from "@/lib/mcp/oauth/config";
import { touchGrant } from "@/lib/mcp/oauth/store";
import { bearerFrom, bearerKind } from "@/lib/mcp/oauth/tokens";
import { PRESS_MCP_SPEND_UNSURE } from "@/lib/mcp/press/messages";
import { pressDeps, pressMcpCaller } from "@/lib/mcp/press/runtime";
import { runPressTool } from "@/lib/mcp/press/service";
import { PRESS_WIDGET_URI, widgetResourceContents, widgetResourceListing } from "@/lib/mcp/press/widget";
import type { PlanId } from "@/lib/plans";

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
//
// PRESS TOUR (Cut 8, 2026-09-26), behind press_tour_mcp (fail-closed):
//   - sign-in for apps: Picacho's own OAuth access tokens (lib/mcp/oauth)
//     beside the existing API keys, each checked for THIS resource; a
//     failure is 401 with a challenge naming the protected-resource
//     document (and, for ChatGPT, the same challenge in the body's _meta);
//   - scopes: every tool needs its own (read / brand / generate);
//   - Press Tour's tools and Picacho's card (the ui:// resource);
//   - the MONEY rule: the only spender a model can call is generate_image.
// With the switch off this endpoint is exactly what it was.

export const runtime = "nodejs";
// Same ceiling as the REST generation route, and for the same reason: a slow
// provider should be cut off by us, mid-render, rather than by the platform
// mid-write. Press Tour's paid steps return in seconds (the stills are
// painted after the answer, in after()).
export const maxDuration = 300;

function jsonRpc(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    // Answering a POSTed request with application/json is one of the two
    // framings the transport permits; the other is an SSE stream.
    headers: { ...headers, "content-type": "application/json" },
  });
}

function authReply(id: RpcId, failure: McpAuthFailure, oauthOn: boolean) {
  const reply = authFailureReply(id, failure, { asToolResult: oauthOn });
  return jsonRpc(reply.body, reply.status, reply.headers);
}

// Paid presses through MCP, per person (spec §4.4): a floor under a loop,
// far above a person tapping a card.
const SPENDS_PER_HOUR = 10;
const SPENDS_PER_DAY = 30;
const SPEND_LIMITED = "That's a lot of paid steps in a short time. Try again a little later.";

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
  // it has to be ours or a host's we run inside, because the attack being
  // described is a page on another origin driving this endpoint.
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

  const supabase = createAdminClient();
  // One read, fail-closed: every Press Tour switch is off while press_tour
  // is, while a provider key is missing, and when the read fails.
  const pressOn = (await readPressTourSwitches(supabase)).press_tour_mcp;
  const authCtx: AuthContext = { oauthEnabled: pressOn, resource: resourceFor(siteOrigin), prmUrl: prmUrlFor(siteOrigin) };
  const authorization = request.headers.get("authorization");

  // ---- methods that need no credential ---------------------------------
  //
  // initialize, ping, tools/list and the card's template are answered
  // before authentication on purpose: none reads any data or spends
  // anything, and a client that cannot complete a handshake cannot show the
  // person WHY a credential was rejected. One exception: an app's own
  // access token that was SENT and fails is answered 401 on every method,
  // so an expired one is refreshed at once rather than at the next tool.
  const handshake = ["initialize", "ping", "tools/list", "resources/list", "resources/read", "resources/templates/list"];
  if (handshake.includes(method)) {
    const sent = bearerFrom(authorization);
    if (pressOn && sent && bearerKind(sent) !== "other") {
      const check = await authenticateMcp(supabase, authorization, authCtx);
      if (check.failure && check.failure.status === 401) return authReply(id, check.failure, pressOn);
    }
  }

  if (method === "initialize") {
    return jsonRpc(
      rpcResult(id, {
        protocolVersion: negotiateProtocolVersion(p.protocolVersion),
        // listChanged is false: these lists are constants in the source
        // (the switch is read per request), so there is nothing to notify.
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: mcpInstructions({ pressTour: pressOn }),
      }),
    );
  }
  if (method === "ping") {
    return jsonRpc(rpcResult(id, {}));
  }
  if (method === "tools/list") {
    return jsonRpc(rpcResult(id, { tools: listedTools({ pressTour: pressOn }) }));
  }
  if (method === "resources/list") {
    return jsonRpc(rpcResult(id, { resources: pressOn ? [widgetResourceListing(siteOrigin)] : [] }));
  }
  if (method === "resources/templates/list") {
    return jsonRpc(rpcResult(id, { resourceTemplates: [] }));
  }
  if (method === "resources/read") {
    // The card's template: static HTML with no one's data in it.
    if (pressOn && p.uri === PRESS_WIDGET_URI) return jsonRpc(rpcResult(id, widgetResourceContents(siteOrigin)));
    return jsonRpc(rpcError(id, RPC_RESOURCE_NOT_FOUND, "Resource not found.", { uri: typeof p.uri === "string" ? p.uri : null }));
  }
  if (method !== "tools/call") {
    return jsonRpc(rpcError(id, RPC_METHOD_NOT_FOUND, `Unknown method: ${method}`));
  }

  // ---- tools/call ------------------------------------------------------
  const toolName = typeof p.name === "string" ? p.name : "";
  const tool = getMcpTool(toolName);
  if (!tool || (tool.pressTour && !pressOn)) {
    // A protocol error, not a tool error: the call never happened, so there
    // is no execution result to report. A Press Tour tool with the switch
    // off does not exist.
    return jsonRpc(rpcError(id, RPC_INVALID_PARAMS, `Unknown tool: ${toolName || "(none)"}`));
  }
  const args = (p.arguments ?? {}) as Record<string, unknown>;

  const { caller, failure } = await authenticateMcp(supabase, authorization, authCtx);
  if (!caller) {
    // HTTP 401 with WWW-Authenticate (403 when the credential is fine but
    // not allowed), not HTTP 200 with a tool error (Press Tour cut 0). The
    // fix is a person's — sign in again, set or replace the key — so the
    // CLIENT has to learn of it.
    return authReply(id, failure, pressOn);
  }
  if (!caller.scopes.includes(tool.scope)) return authReply(id, scopeFailure(tool.scope, authCtx), pressOn);
  // The standing tools keep their rule for an app too: API access (Elite,
  // the per-account grant, or an admin). A key could not exist without it.
  if (!tool.pressTour && !caller.apiAccess) return authReply(id, apiAccessFailure(), pressOn);

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
  if (tool.pressTour && tool.spends) {
    if (
      (await rateLimited(caller.userId, "mcp-spend", 60 * 60, SPENDS_PER_HOUR)) ||
      (await rateLimited(caller.userId, "mcp-spend-day", 24 * 60 * 60, SPENDS_PER_DAY))
    ) {
      return jsonRpc(rpcResult(id, toolError(SPEND_LIMITED)));
    }
  }
  if (caller.grantId) {
    const grantId = caller.grantId;
    after(() => touchGrant(supabase, grantId));
  }

  try {
    let result: ToolTextResult;
    if (tool.pressTour) {
      const who = await pressMcpCaller(supabase, caller.userId, caller.grantId);
      result = who.caller === null ? toolError(who.error) : await runPressTool(toolName, args, await pressDeps(who.caller, siteOrigin), who.caller);
    } else {
      result = await callTool(toolName, args, {
        supabase,
        userId: caller.userId,
        plan: caller.plan,
        origin: siteOrigin,
      });
    }
    return jsonRpc(rpcResult(id, result));
  } catch (err) {
    // An unexpected throw is ours, not the model's. Logged with the tool name
    // so it is diagnosable, and reported as a tool error so the conversation
    // can continue rather than dying on a protocol fault.
    console.error(`MCP tool ${toolName} threw:`, err);
    // A spending tool may have charged before it threw, so it is not told
    // to simply try again: another call is the person's decision, and the
    // same idempotency_key (or the card's one-time code) keeps it from being
    // charged twice.
    return jsonRpc(
      rpcResult(
        id,
        toolError(
          tool.pressTour && tool.spends
            ? PRESS_MCP_SPEND_UNSURE
            : isSpendingTool(toolName)
              ? "Something went wrong making that image, and it may still have been made. Ask the person before trying again; a retry with the same idempotency_key can't be charged twice."
              : "Something went wrong running that tool. Try again in a moment.",
        ),
      ),
    );
  }
}

type ToolContext = {
  supabase: ReturnType<typeof createAdminClient>;
  userId: string;
  plan: PlanId;
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
    // Deliberately the SAME helpers and the same rules the REST route uses,
    // not a second implementation. The first version of this summed
    // credits_used since the raw current_period_start, which is wrong:
    // getMonthlyUsageWith exists because that column is a BILLING period
    // anchor — on an annual plan it is a year ago. The second still
    // overstated the balance (Press Tour cut 0, 2026-09-25): it added bonus
    // credits into remaining_this_period, and it counted a lapsed
    // subscription's full allowance, both of which the spend path refuses.
    // apiUsageSummary is those rules, with GET /api/v1/usage's reasons; an
    // agent asking "how many credits do I have" gets the answer a script
    // gets, and the parity test (lib/mcp/route.test.ts) holds the two routes
    // together.
    const { getMonthlyUsageWith } = await import("@/lib/generations/core");
    const { data: profile } = await ctx.supabase
      .from("profiles")
      .select("plan, plan_status, bonus_credits, purchased_credits, current_period_start")
      .eq("id", ctx.userId)
      .single();
    const used = await getMonthlyUsageWith(
      ctx.supabase,
      ctx.userId,
      profile?.current_period_start as string | null | undefined,
    );
    return toolResult(apiUsageSummary(ctx.plan, (profile ?? null) as UsageProfile, used));
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
    // Re-signed through toMediaUrl, as GET /api/v1/generations/{id} does
    // (Press Tour cut 0). The stored value is either an old Supabase signed
    // URL whose 7-day token has long expired, or a media-route URL signed
    // under whatever key was current when it was written — handed out raw,
    // both were dead links. toMediaUrl re-mints either under today's key.
    const mediaUrl = toMediaUrl(data.result_url as string | null);
    return toolResult({
      id: data.id as string,
      status: data.status as string,
      content_type: data.content_type as string,
      image_url: mediaUrl ? absolutizeMediaUrl(mediaUrl, ctx.origin) : null,
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
    // Optional. With one, a retried call returns the first call's image and
    // is never charged twice (api/idempotency.ts). Refused before anything
    // runs when it is unusable, so a bad key never costs a credit.
    const idempotency = parseIdempotencyKey(args.idempotency_key);
    if (idempotency.error !== null) return toolError(idempotency.error);

    const result = await runApiImageGeneration({
      supabase: ctx.supabase,
      userId: ctx.userId,
      prompt,
      characterId,
      origin: ctx.origin,
      idempotencyKey: idempotency.key,
    });

    if (result.error !== null) {
      // A refused render is a TOOL error: the model is told why in words it
      // can pass on — out of credits, blocked by a rule, a key reused —
      // instead of getting a protocol fault it cannot interpret.
      return toolError(result.error);
    }
    if (result.status === "failed") {
      // Says whether it cost anything, because that is what the person
      // needs to know next; never that another call would do better.
      return toolError(
        result.creditsUsed === 0
          ? "That image didn't come out. Nothing was charged."
          : "That image didn't come out.",
      );
    }
    if (result.status === "generating") {
      // A repeat of a request whose image is still rendering: it exists and
      // is charged once. Not an error — get_generation fetches it, free.
      return toolResult({
        id: result.id,
        status: result.status,
        image_url: null,
        final_prompt: null,
        match_score: null,
        credits_used: result.creditsUsed,
      });
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
