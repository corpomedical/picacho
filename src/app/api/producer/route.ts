import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isProducerEnabled, isProducerOpenToElite, producerAllowed, PRODUCER_UNAVAILABLE } from "@/lib/producer/enabled";
import {
  BRAKE_USD,
  MAX_CALLS,
  MAX_OUTPUT_TOKENS,
  PRODUCER_MODEL,
  RESERVE_UNITS,
  costOfCallUsd,
  unitsForCostUsd,
  type CallUsage,
} from "@/lib/producer/prices";
import { appendMessages, loadMessages, loadPrefs, openThread } from "@/lib/producer/store";
import { closeTail, visibleText, type StoredBlock, type StoredMessage } from "@/lib/producer/history";
import { buildStateNote, type StateFingerprint } from "@/lib/producer/state";
import { loadWatchBar, loadWatchList } from "@/lib/producer/watch";
import { runTool, toolStatus, type ToolCall } from "@/lib/producer/run-tools";
import type { PreparedSend } from "@/lib/producer/tools";
import { PLAN_CHAT_UNIT_LIMITS, type PlanId } from "@/lib/plans";
import { monthlyWindowStart } from "@/lib/generations/core";
import { classifyTurnFailure, unitsForFailedTurn, type TurnFailure } from "@/lib/agent/failures";
import { rateLimited } from "@/lib/rate-limit";

// The Producer's turn (2026-09-24) — Claude Opus 5.5 with four tools, for
// Elite (admins first). The chat route (api/agent/chat) is the model for the
// billing and the failure handling; what is different here, and why:
//
// A TOOL LOOP. Reading renders, looking at one, preparing sends and keeping
// notes are separate steps, so one turn is up to MAX_CALLS model calls. The
// cost is held under the reservation by the brake in producer/prices.ts: once
// the calls so far cost BRAKE_USD, the next call is told to answer without
// tools (tool_choice none), and so is the last one allowed.
//
// THE CONVERSATION LIVES ON THE SERVER, append-only (producer.sql). The
// browser sends only the new message. Opus 5.5 binds its thinking to the
// exact prefix of the conversation, so nothing already sent is ever changed:
// the system prompt and tools are the ones saved when the conversation began,
// and per-turn facts arrive as an app-written system message after the
// person's words (producer/state.ts).
//
// NEVER SPENDS. prepare_send hands the person a card; the composer's receipt
// and their own Send are the only way a credit moves.
//
// REFUSALS FALL BACK. `fallbacks: "default"` lets the API re-run a declined
// request on a model its routing picks, inside the same call; the turn is then
// priced at THAT model's rates (the answer's `model`). If the API ever rejects
// the parameter, the call is retried once without it rather than failing.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_MESSAGE_CHARS = 5000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const REFUSED_TEXT = "I can't help with that one. Ask me another way, or about something else.";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

type ApiMessage = Anthropic.Beta.Messages.BetaMessageParam;

