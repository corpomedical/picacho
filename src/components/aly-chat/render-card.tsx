"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { runGeneration, pollGeneration, requestGenerationCancel } from "@/lib/generations/actions";
import { getLightTake, type LightTake } from "@/lib/light/actions";
import { DEFAULT_IMAGE_ASPECT, DEFAULT_IMAGE_QUALITY, defaultImageResolution } from "@/lib/generations/providers/image-resolution";
import { isStaleDeployError } from "@/lib/stale-deploy";
import { linkRender } from "@/lib/aly-chat/actions";
import type { ViewRender } from "@/lib/aly-chat/view";
import type { LightDefaults } from "@/components/light/light-chat";
import { useInLight } from "@/components/light/in-light";
import { ExpandMediaButton } from "@/components/media-viewer";
import { DownloadButton } from "@/components/download-button";
import { ZoomableImage } from "@/components/zoomable-image";
import { lightHref } from "@/lib/light/mode";
import { CreatingPicture } from "./creating-picture";
import styles from "./aly-chat.module.css";

// A picture or clip Aly got ready in the chat (2026-09-29). The card shows
// the price before anything is spent; "Make it" is the person's own Send,
// through the very runGeneration the studio and Picacho Light use (every
// credit, policy and identity check stays there). The result comes back into
// the card, and the card remembers it (linkRender) for next time.

const POLL_MS = 4000;

type State = "ready" | "working" | "done" | "failed" | "stopped";

