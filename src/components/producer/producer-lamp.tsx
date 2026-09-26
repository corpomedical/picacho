"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PRODUCER_NEEDS_ELITE, PRODUCER_NOT_OPEN, PRODUCER_SUSPENDED, PRODUCER_UNAVAILABLE } from "@/lib/producer/enabled";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  clearProducerNotes,
  deleteProducerNote,
  loadProducer,
  markWatchSeen,
  saveProducerNote,
  startFresh,
  type ProducerLine,
} from "@/lib/producer/actions";
import { parseProducerFrames } from "@/lib/producer/sse";
import type { PreparedSend } from "@/lib/producer/tools";
import type { Note } from "@/lib/producer/notes";
import type { WatchItem } from "@/lib/producer/watch";
import { isSpot, type Spot } from "@/lib/producer/spots";
import { PRODUCER_ASK_EVENT, producerAskDraft, producerAskText } from "@/lib/producer/ask-event";
import styles from "./producer-lamp.module.css";
import { Wheel, WHEEL_R } from "./wheel";
import { MovableLamp } from "./movable-lamp";
import { writeLampHidden } from "./lamp-place";
import { lampMood, type LampLook } from "./lamp-look";
import { LookMark } from "./lamp-looks";
import { Spotlight, type LitSpot } from "./spotlight";
import { useHandsFree, type SpokenAudio, type UtteranceMeta } from "./use-hands-free";

// The Producer's lamp and sheet (2026-09-24; operator: "A lamp on every
// page", "Prepares, you send", "User picks" the name).
//
// The lamp is a small glowing button that lives on every /app page; a dot on
// it means renders came back scoring low since the sheet was last opened.
// The sheet is a panel on the right from md up — non-modal, so the page stays
// usable beside it (open a prepared send, look at History) — and a bottom
// sheet on phones.
//
// Round 2 (2026-09-25, operator): opening the sheet grows a WHEEL out from
// behind the bulb (wheel.tsx) — talk hands-free, read answers aloud, notes,
// start fresh, name — whose rim is lit by how much of the month's assistant
// allowance is used; hands-free voice (use-hands-free.ts); and a thin light
// on the bottom edge of whatever part of the page the Producer is working on
// (spotlight.tsx).
//
// Round 4 (2026-09-25, operator: "The light bulb is disturbing some of the
// buttons" → "Lets make it movable and dismissible"): the lamp can be dragged
// anywhere, lives as a glowing tab on any edge it is dropped at, and can be
// hidden (movable-lamp.tsx, lamp-place.ts).
//
// English only for v1 (admins); the words are gathered here to translate in
// one place when it opens to Elite.

const W = {
  open: (name: string) => `Open ${name}`,
  close: "Close",
  notes: "Notes",
  back: "Back",
  startFresh: "Start fresh",
  freshConfirm: "Clear this conversation? Your notes stay.",
  yes: "Clear it",
  cancel: "Cancel",
  placeholder: (name: string) => `Ask ${name}…`,
  send: "Send",
  stop: "Stop",
  thinking: "Thinking",
  emptyTitle: (name: string) => `${name} knows your cast, your renders and your notes.`,
  emptyBody:
    "Ask for a shot list for a launch, why a render drifted, or the one with the red dress from last week. Every send it prepares waits for you to press Send.",
  suggestions: [
    "Plan three shots for this week",
    "Which of my renders scored best?",
    "What do you remember about my brand?",
  ],
  watchTitle: "Came back low",
  askWhy: "Ask why",
  openComposer: "Open in composer",
  total: (n: number) => `Total ${n} credit${n === 1 ? "" : "s"}`,
  credits: (n: number) => `${n} cr`,
  noNotes: "No notes yet. When you tell it something worth remembering, it writes a note here, and you can edit or delete it.",
  save: "Save",
  delete: "Delete",
  clearAll: "Delete all notes",
  clearAllConfirm: "Delete every note? It forgets them for good.",
  loadFailed: "Couldn't load. Close and try again.",
  longConversation: "This conversation is getting long. Start fresh to keep it quick and cheap. Your notes carry over.",
  prepared: "Prepared, not sent",
  listening: "Listening",
  hearing: "Hearing you",
  sendingVoice: "Thinking",
  speaking: "Speaking",
  endVoice: "End",
  endVoiceLabel: "End the voice conversation",
  talkOver: "Talk over it anytime",
  newCards: (n: number) => `${n} prepared`,
  heardPlaceholder: "…",
  ignored: (text: string) => `Heard “${text.length > 70 ? `${text.slice(0, 70)}…` : text}”. Not for me, so I let it be.`,
  answerIt: "Answer it",
  backgroundTip: "There's a lot of talk around you. Headphones help, or type to me.",
  queued: "Next",
  limitReached: "You've used this period's assistant allowance.",
  hideLamp: "Hide the lamp",
};

const READ_ALOUD_KEY = "picacho.producer.readAloud";
// The sheet reopens after the page reloads to show a set it just fixed.
const REOPEN_KEY = "picacho.producer.reopen";
// Voice survives a reload of the page (the tab's session only): it stays on
// until the person turns it off or asks the Producer to.
const VOICE_ON_KEY = "picacho.producer.voiceOn";

