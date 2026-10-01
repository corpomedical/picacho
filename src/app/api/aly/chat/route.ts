import Anthropic from "@anthropic-ai/sdk";
import { modelForJob } from "@/lib/models/pick";
import { getModelControls } from "@/lib/models/controls";
import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { readProducerGrant } from "@/lib/producer/enabled";
import { runTool, toolStatus, type ToolCall } from "@/lib/producer/run-tools";
import { pageAccessReader } from "@/lib/producer/page-access";
import { cardsIn, type StartableCard } from "@/lib/producer/start-card";
import { startCardRender } from "@/lib/producer/start-render";
import { citedSources } from "@/lib/producer/sources";
import { sendableTools, type PreparedSend } from "@/lib/producer/tools";
import { loadPrefs } from "@/lib/producer/store";
import { PLAN_CHAT_UNIT_LIMITS, FREE_CHAT_UNIT_LIMIT, type PlanId } from "@/lib/plans";
import { monthlyWindowStart } from "@/lib/generations/core";
import { classifyTurnFailure, type TurnFailure } from "@/lib/agent/failures";
import { reserveAssistantUnits, settleAssistantTopUp } from "@/lib/agent/allowance";
import { rateLimited } from "@/lib/rate-limit";
import { isNativeApp } from "@/lib/native/server";
import { isAlyChatEnabled } from "@/lib/aly-chat/enabled";
import {
  BRAINS,
  BRAIN_LABEL,
  BRAKE_USD,
  EVERYDAY_BRAIN,
  LUNA_BRAKE_USD,
  MAX_OUTPUT,
  MAX_TOOL_ROUNDS,
  NO_USAGE,
  WEB_SEARCH_USD,
  addUsage,
  costUsd,
  fromClaude,
  isBrainChoice,
  modelFor,
  reserveUnits,
  routeBrain,
  unitsForCost,
  type Brain,
  type BrainChoice,
  type Usage,
} from "@/lib/aly-chat/brains";
import {
  castNote,
  fileIdsIn,
  toClaude,
  toGemini,
  toLuna,
  toOpenAI,
  type AssistantContent,
  type CastMember,
  type ClaudeMessage,
  type FileLoader,
  type Lane,
  type StoredRow,
  type UserContent,
} from "@/lib/aly-chat/history";
import { lightTurnNote, newChatSetup, plainSystem, turnNote, type ChatSetup } from "@/lib/aly-chat/prompt";
import { isDocTool, runDocTool, type Doc } from "@/lib/aly-chat/docs";
import { MAX_CHAT_FILE_BYTES, MAX_FILES_PER_MESSAGE } from "@/lib/aly-chat/file-types";
import { ProviderError, streamGemini, streamGpt } from "@/lib/aly-chat/providers";
import { lunaPrompt, lunaText, lunaTools, lunaTurn } from "@/lib/aly-chat/luna";
import {
  appendRow,
  createChat,
  docsStore,
  fileRefs,
  getChat,
  loadFiles,
  loadRows,
  memorySnapshot,
  projectSnapshot,
  setTitle,
} from "@/lib/aly-chat/store";

// Aly's own page: one turn (2026-09-29, operator: "a chat version where it
// works exactly as chatgpt and anthropic… give people what no one can").
//
// The model for the billing is api/agent/chat, and for the tool loop
// api/producer. What is different here:
//
// MANY CHATS, EACH APPEND-ONLY. A chat's system prompt and tools are saved
// when it starts (aly_chats.setup) and every message is appended, never
// changed (lib/aly-chat/history.ts says why: prompt caches and Opus 5.5's
// preserved thinking both need the exact same prefix every time).
//
// FOUR BRAINS. Luna (GPT-6 Luna, the everyday brain since 2026-10-01,
// lib/aly-chat/luna.ts) and Claude (Sonnet 5; "Think harder" = Opus 5.5, on
// Luna too) have Aly's hands: web search, memory, account, renders, prepared
// sends, Press Tour, documents, pages. GPT-6 Sol and Gemini 3.8 Flash answer
// from the conversation and its files. "Ask all three" runs Claude, GPT and
// Gemini at once; the person keeps one and the chat continues from it.
//
// ONE ALLOWANCE. Every turn draws on the plan's assistant allowance
// (PLAN_CHAT_UNIT_LIMITS, shared with the composer's chat and the lamp),
// reserved before the first call at the worst case and settled to the real
// cost after, on every exit path.
//
// NEVER SPENDS CREDITS. prepare_send gives the person a card; the composer's
// receipt and their own Send are the only way a credit moves.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_MESSAGE_CHARS = 60_000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const REFUSED_TEXT = "I can't help with that one. Ask me another way, or about something else.";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

