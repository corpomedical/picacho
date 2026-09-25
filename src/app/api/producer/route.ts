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
  speechCostUsd,
  transcribeCostUsd,
  unitsForCostUsd,
  type CallUsage,
} from "@/lib/producer/prices";
import { isHumanVoiceConfigured, isVoiceConfigured, readSpokenInput, speak, speakHuman, transcribe } from "@/lib/producer/speech";
import { sentenceChunker } from "@/lib/producer/sentences";
import { spotForTool } from "@/lib/producer/spots";
import { appendMessages, loadMessages, loadPrefs, loadProducerVoice, openThread } from "@/lib/producer/store";
import {
  TOP_LEVEL_EFFORT,
  closeTail,
  currentEffort,
  effortMessage,
  toApiMessage,
  visibleText,
  type Effort,
  type StoredBlock,
  type StoredMessage,
} from "@/lib/producer/history";
import { buildStateNote, type StateFingerprint } from "@/lib/producer/state";
import { loadWatchBar, loadWatchList } from "@/lib/producer/watch";
import { runTool, toolStatus, type ToolCall } from "@/lib/producer/run-tools";
import type { PreparedSend } from "@/lib/producer/tools";
import { PLAN_CHAT_UNIT_LIMITS, type PlanId } from "@/lib/plans";
import { monthlyWindowStart } from "@/lib/generations/core";
import { classifyTurnFailure, unitsForFailedTurn, type TurnFailure } from "@/lib/agent/failures";
import { rateLimited } from "@/lib/rate-limit";

// The Producer's turn (2026-09-24) — Claude Opus 5.5 with its tools, for
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
// VOICE (2026-09-25, operator: "OpenAI in + out"). A spoken message arrives
// as `audio` and is transcribed here, inside the turn, so its cost settles
// with the turn's. With `speak` on, the answer is read aloud sentence by
// sentence as it streams (lib/producer/sentences.ts) — each piece goes to
// text-to-speech the moment it is complete and plays in order on the device.
//
// A HUMAN VOICE, SOONER (2026-09-25, operator: "make it sound more human and
// make it faster at responses … lets change the voice character, its sounds
// ai"). The reply speaks with ElevenLabs (Turbo v2.5 on fal) in the voice the
// person picked (Settings), each piece carrying the words before it so the
// intonation runs on; OpenAI's voice is only the fallback. A spoken turn runs
// at low effort (history.ts says how, without losing the cache), and the
// conversation's reads run while the recording is still being transcribed.
//
// WHERE IT IS WORKING. Each tool call also sends a `spot` event naming the
// part of the page it concerns (composer, renders, one render, notes), so
// the sheet can light that part's bottom edge (lib/producer/spots.ts).
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
const EFFORT_BETA = "mid-conversation-output-config-2026-07-01";
const REFUSED_TEXT = "I can't help with that one. Ask me another way, or about something else.";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

type ApiMessage = Anthropic.Beta.Messages.BetaMessageParam;
type Turn = { role: "user" | "assistant" | "system"; content: unknown; display?: Record<string, unknown> | null };

