import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isChatAgentEnabled } from "@/lib/agent/enabled";
import { buildAgentContext } from "@/lib/agent/context";
import {
  isAgentMode,
  unitsForTurn,
  costOfTurnUsd,
  MAX_UNITS_PER_TURN,
  type AgentMode,
  type TurnUsage,
} from "@/lib/agent/prices";
import { PLAN_CHAT_UNIT_LIMITS, FREE_CHAT_UNIT_LIMIT, type PlanId } from "@/lib/plans";
import { monthlyWindowStart } from "@/lib/generations/core";
import { classifyTurnFailure, unitsForFailedTurn, type TurnFailure } from "@/lib/agent/failures";
import { rateLimited } from "@/lib/rate-limit";

// The project-aware chat agent (2026-08-30).
//
// A route handler rather than a server action because this streams: server
// actions return a value, and a chat that waits for a whole answer before
// showing anything reads as broken on a slow connection — the same lesson the
// composer already learned about acknowledging every tap immediately.
//
// AND IT USES THE SDK, which is a departure: providers/anthropic.ts calls the
// same API with plain fetch and says why ("no extra package install is
// needed"). That reasoning holds for a single request/response draft. It does
// not hold here — this needs event-typed SSE parsing, usage aggregated across
// a stream, and a timeout that applies to a long-running response, and
// hand-rolling those on the path that decides what to bill is the opposite of
// reliable. The draft step is deliberately left alone.
//
// NO TOOL LOOP IN THIS VERSION, deliberately. The design allowed read-only
// tools; this ships without them because the context builder already hands
// the model the cast, the active brand rules, the model catalogue and the
// last fifteen renders with their scores — which is what the questions people
// actually ask are made of. One API call per turn means a bounded cost, no
// partial-loop failure states, and a cache prefix that cannot be disturbed
// mid-turn. Tools are worth adding once there is usage data saying which
// questions the context misses; adding them first would be guessing with
// someone else's money.
//
// ADVISE ONLY. There is no path from here to a render, a credit, or a
// settings change. The Send Receipt exists to stop sends before money moves;
// an assistant that could press Send would remove the thing it is for.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-opus-5";
// Twelve turns of history is enough for a conversation about one piece of
// work and short enough that the cached prefix stays worth caching.
const MAX_HISTORY_TURNS = 12;
// Matches the composer's own cap — the same box sends both, so a message the
// composer let you type must not be silently truncated on arrival here.
const MAX_MESSAGE_CHARS = 5000;