function toApi(rows: StoredMessage[]): ApiMessage[] {
  return rows.map((m) => ({ role: m.role, content: m.content as ApiMessage["content"] }));
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  if (!(await isProducerEnabled(supabase))) {
    return NextResponse.json({ error: PRODUCER_UNAVAILABLE }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, plan_status, role, status, current_period_start")
    .eq("id", user.id)
    .single<{
      plan: PlanId | null;
      plan_status: string | null;
      role: string | null;
      status: string | null;
      current_period_start: string | null;
    }>();

  const isAdmin = profile?.role === "admin";
  const access = producerAllowed(profile, isAdmin || (await isProducerOpenToElite(supabase)));
  if (access.error) return NextResponse.json({ error: access.error }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { message?: unknown; page?: unknown; focus?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
  if (!message) return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });

  if (await rateLimited(user.id, "producer", 60, 10)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  // The same allowance the chat assistant draws on (one ledger, one unit).
  // Admins meter against Elite's, whatever test plan their account holds.
  const plan: PlanId = profile?.plan ?? "none";
  const cap = isAdmin ? PLAN_CHAT_UNIT_LIMITS.elite : PLAN_CHAT_UNIT_LIMITS[plan];
  const since = monthlyWindowStart(profile?.current_period_start).toISOString();
  const { data: reservationId, error: reserveError } = await admin.rpc("record_agent_units", {
    p_user_id: user.id,
    p_since: since,
    p_cap: cap,
    p_units: RESERVE_UNITS,
  });
  if (reserveError) {
    console.error("producer: budget check failed", reserveError.message);
    return NextResponse.json({ error: "The Producer is unavailable right now." }, { status: 503 });
  }
  if (!reservationId) {
    return NextResponse.json({ error: "You've used this period's assistant allowance." }, { status: 402 });
  }

  // Totals across every call of the turn, for the ledger.
  const totals = { cost: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0, lastCall: 0 };

  async function settle(outcome: "ok" | "aborted" | TurnFailure | "busy") {
    let units: number;
    let mode = "producer";
    if (outcome === "busy") {
      units = 0;
      mode = "producer-busy";
    } else if (totals.calls === 0) {
      if (outcome === "ok") units = 0;
      else if (outcome === "aborted") units = RESERVE_UNITS;
      else {
        units = unitsForFailedTurn(outcome);
        mode = outcome === "provider_unavailable" ? "unavailable" : "failed";
      }
    } else if (outcome === "aborted") {
      // A call was cut off mid-way: its tokens were spent and no usage came
      // back. Charged as one more call like the last, plus a full answer —
      // the safe direction, and still far under the 40-unit reservation.
      units = unitsForCostUsd(totals.cost + Math.max(totals.lastCall, 0.1) + (MAX_OUTPUT_TOKENS * 20) / 1_000_000);
    } else {
      units = unitsForCostUsd(totals.cost);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await admin
        .from("agent_usage")
        .update({
          mode,
          units,
          cost_usd: Number(totals.cost.toFixed(6)),
          input_tokens: totals.input,
          cache_read_tokens: totals.cacheRead,
          cache_write_tokens: totals.cacheWrite,
          output_tokens: totals.output,
        })
        .eq("id", reservationId);
      if (!error) return units;
      console.error("producer: settle write failed", { reservationId, attempt, error: error.message });
      await new Promise((r) => setTimeout(r, 300));
    }
    return units;
  }

  // ---- The conversation, and this turn's opening messages -----------------
  let thread: Awaited<ReturnType<typeof openThread>>;
  let rows: Awaited<ReturnType<typeof loadMessages>>;
  let prefs: Awaited<ReturnType<typeof loadPrefs>>;
  try {
    [thread, prefs] = await Promise.all([openThread(admin, user.id), loadPrefs(admin, user.id)]);
    rows = await loadMessages(admin, thread.id);
  } catch (err) {
    console.error("producer:", err);
    await settle("transient");
    return NextResponse.json({ error: "The Producer is unavailable right now." }, { status: 503 });
  }

  const stored: StoredMessage[] = rows.map((r) => ({ role: r.role, content: r.content }));
  const repairs = closeTail(stored);
  const lastState = [...rows].reverse().find((r) => r.role === "system")?.display?.fingerprint as
    | StateFingerprint
    | undefined;
  const watchBar = await loadWatchBar(supabase);
  const watch = await loadWatchList(supabase, user.id, prefs.watchSeenAt, watchBar);
  const state = await buildStateNote(supabase, {
    userId: user.id,
    name: prefs.name,
    page: body?.page,
    previous: lastState ?? null,
    watch,
    watchBar,
    focus: body?.focus,
  });

  const opening = [
    ...repairs.map((m) => ({ role: m.role, content: m.content, display: null })),
    { role: "user" as const, content: [{ type: "text", text: message }], display: { text: message } },
    { role: "system" as const, content: state.text, display: { kind: "state", fingerprint: state.fingerprint } },
  ];
  const nextSeq = rows.length > 0 ? rows[rows.length - 1].seq + 1 : 0;
  const opened = await appendMessages(admin, { threadId: thread.id, userId: user.id, fromSeq: nextSeq, messages: opening });
  if (!opened.ok) {
    await settle(opened.busy ? "busy" : "transient");
    return NextResponse.json(
      { error: opened.busy ? "Your Producer is still answering the last message." : "That didn't go through. Try again." },
      { status: opened.busy ? 409 : 503 },
    );
  }
  let seq = opened.nextSeq;
  const history: ApiMessage[] = toApi([...stored, ...opening.map((m) => ({ role: m.role, content: m.content as StoredBlock[] | string }))]);

  const client = new Anthropic();
  const upstream = new AbortController();
  const systemBlocks = thread.setup.system.map((text, i, all) => ({
    type: "text" as const,
    text,
    ...(i === all.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
  const tools = thread.setup.tools as Anthropic.Beta.Messages.BetaToolUnion[];

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(sse(event, data)));
        } catch {
          closed = true;
        }
      };

      const cards: PreparedSend[] = [];
      let notesChanged = false;
      let withFallbacks = true;
      let outcome: "ok" | "aborted" | TurnFailure = "ok";

      const call = async (answerNow: boolean) => {
        const run = () =>
          client.beta.messages.stream(
            {
              model: PRODUCER_MODEL,
              max_tokens: MAX_OUTPUT_TOKENS,
              thinking: { type: "adaptive" },
              // Set explicitly: Opus 5.5's default is medium, and a default is
              // a thing that moves under you. Constant for the whole
              // conversation — a top-level effort change resets the cache.
              output_config: { effort: "medium" },
              cache_control: { type: "ephemeral" },
              system: systemBlocks,
              tools,
              tool_choice: answerNow ? { type: "none" } : { type: "auto" },
              messages: history,
              ...(withFallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
            },
            { timeout: 120_000, maxRetries: 1, signal: upstream.signal },
          );

        let s = run();
        let sentText = false;
        const drain = async () => {
          for await (const event of s) {
            if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              send("status", { text: toolStatus(event.content_block.name) });
            } else if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta" &&
              event.delta.text
            ) {
              sentText = true;
              send("delta", { text: event.delta.text });
            }
          }
          return s.finalMessage();
        };
        try {
          return await drain();
        } catch (err) {
          const status = (err as { status?: number })?.status;
          const msg = err instanceof Error ? err.message : String(err);
          if (withFallbacks && !sentText && status === 400 && /fallback/i.test(msg)) {
            console.error("producer: retrying without fallbacks —", msg.slice(0, 200));
            withFallbacks = false;
            s = run();
            return await drain();
          }
          throw err;
        }
      };

      try {
        for (let i = 0; i < MAX_CALLS; i++) {
          const answerNow = i === MAX_CALLS - 1 || totals.cost >= BRAKE_USD;
          const answer = await call(answerNow);
          const usage = answer.usage as CallUsage;
          const callCost = costOfCallUsd(usage, answer.model);
          totals.cost += callCost;
          totals.lastCall = callCost;
          totals.calls += 1;
          totals.input += usage.input_tokens ?? 0;
          totals.cacheRead += usage.cache_read_input_tokens ?? 0;
          totals.cacheWrite += usage.cache_creation_input_tokens ?? 0;
          totals.output += usage.output_tokens ?? 0;

          if (answer.stop_reason === "refusal") {
            // Nothing of a refused answer is kept: it may be partial, and the
            // conversation should read as a clean decline.
            send("delta", { text: REFUSED_TEXT });
            await appendMessages(admin, {
              threadId: thread.id,
              userId: user.id,
              fromSeq: seq,
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: REFUSED_TEXT }],
                  display: { text: REFUSED_TEXT, cards },
                },
              ],
            });
            break;
          }

          const content = answer.content as unknown as StoredBlock[];
          const calls: ToolCall[] = content
            .filter((b) => b.type === "tool_use")
            .map((b) => ({ id: b.id as string, name: b.name as string, input: b.input }));

          if (answer.stop_reason === "tool_use" && calls.length > 0) {
            const outcomes = [];
            for (const c of calls) {
              const o = await runTool({ supabase, admin, userId: user.id }, c);
              if (o.card) {
                cards.push(o.card);
                send("card", o.card);
              }
              if (o.notesChanged) notesChanged = true;
              outcomes.push(o.result);
            }
            const results = { role: "user" as const, content: outcomes };
            const saved = await appendMessages(admin, {
              threadId: thread.id,
              userId: user.id,
              fromSeq: seq,
              messages: [
                { role: "assistant", content, display: null },
                { role: "user", content: outcomes, display: null },
              ],
            });
            if (!saved.ok) throw new Error(`producer: couldn't save the tool round — ${saved.error}`);
            seq = saved.nextSeq;
            history.push({ role: "assistant", content: content as ApiMessage["content"] });
            history.push(results as ApiMessage);
            continue;
          }

          const text = visibleText(content);
          if (answer.stop_reason === "max_tokens") send("delta", { text: "\n\n(I ran out of room there.)" });
          await appendMessages(admin, {
            threadId: thread.id,
            userId: user.id,
            fromSeq: seq,
            messages: [{ role: "assistant", content, display: { text, cards } }],
          });
          break;
        }
      } catch (err) {
        if (upstream.signal.aborted) {
          outcome = "aborted";
        } else {
          const status = (err as { status?: number })?.status;
          outcome = classifyTurnFailure(status, err instanceof Error ? err.message : String(err));
          console.error(`producer failed (${outcome}, status ${status ?? "none"}):`, err);
          send("error", {
            error:
              outcome === "provider_unavailable"
                ? "The Producer is unavailable right now."
                : "That didn't go through. Try again.",
          });
        }
      } finally {
        let units = 0;
        try {
          units = (await settle(outcome)) ?? 0;
        } catch (settleError) {
          console.error("producer: settle failed", settleError);
        }
        send("done", { units, notesChanged });
        if (!closed) controller.close();
      }
    },
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
