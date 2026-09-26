import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  isProducerEnabled,
  isProducerOpenToElite,
  producerAllowed,
  producerUnitCap,
  readProducerGrant,
  PRODUCER_UNAVAILABLE,
} from "@/lib/producer/enabled";
import {
  BRAKE_USD,
  MAX_CALLS,
  MAX_OUTPUT_TOKENS,
  PRODUCER_MODEL,
  RESERVE_UNITS,
  costOfCallUsd,
  gateCostUsd,
  speechCostUsd,
  transcribeCostUsd,
  unitsForCostUsd,
  type CallUsage,
} from "@/lib/producer/prices";
import {
  MAX_AUDIO_BYTES,
  isHumanVoiceConfigured,
  isVoiceConfigured,
  readSpokenInput,
  speak,
  speakHuman,
  transcribeHeard,
  type SpokenInput,
} from "@/lib/producer/speech";
import { gateSignals, judgeSpoken, type Verdict } from "@/lib/producer/gate";
import { sentenceChunker } from "@/lib/producer/sentences";
import { spotForTool } from "@/lib/producer/spots";
import { DEFAULT_PRODUCER_NAME, appendMessages, loadMessages, loadPrefs, loadProducerVoice, openThread } from "@/lib/producer/store";
import {
  CUT_MARK,
  INTERRUPTED_ANSWER,
  TOP_LEVEL_EFFORT,
  answerPending,
  closeTail,
  currentEffort,
  effortMessage,
  lastAnswerCut,
  recentLines,
  secondsSinceAssistant,
  toApiMessage,
  unansweredBefore,
  visibleText,
  type Effort,
  type StoredBlock,
  type StoredMessage,
} from "@/lib/producer/history";
import { buildStateNote, type StateFingerprint } from "@/lib/producer/state";
import { loadWatchBar, loadWatchList } from "@/lib/producer/watch";
import { runTool, toolStatus, type ToolCall } from "@/lib/producer/run-tools";
import type { PreparedSend } from "@/lib/producer/tools";
import type { PlanId } from "@/lib/plans";
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
// Recordings said in a row, answered as one message (the sheet sends them
// together when an answer was cut off by the next one).
const MAX_RECORDINGS = 4;
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
  // An admin's grant (profiles.producer_access), read on its own: before
  // producer-access.sql runs it reads as not granted.
  const granted = !isAdmin && profile ? await readProducerGrant(admin, user.id) : false;
  const access = producerAllowed(
    profile ? { ...profile, producer_access: granted } : profile,
    isAdmin || granted || (await isProducerOpenToElite(supabase)),
  );
  if (access.error) return NextResponse.json({ error: access.error }, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    page?: unknown;
    focus?: unknown;
    audio?: unknown;
    speak?: unknown;
    heard?: unknown;
    interrupting?: unknown;
    nearness?: unknown;
    /** What the sheet calls it: only a spelling hint for the transcriber. */
    name?: unknown;
    /** They talked over her and kept going after she went quiet (the sheet's barge-in held). */
    talkedOver?: unknown;
  } | null;
  // One recording, or several said in a row while an answer was under way
  // (2026-09-25, "several questions at once"): each is transcribed and they
  // are answered as one message, in the order they were said.
  const rawAudio = Array.isArray(body?.audio) ? body.audio.slice(0, MAX_RECORDINGS) : body?.audio ? [body.audio] : [];
  const spokenParts: SpokenInput[] = [];
  for (const raw of rawAudio) {
    const read = readSpokenInput(raw);
    if (read && "error" in read) return NextResponse.json({ error: read.error }, { status: 400 });
    if (read) spokenParts.push(read.input);
  }
  if (spokenParts.reduce((n, part) => n + part.bytes.length, 0) > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "That was too long. Keep it under a minute." }, { status: 400 });
  }
  const spoken = spokenParts.length > 0;
  if ((spoken || body?.speak === true) && !isVoiceConfigured()) {
    return NextResponse.json({ error: "Voice isn't set up on this server yet." }, { status: 503 });
  }
  let speakReplies = body?.speak === true;
  let message = typeof body?.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
  if (!message && !spoken) return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });
  // They cut in while the last answer was being read aloud: the part they
  // heard, as the sheet played it (absent when nothing was cut off).
  const heard = typeof body?.heard === "string" ? body.heard.slice(0, 4000) : null;

  // Recordings are counted apart from turns: the open mic sends whatever it
  // hears, and a burst of noise must not use up the person's turns. Turns
  // (words that reach the model) are limited below, once there are words.
  if (await rateLimited(user.id, spoken ? "producer-rec" : "producer", 60, spoken ? 30 : 10)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  // The same allowance the chat assistant draws on (one ledger, one unit).
  // Admins and granted accounts meter against Elite's, whatever plan the
  // account holds (producerUnitCap).
  const plan: PlanId = profile?.plan ?? "none";
  const cap = producerUnitCap(access, plan);
  const since = monthlyWindowStart(profile?.current_period_start).toISOString();
  const { data: reservationId, error: reserveError } = await admin.rpc("record_agent_units", {
    p_user_id: user.id,
    p_since: since,
    p_cap: cap,
    p_units: RESERVE_UNITS,
  });
  if (reserveError) {
    console.error("producer: budget check failed", reserveError.message);
    return NextResponse.json({ error: "Your assistant is unavailable right now." }, { status: 503 });
  }
  if (!reservationId) {
    return NextResponse.json({ error: "You've used this period's assistant allowance." }, { status: 402 });
  }

  // Totals across every call of the turn, for the ledger.
  const totals = { cost: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0, lastCall: 0 };
  // Whether a model call was started (a turn cut off before one ran cost
  // only its transcription).
  let modelStarted = false;
  // The call under way, as its first event reports it (what it read, cached
  // or not): a call cut off or dropped never sends its final usage, and this
  // is what it cost to start. Recorded on the ledger; what is charged for a
  // cut-off call is set in settle().
  let cutCall: CallUsage | null = null;

  async function settle(outcome: "ok" | "aborted" | TurnFailure | "busy" | "ignored") {
    let units: number;
    let mode = "producer";
    if (outcome === "busy") {
      units = 0;
      mode = "producer-busy";
    } else if (outcome === "ignored") {
      // Heard, judged not said to the Producer, dropped (gate.ts): its
      // transcription, the judgement and a cut-short call are ours to carry
      // (the call's start is on the ledger; after one of these, the next
      // recordings are judged before any call — see recentlyIgnored).
      units = 0;
      mode = "producer-ignored";
    } else if (totals.calls === 0) {
      if (outcome === "ok") units = 0;
      else if (outcome === "aborted") {
        // Cut off during its first call (the person said something else, the
        // usual case in a spoken conversation). It used to be charged the
        // whole reservation (40 units, $0.80). A first call reads the cached
        // conversation and writes a little before a person cuts in — about
        // $0.02-0.04 at Opus 5.5's rates (prices.ts) — so it is charged a
        // generous $0.06 on top of what the turn already cost: 3-4 units.
        units = modelStarted ? unitsForCostUsd(totals.cost + 0.06) : 0;
      } else {
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
    const cut = cutCall;
    const ledger = cut
      ? {
          cost: totals.cost + costOfCallUsd(cut, PRODUCER_MODEL),
          input: totals.input + (cut.input_tokens ?? 0),
          cacheRead: totals.cacheRead + (cut.cache_read_input_tokens ?? 0),
          cacheWrite: totals.cacheWrite + (cut.cache_creation_input_tokens ?? 0),
          output: totals.output + (cut.output_tokens ?? 0),
        }
      : totals;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await admin
        .from("agent_usage")
        .update({
          mode,
          units,
          cost_usd: Number(ledger.cost.toFixed(6)),
          input_tokens: ledger.input,
          cache_read_tokens: ledger.cacheRead,
          cache_write_tokens: ledger.cacheWrite,
          output_tokens: ledger.output,
        })
        .eq("id", reservationId);
      if (!error) return units;
      console.error("producer: settle write failed", { reservationId, attempt, error: error.message });
      await new Promise((r) => setTimeout(r, 300));
    }
    return units;
  }

  // Background was heard lately (a recording judged not for the Producer in
  // the last two minutes): the TV is probably still on, so the next
  // recordings are judged before any model call rather than alongside it.
  // Bounds what dropped words can cost to about one cut-short call every two
  // minutes, however long the mic stays open beside a loud room.
  const recentlyIgnored: Promise<boolean> =
    spoken && body?.interrupting !== true
      ? (async () => {
          const { data } = await admin
            .from("agent_usage")
            .select("id")
            .eq("user_id", user.id)
            .eq("mode", "producer-ignored")
            .gte("created_at", new Date(Date.now() - 120_000).toISOString())
            .limit(1);
          return (data?.length ?? 0) > 0;
        })().catch(() => false)
      : Promise.resolve(false);

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
  // The transcriber is told the words to expect: the product, what the person
  // calls the Producer and their characters' names (read now, waited for at
  // most a moment so the transcription never waits long for them).
  let confidence: number | null = null;
  // Only a spelling hint for this person's own recording: what their sheet
  // shows as its name.
  const nameHint =
    typeof body?.name === "string"
      ? body.name.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 24)
      : "";
  if (spoken) {
    const soon = <T,>(p: Promise<T>, fallback: T) =>
      Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), 300))]);
    const [names, assistantName] = await Promise.all([
      soon(
        (async () => {
          const { data } = await admin
            .from("character_profiles")
            .select("name")
            .eq("user_id", user.id)
            .order("updated_at", { ascending: false })
            .limit(20);
          return (data ?? []).map((r) => String((r as { name?: unknown }).name ?? ""));
        })(),
        [] as string[],
      ),
      // The name they call it, from their settings when those load in time,
      // else the one the sheet shows (sent with the recording), else the
      // default: a name left out of the prompt comes back "Allie" (tested
      // 2026-09-26: English 3/3 "Aly" with the name, 0/3 without).
      soon(loading.then((l) => l.prefs.name), nameHint || DEFAULT_PRODUCER_NAME),
    ]);
    try {
      const heardParts = await Promise.all(
        spokenParts.map((part) => transcribeHeard(part, { assistant: assistantName, names })),
      );
      message = heardParts
        .map((h) => h.text)
        .filter(Boolean)
        .join(" ")
        .slice(0, MAX_MESSAGE_CHARS);
      const sure = heardParts.map((h) => h.confidence).filter((c): c is number => c !== null);
      confidence = sure.length ? sure.reduce((a, b) => a + b, 0) / sure.length : null;
      for (const part of spokenParts) totals.cost += transcribeCostUsd(part.seconds);
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

  // The person moved on while this was being transcribed (they said
  // something else, or closed the sheet): nothing is written, no model ran.
  if (request.signal.aborted) {
    await settle("ok");
    return new Response(null, { status: 499 });
  }

  // ---- The conversation, and this turn's opening messages -----------------
  let loaded: Awaited<typeof loading>;
  try {
    loaded = await loading;
  } catch (err) {
    console.error("producer:", err);
    await settle("transient");
    return NextResponse.json({ error: "Your assistant is unavailable right now." }, { status: 503 });
  }
  const { thread, prefs, watchBar, humanVoice, watch } = loaded;
  let rows = loaded.rows;

  // What they heard of her last answer, as the sheet reports it — used only
  // when it IS her last answer's words (it goes into the app's own note, so
  // text that isn't hers is never passed on).
  const squash = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const heardOf = (rs: typeof rows): string | null => {
    if (heard === null) return null;
    if (!heard.trim()) return "";
    const last = [...rs].reverse().find((r) => r.role === "assistant" && typeof r.display?.text === "string");
    const said = last ? squash(String(last.display?.text)) : "";
    return said && said.includes(squash(heard)) ? heard : null;
  };
  const noteFor = (rs: typeof rows) => {
    const lastState = [...rs].reverse().find((r) => r.role === "system" && r.display?.kind === "state")?.display
      ?.fingerprint as StateFingerprint | undefined;
    return buildStateNote(supabase, {
      userId: user.id,
      name: prefs.name,
      page: body?.page,
      previous: lastState ?? null,
      watch,
      watchBar,
      focus: body?.focus,
      spoken: spoken || speakReplies,
      // Nothing they said is dropped (history.ts): what never got an answer
      // comes back with this turn, and a cut-off answer is named — by what
      // they heard when the sheet says, else by how far it got.
      unanswered: unansweredBefore(rs),
      heard: heardOf(rs),
      cutAnswer: heardOf(rs) === null ? lastAnswerCut(rs) : null,
    });
  };
  // Talking out loud runs at low effort — the first word sooner; typing at
  // the usual medium. Only a CHANGE is written (history.ts).
  const wantEffort: Effort = spoken || speakReplies ? "low" : TOP_LEVEL_EFFORT;
  const openingFor = (rs: typeof rows, state: Awaited<ReturnType<typeof noteFor>>) => {
    const stored: StoredMessage[] = rs.map((r) => ({ role: r.role, content: r.content }));
    return [
      ...closeTail(stored).map((m) => ({ role: m.role, content: m.content, display: null })),
      ...(wantEffort !== currentEffort(rs) ? [effortMessage(wantEffort)] : []),
      { role: "user" as const, content: [{ type: "text", text: message }], display: { text: message } },
      { role: "system" as const, content: state.text, display: { kind: "state", fingerprint: state.fingerprint } },
    ];
  };
  const seqAfter = (rs: typeof rows) => (rs.length > 0 ? rs[rs.length - 1].seq + 1 : 0);

  // ---- Was it said to the Producer? (spoken messages, gate.ts) ---------------
  // Spoken OVER an answer, it is judged first: only a message for the
  // Producer stops that answer (a word from the TV doesn't cost it). Any other
  // spoken message is judged alongside the turn's first model call, with
  // everything that call would show, say or save held until the verdict — so
  // a message that is for the Producer waits for nothing.
  const interrupting = spoken && body?.interrupting === true;
  const nearness =
    typeof body?.nearness === "number" && Number.isFinite(body.nearness) ? Math.max(0, Math.min(4, body.nearness)) : null;
  const talkedOver = spoken && body?.talkedOver === true;
  // An admin sees why a spoken message was let be (on the "Not for me" note),
  // so a wrong call can be read off a screenshot: the judge's own signals.
  const ignoredEvent = () => {
    if (!isAdmin) return { text: message };
    const sig = gateSignals({ confidence, nearness, whileAnswering: interrupting || answerPending(rows), talkedOver });
    return {
      text: message,
      why: [
        `loud: ${sig.loud.replace(/ \(.*\)$/, "")}`,
        `transcriber sure: ${sig.sure}`,
        sig.whileAnswering ? "while answering" : null,
        sig.talkedOver ? "talked over" : null,
        interrupting && heard ? "had her words" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  };
  const verdict: Promise<Verdict> = spoken
    ? judgeSpoken(
        {
          name: prefs.name,
          recent: recentLines(rows),
          words: message,
          confidence,
          nearness,
          whileAnswering: interrupting || answerPending(rows),
          sinceAssistant: secondsSinceAssistant(rows, Date.now()),
          // What she had said aloud of the answer they cut into (the sheet's
          // report): her own voice caught by the mic can then be told from
          // theirs. Only this request's judge reads it.
          herWords: interrupting && heard ? heard.slice(-600) : null,
          talkedOver,
        },
        { signal: request.signal },
      ).then((j) => {
        totals.cost += gateCostUsd(j.usage.input, j.usage.output);
        return j.verdict;
      })
    : Promise.resolve("to_producer");

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
      const emit = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(sse(event, data)));
        } catch {
          closed = true;
        }
      };
      const finish = (units: number, notes = false) => {
        emit("done", { units, notesChanged: notes });
        if (!closed) controller.close();
      };
      // Held until a spoken message is known to be for the Producer.
      let holding = spoken && !interrupting;
      const held: [string, unknown][] = [];
      const send = (event: string, data: unknown) => {
        if (holding) held.push([event, data]);
        else emit(event, data);
      };

      if (interrupting) {
        const v = await verdict;
        // Withdrawn by the sheet while it was judged (merged into the next
        // recording), or not for the Producer: nothing is written or charged.
        if (v === "not_for_producer" || request.signal.aborted) {
          if (v === "not_for_producer") emit("ignored", ignoredEvent());
          finish(await settle("ignored").catch(() => 0));
          return;
        }
        if (await rateLimited(user.id, "producer", 60, 10)) {
          emit("error", { error: "Slow down a moment." });
          finish(await settle("busy").catch(() => 0));
          return;
        }
        if (request.signal.aborted) {
          finish(await settle("ignored").catch(() => 0));
          return;
        }
        // For the Producer: the sheet stops the answer this cut into, which
        // then saves how far it got; a moment is given for that to land.
        emit("heard", { text: message });
        for (let i = 0; i < 8 && answerPending(rows); i++) {
          await new Promise((r) => setTimeout(r, 150));
          rows = await loadMessages(admin, thread.id).catch(() => rows);
          // Withdrawn while that answer still runs: the sheet never took
          // this "heard" (taking it stops that answer), so it was merged into
          // the next recording — nothing is written, and that answer's save
          // isn't cut into.
          if (request.signal.aborted && answerPending(rows)) {
            finish(await settle("ignored").catch(() => 0));
            return;
          }
        }
      }

      // Judged first, before any thinking, when it sounds like background
      // (much quieter than the person, words the transcriber wasn't sure of,
      // or background heard lately): what the gate is likely to drop
      // shouldn't pay for a model call.
      if (
        holding &&
        ((nearness !== null && nearness < 0.5) || (confidence !== null && confidence < -0.7) || (await recentlyIgnored))
      ) {
        if ((await verdict) === "not_for_producer" || request.signal.aborted) {
          emit("ignored", ignoredEvent());
          finish(await settle("ignored").catch(() => 0));
          return;
        }
      }

      // This turn's opening: repairs, the words, the app's note. Written once
      // the message is known to be for the Producer; a clash means another
      // turn wrote first (the answer this cut off, saving how far it got), so
      // it reads again and goes after it rather than refuse what they said.
      let opening = openingFor(rows, await noteFor(rows));
      let turns: Turn[] = [...rows, ...opening];
      let seq = seqAfter(rows) + opening.length;
      let openFailure: "busy" | "transient" | "limited" | null = null;
      const writeOpening = async (retry: boolean): Promise<boolean> => {
        let result = await appendMessages(admin, { threadId: thread.id, userId: user.id, fromSeq: seqAfter(rows), messages: opening });
        // A retry rebuilds the opening from what landed first; while the
        // first call is already answering the old one (a spoken message
        // judged alongside it), that would store a history it never saw — so
        // then a clash fails safe instead.
        for (let attempt = 1; retry && !result.ok && result.busy && attempt <= 3; attempt++) {
          await new Promise((r) => setTimeout(r, 150 * attempt));
          try {
            rows = await loadMessages(admin, thread.id);
          } catch {
            break;
          }
          opening = openingFor(rows, await noteFor(rows));
          result = await appendMessages(admin, { threadId: thread.id, userId: user.id, fromSeq: seqAfter(rows), messages: opening });
        }
        if (!result.ok) {
          openFailure = result.busy ? "busy" : "transient";
          return false;
        }
        seq = result.nextSeq;
        turns = [...rows, ...opening];
        return true;
      };
      let rejected = false;
      let withdrawn = false;
      let pendingSpeech: string[] = [];
      let flushSpeech: () => void = () => {};
      const opened: Promise<boolean> = holding
        ? (async () => {
            send("heard", { text: message });
            if ((await verdict) === "not_for_producer") {
              rejected = true;
              upstream.abort();
              return false;
            }
            // Withdrawn by the sheet while it was judged (merged into the
            // next recording): nothing is written or charged.
            if (request.signal.aborted || upstream.signal.aborted) {
              withdrawn = true;
              upstream.abort();
              return false;
            }
            if (await rateLimited(user.id, "producer", 60, 10)) {
              openFailure = "limited";
              upstream.abort();
              return false;
            }
            if (request.signal.aborted || upstream.signal.aborted) {
              withdrawn = true;
              upstream.abort();
              return false;
            }
            const ok = await writeOpening(false);
            if (!ok) {
              upstream.abort();
              return false;
            }
            holding = false;
            for (const [e, d] of held) emit(e, d);
            held.length = 0;
            flushSpeech();
            return true;
          })()
        : writeOpening(true);
      opened.catch(() => {});
      const failureText = (f: typeof openFailure) =>
        f === "busy" ? "Still answering your last message." : f === "limited" ? "Slow down a moment." : "That didn't go through. Try again.";
      if (!holding && !(await opened)) {
        emit("error", { error: failureText(openFailure) });
        finish(await settle(openFailure === "transient" ? "transient" : "busy").catch(() => 0));
        return;
      }

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
      // Her own voice is tried twice before a piece falls back, and a fallback
      // is for that piece only: a second, different voice for the rest of the
      // answer was one of the tone changes the operator heard (2026-09-26,
      // "Her voice changes tones from sentence to sentence"). Two pieces in a
      // row failing both tries means the service is down: the rest falls back.
      let humanFailures = 0;
      let saidSoFar = "";
      type Speech = { kind: "human"; url: string } | { kind: "openai"; data: string };
      const synth = async (piece: string, before: string, after: string): Promise<Speech | null> => {
        if (!humanBroken && humanVoice) {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const url = await speakHuman(piece, humanVoice.elevenLabsVoiceId, before, after);
              humanFailures = 0;
              return { kind: "human", url };
            } catch {
              // once more, then this piece falls back
            }
          }
          if (++humanFailures >= 2) humanBroken = true;
        }
        if (!isVoiceConfigured()) return null;
        try {
          return { kind: "openai", data: await speak(piece) };
        } catch {
          return null;
        }
      };
      // Each piece after the first waits a moment for the words after it
      // (the voice's next_text), so it isn't read as the end of the answer.
      // The first plays at once, told what has arrived after it so far; a
      // later one waits for the next piece, at most HOLD_FOR_NEXT_MS — while
      // the piece before it is still playing, so it adds no silence.
      const HOLD_FOR_NEXT_MS = 350;
      let heldPiece: string | null = null;
      let heldTimer: ReturnType<typeof setTimeout> | null = null;
      const releaseHeld = (after?: string) => {
        if (heldTimer) clearTimeout(heldTimer);
        heldTimer = null;
        if (heldPiece === null) return;
        const piece = heldPiece;
        heldPiece = null;
        speakPiece(piece, after ?? chunker.pending());
      };
      const say = (pieces: string[]) => {
        if (!speakReplies) return;
        if (holding) {
          // Not yet known to be for the Producer: nothing is spoken (or paid
          // for) until it is.
          pendingSpeech.push(...pieces);
          return;
        }
        pieces.forEach((piece, i) => {
          const next = pieces[i + 1];
          if (voiceIndex === 0 && heldPiece === null) {
            speakPiece(piece, next ?? chunker.pending());
            return;
          }
          releaseHeld(piece);
          if (next !== undefined) {
            speakPiece(piece, next);
            return;
          }
          heldPiece = piece;
          heldTimer = setTimeout(() => releaseHeld(), HOLD_FOR_NEXT_MS);
        });
      };
      // Everything said so far goes: before a lookup (her words mustn't wait
      // through it) and at the end of the answer.
      const sayAllNow = () => {
        say(chunker.flush());
        releaseHeld("");
      };
      function speakPiece(piece: string, after: string) {
        // Cut off while a piece waited for the words after it: never voiced (or paid for).
        if (upstream.signal.aborted) return;
        {
          const index = voiceIndex++;
          const before = saidSoFar;
          saidSoFar = before ? `${before} ${piece}` : piece;
          const job = voiceBroken ? Promise.resolve(null) : synth(piece, before, after);
          voiceChain = voiceChain.then(async () => {
            const audio = await job;
            if (!audio || upstream.signal.aborted) {
              voiceBroken = true;
              return;
            }
            totals.cost += speechCostUsd(piece.length, audio.kind);
            // The piece's words ride along, so the sheet knows what was said
            // aloud before the person cut in.
            send(
              "audio",
              audio.kind === "human" ? { index, url: audio.url, text: piece } : { index, data: audio.data, text: piece },
            );
          });
        }
      }
      const speakText = (text: string) => say(chunker.push(text));
      flushSpeech = () => {
        const pieces = pendingSpeech;
        pendingSpeech = [];
        say(pieces);
      };

      const cards: PreparedSend[] = [];
      // What the person has been shown this turn: the text of each finished
      // round (a model often answers part of the question, then looks
      // something up), and of the call under way.
      const shown: string[] = [];
      let callText = "";
      let notesChanged = false;
      let withFallbacks = true;
      let withEffort = true;
      let outcome: "ok" | "aborted" | "ignored" | "busy" | TurnFailure = "ok";

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

        // Cut off already (withdrawn, dropped or stopped): no call is started,
        // so none is charged.
        if (upstream.signal.aborted) throw new Error("producer: cut off before the call");
        modelStarted = true;
        cutCall = null;
        callText = "";
        // A new round after one that already said something starts on a new
        // paragraph, on screen as in the saved answer.
        let separate = shown.length > 0;
        let s = run();
        let sentText = false;
        const drain = async () => {
          for await (const event of s) {
            if (event.type === "message_start") {
              cutCall = event.message.usage as CallUsage;
            } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              // What she said before looking something up is spoken now,
              // not after the lookup.
              sayAllNow();
              send("status", { text: toolStatus(event.content_block.name) });
              const spot = spotForTool(event.content_block.name);
              if (spot) send("spot", { spot });
            } else if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta" &&
              event.delta.text
            ) {
              sentText = true;
              if (separate) {
                send("delta", { text: "\n\n" });
                separate = false;
              }
              callText += event.delta.text;
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
          cutCall = null;
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
            if (!(await opened)) throw new Error("producer: not opened");
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
            if (!(await opened)) throw new Error("producer: not opened");
            const outcomes = [];
            // Sets changed this round: the copy each replaced rides in the
            // round's record (never sent to the model), for undo_set_change.
            const setChanges: { setId: string; before: unknown }[] = [];
            for (const c of calls) {
              // Cut off while the tools run: stop here, so this turn writes
              // nothing after the message that cut it off.
              if (upstream.signal.aborted) throw new Error("producer: cut off during the tool round");
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
              if (o.setChange) {
                setChanges.push(o.setChange);
                send("set_changed", { setId: o.setChange.setId });
              }
              if (o.voice) {
                // Muting stops the rest of this answer being spoken too; an
                // ending still plays the goodbye, then the device closes.
                if (o.voice === "mute_replies") speakReplies = false;
                if (o.voice === "unmute_replies") speakReplies = true;
                send("voice", { action: o.voice });
              }
              outcomes.push(o.result);
            }
            if (upstream.signal.aborted) throw new Error("producer: cut off during the tool round");
            if (!(await opened)) throw new Error("producer: not opened");
            const results = { role: "user" as const, content: outcomes };
            const roundText = visibleText(content);
            if (roundText) shown.push(roundText);
            callText = "";
            const saved = await appendMessages(admin, {
              threadId: thread.id,
              userId: user.id,
              fromSeq: seq,
              messages: [
                { role: "assistant", content, display: null },
                { role: "user", content: outcomes, display: setChanges.length ? { kind: "set_undo", changes: setChanges } : null },
              ],
            });
            if (!saved.ok) throw new Error(`producer: couldn't save the tool round — ${saved.error}`);
            seq = saved.nextSeq;
            turns.push({ role: "assistant", content }, results);
            continue;
          }

          const text = [...shown, visibleText(content)].filter(Boolean).join("\n\n");
          if (answer.stop_reason === "max_tokens") send("delta", { text: "\n\n(I ran out of room there.)" });
          if (!(await opened)) throw new Error("producer: not opened");
          const savedAnswer = await appendMessages(admin, {
            threadId: thread.id,
            userId: user.id,
            fromSeq: seq,
            messages: [{ role: "assistant", content, display: { text, cards } }],
          });
          // Shown and heard already, so not an error for the person; the next
          // turn's note will list the question as unanswered.
          if (!savedAnswer.ok) console.error("producer: couldn't save the answer —", savedAnswer.error);
          break;
        }
      } catch (err) {
        if (rejected || withdrawn) {
          outcome = "ignored";
        } else if (upstream.signal.aborted && !(await opened.catch(() => false))) {
          // Stopped before its opening was written (the verdict, the limit or
          // the write): nothing of it exists to close. Said below.
          outcome = openFailure ? (openFailure === "transient" ? "transient" : "busy") : "aborted";
        } else if (upstream.signal.aborted) {
          outcome = "aborted";
          // Cut off part-way: what was said so far is kept, as the person saw
          // it, so the conversation knows how far this answer got (the next
          // turn's note says so). Nothing said = nothing saved; the question
          // then comes back with the next turn as unanswered.
          const partial = callText.trim();
          const soFar = [...shown, partial].filter(Boolean).join("\n\n");
          if (soFar) {
            await appendMessages(admin, {
              threadId: thread.id,
              userId: user.id,
              fromSeq: seq,
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: `${partial || "…"}${CUT_MARK}` }],
                  display: { text: soFar, cards, cut: true },
                },
              ],
            }).catch(() => null);
          } else {
            // Nothing said: it closes its own tail now (the question comes
            // back with the next turn as unanswered), so the message that cut
            // it off needn't wait for it.
            await appendMessages(admin, {
              threadId: thread.id,
              userId: user.id,
              fromSeq: seq,
              messages: [{ role: "assistant", content: [{ type: "text", text: INTERRUPTED_ANSWER }], display: null }],
            }).catch(() => null);
          }
        } else {
          const status = (err as { status?: number })?.status;
          outcome = classifyTurnFailure(status, err instanceof Error ? err.message : String(err));
          console.error(`producer failed (${outcome}, status ${status ?? "none"}):`, err);
          send("error", {
            error:
              outcome === "provider_unavailable"
                ? "Your assistant is unavailable right now."
                : "That didn't go through. Try again.",
          });
        }
      } finally {
        // A spoken message's verdict and opening settle first: the model may
        // have failed, or finished, before the judge answered. Its error (held
        // until then) is shown only if the message turned out to be theirs.
        const accepted = await opened.catch(() => false);
        if (rejected || withdrawn) outcome = "ignored";
        else if (!accepted && openFailure) {
          holding = false;
          held.length = 0;
          emit("error", { error: failureText(openFailure) });
          if (outcome !== "transient") outcome = openFailure === "transient" ? "transient" : "busy";
        }
        if (outcome === "ignored") {
          // Not said to the Producer: nothing it held is shown or spoken.
          held.length = 0;
          pendingSpeech = [];
          holding = false;
          emit("ignored", ignoredEvent());
        } else {
          // The last words, then every queued piece of speech, before the
          // turn is settled — their cost belongs to it.
          sayAllNow();
          try {
            await voiceChain;
          } catch {
            // A voice failure never fails the turn.
          }
        }
        let units = 0;
        try {
          units = (await settle(outcome)) ?? 0;
        } catch (settleError) {
          console.error("producer: settle failed", settleError);
        }
        holding = false;
        finish(units, notesChanged);
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
