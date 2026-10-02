"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { runGeneration, pollGeneration, requestGenerationCancel, recordDownload } from "@/lib/generations/actions";
import { reserveChatAttachmentPath, finalizeChatAttachment } from "@/lib/attachments/actions";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import {
  DEFAULT_IMAGE_ASPECT,
  DEFAULT_IMAGE_QUALITY,
  defaultImageResolution,
} from "@/lib/generations/providers/image-resolution";
import { isStaleDeployError } from "@/lib/stale-deploy";
import { getLightTake, type LightTake } from "@/lib/light/actions";
import { LIGHT_HOME, studioHref, type LightPrepared } from "@/lib/light/mode";
import { MenuIcon, PlusIcon, useLightShell } from "./light-shell";
import { MediaViewer } from "@/components/media-viewer";
import { AccountMenuButton } from "@/components/account-menu/account-menu";

type Kind = "video" | "image";
type Photo = { url: string; path: string };

type Turn =
  | { role: "user"; key: string; text: string; photoUrl: string | null }
  | {
      role: "take";
      key: string;
      id: string;
      kind: Kind;
      prompt: string;
      state: "working" | "done" | "failed" | "stopped";
      take: LightTake | null;
      error: string | null;
    };

export type LightDefaults = {
  videoModelId: string;
  videoDurationSeconds: number;
  videoAspectRatio: "16:9" | "9:16" | null;
  imageModelId: string;
};

const POLL_MS = 4000;
const noSubscribe = () => () => {};

export function Ridges({ height }: { height: number }) {
  return (
    <svg aria-hidden="true" className="pl-ridges" height={height} viewBox="0 0 1168 300" preserveAspectRatio="none">
      <path d="M0 170 L140 122 L260 150 L420 64 L470 96 L560 128 L700 92 L860 150 L1000 104 L1168 140 L1168 300 L0 300Z" fill="var(--pl-ridge-back)" />
      <path d="M0 232 L180 192 L330 222 L520 164 L640 204 L800 178 L960 216 L1080 188 L1168 206 L1168 300 L0 300Z" fill="var(--pl-ridge-front)" />
    </svg>
  );
}

function Mark() {
  return (
    <span aria-hidden="true" className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg" style={{ background: "var(--pl-card)", border: "1px solid var(--pl-card-line)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand-icon.png" alt="" width={22} height={22} className="h-[22px] w-[22px] dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand-icon-dark.png" alt="" width={22} height={22} className="hidden h-[22px] w-[22px] dark:block" />
    </span>
  );
}