type Body = {
  chatId?: unknown;
  projectId?: unknown;
  text?: unknown;
  fileIds?: unknown;
  brain?: unknown;
  harder?: unknown;
  timeZone?: unknown;
  /** Sent from Picacho Light's box: a new chat gets Light's setup (lib/aly-chat/light-prompt.ts). */
  light?: unknown;
  /** Light's own video engine and length, for her renders to cost what Light's would. */
  lightNote?: { video?: { model?: unknown; seconds?: unknown } | null } | null;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  if (!(await isAlyChatEnabled(supabase))) {
    return NextResponse.json({ error: "Chat isn't open right now." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const newFileIds = Array.isArray(body?.fileIds)
    ? [...new Set(body.fileIds.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))]
    : [];
  if (!text && newFileIds.length === 0) return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });
  if (text.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: `That message is too long (over ${MAX_MESSAGE_CHARS.toLocaleString("en")} characters). Attach it as a file instead.` }, { status: 400 });
  }
  if (newFileIds.length > MAX_FILES_PER_MESSAGE) {
    return NextResponse.json({ error: `Up to ${MAX_FILES_PER_MESSAGE} files a message.` }, { status: 400 });
  }
  let choice: BrainChoice = isBrainChoice(body?.brain) ? body.brain : EVERYDAY_BRAIN;
  let harder = body?.harder === true;

  if (await rateLimited(user.id, "aly-chat", 60, 12)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, plan_status, current_period_start, status, role")
    .eq("id", user.id)
    .single<{
      plan: PlanId | null;
      plan_status: string | null;
      current_period_start: string | null;
      status: string | null;
      role: string | null;
    }>();
  if (profile?.status === "suspended") {
    return NextResponse.json({ error: "Your account is suspended. Contact support if you think this is a mistake." }, { status: 403 });
  }

  // The same allowance rule as the composer's chat (api/agent/chat): a plan's
  // allowance only while the subscription is in good standing; a free account
  // meters a lifetime total; an admin or an account granted Aly has Elite's —
  // the lamp's rule (producerUnitCap). Without the admin half an admin with no
  // plan met the free lifetime 25 and every message came back 402.
  const plan: PlanId = profile?.plan ?? "none";
  const planActive = (profile?.plan_status ?? null) === null || profile?.plan_status === "active";
  const isFree = plan === "none" || !planActive;
  const granted = profile?.role === "admin" || (await readProducerGrant(admin, user.id));
  if (isFree && !granted) {
    // The free allowance is about a dozen everyday messages: thinking harder
    // or three brains at once would eat it in two.
    harder = false;
    if (choice === "all") choice = EVERYDAY_BRAIN;
  }
  // "Think harder" on Luna answers on Claude Opus 5.5, in Claude's lane (the
  // page sends it there already; this is the same rule, brains.ts).
  ({ choice, harder } = routeBrain(choice, harder, false));
  // A brain taken off the menu on Admin → Models answers as the everyday brain
  // (an open page can still send it); Ask all three asks the ones still on.
  const offBrains = (await getModelControls()).off.aly_brains ?? [];
  if (choice !== "all" && offBrains.includes(choice)) {
    choice = EVERYDAY_BRAIN;
    harder = false;
  }
  const cap = granted ? PLAN_CHAT_UNIT_LIMITS.elite : isFree ? FREE_CHAT_UNIT_LIMIT : PLAN_CHAT_UNIT_LIMITS[plan];
  const since = isFree && !granted ? new Date(0).toISOString() : monthlyWindowStart(profile?.current_period_start).toISOString();

  // ---- The chat -------------------------------------------------------------
  let chatId = typeof body?.chatId === "string" && /^[0-9a-f-]{36}$/i.test(body.chatId) ? body.chatId : null;
  let setup: ChatSetup;
  let isNew = false;
  if (chatId) {
    const chat = await getChat(admin, user.id, chatId);
    if (!chat || !chat.setup) return NextResponse.json({ error: "That chat isn't there any more." }, { status: 404 });
    setup = chat.setup;
  } else {
    const projectId = typeof body?.projectId === "string" && /^[0-9a-f-]{36}$/i.test(body.projectId) ? body.projectId : null;
    const [prefs, memory, project] = await Promise.all([
      loadPrefs(admin, user.id),
      memorySnapshot(admin, user.id).catch(() => ""),
      projectId ? projectSnapshot(supabase, user.id, projectId) : Promise.resolve(null),
    ]);
    setup = newChatSetup({ name: prefs.name, memory, project, light: body?.light === true });
    try {
      chatId = await createChat(admin, { userId: user.id, setup, projectId: project?.id ?? null });
    } catch (err) {
      console.error("aly-chat: create failed", err);
      return NextResponse.json({ error: "Chat isn't available right now." }, { status: 503 });
    }
    isNew = true;
  }
  const theChat = chatId;

  let rows: StoredRow[];
  try {
    rows = await loadRows(admin, theChat);
  } catch (err) {
    console.error("aly-chat: read failed", err);
    return NextResponse.json({ error: "Chat isn't available right now." }, { status: 503 });
  }

  // The files: this message's, and every earlier one's (each brain rereads
  // the whole conversation).
  const newRefs = await fileRefs(admin, user.id, newFileIds);
  if (newRefs.length !== newFileIds.length) {
    return NextResponse.json({ error: "A file is still uploading, or failed. Remove it and try again." }, { status: 400 });
  }
  const allIds = [...new Set([...fileIdsIn(rows), ...newRefs.map((r) => r.id)])];
  if (allIds.length > 0) {
    const { data: sizes } = await admin.from("aly_chat_files").select("bytes").eq("user_id", user.id).in("id", allIds);
    const total = (sizes ?? []).reduce((s, r) => s + (Number(r.bytes) || 0), 0);
    if (total > MAX_CHAT_FILE_BYTES) {
      return NextResponse.json(
        { error: "This chat holds as many files as it can. Start a new chat for these." },
        { status: 400 },
      );
    }
  }

  // ---- Reserve ----------------------------------------------------------------
  const reservedUnits = reserveUnits(choice, harder);
  const reserved = await reserveAssistantUnits(admin, { userId: user.id, since, cap, units: reservedUnits });
  if (!reserved.ok) {
    console.error("aly-chat: budget check failed", reserved.error);
    return NextResponse.json({ error: "Chat isn't available right now." }, { status: 503 });
  }
  if (!reserved.id) {
    const monthly = !isFree || granted;
    return NextResponse.json(
      {
        error: monthly
          ? "You've used this month's chat allowance."
          : "You've used the free chat allowance. Any paid plan includes more.",
        topUp: monthly && !(await isNativeApp()),
        chatId: isNew ? theChat : undefined,
      },
      { status: 402 },
    );
  }
  const reservationId = reserved.id;

  // ---- The person's message, saved first ----------------------------------------
  const timeZone = typeof body?.timeZone === "string" ? body.timeZone.slice(0, 64) : null;
  // In a Light chat a render she makes starts at once, except in a message
  // with files (a render can't take a photo from the chat): the note says
  // which, and the page follows the same rule (chat-view.tsx autoStartRenders).
  const lightStartsNow = setup.light === true && newRefs.length === 0;
  const lightNote = setup.light
    ? lightTurnNote({ files: newRefs.length, video: body?.lightNote && typeof body.lightNote === "object" ? body.lightNote.video : null })
    : "";
  // Their characters with ids, so prepare_send can attach one (history.ts
  // castNote: in full when the list changed since the last note in this chat).
  const cast = await loadCast(supabase, user.id);
  const userContent: UserContent = {
    text,
    files: newRefs,
    note: [turnNote(new Date(), timeZone), cast ? castNote(cast, rows) : "", lightNote].filter(Boolean).join("\n"),
  };
  const userSeq = (rows[rows.length - 1]?.seq ?? -1) + 1;
  const savedUser = await appendRow(admin, {
    chatId: theChat,
    userId: user.id,
    seq: userSeq,
    role: "user",
    brain: null,
    content: userContent,
  });
  if (!savedUser.ok) {
    await admin.from("agent_usage").update({ mode: "aly-chat-busy", units: 0 }).eq("id", reservationId);
    return NextResponse.json(
      { error: savedUser.busy ? "Still answering your last message." : "Chat isn't available right now." },
      { status: savedUser.busy ? 409 : 503 },
    );
  }
  rows = [...rows, { seq: userSeq, role: "user", content: userContent }];

  const loaded = await loadFiles(admin, user.id, [...rows.flatMap((r) => (r.role === "user" ? r.content.files : []))]);
  const load: FileLoader = (id) => loaded.get(id);

  const client = new Anthropic();
  const upstream = new AbortController();
  const pageAccess = pageAccessReader(supabase, user.id);
  const onBrains = BRAINS.filter((b) => !offBrains.includes(b));
  const lanes: readonly Brain[] = choice === "all" ? (onBrains.length ? onBrains : [EVERYDAY_BRAIN]) : [choice];

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
      send("meta", { chatId: theChat, seq: userSeq, lanes, harder, isNew });

      const cost = { usd: 0, usage: NO_USAGE as Usage, started: false };
      const docs: Doc[] = [];
      const cards: PreparedSend[] = [];
      // Hands-free (2026-10-01): start_render finds a card among this chat's
      // saved ones and this answer's, and starts it on the server
      // (start-render.ts). Not in Light, where prepare_send already starts it.
      const hands = setup.light
        ? undefined
        : {
            cards: () => [
              ...cardsIn(rows.map((r) => (r.role === "assistant" ? r.content : null)), "renders"),
              ...cardsIn([{ cards }], "cards"),
            ],
            startedThisTurn: [] as string[],
            start: (card: StartableCard) => startCardRender(supabase, user.id, { ...card, id: `${theChat}:${card.id}` }),
          };
      const results: Partial<Record<Brain, Lane>> = {};

      // ---- One tool call, from either brain with Aly's hands ------------------
      // Run by the route's own runners, with what it does on the page: a
      // document opens in the panel, a card appears, a page opens, a started
      // card follows its take. Returns what the brain is told.
      const runAlyTool = async (c: ToolCall): Promise<{ content: unknown; isError: boolean }> => {
        if (upstream.signal.aborted) throw new Error("aly-chat: stopped during the tool round");
        if (isDocTool(c.name)) {
          try {
            const o = await runDocTool(docsStore(admin, user.id, theChat), c.name, c.input);
            if (o.doc) {
              const i = docs.findIndex((d) => d.id === o.doc!.id);
              if (i >= 0) docs[i] = o.doc;
              else docs.push(o.doc);
              send("doc", o.doc);
            }
            return { content: o.text, isError: o.isError };
          } catch (err) {
            console.error("aly-chat: document tool failed", err);
            return { content: "The document couldn't be saved just now. Put it in the chat instead.", isError: true };
          }
        }
        const o = await runTool({ supabase, admin, userId: user.id, topUpUnits: reserved.topUp, pageAccess, hands }, c);
        if (o.card) {
          cards.push(o.card);
          send("card", o.card);
        }
        // open_page: the chat view hands it to the pointer, which opens the page (aly-pointer.tsx).
        if (o.navigate) send("navigate", o.navigate);
        if (o.started) {
          // This answer's card keeps its take when the answer is saved; an
          // earlier card's take is written onto its saved message, as the
          // card's own Make it does (linkRender), so a reload shows it.
          const mine = cards.find((k) => k.id === o.started!.cardId);
          if (mine) mine.generationId = o.started.generationId;
          else await rememberStarted(admin, user.id, theChat, rows, o.started.cardId, o.started.generationId);
          send("started", o.started);
        }
        // In Picacho Light the page starts the card's render the moment it
        // arrives (the person's own send, through runGeneration): Aly is
        // told so, not that it waits for a button.
        if (lightStartsNow && o.card && o.card.kind !== "ad") return { content: lightStartedText(o.card), isError: false };
        return { content: o.result.content, isError: o.result.is_error === true };
      };

      // ---- Claude, with Aly's tools ------------------------------------------
      const runClaude = async (): Promise<Lane> => {
        // Think harder stays Opus 5.5; the everyday Claude brain is the Models page's pick (aly_claude).
        const model = harder ? modelFor("claude", true) : await modelForJob("aly_claude");
        const maxTokens = MAX_OUTPUT[harder ? "harder" : "everyday"];
        const brake = BRAKE_USD[harder ? "harder" : "everyday"];
        const system = setup.system.map((t, i, all) => ({
          type: "text" as const,
          text: t,
          ...(i === all.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
        }));
        const tools = sendableTools(setup.tools as Anthropic.Beta.Messages.BetaToolUnion[]);
        const history = toClaude(rows, load);
        const turn: ClaudeMessage[] = [];
        let text = "";
        let laneCost = 0;
        let withFallbacks = true;
        const allContent: unknown[] = [];

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const answerNow = round === MAX_TOOL_ROUNDS - 1 || laneCost >= brake;
          const run = () =>
            client.beta.messages.stream(
              {
                model,
                max_tokens: maxTokens,
                thinking: { type: "adaptive" },
                output_config: { effort: harder ? "high" : "medium" },
                cache_control: { type: "ephemeral" },
                system,
                tools,
                tool_choice: answerNow ? { type: "none" } : { type: "auto" },
                messages: [...history, ...turn] as Anthropic.Beta.Messages.BetaMessageParam[],
                betas: withFallbacks ? [FALLBACK_BETA] : [],
                ...(withFallbacks ? { fallbacks: "default" as const } : {}),
              } as Anthropic.Beta.Messages.MessageCreateParamsStreaming,
              { timeout: 180_000, maxRetries: 1, signal: upstream.signal },
            );
          let separate = text.length > 0;
          let sentText = false;
          let answer: Anthropic.Beta.Messages.BetaMessage | null = null;
          for (;;) {
            const s = run();
            try {
              cost.started = true;
              for await (const event of s) {
                if (
                  event.type === "content_block_start" &&
                  (event.content_block.type === "tool_use" || event.content_block.type === "server_tool_use")
                ) {
                  const name = event.content_block.name;
                  send("status", { lane: "claude", text: isDocTool(name) ? "Writing the document" : toolStatus(name) });
                } else if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
                  sentText = true;
                  if (separate) {
                    send("delta", { lane: "claude", text: "\n\n" });
                    text += "\n\n";
                    separate = false;
                  }
                  text += event.delta.text;
                  send("delta", { lane: "claude", text: event.delta.text });
                }
              }
              answer = await s.finalMessage();
              break;
            } catch (err) {
              const status = (err as { status?: number })?.status;
              const msg = err instanceof Error ? err.message : String(err);
              if (!sentText && status === 400 && withFallbacks && /fallback/i.test(msg)) {
                console.error("aly-chat: retrying without fallbacks —", msg.slice(0, 200));
                withFallbacks = false;
                continue;
              }
              throw err;
            }
          }

          const u = fromClaude(answer.usage);
          const searches = (answer.usage as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0;
          const callCost = costUsd(u, answer.model) + searches * WEB_SEARCH_USD;
          laneCost += callCost;
          cost.usd += callCost;
          cost.usage = addUsage(cost.usage, u);

          if (answer.stop_reason === "refusal") {
            send("delta", { lane: "claude", text: (text ? "\n\n" : "") + REFUSED_TEXT });
            return { text: REFUSED_TEXT, model: answer.model, claude: [{ role: "assistant", content: [{ type: "text", text: REFUSED_TEXT }] }] };
          }

          const content = answer.content as unknown[];
          allContent.push(...content);
          turn.push({ role: "assistant", content });
          if (answer.stop_reason === "pause_turn") continue;

          const calls: ToolCall[] = (content as { type: string; id?: string; name?: string; input?: unknown }[])
            .filter((b) => b.type === "tool_use")
            .map((b) => ({ id: b.id as string, name: b.name as string, input: b.input }));
          if (answer.stop_reason !== "tool_use" || calls.length === 0) {
            const sources = citedSources(allContent);
            if (sources.length) send("sources", { lane: "claude", sources });
            return { text, model: answer.model, claude: turn, sources };
          }

          const outcomes: unknown[] = [];
          for (const c of calls) {
            const r = await runAlyTool(c);
            outcomes.push({ type: "tool_result", tool_use_id: c.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
          }
          turn.push({ role: "user", content: outcomes });
        }
        return { text, model, claude: turn };
      };

      // ---- Luna, with Aly's tools (lib/aly-chat/luna.ts) ------------------------
      // Everyday only: "Think harder" on Luna went to Claude's lane (routeBrain).
      const runLuna = async (): Promise<Lane> => {
        const { instructions, head } = lunaPrompt(setup.system);
        const gen = lunaTurn({
          instructions,
          history: [...head, ...toLuna(rows, load)],
          tools: lunaTools(setup.tools),
          maxOutput: MAX_OUTPUT.everyday,
          brakeUsd: LUNA_BRAKE_USD,
          maxRounds: MAX_TOOL_ROUNDS,
          signal: upstream.signal,
          safetyId: createHash("sha256").update(`picacho:${user.id}`).digest("hex").slice(0, 32),
          onCost: (usd, usage) => {
            cost.usd += usd;
            cost.usage = addUsage(cost.usage, usage);
          },
          runTool: (c) => runAlyTool(c),
        });
        cost.started = true;
        let step = await gen.next();
        while (!step.done) {
          const ev = step.value;
          if (ev.type === "text") send("delta", { lane: "luna", text: ev.text });
          else send("status", { lane: "luna", text: isDocTool(ev.name) ? "Writing the document" : toolStatus(ev.name) });
          step = await gen.next();
        }
        const r = step.value;
        if (r.sources.length) send("sources", { lane: "luna", sources: r.sources });
        return { text: r.text, model: r.model, openai: r.items, ...(r.sources.length ? { sources: r.sources } : {}) };
      };

      // ---- GPT and Gemini: words and files, no tools --------------------------
      const runOther = async (brain: "gpt" | "gemini"): Promise<Lane> => {
        const maxOutput = MAX_OUTPUT[harder ? "harder" : "everyday"];
        const system = plainSystem(setup);
        const gen =
          brain === "gpt"
            ? streamGpt({ messages: toOpenAI(system, rows, load), harder, maxOutput, signal: upstream.signal })
            : streamGemini({ system, contents: toGemini(rows, load), harder, maxOutput, signal: upstream.signal });
        cost.started = true;
        let step = await gen.next();
        while (!step.done) {
          send("delta", { lane: brain, text: step.value.text });
          step = await gen.next();
        }
        const r = step.value;
        const c = costUsd(r.usage, r.model);
        cost.usd += c;
        cost.usage = addUsage(cost.usage, r.usage);
        return { text: r.text, model: r.model };
      };

      let failure: TurnFailure | null = null;
      let deliveredText = false;
      try {
        await Promise.all(
          lanes.map(async (brain) => {
            try {
              const lane = brain === "claude" ? await runClaude() : brain === "luna" ? await runLuna() : await runOther(brain);
              results[brain] = lane;
              if (lane.text) deliveredText = true;
              send("lane_done", { lane: brain, model: lane.model });
            } catch (err) {
              if (upstream.signal.aborted) throw err;
              const status = (err as { status?: number })?.status ?? (err instanceof ProviderError ? err.status : undefined);
              const kind = err instanceof ProviderError ? err.kind : null;
              console.error(`aly-chat: ${brain} failed (status ${status ?? "none"}):`, err instanceof Error ? err.message.slice(0, 300) : err);
              const message =
                kind === "not_configured"
                  ? `${BRAIN_LABEL[brain]} isn't switched on yet. Pick another brain.`
                  : kind === "refused"
                    ? "That brain declined to answer this one. Try another."
                    : "That didn't go through. Try again.";
              results[brain] = { text: "", model: modelFor(brain, harder), error: message };
              if (lanes.length === 1) failure = classifyTurnFailure(status ?? undefined, err instanceof Error ? err.message : String(err));
              send("lane_error", { lane: brain, error: message });
            }
          }),
        );

        // ---- Save the answer --------------------------------------------------
        const firstOk = lanes.find((b) => results[b] && !results[b]!.error) ?? null;
        if (firstOk) {
          const content: AssistantContent = {
            lanes: results,
            kept: firstOk,
            ...(docs.length ? { docs: docs.map((d) => ({ id: d.id, title: d.title, version: d.version })) } : {}),
            ...(cards.length ? { renders: cards } : {}),
          };
          const saved = await appendRow(admin, {
            chatId: theChat,
            userId: user.id,
            seq: userSeq + 1,
            role: "assistant",
            brain: choice,
            content,
          });
          if (!saved.ok) console.error("aly-chat: answer save failed", saved.error);
        }

        // A new chat gets a title from its first exchange (GPT-6 Luna with no
        // reasoning, TITLE_MODEL: a few hundred tokens, about $0.00003, inside
        // this turn's charge).
        if (isNew && firstOk) {
          const title = await titleFor(text || newRefs.map((f) => f.name).join(", "), results[firstOk]!.text).catch(() => null);
          if (title) {
            cost.usd += title.cost;
            await setTitle(admin, user.id, theChat, title.text);
            send("title", { title: title.text });
          }
        }
      } catch (err) {
        if (!upstream.signal.aborted) {
          const status = (err as { status?: number })?.status;
          failure = classifyTurnFailure(status, err instanceof Error ? err.message : String(err));
          console.error("aly-chat failed", err);
          send("error", { error: failure === "provider_unavailable" ? "Chat is unavailable right now. Nothing was charged." : "That didn't go through. Try again." });
        }
      } finally {
        const units = await settle(cost, failure, deliveredText || cost.started).catch((e) => {
          console.error("aly-chat: settle failed", e);
          return reservedUnits;
        });
        send("done", { units });
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      upstream.abort();
    },
  });

  // Writes what the turn really cost over the reservation, on every path.
  async function settle(c: { usd: number; usage: Usage; started: boolean }, failure: TurnFailure | null, spent: boolean): Promise<number> {
    let units: number;
    let mode = "aly-chat";
    if (upstream.signal.aborted) {
      // Stopped mid-answer: tokens were spent and the cut call's usage never
      // came back. Charged what came back plus one full answer at this brain's
      // output price — the safe direction, and under the reservation.
      units = Math.min(reservedUnits, unitsForCost(c.usd + (MAX_OUTPUT[harder ? "harder" : "everyday"] * 10) / 1_000_000));
      mode = "aly-chat-stopped";
    } else if (failure && c.usd === 0) {
      units = spent ? 1 : 0;
      mode = failure === "provider_unavailable" ? "aly-chat-unavailable" : "aly-chat-failed";
    } else {
      units = unitsForCost(c.usd);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await admin
        .from("agent_usage")
        .update({
          mode,
          units,
          cost_usd: Number(c.usd.toFixed(6)),
          input_tokens: c.usage.input,
          cache_read_tokens: c.usage.cached,
          cache_write_tokens: c.usage.cacheWrite,
          output_tokens: c.usage.output,
        })
        .eq("id", reservationId);
      if (!error) break;
      console.error("aly-chat: settle write failed", { reservationId, attempt, error: error.message });
      await new Promise((r) => setTimeout(r, 300));
    }
    if (reserved.ok && reserved.topUp > 0) await settleAssistantTopUp(admin, { userId: user!.id, since, cap });
    return units;
  }

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  });
}

