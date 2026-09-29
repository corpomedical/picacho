"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { BRAINS, isBrain, isBrainChoice, modelLabel, type Brain, type BrainChoice } from "@/lib/aly-chat/brains";
import { ACCEPT_ATTR, MAX_FILES_PER_MESSAGE } from "@/lib/aly-chat/file-types";
import type { FileRef, Source } from "@/lib/aly-chat/history";
import type { Doc } from "@/lib/aly-chat/docs";
import type { ViewLane, ViewMsg, ViewRender } from "@/lib/aly-chat/view";
import { finishChatUpload, keepAnswer, startChatUpload } from "@/lib/aly-chat/actions";
import type { LightDefaults } from "@/components/light/light-chat";
import { Markdown } from "./markdown";
import { DocPanel } from "./doc-panel";
import { RenderCard } from "./render-card";
import { useLiveVoice } from "@/components/producer/use-live-voice";
import { liveVoiceName } from "@/components/producer/live-voice-prefs";
import { ChatMenu } from "./chat-menu";
import { DocGlyph } from "./glyphs";
import styles from "./aly-chat.module.css";

// Aly's own page (2026-09-29, layout A: "the chat you already know"). The
// conversation in the middle, the text box at the bottom with the brain
// picker and Think harder, and a side panel that opens only when there's a
// document to look at. api/aly/chat answers; this streams it in.

type Attachment = { localId: string; name: string; state: "uploading" | "ready" | "error"; id?: string; error?: string };

export type ChatViewProps = {
  chatId: string | null;
  title: string | null;
  initial: ViewMsg[];
  docs: Doc[];
  name: string;
  firstName: string | null;
  brains: Record<Brain, boolean>;
  /** Free accounts: Claude only, no Think harder. */
  limited: boolean;
  project: { id: string; name: string } | null;
  projects: { id: string; name: string }[];
  defaults: LightDefaults;
  /** Where "Top up" goes on the web; null in the Android app. */
  topUpHref: string | null;
  /** Aly's live voice (GPT-Live), for whoever has her lamp (the live route decides). */
  liveVoice: boolean;
};

const PREF_KEY = "picacho.alyChat.brain";

function readPref(): { brain: BrainChoice; harder: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? "null") as { brain?: unknown; harder?: unknown } | null;
    return { brain: isBrainChoice(raw?.brain) ? raw.brain : "claude", harder: raw?.harder === true };
  } catch {
    return { brain: "claude", harder: false };
  }
}

function writePref(p: { brain: BrainChoice; harder: boolean }) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* a private window: the pick lasts this visit */
  }
}

/** Server-sent events from a fetch body. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        yield { event, data: JSON.parse(data) };
      } catch {
        /* a broken frame is skipped */
      }
    }
  }
}