const icon = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export function VideoGlyph() {
  return (
    <svg {...icon} stroke="var(--pl-accent)">
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </svg>
  );
}
export function PictureGlyph() {
  return (
    <svg {...icon} stroke="var(--pl-accent)">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

/**
 * Light's top bar: the phone's menu button, the logo (a new chat), credits
 * and the account. Shared by the chat with Aly and Light's own box.
 */
export function LightTopBar({ creditsLeft, initial }: { creditsLeft: number; initial: string }) {
  const { t, locale } = useLocale();
  const l = t.light;
  const { openMenu, newChat } = useLightShell();
  // "{n} credits" with the number in ochre, as the boards draw it.
  const [creditsBefore, creditsAfter = ""] = l.creditsLeft.split("{n}");
  return (
    <header className="relative flex h-14 flex-shrink-0 items-center justify-between px-2 md:h-[68px] md:px-6">
      <button type="button" className="pl-iconbtn md:hidden" aria-label={l.openMenu} onClick={openMenu}>
        <MenuIcon />
      </button>
      {/* The logo is home: a new chat (operator, 2026-09-28). */}
      <Link
        href="/app/light"
        onClick={(e) => {
          e.preventDefault();
          newChat();
        }}
        className="flex items-center gap-2 md:gap-2.5"
        style={{ color: "var(--pl-ink)", textDecoration: "none" }}
      >
        <span className="pl-display text-[20px] font-semibold md:text-[22px]">Picacho</span>
        <span className="rounded-[10px] px-2 py-0.5 text-[11px] font-semibold md:px-[9px] md:py-[3px] md:text-xs" style={{ color: "var(--pl-muted)", background: "var(--pl-rail)" }}>
          {l.badge}
        </span>
      </Link>
      <div className="flex items-center gap-3">
        {/* Both open the account menu (draft B, 2026-10-02), in Light's colours. */}
        <AccountMenuButton
          className="hidden rounded-[18px] px-3.5 py-2 text-sm md:inline-block"
          style={{ border: "1px solid var(--pl-line)", color: "var(--pl-ink)", textDecoration: "none" }}
        >
          {creditsBefore}
          <strong style={{ color: "var(--pl-accent)" }}>{creditsLeft.toLocaleString(locale)}</strong>
          {creditsAfter}
        </AccountMenuButton>
        <AccountMenuButton label={l.account} className="flex h-11 w-11 items-center justify-center md:h-10 md:w-10">
          <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-sm font-semibold text-white md:h-10 md:w-10 md:text-[15px]" style={{ background: "#a84e24" }}>
            {initial}
          </span>
        </AccountMenuButton>
      </div>
    </header>
  );
}

// Web Speech API, where the browser has it (Chrome, Edge, Safari). The mic is
// simply not offered elsewhere rather than offered and failing.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
function speechCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function LightChat({
  firstName,
  initial,
  creditsLeft,
  defaults,
  openedTake,
  prepared = null,
}: {
  firstName: string | null;
  initial: string;
  creditsLeft: number;
  defaults: LightDefaults;
  openedTake: LightTake | null;
  /** A send the assistant prepared: fills the box, unsent (app/app/light/page.tsx). */
  prepared?: LightPrepared | null;
}) {
  const { t, locale } = useLocale();
  const l = t.light;
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(prepared?.kind ?? openedTake?.contentType ?? "video");
  const [text, setText] = useState(prepared?.prompt ?? "");
  // The assistant's character, engine and length ride along on the next send,
  // so it costs what her card said; ✕ drops them back to Light's defaults.
  const [fromAssistant, setFromAssistant] = useState<LightPrepared | null>(prepared);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [listening, setListening] = useState(false);
  // After hydration only: the server render cannot know the browser.
  const canSpeak = useSyncExternalStore(
    noSubscribe,
    () => speechCtor() !== null,
    () => false,
  );
  const recognitionRef = useRef<Recognition | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [turns, setTurns] = useState<Turn[]>(() =>
    openedTake
      ? [
          { role: "user", key: `u-${openedTake.id}`, text: openedTake.prompt, photoUrl: null },
          {
            role: "take",
            key: `t-${openedTake.id}`,
            id: openedTake.id,
            kind: openedTake.contentType,
            prompt: openedTake.prompt,
            state: openedTake.status === "succeeded" ? "done" : openedTake.status === "generating" ? "working" : "failed",
            take: openedTake,
            error: null,
          },
        ]
      : [],
  );
  const working = turns.some((x) => x.role === "take" && x.state === "working");

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length]);

  // The assistant's words now sit in the box; take them out of the address,
  // so a reload or a shared link doesn't fill the box again.
  useEffect(() => {
    if (!prepared) return;
    window.history.replaceState(null, "", LIGHT_HOME);
    requestAnimationFrame(() => inputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateTake(id: string, patch: Partial<Extract<Turn, { role: "take" }>>) {
    setTurns((prev) => prev.map((x) => (x.role === "take" && x.id === id ? { ...x, ...patch } : x)));
  }

  async function settle(id: string) {
    const take = await getLightTake(id);
    const state = take?.status === "succeeded" ? "done" : take?.status === "cancelled" ? "stopped" : "failed";
    updateTake(id, { state, take });
    // The rail's Recent list is the layout's; refresh it once the take has landed.
    router.refresh();
  }

  async function follow(id: string) {
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      let res;
      try {
        res = await pollGeneration(id);
      } catch {
        continue; // a dropped poll is not a failed render
      }
      if (res.error !== null) continue;
      if (res.state === "pending") continue;
      await settle(id);
      return;
    }
  }

  // A take opened from Recent while still rendering keeps following it.
  useEffect(() => {
    if (openedTake?.status !== "generating") return;
    const timer = window.setTimeout(() => void follow(openedTake.id), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** `kindOverride`: "Try again" on a failed take makes the same kind it was. */
  async function send(prompt: string, kindOverride?: Kind) {
    const clean = prompt.trim();
    const k = kindOverride ?? kind;
    if (!clean || working || uploading) return;
    setNotice("");
    const id = crypto.randomUUID();
    const sentPhoto = photo;
    const fd = new FormData();
    fd.set("generation_id", id);
    fd.set("prompt", clean);
    fd.set("content_type", k);
    const aly = fromAssistant;
    fd.set("character_id", aly?.characterId ?? "");
    fd.set("use_outfit", "0");
    fd.set("payload_version", "2");
    if (sentPhoto) fd.set("attachment_roles", JSON.stringify([{ url: sentPhoto.url, role: "reference" }]));
    // The very values a new account's composer opens on (generate-form.tsx),
    // so a Light send renders and costs the same as the studio's default.
    if (k === "image") {
      fd.set("image_model_id", defaults.imageModelId);
      fd.set("image_resolution", defaultImageResolution(defaults.imageModelId));
      fd.set("image_aspect", DEFAULT_IMAGE_ASPECT);
      fd.set("image_quality", DEFAULT_IMAGE_QUALITY);
    } else {
      fd.set("video_model_id", aly?.videoModelId ?? defaults.videoModelId);
      fd.set("video_duration_seconds", String(aly?.videoModelId && aly.seconds ? aly.seconds : defaults.videoDurationSeconds));
      if (defaults.videoAspectRatio) fd.set("video_aspect_ratio", defaults.videoAspectRatio);
    }
    setTurns((prev) => [
      ...prev,
      { role: "user", key: `u-${id}`, text: clean, photoUrl: sentPhoto?.url ?? null },
      { role: "take", key: `t-${id}`, id, kind: k, prompt: clean, state: "working", take: null, error: null },
    ]);
    setText("");
    setPhoto(null);
    setFromAssistant(null);

    let result;
    try {
      result = await runGeneration(fd);
    } catch (err) {
      const reason = isStaleDeployError(err) ? t.generate.refreshNeeded : t.generate.submitFailed;
      updateTake(id, { state: "failed", error: reason });
      setText(clean);
      return;
    }
    if (result.error !== null) {
      updateTake(id, { state: "failed", error: result.error });
      setText(clean);
      return;
    }
    if (result.pending) {
      await follow(result.id);
      return;
    }
    await settle(result.id);
  }

  async function stop(id: string) {
    await requestGenerationCancel(id);
  }

  function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setNotice("");
    (async () => {
      const reserve = new FormData();
      reserve.set("name", file.name);
      reserve.set("size", String(file.size));
      const reserved = await reserveChatAttachmentPath(reserve);
      if (reserved.error !== null || !reserved.path) throw new Error(reserved.error ?? "reserve");
      const { error: uploadError } = await createBrowserSupabase()
        .storage.from("chat-attachments")
        .upload(reserved.path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (uploadError) throw uploadError;
      const done = new FormData();
      done.set("path", reserved.path);
      done.set("name", file.name);
      done.set("type", file.type);
      done.set("size", String(file.size));
      const finalized = await finalizeChatAttachment(done);
      if (finalized.error !== null || !finalized.attachment) throw new Error(finalized.error ?? "finalize");
      setPhoto({ url: finalized.attachment.url, path: finalized.attachment.path });
    })()
      .catch(() => setNotice(l.uploadFailed))
      .finally(() => setUploading(false));
  }

  function toggleMic() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = locale === "en" ? "en-US" : locale === "es" ? "es-ES" : locale === "pt" ? "pt-BR" : "it-IT";
    rec.interimResults = false;
    rec.continuous = false;
    const before = text;
    rec.onresult = (e) => {
      const said = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (said) setText(before ? `${before} ${said}` : said);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  // A follow-up or "Make another" fills the box; nothing is charged until Send.
  function prefill(prompt: string, nextKind: Kind) {
    setKind(nextKind);
    setText(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function share(take: LightTake) {
    if (!take.resultUrl) return;
    const url = new URL(take.resultUrl, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNotice(l.linkCopied);
    } catch {
      // Closing the share sheet is not an error.
    }
  }

  const empty = turns.length === 0;

  const composer = (big: boolean) => (
    <div className={`pl-box w-full ${big ? "rounded-[26px] px-3 pb-2 pt-3.5 md:rounded-[28px] md:px-5 md:pb-3 md:pt-[18px]" : "rounded-[28px] p-2"}`}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhotoPicked} />
      {fromAssistant && (fromAssistant.characterName || fromAssistant.videoModelName) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-[13px]" style={{ color: "var(--pl-muted)" }}>
          <span>
            {l.fromAssistant}:{" "}
            <span style={{ color: "var(--pl-ink)" }}>
              {[
                fromAssistant.characterName,
                kind === "video" ? fromAssistant.videoModelName : null,
                kind === "video" && fromAssistant.videoModelName && fromAssistant.seconds ? `${fromAssistant.seconds} s` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <button type="button" className="pl-chip-btn h-8 px-3 text-xs" onClick={() => setFromAssistant(null)}>
            {l.dropAssistant}
          </button>
        </div>
      )}
      {photo && (
        <div className="mb-2 flex items-center gap-2 px-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt="" className="h-14 w-14 rounded-xl object-cover" />
          <button type="button" className="pl-chip-btn h-8 px-3 text-xs" onClick={() => setPhoto(null)}>
            {l.removePhoto}
          </button>
        </div>
      )}
      {/* The follow-up box is one row on a desktop (board Chat) and stacks on
          a phone like the home box, so the words keep the full width. */}
      <div className={big ? "flex flex-col gap-2.5 md:gap-3.5" : "flex flex-col gap-2 px-1 pt-1 md:flex-row md:items-center md:gap-1.5 md:p-0"}>
        {!big && (
          <button type="button" className="pl-iconbtn !hidden md:!inline-flex" aria-label={l.addPhoto} onClick={() => fileRef.current?.click()} disabled={uploading}>
            <PlusIcon />
          </button>
        )}
        <label htmlFor={big ? "pl-ask" : "pl-ask2"} className="sr-only">
          {l.describeLabel}
        </label>
        <textarea
          ref={inputRef}
          id={big ? "pl-ask" : "pl-ask2"}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(text);
            }
          }}
          placeholder={listening ? l.listening : big ? l.placeholder : l.placeholderFollow}
          className={`min-w-0 resize-none border-0 bg-transparent outline-none ${big ? "px-1.5 py-0.5 text-[16px] md:px-1 md:py-1 md:text-[17px]" : "px-1.5 py-0.5 text-[16px] md:flex-grow md:p-0"}`}
          style={{ color: "var(--pl-ink)", maxHeight: 160, fieldSizing: "content" } as React.CSSProperties}
        />
        <div className={big ? "flex items-center gap-1 md:gap-2" : "flex items-center gap-1 md:contents"}>
          <button type="button" className={big ? "pl-iconbtn" : "pl-iconbtn md:!hidden"} aria-label={l.addPhoto} onClick={() => fileRef.current?.click()} disabled={uploading}>
            <PlusIcon />
          </button>
          <div role="group" aria-label={l.whatToMake} className="pl-seg">
            <button type="button" aria-pressed={kind === "video"} onClick={() => setKind("video")} className={big ? "" : "!h-[34px] !px-3.5 !text-[13px]"}>
              {l.video}
            </button>
            <button type="button" aria-pressed={kind === "image"} onClick={() => setKind("image")} className={big ? "" : "!h-[34px] !px-3.5 !text-[13px]"}>
              {l.picture}
            </button>
          </div>
          <div className={big ? "flex-grow" : "flex-grow md:hidden"} />
          {canSpeak && (
            <button
              type="button"
              className="pl-iconbtn"
              aria-label={l.speak}
              aria-pressed={listening}
              onClick={toggleMic}
              style={listening ? { background: "var(--pl-accent)", color: "#fff" } : undefined}
            >
              <svg {...icon}>
                <rect x="9" y="3" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
          )}
          {working ? (
            <button
              type="button"
              className="pl-iconbtn"
              aria-label={l.stop}
              style={{ background: "#a84e24", color: "#fff" }}
              onClick={() => {
                const live = turns.find((x) => x.role === "take" && x.state === "working");
                if (live && live.role === "take") void stop(live.id);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="pl-iconbtn"
              aria-label={l.send}
              disabled={!text.trim() || uploading}
              onClick={() => void send(text)}
              style={{ background: text.trim() ? "#a84e24" : "var(--pl-send-idle)", color: "#fff", opacity: 1 }}
            >
              <svg {...icon} strokeWidth={2}>
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {(uploading || notice) && (
        <p role="status" className="px-2 pt-1 text-[13px]" style={{ color: "var(--pl-muted)" }}>
          {uploading ? l.photoUploading : notice}
        </p>
      )}
    </div>
  );

  const ideas: { text: string; kind: Kind }[] = [
    { text: l.idea1, kind: "video" },
    { text: l.idea2, kind: "image" },
    { text: l.idea3, kind: "image" },
    { text: l.idea4, kind: "video" },
  ];

  return (
    <main className="pl-surface relative flex h-full min-w-0 flex-col overflow-hidden">
      <div aria-hidden="true" className="pl-sky" />
      <div className="hidden md:block">
        <Ridges height={empty ? 300 : 200} />
      </div>
      <div className="md:hidden">
        <Ridges height={220} />
      </div>

      <LightTopBar creditsLeft={creditsLeft} initial={initial} />

      {empty ? (
        <>
          {/* Desktop: greeting, the box, four ideas, centred (board Main). */}
          <div className="relative hidden flex-grow flex-col items-center justify-center gap-9 px-12 pb-[72px] md:flex">
            <div className="flex w-full max-w-[760px] flex-col gap-1.5">
              <span className="pl-display text-[40px] font-semibold leading-tight" style={{ color: "var(--pl-accent)" }}>
                {firstName ? formatMsg(l.hiName, { name: firstName }) : l.hiThere}
              </span>
              <div className="pl-display text-[40px] font-medium leading-tight" style={{ color: "var(--pl-soft)" }}>
                {l.whatToday}
              </div>
            </div>
            <div className="w-full max-w-[760px]">{composer(true)}</div>
            <div className="grid w-full max-w-[760px] grid-cols-4 gap-3">
              {ideas.map((idea) => (
                <button key={idea.text} type="button" className="pl-idea flex h-32 flex-col justify-between" onClick={() => prefill(idea.text, idea.kind)}>
                  <span>{idea.text}</span>
                  {idea.kind === "video" ? <VideoGlyph /> : <PictureGlyph />}
                </button>
              ))}
            </div>
          </div>
          {/* Phone: greeting in the middle, ideas and the box at the bottom (board PhoneHomeRidge). */}
          <div className="relative flex flex-grow flex-col md:hidden">
            <div className="flex flex-grow flex-col justify-center gap-1.5 px-7 pb-10">
              <span className="pl-display text-[32px] font-semibold" style={{ color: "var(--pl-accent)" }}>
                {firstName ? formatMsg(l.hiName, { name: firstName }) : l.hiThere}
              </span>
              <span className="pl-display text-[32px] font-medium leading-[1.15]" style={{ color: "var(--pl-soft)" }}>
                {l.whatToday}
              </span>
            </div>
            <div className="flex gap-2.5 overflow-x-auto px-4 pb-3.5 [scrollbar-width:none]">
              {ideas.map((idea) => (
                <button key={idea.text} type="button" className="pl-idea w-[168px] flex-shrink-0 !rounded-2xl !p-3.5 !leading-[1.35]" onClick={() => prefill(idea.text, idea.kind)}>
                  {idea.text}
                </button>
              ))}
            </div>
            <div className="px-3 pb-[max(12px,env(safe-area-inset-bottom))]">{composer(true)}</div>
          </div>
        </>
      ) : (
        <>
          <div className="relative flex-grow overflow-y-auto px-4 pt-2 md:px-12">
            <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 pb-6">
              {turns.map((turn) =>
                turn.role === "user" ? (
                  <div
                    key={turn.key}
                    className="max-w-[85%] self-end px-5 py-3.5 text-[16px] leading-normal md:max-w-[520px]"
                    style={{ background: "var(--pl-bubble)", borderRadius: "24px 24px 6px 24px" }}
                  >
                    {turn.photoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={turn.photoUrl} alt="" className="mb-2 h-24 w-24 rounded-xl object-cover" />
                    )}
                    {turn.text}
                  </div>
                ) : (
                  <TakeTurn
                    key={turn.key}
                    turn={turn}
                    onShare={share}
                    onAgain={() => prefill(turn.prompt, turn.kind)}
                    onFollow={(chip, nextKind) => prefill(`${turn.prompt}. ${chip}.`, nextKind)}
                    onRetry={() => void send(turn.prompt, turn.kind)}
                  />
                ),
              )}
              <div ref={endRef} />
            </div>
          </div>
          <div className="relative flex flex-shrink-0 flex-col items-center gap-2.5 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 md:px-12 md:pb-4">
            <div className="w-full max-w-[760px]">{composer(false)}</div>
            <div className="hidden text-xs md:block" style={{ color: "var(--pl-muted)" }}>
              {l.disclaimer}
            </div>
          </div>
        </>
      )}
      {empty && (
        <div className="relative hidden pb-4 text-center text-xs md:block" style={{ color: "var(--pl-muted)" }}>
          {l.disclaimer}
        </div>
      )}
    </main>
  );
}

function TakeTurn({
  turn,
  onShare,
  onAgain,
  onFollow,
  onRetry,
}: {
  turn: Extract<Turn, { role: "take" }>;
  onShare: (take: LightTake) => void;
  onAgain: () => void;
  onFollow: (chip: string, kind: Kind) => void;
  /** Sends the same words again (it charges again, as a new send). */
  onRetry: () => void;
}) {
  const { t, locale } = useLocale();
  const l = t.light;
  const take = turn.take;
  const video = turn.kind === "video";
  // The take open full screen (media-viewer.tsx) — a video carries on from
  // where the chat's player was.
  const [viewing, setViewing] = useState<{ startAt?: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const openViewer = () => {
    const v = videoRef.current;
    setViewing({ startAt: v?.currentTime || undefined });
    v?.pause();
  };

  if (turn.state === "working") {
    return (
      <div className="flex items-start gap-4">
        <Mark />
        <div className="flex flex-col gap-2.5">
          <div className="text-[16px] leading-relaxed">{video ? l.makingVideo : l.makingPicture}</div>
          <div
            className={`flex flex-col items-center justify-center gap-3.5 rounded-[20px] ${video ? "aspect-video w-[min(600px,72vw)]" : "aspect-square w-[min(300px,60vw)]"}`}
            style={{ background: "var(--pl-rail)" }}
          >
            <div className="pl-progress">
              <div />
            </div>
            <span className="px-4 text-center text-[13px]" style={{ color: "var(--pl-muted)" }}>
              {video ? l.waitVideo : l.waitPicture}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const charged = take
    ? take.freeGeneration
      ? l.usedFree
      : take.creditsUsed === 0
        ? l.usedNone
        : take.creditsUsed === 1
          ? l.usedOneCredit
          : formatMsg(l.usedCredits, { n: take.creditsUsed.toLocaleString(locale) })
    : null;

  if (turn.state !== "done" || !take?.resultUrl) {
    return (
      <div className="flex items-start gap-4">
        <Mark />
        <div className="flex flex-col gap-2 text-[16px] leading-relaxed">
          <div>
            {turn.state === "stopped"
              ? l.stopped
              : turn.error
                ? formatMsg(l.sendFailed, { reason: turn.error })
                : take?.failReason
                  ? formatMsg(l.notFinishedWhy, { reason: take.failReason })
                  : l.notFinished}
          </div>
          {/* Why, and a way on, right here (2026-09-29 check: a beginner was
              sent to the full studio to find out what went wrong). */}
          {turn.state !== "stopped" && (
            <div>
              <button type="button" className="pl-chip-btn" onClick={onRetry}>
                {l.tryAgain}
              </button>
            </div>
          )}
          {(take || charged) && (
            <div className="flex items-center gap-3 text-[13px]" style={{ color: "var(--pl-muted)" }}>
              {take && (
                <Link href={studioHref(`/app/history/${take.id}`)} style={{ color: "var(--pl-accent)" }}>
                  {l.openInStudio}
                </Link>
              )}
              {charged && <span>{charged}</span>}
            </div>
          )}
        </div>
      </div>
    );
  }

  const followUps: { text: string; kind: Kind }[] = video
    ? [
        { text: l.fuSlowMo, kind: "video" },
        { text: l.fuNight, kind: "video" },
        { text: l.fuAsPicture, kind: "image" },
      ]
    : [
        { text: l.fuAsVideo, kind: "video" },
        { text: l.fuPainted, kind: "image" },
        { text: l.fuBrighter, kind: "image" },
      ];
  const actionBtn = "pl-iconbtn pl-muted-btn";

  return (
    <div className="flex items-start gap-4">
      <Mark />
      <div className="flex min-w-0 flex-grow flex-col gap-3.5">
        <div className="text-[16px] leading-relaxed">{video ? l.doneVideo : l.donePicture}</div>
        <div className={`overflow-hidden rounded-[20px] bg-black ${video ? "w-full max-w-[600px]" : "w-full max-w-[420px]"}`}>
          {video ? (
            <video ref={videoRef} src={take.resultUrl} controls playsInline preload="metadata" aria-label={l.yourVideo} className="block aspect-video w-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={take.resultUrl} alt={l.yourPicture} onClick={openViewer} className="block h-auto w-full cursor-zoom-in" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1" style={{ color: "var(--pl-muted)" }}>
          {/* A plain download link: browsers save it, and in the Android
              app the shell's catch-all saves it to the phone's gallery
              (lib/native/download-intercept.ts). */}
          <a
            href={take.resultUrl}
            download
            aria-label={l.download}
            title={l.download}
            className={actionBtn}
            onClick={() => void recordDownload(take.id)}
          >
            <svg {...icon}>
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
          </a>
          <button type="button" aria-label={t.generate.fullScreen} title={t.generate.fullScreen} className={actionBtn} onClick={openViewer}>
            <svg {...icon}>
              <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
            </svg>
          </button>
          <button type="button" aria-label={l.share} title={l.share} className={actionBtn} onClick={() => onShare(take)}>
            <svg {...icon}>
              <path d="M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
            </svg>
          </button>
          <button type="button" aria-label={l.makeAnother} title={l.makeAnother} className={actionBtn} onClick={onAgain}>
            <svg {...icon}>
              <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />
            </svg>
          </button>
          <Link href={studioHref(`/app/history/${take.id}`)} aria-label={l.openInStudio} title={l.openInStudio} className={actionBtn}>
            <svg {...icon}>
              <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
          </Link>
          {charged && (
            <span className="ml-2 text-[13px]" style={{ color: "var(--pl-muted)" }}>
              {charged}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {followUps.map((f) => (
            <button key={f.text} type="button" className="pl-chip-btn" onClick={() => onFollow(f.text, f.kind)}>
              {f.text}
            </button>
          ))}
        </div>
      </div>
      {viewing && take.resultUrl && (
        <MediaViewer
          url={take.resultUrl}
          contentType={video ? "video" : "image"}
          alt={video ? l.yourVideo : l.yourPicture}
          startAt={viewing.startAt}
          generationId={take.id}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