function readStoredBool(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

// Past this many lines a fresh start is suggested (every turn re-reads the
// whole conversation — cheaply, from cache, but not for free).
const LONG_CONVERSATION = 120;

type Streaming = { text: string; cards: PreparedSend[]; status: string | null };
type SendInput = { text?: string; audio?: SpokenAudio; focus?: string };
/**
 * One request to the Producer. A spoken one is `accepted` only once the
 * server has judged it was said to the Producer (its "heard" event); until
 * then it touches nothing on screen and stops nothing.
 */
type Turn = {
  controller: AbortController;
  live: Streaming;
  userSeq: number;
  accepted: boolean;
  /** Superseded by a later message that cut it off. */
  cut: boolean;
  spoken: SpokenAudio[] | null;
};

export function ProducerLamp({
  name: initialName,
  watchCount,
  voiceAvailable,
  look,
  diagnostics = false,
}: {
  name: string;
  watchCount: number;
  /** The server has a speech provider configured (OPENAI_API_KEY). */
  voiceAvailable: boolean;
  /** How the lamp looks: the person's pick in Settings (lamp-look.ts). */
  look: LampLook;
  /** An admin's readouts: how much of her voice the mic hears (2026-09-26, "I still cant interrupt her"). */
  diagnostics?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Refused because it is no longer theirs (a grant revoked, the plan or the
  // switch changed, the account suspended): the layout that put the lamp on
  // the page is drawn again without it. The app's layout isn't redrawn on an
  // ordinary page change, so without this the lamp would linger until a full
  // reload, refusing every message (review of the grant, 2026-09-26).
  const goneIfRefused = useCallback(
    (error: string | null | undefined) => {
      if (error === PRODUCER_NOT_OPEN || error === PRODUCER_NEEDS_ELITE || error === PRODUCER_SUSPENDED || error === PRODUCER_UNAVAILABLE) {
        router.refresh();
      }
    },
    [router],
  );
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "notes">("chat");
  const [name, setName] = useState(initialName);
  const [dot, setDot] = useState(watchCount);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lines, setLines] = useState<ProducerLine[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmFresh, setConfirmFresh] = useState(false);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lampRef = useRef<HTMLButtonElement>(null);
  const [usage, setUsage] = useState<{ used: number; cap: number } | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [lit, setLit] = useState<LitSpot[]>([]);
  const [typing, setTyping] = useState(false);
  const [center, setCenter] = useState<{ cx: number; cy: number; vh: number; phone: boolean } | null>(null);

  useEffect(() => setReadAloud(readStoredBool(READ_ALOUD_KEY)), []);

  // Light a spot for `ms` (the latest request for a spot wins).
  const light = useCallback((spot: Spot, id: string | null, ms: number) => {
    const until = Date.now() + ms;
    setLit((prev) => [...prev.filter((l) => !(l.spot === spot && (l.id ?? null) === id) && l.until > Date.now()), { spot, id, until }]);
  }, []);
  // A finished turn lets every lit spot fade shortly after.
  const settleLights = useCallback(() => {
    const soon = Date.now() + 2500;
    setLit((prev) => prev.map((l) => ({ ...l, until: Math.min(l.until, soon) })));
    window.setTimeout(() => setLit((prev) => prev.filter((l) => l.until > Date.now())), 2700);
  }, []);

  // SEVERAL THINGS AT ONCE, SPOKEN OR TYPED (2026-09-25, operator: "it looks
  // like the assistant cant handle several questions at once. check the
  // data"). The data: a second spoken message cut the first answer off before
  // it began, and the first question was never answered; a typed follow-up
  // while it answered was silently ignored. Now:
  //   - a recording is sent at once; one that arrives before the last got
  //     its answer is merged with it and they go together, in order;
  //   - said over an answer, it is sent WITHOUT stopping that answer: only
  //     when the server has judged it was said to the Producer (its "heard")
  //     is the old answer stopped — kept as far as it got — and the new one
  //     answers what they just said plus anything left unanswered. Judged not
  //     for the Producer (the TV, someone else), the old answer carries on;
  //   - a typed message during an answer shows at once and goes when that
  //     answer has finished.
  const currentRef = useRef<Turn | null>(null);
  const probeRef = useRef<Turn | null>(null);
  const queuedRef = useRef<(SendInput & { queuedSeq?: number })[]>([]);
  // Bumped when a typed message is queued or an answer ends: the effect
  // below sends the next one once she is quiet.
  const [queueTick, setQueueTick] = useState(0);
  const [ignored, setIgnored] = useState<string | null>(null);
  // An admin's line under the note: the signals the judge read (route.ts).
  const [ignoredWhy, setIgnoredWhy] = useState<string | null>(null);
  const ignoredTimes = useRef<number[]>([]);
  const [backgroundTip, setBackgroundTip] = useState(false);
  // A set the Producer changed (fix_set_thing): the set page shows it after a
  // reload, once the answer and its speech are done.
  const [reloadFor, setReloadFor] = useState<string | null>(null);
  const voice = useHandsFree({
    onUtterance: (audio: SpokenAudio, meta: UtteranceMeta) => {
      void sendSpokenRef.current(audio, meta);
    },
  });
  const sendSpokenRef = useRef<(audio: SpokenAudio, meta: UtteranceMeta) => Promise<void>>(async () => {});
  const [unseenCards, setUnseenCards] = useState(0);

  // Voice stays on across a reload, and off only when the person says so.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(VOICE_ON_KEY) === "1") void voice.start();
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      if (voice.active && voice.phase !== "speaking") window.sessionStorage.setItem(VOICE_ON_KEY, "1");
      if (voice.phase === "off") window.sessionStorage.removeItem(VOICE_ON_KEY);
    } catch {}
  }, [voice.active, voice.phase]);
  useEffect(() => {
    if (open) setUnseenCards(0);
  }, [open]);

  const setAloud = useCallback((next: boolean) => {
    setReadAloud(next);
    try {
      window.localStorage.setItem(READ_ALOUD_KEY, next ? "1" : "0");
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    const r = await loadProducer();
    if (r.error !== null) {
      setLoadError(r.error || W.loadFailed);
      goneIfRefused(r.error);
      return;
    }
    setName(r.snapshot.name);
    setUsage(r.snapshot.usage);
    setLines(r.snapshot.lines);
    setNotes(r.snapshot.notes);
    setWatch(r.snapshot.watch);
    setLoaded(true);
    if (r.snapshot.watch.length > 0) void markWatchSeen();
    setDot(0);
  }, [goneIfRefused]);

  useEffect(() => {
    if (open && !loaded) void load();
  }, [open, loaded, load]);

  // A set's chat hands a question over (Helios Cut 2, step 12; ask-event.ts):
  // the lamp opens on the conversation with the words in its field, UNSENT —
  // a Producer turn is always the person's own press. A draft they had
  // started stays, the words after it.
  const askedRef = useRef(false);
  useEffect(() => {
    const onAsk = (e: Event) => {
      const text = producerAskText(e);
      if (text === null) return;
      setView("chat");
      setInput((current) => producerAskDraft(current, text));
      setOpen(true);
      askedRef.current = true;
    };
    window.addEventListener(PRODUCER_ASK_EVENT, onAsk);
    return () => window.removeEventListener(PRODUCER_ASK_EVENT, onAsk);
  }, []);
  // The field takes the keyboard once the conversation has loaded (it is held until then), sized to the words.
  useEffect(() => {
    if (!open || !loaded || !askedRef.current) return;
    askedRef.current = false;
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
    el.focus();
  }, [open, loaded, view]);

  // A rename in Settings arrives as a new prop after the router refresh.
  useEffect(() => setName(initialName), [initialName]);

  // On a phone the lamp floats just ABOVE whatever is docked at the bottom —
  // the composer's dock on Generate ([data-dock], whose height changes as it
  // opens and closes) — instead of sitting on its Render button. With nothing
  // docked, the CSS position stands (above the tab bar in the app).
  const [lift, setLift] = useState<number | null>(null);
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 767px)");
    let dock: Element | null = null;
    const ro = new ResizeObserver(() => measure());
    function measure() {
      if (!phone.matches || !dock || !dock.isConnected) return setLift(null);
      const top = dock.getBoundingClientRect().top;
      const below = window.innerHeight - top;
      setLift(below > 0 && below < window.innerHeight * 0.8 ? below + 12 : null);
    }
    function attach() {
      const next = document.querySelector("[data-dock]");
      if (next === dock) return measure();
      if (dock) ro.unobserve(dock);
      dock = next;
      if (dock) ro.observe(dock);
      measure();
    }
    attach();
    const mo = new MutationObserver(attach);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    phone.addEventListener("change", measure);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
      phone.removeEventListener("change", measure);
    };
  }, [pathname]);

  // Where the wheel opens: centred on the lamp's corner (its open position —
  // the corner on a phone), and again on resize. The corner is read from the
  // lamp's invisible twin (movable-lamp.tsx), which is already there while a
  // moved lamp is still flying home; the wheel then waits for it to land.
  const [wheelReady, setWheelReady] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const home = () => document.querySelector("[data-producer-lamp-home]")?.getBoundingClientRect();
    const measure = () => {
      const r = home() ?? lampRef.current?.getBoundingClientRect();
      if (!r) return;
      setCenter({
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        vh: window.innerHeight,
        phone: window.matchMedia("(max-width: 767px)").matches,
      });
    };
    measure();
    const lamp = lampRef.current?.getBoundingClientRect();
    const corner = home();
    const away = lamp && corner ? Math.hypot(lamp.left - corner.left, lamp.top - corner.top) > 4 : false;
    if (!away) setWheelReady(true);
    const ready = away ? window.setTimeout(() => setWheelReady(true), 560) : undefined;
    const t = window.setTimeout(measure, 220);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(t);
      if (ready) window.clearTimeout(ready);
      window.removeEventListener("resize", measure);
      setWheelReady(false);
    };
  }, [open]);

  // Closing the sheet does NOT end voice (operator, 2026-09-25: "Even if you
  // close the conversation, the mic and speaker does not turn off until the
  // user manually turns it off or tells it to turn off"). The lamp shows it's
  // live, with an End button beside it.

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, streaming, open, view]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function send({ text, audio, focus }: SendInput) {
    if (audio) return sendSpoken(audio, { interrupting: currentRef.current !== null });
    const message = (text ?? "").trim();
    if (!message) return;
    if (usage && usage.used >= usage.cap) {
      setError(W.limitReached);
      return;
    }
    setInput("");
    if (currentRef.current) {
      // Answering already: it shows now and goes when this answer is done.
      const seq = -Date.now();
      setLines((prev) => [...prev, { seq, role: "user", text: message, queued: true }]);
      queuedRef.current.push({ text: message, focus, queuedSeq: seq });
      setQueueTick((n) => n + 1);
      return;
    }
    return runTurn({ text: message, focus });
  }

  async function sendSpoken(audio: SpokenAudio, meta: UtteranceMeta) {
    if (usage && usage.used >= usage.cap) {
      setError(W.limitReached);
      voice.stop();
      return;
    }
    // Not yet answered (the server hasn't said "heard"): this one joins it,
    // and they are sent again together, in the order they were said.
    const waiting = probeRef.current;
    let audios = [audio];
    if (waiting && waiting.spoken) {
      waiting.controller.abort();
      audios = [...waiting.spoken, audio].slice(-4);
      // The newest first, as many as fit in ~55 s (the upload holds ~65 s).
      while (audios.length > 1 && audios.reduce((n, a) => n + a.seconds, 0) > 55) audios = audios.slice(1);
    }
    const interrupting = meta.interrupting || currentRef.current !== null;
    return runTurn({
      spoken: audios,
      interrupting,
      heard: interrupting && readAloud ? voice.heardText() : null,
      talkedOver: meta.talkedOver === true,
    });
  }
  sendSpokenRef.current = sendSpoken;

  /** The answer on screen stops here (a later message cut it off, or Stop). */
  function finalize(turn: Turn, cut: boolean) {
    const text = turn.live.text.trim();
    if (text || turn.live.cards.length > 0) {
      setLines((prev) => [
        ...prev,
        { seq: -Date.now() - 1, role: "assistant", text: cut && text ? `${text} —` : text, cards: turn.live.cards },
      ]);
    }
  }

  /** A turn takes the screen: whatever answer was showing is kept as far as it got. */
  function becomeCurrent(turn: Turn) {
    const old = currentRef.current;
    if (old && old !== turn) {
      old.cut = true;
      old.controller.abort();
      finalize(old, true);
    }
    currentRef.current = turn;
    setStreaming({ ...turn.live });
  }

  function stopAnswer() {
    const t = currentRef.current;
    if (t) t.controller.abort();
    voice.dropReply();
  }

  async function runTurn({
    text,
    focus,
    spoken = null,
    interrupting = false,
    heard = null,
    talkedOver = false,
  }: {
    text?: string;
    focus?: string;
    spoken?: SpokenAudio[] | null;
    interrupting?: boolean;
    heard?: string | null;
    talkedOver?: boolean;
  }) {
    setError(null);
    const turn: Turn = {
      controller: new AbortController(),
      live: { text: "", cards: [], status: W.thinking },
      userSeq: -Date.now(),
      accepted: !spoken,
      cut: false,
      spoken,
    };
    const speak = readAloud;
    const accept = (words: string) => {
      if (turn.accepted && currentRef.current === turn) return;
      turn.accepted = true;
      if (probeRef.current === turn) probeRef.current = null;
      // The old answer, if any, stops here; its unplayed speech goes.
      if (spoken) voice.dropReply();
      becomeCurrent(turn);
      setLines((prev) => [...prev, { seq: turn.userSeq, role: "user", text: words }]);
      if (speak) voice.beginTurn();
      if (spoken) voice.markAccepted(spoken[spoken.length - 1]?.level);
    };
    if (spoken) probeRef.current = turn;
    else accept(text ?? "");
    let notesChanged = false;
    let failed: string | null = null;
    let wasIgnored = false;
    const last = spoken ? spoken[spoken.length - 1] : null;
    try {
      const res = await fetch("/api/producer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: spoken ? undefined : text,
          audio: spoken ?? undefined,
          speak,
          page: pathname,
          focus: focus ?? null,
          interrupting: spoken ? interrupting : undefined,
          nearness: last?.nearness ?? null,
          // What this sheet calls it: the transcriber's spelling hint when the
          // server's settings read is slow (route.ts).
          name: spoken ? name : undefined,
          heard: heard ?? undefined,
          talkedOver: spoken ? talkedOver : undefined,
        }),
        signal: turn.controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (res.status === 402 && usage) setUsage({ ...usage, used: usage.cap });
        if (res.status === 403) goneIfRefused(body?.error);
        throw new Error(body?.error ?? "That didn't go through. Try again.");
      }
      if ((res.headers.get("content-type") ?? "").includes("application/json")) {
        // A recording with nothing said in it: nothing changes.
        wasIgnored = true;
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      const live = turn.live;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const parsed = parseProducerFrames(buffer);
        buffer = parsed.rest;
        for (const ev of parsed.events) {
          if (ev.event === "heard" && typeof ev.data.text === "string") {
            accept(ev.data.text);
            continue;
          }
          if (ev.event === "ignored") {
            wasIgnored = true;
            const words = typeof ev.data.text === "string" ? ev.data.text : "";
            if (words) {
              setIgnored(words);
              setIgnoredWhy(typeof ev.data.why === "string" ? ev.data.why : null);
              const now = Date.now();
              ignoredTimes.current = [...ignoredTimes.current.filter((t) => now - t < 60_000), now];
              if (ignoredTimes.current.length >= 3) setBackgroundTip(true);
            }
            continue;
          }
          if (ev.event === "error" && typeof ev.data.error === "string") {
            failed = ev.data.error;
            continue;
          }
          if (!turn.accepted || currentRef.current !== turn) continue;
          if (ev.event === "delta" && typeof ev.data.text === "string") {
            live.text += ev.data.text;
            live.status = null;
          } else if (ev.event === "status" && typeof ev.data.text === "string") {
            live.status = ev.data.text;
          } else if (ev.event === "card") {
            live.cards = [...live.cards, ev.data as unknown as PreparedSend];
            if (!openRef.current) setUnseenCards((n) => n + 1);
          } else if (ev.event === "voice" && typeof ev.data.action === "string") {
            if (ev.data.action === "end_voice") voice.endAfterPlayback();
            else if (ev.data.action === "mute_replies") setAloud(false);
            else if (ev.data.action === "unmute_replies") setAloud(true);
          } else if (ev.event === "audio" && typeof ev.data.url === "string") {
            voice.enqueue(Number(ev.data.index) || 0, { url: ev.data.url }, typeof ev.data.text === "string" ? ev.data.text : "");
          } else if (ev.event === "audio" && typeof ev.data.data === "string") {
            voice.enqueue(Number(ev.data.index) || 0, { data: ev.data.data }, typeof ev.data.text === "string" ? ev.data.text : "");
          } else if (ev.event === "set_changed" && typeof ev.data.setId === "string") {
            setReloadFor(ev.data.setId);
          } else if (ev.event === "spot" && isSpot(ev.data.spot)) {
            light(ev.data.spot, typeof ev.data.id === "string" ? ev.data.id : null, 8000);
          } else if (ev.event === "done") {
            notesChanged = ev.data.notesChanged === true;
            const units = Number(ev.data.units) || 0;
            setUsage((u) => (u ? { ...u, used: u.used + units } : u));
          }
          setStreaming({ ...live });
        }
      }
    } catch (err) {
      if (!turn.controller.signal.aborted) failed = err instanceof Error ? err.message : "That didn't go through. Try again.";
    } finally {
      if (probeRef.current === turn) probeRef.current = null;
      if (!turn.accepted) {
        // Never became a turn (nothing said, not for the Producer, merged
        // into a later recording, or failed): if she had stopped for it,
        // she carries on; nothing else changes.
        if (!turn.controller.signal.aborted) {
          voice.resume();
          if (failed && !wasIgnored) setError(failed);
        }
      } else if (currentRef.current === turn) {
        currentRef.current = null;
        settleLights();
        voice.endTurn();
        finalize(turn, turn.controller.signal.aborted);
        setStreaming(null);
        if (failed) setError(failed);
        setQueueTick((n) => n + 1);
        if (notesChanged) {
          const r = await loadProducer().catch(() => null);
          if (r && r.error === null) setNotes(r.snapshot.notes);
        }
      }
    }
  }

  // The next typed message goes once the answer before it has finished and
  // she has stopped speaking (it used to cut her off mid-sentence).
  useEffect(() => {
    if (streaming !== null || voice.phase === "speaking" || voice.held) return;
    const next = queuedRef.current.shift();
    if (!next?.text) return;
    setLines((prev) => prev.filter((l) => l.seq !== next.queuedSeq));
    void runTurn({ text: next.text, focus: next.focus });
    // runTurn is this render's (fresh settings); the tick re-checks the queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueTick, streaming, voice.phase, voice.held]);

  useEffect(() => {
    if (!reloadFor || streaming !== null || voice.phase === "speaking" || voice.held) return;
    if (!pathname.startsWith(`/app/sets/${reloadFor}`)) {
      const t = window.setTimeout(() => setReloadFor(null), 0);
      return () => window.clearTimeout(t);
    }
    try {
      window.sessionStorage.setItem(REOPEN_KEY, "1");
    } catch {}
    window.location.reload();
  }, [reloadFor, streaming, voice.phase, voice.held, pathname]);
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(REOPEN_KEY) !== "1") return;
      window.sessionStorage.removeItem(REOPEN_KEY);
    } catch {
      return;
    }
    const t = window.setTimeout(() => setOpen(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  async function doFresh() {
    setConfirmFresh(false);
    const r = await startFresh();
    if (r.error) {
      setError(r.error);
      return;
    }
    setLines([]);
    setError(null);
  }

  const busy = streaming !== null;
  const mood = lampMood(voice.phase, busy);
  // The look's light: the voice's loudness while a mic session measures it;
  // a reply read aloud with the mic off has no meter, so it talks at a
  // steady middle strength instead of its dimmest.
  const glow = voice.metered ? voice.level : mood === "talking" ? 0.7 : 0;
  const wheelShown = open && wheelReady && center !== null && !(center.phone && typing);
  // The sheet ends just above the wheel; with the keyboard up on a phone the
  // wheel tucks away and the sheet reaches the bottom.
  // (Kept while a moved lamp is still flying home, so the sheet doesn't jump
  // when the wheel appears.)
  const sheetBottom =
    open && center && !(center.phone && typing) ? Math.round(center.vh - (center.cy - WHEEL_R) + 10) : undefined;
  const voiceLine =
    voice.phase === "listening"
      ? W.listening
      : voice.phase === "hearing"
        ? W.hearing
        : voice.phase === "sending"
          ? W.sendingVoice
          : voice.phase === "speaking"
            ? W.speaking
            : null;

  return (
    <>
      {/* The lamp: movable, tucks into any edge as a tab, can be hidden
          (movable-lamp.tsx). Voice live with the sheet closed: it glows with
          the sound, and End beside it turns voice off in one tap. */}
      <MovableLamp
        name={name}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        live={voice.active}
        level={glow}
        look={look}
        mood={mood}
        lift={lift}
        unseenCards={unseenCards}
        dot={dot}
        onEndVoice={voice.stop}
        lampRef={lampRef}
        openLabel={W.open(name)}
        newCardsLabel={W.newCards(unseenCards)}
        endVoiceLabel={W.endVoiceLabel}
      />

      <Spotlight lit={lit} />

      {wheelShown && center && (
        <Wheel
          cx={center.cx}
          cy={center.cy}
          used={usage?.used ?? 0}
          cap={usage?.cap ?? 0}
          phase={voice.phase}
          level={voice.level}
          readAloud={readAloud}
          notesOpen={view === "notes"}
          notesCount={notes.length}
          voiceAvailable={voiceAvailable && voice.supported}
          canFresh={!busy && lines.length > 0}
          onTalk={() => {
            if (voice.active) voice.stop();
            else {
              // A voice conversation answers out loud, like ChatGPT's.
              setAloud(true);
              void voice.start();
            }
          }}
          onReadAloud={() => setAloud(!readAloud)}
          onNotes={() => setView((v) => (v === "notes" ? "chat" : "notes"))}
          onFresh={() => {
            setView("chat");
            setConfirmFresh(true);
          }}
        />
      )}

      {open && (
        <>
          <button
            type="button"
            aria-label={W.close}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[46] bg-black/60 md:hidden"
          />
          <section
            data-producer-sheet
            role="dialog"
            aria-label={name}
            style={sheetBottom !== undefined ? { bottom: sheetBottom } : undefined}
            className={`${styles.sheet} fixed z-[47] flex flex-col overflow-hidden border border-atelier-rule bg-atelier-surface text-atelier-ink shadow-[0_30px_80px_-30px_rgba(0,0,0,0.75)] backdrop-blur-xl inset-x-0 bottom-0 top-[6dvh] rounded-[22px] md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:w-[420px] md:rounded-[18px]`}
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-atelier-rule px-4 py-3">
              <LookMark look={look} mood={mood} size={22} glow={glow} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold leading-tight">
                  {view === "notes" ? W.notes : name}
                </div>
              </div>
              {view === "chat" ? null : (
                <button
                  type="button"
                  onClick={() => setView("chat")}
                  className="rounded-control px-2.5 py-1.5 text-[13px] text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                >
                  {W.back}
                </button>
              )}
              {/* Hiding without dragging (keyboard, screen readers, or just
                  easier): Undo follows, Settings brings it back. */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  writeLampHidden(true);
                }}
                aria-label={W.hideLamp}
                title={W.hideLamp}
                className="grid h-8 w-8 place-items-center rounded-full text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z" />
                  <circle cx="8" cy="8" r="1.8" />
                  <path d="M2.5 13.5l11-11" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={W.close}
                className="grid h-8 w-8 place-items-center rounded-full text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            {confirmFresh && (
              <div className="flex flex-wrap items-center gap-2 border-b border-atelier-rule bg-atelier-ink/[0.03] px-4 py-2.5 text-[13px]">
                <span className="flex-1">{W.freshConfirm}</span>
                <button type="button" onClick={doFresh} className="rounded-full bg-atelier-accent px-3 py-1 font-semibold text-[#1a120a]">
                  {W.yes}
                </button>
                <button type="button" onClick={() => setConfirmFresh(false)} className="rounded-full px-3 py-1 text-atelier-muted hover:text-atelier-ink">
                  {W.cancel}
                </button>
              </div>
            )}

            {view === "notes" ? (
              <NotesView notes={notes} setNotes={setNotes} />
            ) : (
              <>
                <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                  {loadError && <p className="text-sm text-[#ff8a80]">{loadError}</p>}
                  {!loadError && !loaded && <p className="text-sm text-atelier-muted">…</p>}

                  {loaded && watch.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{W.watchTitle}</div>
                      {watch.map((w) => (
                        <div key={w.id} className="flex items-center gap-3 rounded-xl border border-atelier-rule border-l-[3px] border-l-[#e6c46e] p-2.5">
                          {w.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={w.thumb} alt="" className="h-14 w-10 flex-none rounded-md object-cover" />
                          ) : (
                            <div className="h-14 w-10 flex-none rounded-md bg-atelier-ink/10" />
                          )}
                          <div className="min-w-0 flex-1 text-[13px]">
                            <div>
                              <span className="font-semibold tabular-nums text-[#e6c46e]">{w.score}</span>{" "}
                              <span className="text-atelier-muted">
                                · {w.kind} · {new Date(w.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                              </span>
                            </div>
                            <div className="truncate text-atelier-muted">{w.prompt}</div>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              send({
                                text: `Why did my ${w.kind} from ${new Date(w.createdAt).toLocaleString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })} score ${w.score}?`,
                                focus: w.id,
                              })
                            }
                            className="flex-none rounded-full border border-atelier-rule px-3 py-1 text-[12.5px] font-semibold hover:bg-atelier-ink/5 disabled:opacity-40"
                          >
                            {W.askWhy}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {loaded && lines.length === 0 && !streaming && (
                    <div className="space-y-3 pt-2">
                      <p className="text-[15px] font-semibold leading-snug">{W.emptyTitle(name)}</p>
                      <p className="text-[14px] leading-relaxed text-atelier-muted">{W.emptyBody}</p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {W.suggestions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => send({ text: s })}
                            className="rounded-full border border-atelier-rule px-3 py-1.5 text-[13px] text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {lines.filter((l) => !(l.role === "user" && l.queued)).map((l) =>
                    l.role === "user" ? (
                      <div key={l.seq} className="ml-auto w-fit max-w-[88%] whitespace-pre-wrap rounded-[14px] rounded-br-[4px] bg-atelier-ink/[0.07] px-3.5 py-2 text-[14.5px] leading-relaxed">
                        {l.text}
                      </div>
                    ) : (
                      <div key={l.seq} className="max-w-[96%] space-y-3">
                        {l.text && <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{l.text}</p>}
                        {l.cards.length > 0 && (
                          <Cards
                            cards={l.cards}
                            onOpen={() => {
                              light("composer", null, 3500);
                              setOpen(window.matchMedia("(min-width: 768px)").matches);
                            }}
                          />
                        )}
                      </div>
                    ),
                  )}

                  {streaming && (
                    <div className="max-w-[96%] space-y-3">
                      {streaming.text && <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{streaming.text}</p>}
                      {streaming.cards.length > 0 && <Cards cards={streaming.cards} onOpen={() => light("composer", null, 3500)} />}
                      {streaming.status && (
                        <p className="flex items-center gap-2 text-[13px] text-atelier-muted">
                          <span className={styles.statusDot} aria-hidden="true" />
                          {streaming.status}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Typed while it answered: after this answer, in order. */}
                  {lines
                    .filter((l) => l.role === "user" && l.queued)
                    .map((l) => (
                      <div key={l.seq} className="ml-auto w-fit max-w-[88%] opacity-60">
                        <div className="whitespace-pre-wrap rounded-[14px] rounded-br-[4px] bg-atelier-ink/[0.07] px-3.5 py-2 text-[14.5px] leading-relaxed">
                          {l.text}
                        </div>
                        <div className="mt-1 text-right text-[11px] text-atelier-muted">{W.queued}</div>
                      </div>
                    ))}

                  {error && <p className="text-sm text-[#ff8a80]">{error}</p>}
                  {lines.length >= LONG_CONVERSATION && !busy && (
                    <p className="text-[13px] text-atelier-muted">{W.longConversation}</p>
                  )}
                </div>

                {/* Composer */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send({ text: input });
                  }}
                  className="border-t border-atelier-rule p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                >
                  {ignored && (
                    <div className="mb-2 flex items-center gap-2 px-1 text-[12px] text-atelier-muted" role="status">
                      <span className="min-w-0 flex-1">
                        {W.ignored(ignored)}
                        {ignoredWhy && <span className="mt-0.5 block text-[11px] opacity-70">Why: {ignoredWhy}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const words = ignored;
                          setIgnored(null);
                          void send({ text: words });
                        }}
                        className="flex-none rounded-full border border-atelier-rule px-2.5 py-1 font-semibold text-atelier-ink hover:bg-atelier-ink/5"
                      >
                        {W.answerIt}
                      </button>
                    </div>
                  )}
                  {diagnostics && voice.active && voice.echo && (
                    <p className="mb-2 px-1 text-[11px] text-atelier-muted" data-voice-echo>
                      Echo check (admins): {Math.round(voice.echo.leak * 100)}% of her voice reaches the mic
                      {voice.echo.strict ? " — too much, she can't hear you over herself" : ""} · talking over her dipped{" "}
                      {voice.echo.dips}, stopped {voice.echo.stops} · ears: {voice.engine ?? "off"}
                    </p>
                  )}
                  {backgroundTip && voice.active && (
                    <p className="mb-2 px-1 text-[12px] text-atelier-muted">{W.backgroundTip}</p>
                  )}
                  {(voiceLine || voice.notice) && (
                    <div className="mb-2 flex items-center gap-3 px-1" aria-live="polite" data-voice-engine={voice.engine ?? undefined}>
                      {voiceLine && (
                        <LookMark look={look} mood={mood} size={26} glow={glow} />
                      )}
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="text-[14px] font-medium text-atelier-ink">{voiceLine ?? voice.notice}</div>
                        {voiceLine && (
                          <div className="text-[12px] text-atelier-muted">{voice.notice ?? W.talkOver}</div>
                        )}
                      </div>
                      {voice.active && (
                        <button
                          type="button"
                          onClick={voice.stop}
                          aria-label={W.endVoiceLabel}
                          className="rounded-full border border-atelier-rule px-3.5 py-1.5 text-[13px] font-semibold text-atelier-ink hover:bg-atelier-ink/5"
                        >
                          {W.endVoice}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex items-end gap-2 rounded-[20px] border border-atelier-rule bg-atelier-ink/[0.03] py-1.5 pl-4 pr-1.5">
                    <textarea
                      id="producer-input"
                      ref={inputRef}
                      rows={1}
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        const el = e.target;
                        el.style.height = "auto";
                        el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void send({ text: input });
                        }
                      }}
                      onFocus={() => setTyping(true)}
                      onBlur={() => setTyping(false)}
                      placeholder={W.placeholder(name)}
                      maxLength={5000}
                      disabled={!loaded}
                      className="min-h-[34px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-snug text-atelier-ink outline-none placeholder:text-atelier-muted"
                    />
                    {busy || voice.phase === "speaking" || voice.held ? (
                      <button
                        type="button"
                        onClick={stopAnswer}
                        aria-label={W.stop}
                        className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full border border-atelier-rule text-atelier-ink"
                      >
                        <span className="h-3 w-3 rounded-[2px] bg-current" />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        aria-label={W.send}
                        disabled={!input.trim() || !loaded}
                        className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full bg-atelier-accent text-[#1a120a] disabled:opacity-40"
                      >
                        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
                        </svg>
                      </button>
                    )}
                  </div>
                </form>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}

function Cards({ cards, onOpen }: { cards: PreparedSend[]; onOpen: () => void }) {
  const total = cards.reduce((a, c) => a + c.credits, 0);
  return (
    <div className="overflow-hidden rounded-xl border border-atelier-rule">
      {cards.map((c, i) => (
        <div key={c.id} className="flex items-start gap-3 border-b border-atelier-rule px-3 py-2.5 last:border-b-0">
          <span className="w-4 flex-none pt-0.5 text-[12px] tabular-nums text-atelier-muted">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold leading-snug">{c.label}</div>
            <div className="mt-0.5 text-[12.5px] leading-snug text-atelier-muted">
              {[
                c.kind === "video" ? c.modelName : "Image",
                c.seconds ? `${c.seconds} s` : null,
                c.characterName ?? null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <Link
              href={c.href}
              onClick={onOpen}
              className="mt-1.5 inline-block text-[13px] font-semibold text-atelier-accent hover:underline"
            >
              {W.openComposer} →
            </Link>
          </div>
          <span className="flex-none pt-0.5 text-[13px] tabular-nums">{W.credits(c.credits)}</span>
        </div>
      ))}
      <div className="flex items-center justify-between bg-atelier-ink/[0.03] px-3 py-2 text-[12.5px] text-atelier-muted">
        <span>{W.prepared}</span>
        {cards.length > 1 && <span className="font-semibold tabular-nums text-atelier-ink">{W.total(total)}</span>}
      </div>
    </div>
  );
}

function NotesView({ notes, setNotes }: { notes: Note[]; setNotes: (n: Note[]) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  async function save(path: string) {
    setBusy(path);
    const content = drafts[path];
    const r = await saveProducerNote(path, content);
    setBusy(null);
    if (r.error) return setError(r.error);
    setNotes(notes.map((n) => (n.path === path ? { ...n, content } : n)));
    setDrafts(({ [path]: _dropped, ...rest }) => rest);
  }

  async function remove(path: string) {
    setBusy(path);
    const r = await deleteProducerNote(path);
    setBusy(null);
    if (r.error) return setError(r.error);
    setNotes(notes.filter((n) => n.path !== path));
  }

  async function removeAll() {
    setConfirmAll(false);
    const r = await clearProducerNotes();
    if (r.error) return setError(r.error);
    setNotes([]);
  }

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {notes.length === 0 && <p className="text-[14px] leading-relaxed text-atelier-muted">{W.noNotes}</p>}
      {notes.map((n) => {
        const draft = drafts[n.path];
        const dirty = draft !== undefined && draft !== n.content;
        return (
          <div key={n.path} className="rounded-xl border border-atelier-rule p-3">
            <div className="mb-1.5 text-[12px] font-medium text-atelier-muted">{n.path.replace(/^\/memories\//, "")}</div>
            <textarea
              id={`producer-note-${n.path}`}
              value={draft ?? n.content}
              onChange={(e) => setDrafts((d) => ({ ...d, [n.path]: e.target.value }))}
              rows={Math.min(8, Math.max(2, (draft ?? n.content).split("\n").length))}
              className="w-full resize-y bg-transparent text-[14px] leading-relaxed text-atelier-ink outline-none"
            />
            <div className="mt-1.5 flex justify-end gap-2">
              {dirty && (
                <button
                  type="button"
                  disabled={busy === n.path}
                  onClick={() => save(n.path)}
                  className="rounded-full bg-atelier-accent px-3 py-1 text-[12.5px] font-semibold text-[#1a120a] disabled:opacity-50"
                >
                  {W.save}
                </button>
              )}
              <button
                type="button"
                disabled={busy === n.path}
                onClick={() => remove(n.path)}
                className="rounded-full px-3 py-1 text-[12.5px] text-atelier-muted hover:text-[#ff8a80] disabled:opacity-50"
              >
                {W.delete}
              </button>
            </div>
          </div>
        );
      })}
      {error && <p className="text-sm text-[#ff8a80]">{error}</p>}
      {notes.length > 0 &&
        (confirmAll ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="flex-1">{W.clearAllConfirm}</span>
            <button type="button" onClick={removeAll} className="rounded-full bg-[#ff8a80] px-3 py-1 font-semibold text-[#1a120a]">
              {W.delete}
            </button>
            <button type="button" onClick={() => setConfirmAll(false)} className="rounded-full px-3 py-1 text-atelier-muted">
              {W.cancel}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmAll(true)} className="text-[13px] text-atelier-muted hover:text-[#ff8a80]">
            {W.clearAll}
          </button>
        ))}
    </div>
  );
}