// Effort messages are dropped when the per-turn effort beta is off (the retry
// below); the SDK's types don't know output_config on a message yet.
function toApi(turns: Turn[], withEffort: boolean): ApiMessage[] {
  return turns.map((t) => toApiMessage(t, withEffort)).filter((m) => m !== null) as unknown as ApiMessage[];
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

  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    page?: unknown;
    focus?: unknown;
    audio?: unknown;
    speak?: unknown;
  } | null;
  const spoken = readSpokenInput(body?.audio);
  if (spoken && "error" in spoken) return NextResponse.json({ error: spoken.error }, { status: 400 });
  if ((spoken || body?.speak === true) && !isVoiceConfigured()) {
    return NextResponse.json({ error: "Voice isn't set up on this server yet." }, { status: 503 });
  }
  let speakReplies = body?.speak === true;
  let message = typeof body?.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
  if (!message && !spoken) return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });

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

  // ---- The conversation's reads, started now ----------------------------------
  // They used to wait for the transcription; now they run alongside it (the
  // words are only needed for the turn itself). A failure surfaces below.
  const loading = (async () => {
    const [thread, prefs, watchBar, humanVoice] = await Promise.all([
      openThread(admin, user.id),
      loadPrefs(admin, user.id),
      loadWatchBar(supabase),
      loadProducerVoice(admin, user.id).catch(() => null),
    ]);
    const [rows, watch] = await Promise.all([
      loadMessages(admin, thread.id),
      loadWatchList(supabase, user.id, prefs.watchSeenAt, watchBar),
    ]);
    return { thread, prefs, watchBar, humanVoice, rows, watch };
  })();
  loading.catch(() => {}); // awaited below; the transcription may return first

  // ---- A spoken message becomes words first ---------------------------------
  if (spoken) {
    try {
      message = (await transcribe(spoken.input)).slice(0, MAX_MESSAGE_CHARS);
      totals.cost += transcribeCostUsd(spoken.input.seconds);
    } catch {
      await settle("transient");
      return NextResponse.json({ error: "Couldn't make out the recording. Try again." }, { status: 502 });
    }
    if (!message) {
      // Nothing was said: the recording cost fractions of a cent and no model
      // ran, so no units are charged (settle "ok" with no calls = 0).
      await settle("ok");
      return NextResponse.json({ heard: "" }, { status: 200 });
    }
  }

  // ---- The conversation, and this turn's opening messages -----------------
  let loaded: Awaited<typeof loading>;
  try {
    loaded = await loading;
  } catch (err) {
    console.error("producer:", err);
    await settle("transient");
    return NextResponse.json({ error: "The Producer is unavailable right now." }, { status: 503 });
  }
  const { thread, prefs, watchBar, humanVoice, rows, watch } = loaded;

  const stored: StoredMessage[] = rows.map((r) => ({ role: r.role, content: r.content }));
  const repairs = closeTail(stored);
  const lastState = [...rows].reverse().find((r) => r.role === "system" && r.display?.kind === "state")?.display
    ?.fingerprint as StateFingerprint | undefined;
  const state = await buildStateNote(supabase, {
    userId: user.id,
    name: prefs.name,
    page: body?.page,
    previous: lastState ?? null,
    watch,
    watchBar,
    focus: body?.focus,
    spoken: Boolean(spoken) || speakReplies,
  });

  // Talking out loud runs at low effort — the first word sooner; typing at
  // the usual medium. Only a CHANGE is written (history.ts).
  const wantEffort: Effort = spoken || speakReplies ? "low" : TOP_LEVEL_EFFORT;
  const opening = [
    ...repairs.map((m) => ({ role: m.role, content: m.content, display: null })),
    ...(wantEffort !== currentEffort(rows) ? [effortMessage(wantEffort)] : []),
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
  const turns: Turn[] = [...rows, ...opening];

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

      if (spoken) send("heard", { text: message });

      // Read-aloud: sentences go to speech as they complete and are sent in
      // order. The human voice first, each piece told what was said before it;
      // if it fails, that piece and the rest of the answer use OpenAI's voice —
      // a change of voice beats a silence. Both failing stops the voice for
      // the rest of the turn; the words are still on screen.
      const chunker = sentenceChunker();
      let voiceChain: Promise<void> = Promise.resolve();
      let voiceIndex = 0;
      let voiceBroken = false;
      let humanBroken = !humanVoice || !isHumanVoiceConfigured();
      let saidSoFar = "";
      type Speech = { kind: "human"; url: string } | { kind: "openai"; data: string };
      const synth = async (piece: string, before: string): Promise<Speech | null> => {
        if (!humanBroken && humanVoice) {
          try {
            return { kind: "human", url: await speakHuman(piece, humanVoice.elevenLabsVoiceId, before) };
          } catch {
            humanBroken = true;
          }
        }
        if (!isVoiceConfigured()) return null;
        try {
          return { kind: "openai", data: await speak(piece) };
        } catch {
          return null;
        }
      };
      const say = (pieces: string[]) => {
        if (!speakReplies) return;
        for (const piece of pieces) {
          const index = voiceIndex++;
          const before = saidSoFar;
          saidSoFar = before ? `${before} ${piece}` : piece;
          const job = voiceBroken ? Promise.resolve(null) : synth(piece, before);
          voiceChain = voiceChain.then(async () => {
            const audio = await job;
            if (!audio || upstream.signal.aborted) {
              voiceBroken = true;
              return;
            }
            totals.cost += speechCostUsd(piece.length, audio.kind);
            send("audio", audio.kind === "human" ? { index, url: audio.url } : { index, data: audio.data });
          });
        }
      };
      const speakText = (text: string) => say(chunker.push(text));

      const cards: PreparedSend[] = [];
      let notesChanged = false;
      let withFallbacks = true;
      let withEffort = true;
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
              // conversation — a top-level effort change resets the cache; a
              // spoken turn moves it with an effort message instead.
              output_config: { effort: TOP_LEVEL_EFFORT },
              cache_control: { type: "ephemeral" },
              system: systemBlocks,
              tools,
              tool_choice: answerNow ? { type: "none" } : { type: "auto" },
              messages: toApi(turns, withEffort),
              betas: [...(withFallbacks ? [FALLBACK_BETA] : []), ...(withEffort ? [EFFORT_BETA] : [])],
              ...(withFallbacks ? { fallbacks: "default" as const } : {}),
            },
            { timeout: 120_000, maxRetries: 1, signal: upstream.signal },
          );

        let s = run();
        let sentText = false;
        const drain = async () => {
          for await (const event of s) {
            if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              send("status", { text: toolStatus(event.content_block.name) });
              const spot = spotForTool(event.content_block.name);
              if (spot) send("spot", { spot });
            } else if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta" &&
              event.delta.text
            ) {
              sentText = true;
              send("delta", { text: event.delta.text });
              speakText(event.delta.text);
            }
          }
          return s.finalMessage();
        };
        // A 400 naming one of the two betas: once more without it, rather
        // than failing the turn. Without the effort beta the turn runs at
        // the top level (medium) — slower to start, never broken.
        for (;;) {
          try {
            return await drain();
          } catch (err) {
            const status = (err as { status?: number })?.status;
            const msg = err instanceof Error ? err.message : String(err);
            if (!sentText && status === 400 && withFallbacks && /fallback/i.test(msg)) {
              console.error("producer: retrying without fallbacks —", msg.slice(0, 200));
              withFallbacks = false;
              s = run();
              continue;
            }
            if (!sentText && status === 400 && withEffort && /effort|output_config|mid-conversation/i.test(msg)) {
              console.error("producer: retrying without the per-turn effort —", msg.slice(0, 200));
              withEffort = false;
              s = run();
              continue;
            }
            throw err;
          }
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
            speakText(REFUSED_TEXT);
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
              if (c.name === "look_at_render") {
                const id = (c.input as { render_id?: unknown } | null)?.render_id;
                if (typeof id === "string") send("spot", { spot: "render", id });
              }
              const o = await runTool({ supabase, admin, userId: user.id }, c);
              if (o.card) {
                cards.push(o.card);
                send("card", o.card);
                send("spot", { spot: "composer" });
              }
              if (o.notesChanged) notesChanged = true;
              if (o.voice) {
                // Muting stops the rest of this answer being spoken too; an
                // ending still plays the goodbye, then the device closes.
                if (o.voice === "mute_replies") speakReplies = false;
                if (o.voice === "unmute_replies") speakReplies = true;
                send("voice", { action: o.voice });
              }
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
            turns.push({ role: "assistant", content }, results);
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
        // The last words, then every queued piece of speech, before the turn
        // is settled — their cost belongs to it.
        say(chunker.flush());
        try {
          await voiceChain;
        } catch {
          // A voice failure never fails the turn.
        }
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