export function ChatView(props: ChatViewProps) {
  const { t } = useLocale();
  const c = t.alyChat;
  const router = useRouter();
  const [chatId, setChatId] = useState<string | null>(props.chatId);
  const [title, setTitle] = useState<string | null>(props.title);
  const [messages, setMessages] = useState<ViewMsg[]>(props.initial);
  const [docs, setDocs] = useState<Doc[]>(props.docs);
  const [panelDoc, setPanelDoc] = useState<string | null>(null);
  const [brain, setBrain] = useState<BrainChoice>("claude");
  const [harder, setHarder] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; topUp?: boolean } | null>(null);
  const [menu, setMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickRef = useRef(true);

  // The brain and Think harder last between visits on this device.
  useEffect(() => {
    const p = readPref();
    const b = props.limited && (p.brain === "all" || !isBrain(p.brain)) ? "claude" : p.brain;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrain(b === "all" || props.brains[b] ? b : "claude");
    setHarder(props.limited ? false : p.harder);
  }, [props.limited, props.brains]);

  const choose = (b: BrainChoice) => {
    setBrain(b);
    setMenu(false);
    writePref({ brain: b, harder });
    inputRef.current?.focus();
  };
  const toggleHarder = () => {
    const next = !harder;
    setHarder(next);
    writePref({ brain, harder: next });
  };

  // Follow the answer while it streams, unless they scrolled up to read.
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // The box grows with what's typed, up to a third of the screen.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.max(160, window.innerHeight / 3))}px`;
  }, [text]);

  // ---- Files --------------------------------------------------------------

  async function addFiles(list: File[]) {
    const room = MAX_FILES_PER_MESSAGE - files.length;
    for (const file of list.slice(0, Math.max(0, room))) {
      const localId = crypto.randomUUID();
      setFiles((prev) => [...prev, { localId, name: file.name, state: "uploading" }]);
      const fail = (error: string) =>
        setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, state: "error", error } : f)));
      try {
        const start = await startChatUpload({ name: file.name, type: file.type, size: file.size, projectId: props.project?.id ?? null });
        if ("error" in start) {
          fail(start.error);
          continue;
        }
        const { error: upErr } = await createBrowserSupabase()
          .storage.from(start.bucket)
          .uploadToSignedUrl(start.path, start.token, file, { contentType: start.mime });
        if (upErr) {
          fail(c.failed);
          continue;
        }
        const done = await finishChatUpload(start.id);
        if ("error" in done) {
          fail(done.error);
          continue;
        }
        setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, state: "ready", id: start.id } : f)));
      } catch {
        fail(c.failed);
      }
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const list = Array.from(e.dataTransfer.files ?? []);
    if (list.length) void addFiles(list);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const list = Array.from(e.clipboardData.files ?? []);
    if (list.length) {
      e.preventDefault();
      void addFiles(list);
    }
  };

  // ---- Sending ------------------------------------------------------------

  const patchLast = (fn: (m: Extract<ViewMsg, { role: "assistant" }>) => Extract<ViewMsg, { role: "assistant" }>) =>
    setMessages((prev) => {
      const i = prev.length - 1;
      const last = prev[i];
      if (!last || last.role !== "assistant") return prev;
      const next = prev.slice();
      next[i] = fn(last);
      return next;
    });

  const patchLane = (lane: Brain, fn: (l: ViewLane) => ViewLane) =>
    patchLast((m) => ({ ...m, lanes: { ...m.lanes, [lane]: fn(m.lanes[lane] ?? { text: "", model: "" }) } }));

  /** Sends a message; resolves with the answer's words (the live voice speaks them). */
  async function send(override?: string): Promise<string> {
    const words = (override ?? text).trim();
    const ready = files.filter((f) => f.state === "ready" && f.id);
    if (busy || files.some((f) => f.state === "uploading")) return "";
    if (!words && ready.length === 0) return "";
    setNotice(null);
    setBusy(true);
    stickRef.current = true;

    const choice: BrainChoice = props.limited && brain === "all" ? "claude" : brain;
    const lanes: Brain[] = choice === "all" ? [...BRAINS] : [choice];
    const refs: FileRef[] = ready.map((f) => ({ id: f.id!, name: f.name, mime: "", kind: "text" }));
    const stamp = Date.now();
    setMessages((prev) => [
      ...prev,
      { key: `u-${stamp}`, seq: -1, role: "user", text: words, files: refs },
      {
        key: `a-${stamp}`,
        seq: -1,
        role: "assistant",
        brain: choice,
        lanes: Object.fromEntries(lanes.map((b) => [b, { text: "", model: "", streaming: true }])),
        kept: lanes[0],
        docs: [],
        renders: [],
        streaming: true,
      },
    ]);
    setText("");
    setFiles([]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let gotChat = chatId;
    let answer = "";
    try {
      const res = await fetch("/api/aly/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chatId,
          projectId: chatId ? null : props.project?.id ?? null,
          text: words,
          fileIds: ready.map((f) => f.id),
          brain: choice,
          harder: props.limited ? false : harder,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string; topUp?: boolean } | null;
        // Nothing was said: the message goes back in the box.
        setMessages((prev) => prev.slice(0, -2));
        setText(words);
        setFiles(ready);
        setNotice({ text: j?.error ?? c.failed, topUp: j?.topUp === true });
        return "";
      }
      for await (const { event, data } of readEvents(res.body)) {
        const d = data as Record<string, unknown>;
        const lane = isBrain(d.lane) ? d.lane : null;
        switch (event) {
          case "meta": {
            const id = String(d.chatId);
            gotChat = id;
            setChatId(id);
            if (d.isNew) window.history.replaceState(null, "", `/app/chat/${id}`);
            const seq = Number(d.seq);
            setMessages((prev) => prev.map((m, i) => (i === prev.length - 2 ? { ...m, seq } : i === prev.length - 1 ? { ...m, seq: seq + 1 } : m)));
            break;
          }
          case "delta":
            if (lane === lanes[0]) answer += String(d.text ?? "");
            if (lane) patchLane(lane, (l) => ({ ...l, text: l.text + String(d.text ?? ""), status: undefined }));
            break;
          case "status":
            if (lane) patchLane(lane, (l) => ({ ...l, status: String(d.text ?? "") }));
            break;
          case "sources":
            if (lane) patchLane(lane, (l) => ({ ...l, sources: d.sources as Source[] }));
            break;
          case "lane_done":
            if (lane) patchLane(lane, (l) => ({ ...l, model: String(d.model ?? ""), streaming: false, status: undefined }));
            break;
          case "lane_error":
            if (lane) patchLane(lane, (l) => ({ ...l, error: String(d.error ?? c.failed), streaming: false, status: undefined }));
            break;
          case "doc": {
            const doc = d as unknown as Doc;
            setDocs((prev) => {
              const i = prev.findIndex((x) => x.id === doc.id);
              if (i < 0) return [...prev, doc];
              const next = prev.slice();
              next[i] = doc;
              return next;
            });
            patchLast((m) => ({
              ...m,
              docs: [...m.docs.filter((x) => x.id !== doc.id), { id: doc.id, title: doc.title, version: doc.version }],
            }));
            setPanelDoc(doc.id);
            break;
          }
          case "card":
            patchLast((m) => ({ ...m, renders: [...m.renders, d as unknown as ViewRender] }));
            break;
          case "title":
            setTitle(String(d.title ?? ""));
            window.dispatchEvent(new Event("aly-chats-changed"));
            break;
          case "error":
            patchLast((m) => ({ ...m, error: String(d.error ?? c.failed) }));
            break;
          case "done":
            break;
        }
      }
    } catch {
      if (ctrl.signal.aborted) patchLast((m) => ({ ...m, error: c.stopped }));
      else patchLast((m) => ({ ...m, error: c.failed }));
    } finally {
      patchLast((m) => ({
        ...m,
        streaming: false,
        lanes: Object.fromEntries(Object.entries(m.lanes).map(([b, l]) => [b, { ...l!, streaming: false, status: undefined }])),
      }));
      abortRef.current = null;
      setBusy(false);
      if (gotChat) window.dispatchEvent(new Event("aly-chats-changed"));
      if (gotChat && !props.chatId) router.prefetch(`/app/chat/${gotChat}`);
    }
    return answer;
  }

  // The live voice: what they say goes into this chat as a message, and
  // Aly's answer is spoken back in her own words (use-live-voice.ts).
  const live = useLiveVoice({
    onDelegation: (words) => send(words || "(They didn't say anything clear.)"),
    onError: (message) => setNotice({ text: message }),
  });
  const canTalk = props.liveVoice && live.supported;

  const stop = () => abortRef.current?.abort();

  async function keep(m: Extract<ViewMsg, { role: "assistant" }>, b: Brain) {
    if (!chatId || m.seq < 0) return;
    const prevKept = m.kept;
    setMessages((prev) => prev.map((x) => (x.key === m.key && x.role === "assistant" ? { ...x, kept: b } : x)));
    const r = await keepAnswer(chatId, m.seq, b);
    if ("error" in r) {
      setMessages((prev) => prev.map((x) => (x.key === m.key && x.role === "assistant" ? { ...x, kept: prevKept } : x)));
      setNotice({ text: r.error });
    }
  }

  // ---- Rendering ----------------------------------------------------------

  const empty = messages.length === 0;
  const lastKey = messages[messages.length - 1]?.key;
  const openDoc = docs.find((d) => d.id === panelDoc) ?? null;
  const placeholder = props.project
    ? formatMsg(c.placeholderProject, { project: props.project.name })
    : formatMsg(c.placeholder, { name: props.name });

  const brainName = (b: BrainChoice) =>
    b === "claude" ? c.brainClaude : b === "gpt" ? c.brainGpt : b === "gemini" ? c.brainGemini : c.brainAll;

  const composer = (
    <div className={`${styles.box} relative`}>
      {live.active && (
        <div className="flex items-center gap-3 border-b border-atelier-rule px-4 py-2.5">
          <span
            className={`${styles.lamp} ${live.talking === "her" ? styles.lampThinking : ""}`}
            style={{ transform: `scale(${1 + Math.min(0.35, live.level * 0.6)})` }}
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 truncate text-sm text-atelier-muted">
            {live.phase === "connecting" ? c.talkConnecting : live.talking === "her" ? live.said || c.talkLive : live.heard || c.talkLive}
          </p>
          <button type="button" onClick={live.stop} className="rounded-full border border-atelier-rule px-3 py-1 text-xs text-atelier-ink hover:bg-atelier-ink/[0.05]">
            {c.talkEnd}
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {files.map((f) => (
            <span
              key={f.localId}
              title={f.error ?? f.name}
              className={`inline-flex max-w-[260px] items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs ${
                f.state === "error" ? "border-red-400/60 text-red-500" : "border-atelier-rule text-atelier-ink"
              }`}
            >
              <FileGlyph />
              <span className="min-w-0 truncate">{f.state === "error" ? f.error : f.name}</span>
              {f.state === "uploading" && <span className="text-atelier-muted">{c.uploading}</span>}
              <button
                type="button"
                aria-label={formatMsg(c.removeFile, { name: f.name })}
                className="rounded px-1 text-atelier-muted hover:text-atelier-ink"
                onClick={() => setFiles((prev) => prev.filter((x) => x.localId !== f.localId))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <label htmlFor="aly-chat-input" className="sr-only">
        {placeholder}
      </label>
      <textarea
        id="aly-chat-input"
        ref={inputRef}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={placeholder}
        className="block w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-6 text-atelier-ink outline-none placeholder:text-atelier-muted"
      />
      <div className="flex items-center gap-1.5 px-2 pb-2 pt-1">
        <button
          type="button"
          title={c.attach}
          aria-label={c.attach}
          onClick={() => fileRef.current?.click()}
          className="flex h-9 w-9 items-center justify-center rounded-full text-atelier-muted hover:bg-atelier-ink/[0.06] hover:text-atelier-ink"
        >
          <PlusGlyph />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (list.length) void addFiles(list);
          }}
        />
        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menu}
            title={c.brainMenu}
            onClick={() => setMenu((v) => !v)}
            className="flex h-9 items-center gap-2 rounded-full border border-atelier-rule px-3 text-[13px] text-atelier-ink hover:bg-atelier-ink/[0.05]"
          >
            {brain === "all" ? (
              <span className="flex -space-x-0.5">
                <span className={`${styles.brainDot} ${styles.claude}`} />
                <span className={`${styles.brainDot} ${styles.gpt}`} />
                <span className={`${styles.brainDot} ${styles.gemini}`} />
              </span>
            ) : (
              <span className={`${styles.brainDot} ${styles[brain]}`} />
            )}
            <span>{brainName(brain)}</span>
            <span aria-hidden="true" className="text-atelier-muted">
              ▾
            </span>
          </button>
          {menu && (
            <>
              <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setMenu(false)} />
              <div role="menu" className="absolute bottom-11 left-0 z-50 w-[300px] rounded-[20px] border border-atelier-rule bg-atelier-paper p-1.5 shadow-2xl">
                {(["claude", "gpt", "gemini", "all"] as BrainChoice[]).map((b) => {
                  const off = b === "all" ? props.limited : !props.brains[b];
                  const sub =
                    b === "claude" ? c.brainClaudeSub : b === "gpt" ? c.brainGptSub : b === "gemini" ? c.brainGeminiSub : c.brainAllSub;
                  return (
                    <button
                      key={b}
                      type="button"
                      role="menuitemradio"
                      aria-checked={brain === b}
                      disabled={off}
                      onClick={() => choose(b)}
                      className={`flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left ${
                        brain === b ? "bg-atelier-ink/[0.07]" : "hover:bg-atelier-ink/[0.04]"
                      } disabled:opacity-45`}
                    >
                      <span className="mt-1.5 flex w-6 flex-shrink-0 justify-center">
                        {b === "all" ? (
                          <span className="flex -space-x-0.5">
                            <span className={`${styles.brainDot} ${styles.claude}`} />
                            <span className={`${styles.brainDot} ${styles.gpt}`} />
                            <span className={`${styles.brainDot} ${styles.gemini}`} />
                          </span>
                        ) : (
                          <span className={`${styles.brainDot} ${styles[b]}`} />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-atelier-ink">{brainName(b)}</span>
                        <span className="block text-xs leading-5 text-atelier-muted">
                          {off ? (b === "all" ? c.paidOnly : c.brainOff) : sub}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          aria-pressed={harder}
          disabled={props.limited}
          title={props.limited ? c.paidOnly : c.thinkHarderHint}
          onClick={toggleHarder}
          className={`hidden h-9 items-center rounded-full border px-3 text-[13px] sm:flex ${
            harder ? "border-atelier-accent text-atelier-accent" : "border-atelier-rule text-atelier-muted hover:text-atelier-ink"
          } disabled:opacity-45`}
        >
          {c.thinkHarder}
        </button>
        <span className="flex-1" />
        {canTalk && (
          <button
            type="button"
            aria-pressed={live.active}
            title={formatMsg(c.talk, { name: props.name })}
            aria-label={formatMsg(c.talk, { name: props.name })}
            onClick={() => (live.active ? live.stop() : void live.start(liveVoiceName()))}
            className={`flex h-9 w-9 items-center justify-center rounded-full border ${
              live.active ? "border-atelier-accent text-atelier-accent" : "border-atelier-rule text-atelier-muted hover:text-atelier-ink"
            }`}
          >
            <WaveGlyph />
          </button>
        )}
        {busy ? (
          <button
            type="button"
            onClick={stop}
            aria-label={c.stop}
            title={c.stop}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-atelier-ink text-atelier-paper"
          >
            <span className="block h-3 w-3 rounded-[2px] bg-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void send()}
            aria-label={c.send}
            title={c.send}
            disabled={(!text.trim() && !files.some((f) => f.state === "ready")) || files.some((f) => f.state === "uploading")}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-atelier-accent text-white disabled:bg-atelier-ink/15 disabled:text-atelier-muted"
          >
            <ArrowUpGlyph />
          </button>
        )}
      </div>
      {/* Think harder on the phone sits under the row, where there's room. */}
      <div className="flex px-3 pb-2 sm:hidden">
        <button
          type="button"
          aria-pressed={harder}
          disabled={props.limited}
          onClick={toggleHarder}
          className={`h-8 rounded-full border px-3 text-xs ${harder ? "border-atelier-accent text-atelier-accent" : "border-atelier-rule text-atelier-muted"} disabled:opacity-45`}
        >
          {c.thinkHarder}
        </button>
      </div>
    </div>
  );

  return (
    <div
      data-aly-chat=""
      className={styles.root}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className={styles.main}>
        {/* The chat's own header: its name and its menu. */}
        {!empty && (
          <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-atelier-rule px-4">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-atelier-ink">{title ?? "…"}</p>
            {props.project && (
              <Link
                href={`/app/projects/${props.project.id}`}
                className="hidden max-w-[40%] truncate rounded-full border border-atelier-rule px-2.5 py-1 text-xs text-atelier-muted hover:text-atelier-ink sm:inline"
              >
                {formatMsg(c.inProject, { project: props.project.name })}
              </Link>
            )}
            {docs.length > 0 && !openDoc && (
              <button
                type="button"
                onClick={() => setPanelDoc(docs[docs.length - 1].id)}
                className="rounded-full border border-atelier-rule px-2.5 py-1 text-xs text-atelier-muted hover:text-atelier-ink"
              >
                {c.document} · {docs.length}
              </button>
            )}
            {chatId && (
              <ChatMenu
                chatId={chatId}
                title={title ?? ""}
                projectId={props.project?.id ?? null}
                projects={props.projects}
                onRenamed={(tt) => {
                  setTitle(tt);
                  window.dispatchEvent(new Event("aly-chats-changed"));
                }}
                onDeleted={() => {
                  window.dispatchEvent(new Event("aly-chats-changed"));
                  router.push(`/app/chat?n=${Date.now()}`);
                }}
                onMoved={() => {
                  window.dispatchEvent(new Event("aly-chats-changed"));
                  router.refresh();
                }}
              />
            )}
          </div>
        )}

        <div ref={scrollerRef} onScroll={onScroll} className={styles.scroller}>
          {empty ? (
            <div className={`${styles.column} flex min-h-full flex-col justify-center pb-10 pt-8`}>
              <div className="mb-6 flex items-center gap-3">
                <span className={styles.lamp} aria-hidden="true" />
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-atelier-ink sm:text-3xl">
                    {props.firstName ? formatMsg(c.greeting, { name: props.firstName }) : c.greetingNoName}
                  </h1>
                  <p className="text-lg text-atelier-muted sm:text-xl">
                    {props.project ? formatMsg(c.placeholderProject, { project: props.project.name }) : c.ask}
                  </p>
                </div>
              </div>
              {composer}
              {notice && <Notice notice={notice} topUpHref={props.topUpHref} topUpLabel={c.topUp} />}
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[c.idea1, c.idea2, c.idea3, c.idea4].map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => {
                      setText(idea);
                      inputRef.current?.focus();
                    }}
                    className="rounded-2xl border border-atelier-rule px-4 py-3 text-left text-sm text-atelier-muted hover:border-atelier-ink/20 hover:text-atelier-ink"
                  >
                    {idea}
                  </button>
                ))}
              </div>
              {props.limited && <p className="mt-4 text-xs text-atelier-muted">{c.freeNote}</p>}
            </div>
          ) : (
            <div className={`${styles.column} @container space-y-7 py-6`}>
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.key} className="flex flex-col items-end gap-1.5">
                    {m.files.length > 0 && (
                      <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
                        {m.files.map((f) => (
                          <span key={f.id} className="inline-flex max-w-[240px] items-center gap-1.5 rounded-xl border border-atelier-rule px-2.5 py-1 text-xs text-atelier-muted">
                            <FileGlyph />
                            <span className="truncate">{f.name}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {m.text && (
                      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-md bg-atelier-ink/[0.07] px-4 py-2.5 text-[15px] leading-6 text-atelier-ink">
                        {m.text}
                      </div>
                    )}
                  </div>
                ) : (
                  <Answer
                    key={m.key}
                    m={m}
                    last={m.key === lastKey}
                    chatId={chatId}
                    defaults={props.defaults}
                    onKeep={(b) => void keep(m, b)}
                    onOpenDoc={setPanelDoc}
                    topUpHref={props.topUpHref}
                  />
                ),
              )}
            </div>
          )}
        </div>

        {!empty && (
          <div className="flex-shrink-0 pb-3 pt-1">
            <div className={styles.column}>
              {notice && <Notice notice={notice} topUpHref={props.topUpHref} topUpLabel={c.topUp} />}
              {composer}
              <p className="mt-1.5 text-center text-[11px] text-atelier-muted">{formatMsg(c.disclaimer, { name: props.name })}</p>
            </div>
          </div>
        )}
      </div>

      {openDoc && (
        <DocPanel
          key={openDoc.id}
          doc={openDoc}
          docs={docs}
          onPick={setPanelDoc}
          onClose={() => setPanelDoc(null)}
          onSaved={(d) => setDocs((prev) => prev.map((x) => (x.id === d.id ? d : x)))}
        />
      )}

      {dragging && (
        <div className={styles.drop}>
          <p className="text-sm font-medium text-atelier-ink">{c.dropHere}</p>
        </div>
      )}
    </div>
  );
}

function Notice({ notice, topUpHref, topUpLabel }: { notice: { text: string; topUp?: boolean }; topUpHref: string | null; topUpLabel: string }) {
  return (
    <p role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-2xl border border-atelier-rule px-3 py-2 text-sm text-atelier-ink">
      <span>{notice.text}</span>
      {notice.topUp && topUpHref && (
        <Link href={topUpHref} className="font-medium text-atelier-accent underline underline-offset-2">
          {topUpLabel}
        </Link>
      )}
    </p>
  );
}

function Answer({
  m,
  last,
  chatId,
  defaults,
  onKeep,
  onOpenDoc,
  topUpHref,
}: {
  m: Extract<ViewMsg, { role: "assistant" }>;
  last: boolean;
  chatId: string | null;
  defaults: LightDefaults;
  onKeep: (b: Brain) => void;
  onOpenDoc: (id: string) => void;
  topUpHref: string | null;
}) {
  const { t } = useLocale();
  const c = t.alyChat;
  const lanes = (Object.keys(m.lanes) as Brain[]).filter(isBrain);
  const compare = lanes.length > 1;
  const brainName = (b: Brain) => (b === "claude" ? c.brainClaude : b === "gpt" ? c.brainGpt : c.brainGemini);

  const laneBody = (l: ViewLane) => (
    <>
      {l.status && !l.text && <p className="text-sm text-atelier-muted">{l.status}…</p>}
      {l.text ? (
        <div className={l.streaming ? styles.caret : undefined}>
          <Markdown text={l.text} copyLabel={c.copy} copiedLabel={c.copied} size={compare ? "sm" : "md"} />
        </div>
      ) : l.streaming && !l.status ? (
        <p className="text-sm text-atelier-muted">{c.thinking}</p>
      ) : null}
      {l.status && l.text && <p className="mt-2 text-sm text-atelier-muted">{l.status}…</p>}
      {l.error && <p className="text-sm text-red-500">{l.error}</p>}
      {l.sources && l.sources.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {l.sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-[220px] truncate rounded-full border border-atelier-rule px-2.5 py-0.5 text-[11px] text-atelier-muted hover:text-atelier-ink"
            >
              {s.title || new URL(s.url).hostname}
            </a>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="flex gap-3">
      <span className={`${styles.lamp} mt-1 ${m.streaming ? styles.lampThinking : ""}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {compare ? (
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
            {lanes.map((b) => {
              const l = m.lanes[b]!;
              const isKept = m.kept === b;
              return (
                <div
                  key={b}
                  className={`min-w-0 rounded-2xl border p-3 ${isKept && !m.streaming ? "border-atelier-accent/60" : "border-atelier-rule"}`}
                >
                  <div className="mb-2 flex min-w-0 items-center gap-2 text-xs font-medium text-atelier-ink">
                    <span className={`${styles.brainDot} ${styles[b]}`} />
                    <span className="flex-shrink-0">{brainName(b)}</span>
                    <span className="min-w-0 truncate font-normal text-atelier-muted">{l.model ? modelLabel(l.model) : ""}</span>
                  </div>
                  <div>{laneBody(l)}</div>
                  {!m.streaming && !l.error && l.text && (
                    <button
                      type="button"
                      disabled={!last || isKept}
                      title={c.keepHint}
                      onClick={() => onKeep(b)}
                      className={`mt-3 rounded-full border px-3 py-1 text-xs ${
                        isKept ? "border-atelier-accent text-atelier-accent" : "border-atelier-rule text-atelier-muted hover:text-atelier-ink"
                      } disabled:cursor-default`}
                    >
                      {isKept ? `✓ ${c.kept}` : c.keep}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          lanes.map((b) => <div key={b}>{laneBody(m.lanes[b]!)}</div>)
        )}

        {m.docs.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.docs.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onOpenDoc(d.id)}
                className="inline-flex items-center gap-2 rounded-xl border border-atelier-rule px-3 py-2 text-sm text-atelier-ink hover:bg-atelier-ink/[0.04]"
              >
                <DocGlyph />
                <span className="max-w-[240px] truncate">{d.title}</span>
                <span className="text-xs text-atelier-muted">{formatMsg(c.version, { n: d.version })}</span>
              </button>
            ))}
          </div>
        )}

        {m.renders.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-3 @xl:grid-cols-2">
            {m.renders.map((r) => (
              <RenderCard key={r.id} card={r} chatId={chatId} seq={m.seq} defaults={defaults} />
            ))}
          </div>
        )}

        {m.error && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-atelier-muted">
            <span>{m.error}</span>
            {m.topUp && topUpHref && (
              <Link href={topUpHref} className="text-atelier-accent underline">
                {c.topUp}
              </Link>
            )}
          </p>
        )}

        {!compare && !m.streaming && lanes[0] && m.lanes[lanes[0]]?.text && (
          <AnswerFoot text={m.lanes[lanes[0]]!.text} model={m.lanes[lanes[0]]!.model} />
        )}
      </div>
    </div>
  );
}

function AnswerFoot({ text, model }: { text: string; model: string }) {
  const { t } = useLocale();
  const c = t.alyChat;
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-3 text-xs text-atelier-muted">
      <button
        type="button"
        onClick={() =>
          navigator.clipboard
            ?.writeText(text)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {})
        }
        className="rounded px-1 py-0.5 hover:bg-atelier-ink/[0.06] hover:text-atelier-ink"
      >
        {copied ? c.copied : c.copy}
      </button>
      {model && <span>{modelLabel(model)}</span>}
    </div>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M10 4v12M4 10h12" strokeLinecap="round" />
    </svg>
  );
}

function WaveGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 8v4M7.5 5.5v9M11 7v6M14.5 4.5v11M18 8.5v3" />
    </svg>
  );
}

function ArrowUpGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M10 16V4M5 9l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M4 1.5h5L12.5 5v9.5h-8.5z" strokeLinejoin="round" />
      <path d="M9 1.5V5h3.5" strokeLinejoin="round" />
    </svg>
  );
}