export function RenderCard({
  card,
  chatId,
  seq,
  defaults,
  autoStart = false,
}: {
  card: ViewRender;
  chatId: string | null;
  seq: number;
  defaults: LightDefaults;
  /** Picacho Light: start it the moment it arrives ("Start right away", 2026-09-29). */
  autoStart?: boolean;
}) {
  const { t } = useLocale();
  const c = t.alyChat;
  // In Picacho Light the card's second button opens Light's own box with it
  // filled in, not the studio's composer (2026-09-29, Aly IS the Light chat).
  const inLight = useInLight();
  const openHref = inLight ? lightHref(card.href) : card.href;
  const [genId, setGenId] = useState<string | null>(card.generationId ?? null);
  const [state, setState] = useState<State>(card.generationId ? "working" : "ready");
  const [take, setTake] = useState<LightTake | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A picture being made shows ChatGPT's frame instead of the card
  // (creating-picture.tsx), from the moment it is KNOWN to be working: a card
  // opened again starts as "working" until its take is read, and a finished
  // picture must not flash "Creating picture" on the way in.
  const [making, setMaking] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  // The card coming back with the picture it just made (not one reopened).
  const [cameIn, setCameIn] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function settle(id: string) {
    const tk = await getLightTake(id);
    if (!alive.current) return;
    setTake(tk);
    setState(tk?.status === "succeeded" ? "done" : tk?.status === "cancelled" ? "stopped" : tk?.status === "generating" || tk?.status === "pending" ? "working" : "failed");
    if (tk?.status === "succeeded") setCameIn(true);
  }

  async function follow(id: string) {
    while (alive.current) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      let res;
      try {
        res = await pollGeneration(id);
      } catch {
        continue;
      }
      if (res.error !== null || res.state === "pending") continue;
      await settle(id);
      return;
    }
  }

  // A card opened again: show what it became, and keep following it if it
  // is still being made. A take that arrives later (Aly started it herself,
  // start_render, 2026-10-01) is read the same way: a finished one shows at
  // once, one still being made is followed.
  const atMount = useRef(card.generationId ?? null);
  const resumed = useRef<string | null>(null);
  useEffect(() => {
    if (!card.generationId || resumed.current === card.generationId) return;
    const id = card.generationId;
    resumed.current = id;
    const late = id !== atMount.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (late) {
          setGenId(id);
          setError(null);
          setState("working");
          setStartedAt(Date.now());
          setMaking(true);
        }
        const tk = await getLightTake(id);
        if (!alive.current) return;
        // Just started: its row can be a moment behind.
        if (!tk && late) return void follow(id);
        setTake(tk);
        if (tk?.status === "succeeded") setState("done");
        else if (tk?.status === "cancelled") setState("stopped");
        else if (tk && (tk.status === "generating" || tk.status === "pending")) {
          const at = tk.createdAt ? Date.parse(tk.createdAt) : NaN;
          if (!Number.isNaN(at)) setStartedAt(at);
          setMaking(true);
          void follow(id);
        }
        else setState("failed");
      })();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.generationId]);

  // Remembered on Aly's message, so the chat shows it when it's opened again.
  // A card that starts by itself (Light) can beat the message being saved,
  // which happens when her answer ends, so it tries again a few times.
  async function remember(chat: string, at: number, cardId: string, genId: string) {
    for (const wait of [0, 2000, 5000, 10000, 20000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const r = await linkRender(chat, at, cardId, genId).catch(() => null);
      if (r && "ok" in r) return;
    }
  }

  // "Start right away" in Picacho Light: once, as the card arrives. The flag
  // is set inside the timer so React's development double mount (effect,
  // cleanup, effect) still starts it exactly once.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || card.generationId || card.kind === "ad") return;
    const timer = window.setTimeout(() => {
      if (started.current) return;
      started.current = true;
      void make();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function make() {
    if (card.kind === "ad" || state === "working") return;
    setError(null);
    setState("working");
    setStartedAt(Date.now());
    setMaking(true);
    setCameIn(false);
    const id = crypto.randomUUID();
    setGenId(id);
    const fd = new FormData();
    fd.set("generation_id", id);
    fd.set("prompt", card.prompt);
    fd.set("content_type", card.kind);
    fd.set("character_id", card.characterId ?? "");
    fd.set("use_outfit", "0");
    fd.set("payload_version", "2");
    if (card.kind === "image") {
      fd.set("image_model_id", defaults.imageModelId);
      fd.set("image_resolution", defaultImageResolution(defaults.imageModelId));
      fd.set("image_aspect", DEFAULT_IMAGE_ASPECT);
      fd.set("image_quality", DEFAULT_IMAGE_QUALITY);
    } else {
      fd.set("video_model_id", card.modelId ?? defaults.videoModelId);
      fd.set("video_duration_seconds", String(card.seconds ?? defaults.videoDurationSeconds));
      if (defaults.videoAspectRatio) fd.set("video_aspect_ratio", defaults.videoAspectRatio);
    }
    if (chatId && seq >= 0) void remember(chatId, seq, card.id, id);

    let result;
    try {
      result = await runGeneration(fd);
    } catch (err) {
      setError(isStaleDeployError(err) ? t.generate.refreshNeeded : t.generate.submitFailed);
      setState("failed");
      return;
    }
    if (result.error !== null) {
      setError(result.error);
      setState("failed");
      return;
    }
    if (result.pending) {
      await follow(result.id);
      return;
    }
    await settle(result.id);
  }

  const price = card.credits === 1 ? c.renderMakeOne : formatMsg(c.renderMake, { credits: card.credits });
  const charged = take
    ? take.freeGeneration
      ? c.renderFree
      : take.creditsUsed === 1
        ? c.renderChargedOne
        : formatMsg(c.renderCharged, { credits: take.creditsUsed })
    : "";
  const meta = [card.characterName, card.modelName, card.seconds ? formatMsg(c.renderSeconds, { n: card.seconds }) : null]
    .filter(Boolean)
    .join(" · ");

  if (state === "working" && making && card.kind === "image") {
    return (
      <CreatingPicture
        label={c.renderCreating}
        stopLabel={c.renderStop}
        onStop={genId ? () => void requestGenerationCancel(genId) : undefined}
        startedAt={startedAt}
        aspect={DEFAULT_IMAGE_ASPECT}
      />
    );
  }

  return (
    <div className={`overflow-hidden rounded-2xl border border-atelier-rule bg-atelier-ink/[0.02] ${cameIn && state === "done" ? styles.cardIn : ""}`}>
      {state === "done" && take?.resultUrl ? (
        // Full screen and download on the frame's corners, as on History
        // (2026-09-30: the card had neither, so a take made in the chat could
        // only be seen small and never saved to the phone).
        <div className="relative">
          {take.contentType === "video" ? (
            <video src={take.resultUrl} controls playsInline className="block aspect-video w-full bg-black object-contain" />
          ) : (
            // A tap on the picture opens it full screen too.
            <ZoomableImage src={take.resultUrl} alt={card.label} generationId={take.id} className="block w-full bg-black/5 object-contain" />
          )}
          <ExpandMediaButton
            url={take.resultUrl}
            contentType={take.contentType === "video" ? "video" : "image"}
            alt={card.label}
            generationId={take.id}
          />
          <DownloadButton url={take.resultUrl} contentType={take.contentType === "video" ? "video" : "image"} generationId={take.id} />
        </div>
      ) : (
        <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-atelier-accent/25 via-atelier-ink/[0.06] to-atelier-ink/[0.12]">
          {state === "working" ? (
            <span className="rounded-full bg-atelier-paper/80 px-3 py-1 text-xs text-atelier-ink">{c.renderWorking}</span>
          ) : (
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-atelier-ink/40" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              {card.kind === "video" ? (
                <>
                  <rect x="3" y="5" width="14" height="14" rx="2" />
                  <path d="m17 10 4-2.5v9L17 14" strokeLinejoin="round" />
                </>
              ) : (
                <>
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <circle cx="9" cy="10" r="1.8" />
                  <path d="m3 17 5.5-5 4 3.5 3-2.5L21 17" strokeLinejoin="round" />
                </>
              )}
            </svg>
          )}
        </div>
      )}
      <div className="space-y-1.5 p-3">
        <p className="text-sm font-medium text-atelier-ink">{card.label}</p>
        {meta && <p className="text-xs text-atelier-muted">{meta}</p>}
        {state === "failed" && <p className="text-xs text-red-500">{formatMsg(c.renderFailed, { error: error ?? "" }).trim()}</p>}
        {state === "stopped" && <p className="text-xs text-atelier-muted">{c.renderStopped}</p>}
        {state === "done" && charged && <p className="text-xs text-atelier-muted">{charged}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {card.kind === "ad" ? (
            <Link href={card.href} className="rounded-full bg-atelier-accent px-3 py-1.5 text-xs font-medium text-white">
              {c.renderAd}
            </Link>
          ) : state === "ready" || state === "failed" || state === "stopped" ? (
            <>
              <button type="button" onClick={() => void make()} className="rounded-full bg-atelier-accent px-3 py-1.5 text-xs font-medium text-white">
                {price}
              </button>
              <Link href={openHref} className="rounded-full border border-atelier-rule px-3 py-1.5 text-xs text-atelier-muted hover:text-atelier-ink">
                {inLight ? t.light.changeFirst : c.renderOpen}
              </Link>
            </>
          ) : state === "working" && genId ? (
            <button
              type="button"
              onClick={() => void requestGenerationCancel(genId)}
              className="rounded-full border border-atelier-rule px-3 py-1.5 text-xs text-atelier-muted hover:text-atelier-ink"
            >
              {c.renderStop}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