type IncomingTurn = { role: "user" | "assistant"; content: string };

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  // Re-checked here even though the composer hides the control when the flag
  // is off: a hidden button is not an access control.
  if (!(await isChatAgentEnabled(supabase))) {
    return NextResponse.json({ error: "Chat isn't available right now." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    messages?: IncomingTurn[];
    mode?: string;
    characterId?: string | null;
  } | null;

  const mode: AgentMode = isAgentMode(body?.mode) ? body.mode : "faster";
  const history = (body?.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));

  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });
  }

  // Burst limit, on its own scopes so it doesn't share a bucket with the six
  // features already using api_rate_hits. Fails closed by design.
  if (await rateLimited(user.id, "agent-chat", 60, 10)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, current_period_start")
    .eq("id", user.id)
    .single<{ plan: PlanId | null; current_period_start: string | null }>();

  const plan: PlanId = profile?.plan ?? "none";
  const isFree = plan === "none";

  // Smarter is a paid capability: the free allowance is sized for about a
  // dozen Faster messages, and one Smarter turn could eat half of it.
  const effectiveMode: AgentMode = isFree ? "faster" : mode;

  // Free accounts meter against a LIFETIME total (no billing anchor to reset
  // against); paid accounts against the billing period, like every other meter.
  const cap = isFree ? FREE_CHAT_UNIT_LIMIT : PLAN_CHAT_UNIT_LIMITS[plan];
  const since = isFree
    ? new Date(0).toISOString()
    : monthlyWindowStart(profile?.current_period_start).toISOString();

  // Reserve BEFORE the call, at the worst-case cost for the mode actually
  // being run. The real cost is unknowable until the turn ends, and someone
  // with three units left must not be able to start a turn that could cost
  // ten. The RPC returns the reservation ROW'S ID; that row is later updated
  // in place with what the turn really cost. It is never a second charge —
  // see agent-chat.sql for what happened when it was.
  const reservedUnits = MAX_UNITS_PER_TURN[effectiveMode];
  const { data: reservationId, error: reserveError } = await admin.rpc("record_agent_units", {
    p_user_id: user.id,
    p_since: since,
    p_cap: cap,
    p_units: reservedUnits,
  });
  if (reserveError) {
    console.error("agent-chat: budget check failed", reserveError.message);
    return NextResponse.json({ error: "Chat is unavailable right now." }, { status: 503 });
  }
  if (!reservationId) {
    return NextResponse.json(
      {
        error: isFree
          ? "You've used the free chat allowance. Any paid plan includes more."
          : "You've used this period's chat allowance.",
      },
      { status: 402 },
    );
  }

  // Rewrites the reservation row with what the turn actually cost. Called on
  // every exit path, including the failures — a reservation left standing at
  // the worst case is a charge nobody can explain.
  async function settle(
    usage: TurnUsage | null,
    failure: TurnFailure | null,
    deliveredText: boolean,
  ) {
    if (usage) {
      // Checked and retried once: this UPDATE is what turns the worst-case
      // reservation into the real (usually much smaller) charge. Discarding
      // its error left the person silently billed the ceiling for a turn
      // that cost one unit (2026-08-31 ledger audit).
      for (let attempt = 0; attempt < 2; attempt++) {
        const { error: settleError } = await admin
          .from("agent_usage")
          .update({
            mode: effectiveMode,
            units: unitsForTurn(usage),
            cost_usd: Number(costOfTurnUsd(usage).toFixed(6)),
            input_tokens: usage.input_tokens ?? 0,
            cache_read_tokens: usage.cache_read_input_tokens ?? 0,
            cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
            output_tokens: usage.output_tokens ?? 0,
          })
          .eq("id", reservationId);
        if (!settleError) return;
        console.error("agent-chat: settle write failed", {
          reservationId,
          attempt,
          error: settleError.message,
        });
        await new Promise((r) => setTimeout(r, 300));
      }
      return;
    }
    // No usage came back. If text DID still reach them, the reservation
    // stands: otherwise a client could take a full answer, drop the
    // connection before the usage frame, and pay next to nothing every turn.
    if (deliveredText) return;
    // Nothing reached them, so this failed on our side. What it costs them
    // depends on whether the request ever got as far as the model — a
    // rejected one spends no tokens and must be free. See lib/agent/failures.
    await admin
      .from("agent_usage")
      .update({
        mode: failure === "provider_unavailable" ? "unavailable" : "failed",
        units: unitsForFailedTurn(failure ?? "transient"),
      })
      .eq("id", reservationId);
  }

  const ctx = await buildAgentContext(supabase, user.id, body?.characterId ?? null);
  const client = new Anthropic();

  // Carries a Stop, or a closed tab, all the way to Anthropic.
  //
  // Before this, aborting the browser fetch cancelled nothing upstream: the
  // completion ran to the end and we paid for every token of an answer
  // nobody would ever read. The client's Stop button looked like it saved
  // money and did the opposite.
  const upstream = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      let deliveredText = false;
      // The person can navigate away mid-answer, which kills the controller.
      // That must not abort the turn's accounting — the tokens are already
      // spent — so a dead controller is swallowed here and the loop runs on
      // to collect usage.
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(sse(event, data)));
        } catch {
          closed = true;
        }
      };

      // One turn. `tuned` carries the two request parameters that make the
      // Faster/Smarter switch mean anything; see the retry below for why it
      // is a parameter rather than a constant.
      const runTurn = async (tuned: boolean) => {
        const result = client.messages.stream(
          {
            model: MODEL,
            max_tokens: effectiveMode === "smarter" ? 4000 : 1500,
            // Thinking stays ADAPTIVE in both modes. Disabling it to make
            // "faster" faster is the wrong lever — on this model a disabled
            // -thinking turn can leak internal tags into the visible answer.
            // Effort is the lever, and it still cuts the cost.
            ...(tuned
              ? {
                  thinking: { type: "adaptive" as const },
                  output_config: { effort: effectiveMode === "smarter" ? "high" : "low" },
                }
              : {}),
            // Cache order is load-bearing — see lib/agent/context.ts. The
            // first two blocks are byte-stable across every request; the
            // third varies per person.
            //
            // THE THIRD BREAKPOINT IS THERE ON MEASUREMENT, not on theory.
            // The first live run of this feature (2026-08-30) reported
            // input_tokens 2,618 with only 1,206 cached, because the project
            // block sat after the last breakpoint and was re-sent fresh
            // every turn. It varies per PERSON, but within one conversation
            // it is usually byte-identical — nothing changes it unless they
            // render, rename a character or edit a rule mid-chat. Caching it
            // makes the common case (several questions in a row) roughly
            // halve in input cost, and the uncommon case pays a 1.25x write
            // on that block alone while the two blocks above it still hit.
            // Never worse overall, often much better.
            system: [
              { type: "text" as const, text: ctx.houseRules, cache_control: { type: "ephemeral" as const } },
              { type: "text" as const, text: ctx.modelCatalogue, cache_control: { type: "ephemeral" as const } },
              { type: "text" as const, text: ctx.project, cache_control: { type: "ephemeral" as const } },
            ],
            messages: history,
          },
          // The SDK's default timeout is measured in minutes, which is the
          // right default for a batch job and the wrong one for someone
          // watching a cursor blink. Ninety seconds is well past the longest
          // a 4,000-token answer takes.
          { timeout: 90_000, maxRetries: 1, signal: upstream.signal },
        );

        for await (const event of result) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta" &&
            event.delta.text
          ) {
            deliveredText = true;
            send("delta", { text: event.delta.text });
          }
        }

        return (await result.finalMessage()).usage;
      };

      let usage: TurnUsage | null = null;
      let failure: TurnFailure | null = null;
      try {
        try {
          usage = await runTurn(true);
        } catch (err) {
          // Same defence draftWithClaude already carries, and for the same
          // reason it was added there: a model or API version that rejects
          // an OPTIONAL tuning parameter must not take the whole feature
          // down with it. Retried only when nothing has been sent yet — a
          // second attempt after half an answer would duplicate text — and
          // only on a 400 that actually names one of these parameters, so a
          // real bad request still fails loudly.
          const message = err instanceof Error ? err.message : String(err);
          const isParamRejection =
            (err as { status?: number })?.status === 400 &&
            /thinking|output_config|effort/i.test(message);
          if (!isParamRejection || deliveredText) throw err;
          console.error("agent-chat: retrying without tuning params —", message.slice(0, 200));
          usage = await runTurn(false);
        }
        send("done", { units: unitsForTurn(usage), mode: effectiveMode });
      } catch (err) {
        // A stop we asked for is not a failure and must not be reported as
        // one — there is nobody left reading the stream anyway. The
        // reservation stands: tokens were spent up to the moment we pulled
        // the plug, and a cancelled call returns no usage report, so the
        // safe direction is to have charged.
        if (upstream.signal.aborted) {
          console.info("agent-chat: cancelled by the client mid-stream");
          return;
        }
        const status = (err as { status?: number })?.status;
        failure = classifyTurnFailure(status, err instanceof Error ? err.message : String(err));
        console.error(`agent-chat failed (${failure}, status ${status ?? "none"}):`, err);
        send("error", {
          // Two different sentences on purpose. "Try again" is an
          // instruction, and when the cause is a spend cap or a dead key it
          // is an instruction to keep walking into a wall — so the message
          // only invites a retry when a retry could actually work.
          error:
            failure === "provider_unavailable"
              ? "Chat is unavailable right now. Nothing was charged."
              : "That didn't go through. Try again.",
        });
      } finally {
        // Accounting runs on every path, and its own failure is logged
        // rather than thrown: a broken update must not also break the
        // response the person is reading.
        try {
          await settle(usage, failure, deliveredText);
        } catch (settleError) {
          console.error("agent-chat: settle failed", settleError);
        }
        if (!closed) controller.close();
      }
    },
    // Fired when the person presses Stop, navigates away, or closes the tab —
    // the platform cancels the response body and this is where that lands.
    cancel() {
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  });
}