/** Their saved characters, oldest first (a stable order, so an unchanged list reads as unchanged); null if they couldn't be read. */
async function loadCast(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<CastMember[] | null> {
  const { data, error } = await supabase
    .from("character_profiles")
    .select("id, name")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    console.error("aly-chat: characters unavailable —", error.message);
    return null;
  }
  return (data ?? []).map((c) => ({ id: String(c.id), name: String(c.name ?? "") }));
}

/** The prepare_send outcome as a Light chat reads it: started, not waiting. */
function lightStartedText(card: PreparedSend): string {
  const what = card.kind === "video" ? `a ${card.seconds ? `${card.seconds}-second ` : ""}video` : "a picture";
  return `Started "${card.label}" (${what}${card.characterName ? `, with ${card.characterName}` : ""}, ${card.credits} credit${card.credits === 1 ? "" : "s"}). It is being made now and appears in the chat by itself when it's ready.`;
}

/** A new chat's name, from its first exchange (TITLE_MODEL, GPT-6 Luna with no reasoning). */
async function titleFor(asked: string, answered: string): Promise<{ text: string; cost: number } | null> {
  const res = await lunaText({
    instructions:
      "Name this chat in 2 to 6 words, in the language the person wrote in, the way a chat app's sidebar would. Reply with the name only: no quotes, no full stop.",
    input: `The person wrote:\n${asked.slice(0, 1500)}\n\nThe answer began:\n${answered.slice(0, 600)}`,
    maxOutput: 40,
    signal: AbortSignal.timeout(15_000),
  });
  const t = res.text.trim().replace(/^["'“”]+|["'“”.]+$/g, "").slice(0, 80);
  if (!t) return null;
  return { text: t, cost: costUsd(res.usage, res.model) };
}

/** An earlier card's take, written onto the saved message that holds the card (linkRender's write, done here). */
async function rememberStarted(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  chatId: string,
  rows: StoredRow[],
  cardId: string,
  generationId: string,
): Promise<void> {
  type Card = { id?: unknown };
  const listOf = (r: StoredRow): Card[] =>
    r.role === "assistant" && Array.isArray(r.content.renders) ? (r.content.renders as Card[]) : [];
  const row = [...rows].reverse().find((r) => listOf(r).some((x) => x.id === cardId));
  if (!row || row.role !== "assistant") return;
  const renders = listOf(row).map((x) => (x.id === cardId ? { ...x, generationId } : x));
  const { error } = await admin
    .from("aly_chat_messages")
    .update({ content: { ...row.content, renders } })
    .eq("chat_id", chatId)
    .eq("seq", row.seq)
    .eq("user_id", userId);
  if (error) console.error("aly-chat: couldn't remember a started card —", error.message);
  else (row.content as { renders?: unknown }).renders = renders;
}
