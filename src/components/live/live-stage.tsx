"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createFalClient } from "@fal-ai/client";
import { wma, type ManagedRealtimeSession, type WmaRealtimeSession } from "@fal-ai/client/realtime";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  checkLiveDirection,
  keepLiveRecording,
  reserveLiveRecording,
  startLiveTake,
  stopLiveTake,
  type LiveSettled,
} from "@/lib/live/actions";
import {
  LIVE_ASPECTS,
  LIVE_CLIENT_OPEN_TIMEOUT_MS,
  LIVE_DIRECTION_MAX,
  LIVE_ENDPOINT,
  LIVE_LENGTHS,
  LIVE_PROMPT_MAX,
  LIVE_RESOLUTIONS,
  liveCreditsFor,
  type LiveAspect,
  type LiveErrorCode,
  type LiveLength,
  type LiveResolution,
} from "@/lib/live/live";

// THE LIVE STAGE (2026-09-24). Set the opening, pick a length, Go live: the
// take is paid for, fal's session opens through our relay, and the video
// plays here while every direction typed is judged by us and then sent
// straight to fal's runner. Stop — or the paid length running out — settles
// it (unused seconds back) and the page's own recording of the stream is
// kept in Media: fal keeps no file of a live take.
//
// Colours are literals, the Recast door's vocabulary (mystique-door.tsx):
// html.screening.dark redefines Tailwind's `white` as near-black, so a
// token would turn this dark stage's text unreadable.

export type LiveCharacter = { id: string; name: string; photos: { path: string; url: string }[] };
export type LiveStill = { id: string; url: string; words: string | null };

type Phase = "setup" | "opening" | "live" | "stopping" | "ended";
type Direction = { text: string; seal: string; version: number; state: "pending" | "applied" | "rejected" };

/** What History may keep: the directions fal took, each with the server's seal. */
const sealed = (ds: Direction[]) => ds.filter((d) => d.state !== "rejected").map(({ text, seal }) => ({ text, seal }));

const label = "text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#6b6f7a]";
const ghost =
  "cursor-pointer rounded-xl px-3.5 py-2 text-sm font-medium text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] transition-colors hover:bg-[rgba(255,255,255,0.05)] disabled:cursor-not-allowed disabled:opacity-40";
const pill = (on: boolean) =>
  `cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium transition-shadow disabled:cursor-not-allowed disabled:opacity-45 ${
    on
      ? "bg-[rgba(255,255,255,0.06)] text-[#ecedf1] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]"
      : "text-[#c6c9d1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24)]"
  }`;
const key =
  "cursor-pointer rounded-xl bg-[#f0cda6] px-5 py-2.5 text-sm font-semibold text-[#1a1410] shadow-[0_8px_24px_-10px_rgba(240,196,142,0.7)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const field =
  "w-full rounded-2xl bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm text-[#ecedf1] placeholder:text-[#6b6f7a] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] outline-none focus:shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.6)]";

// Chrome (126+) and Safari record MP4, which is what can be kept; a browser
// that only records WebM still gets its take, saved to the device.
const RECORDER_MIMES = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
const RECORDER_BITRATE = 2_500_000;

type Session = ManagedRealtimeSession<WmaRealtimeSession>;

function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
      );
}

export function LiveStage({
  blocked,
  characters,
  still,
}: {
  blocked: "needsPlan" | "suspended" | null;
  characters: LiveCharacter[];
  still: LiveStill | null;
}) {
  const { t } = useLocale();
  const m = t.live;

  // ---- the opening
  const [opening, setOpening] = useState<"still" | "character" | "words">(still ? "still" : "words");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(still?.words ?? "");
  const [length, setLength] = useState<LiveLength>(60);
  const [resolution, setResolution] = useState<LiveResolution>("768p");
  const [aspect, setAspect] = useState<LiveAspect>("16:9");

  // ---- the take
  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState<string | null>(null);
  const [takeId, setTakeId] = useState<string | null>(null);
  const [paid, setPaid] = useState<{ seconds: number; credits: number } | null>(null);
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [firstFrame, setFirstFrame] = useState(false);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [settled, setSettled] = useState<LiveSettled | null>(null);
  const [recording, setRecording] = useState<{ url: string; mime: string; seconds: number } | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "local" | "failed">("idle");
  const [savedError, setSavedError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const takeRef = useRef<string | null>(null);
  const versionRef = useRef(1);
  const configuredRef = useRef(false);
  const queuedRef = useRef<{ text: string; version: number }[]>([]);
  const directionsRef = useRef<Direction[]>([]);
  const recorderRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; mime: string; startedAt: number } | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const recordingSecondsRef = useRef(0);
  const endingRef = useRef(false);
  const mountedRef = useRef(true);

  const say = useCallback(
    (res: { error: string; code?: LiveErrorCode }) => {
      const code = res.code;
      // A content refusal carries its own sentence (already the person's to read).
      setError(code && code !== "refused" && code !== "recordingRefused" ? m.err[code] : res.error);
    },
    [m],
  );

  useEffect(() => {
    directionsRef.current = directions;
  }, [directions]);

  // The clock the countdown reads; only runs while a take is on screen.
  useEffect(() => {
    if (phase !== "live" && phase !== "opening") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  const stopRecorder = useCallback((): Promise<void> => {
    const r = recorderRef.current;
    recorderRef.current = null;
    if (!r || r.rec.state === "inactive") return Promise.resolve();
    return new Promise((resolve) => {
      r.rec.onstop = () => {
        const blob = new Blob(r.chunks, { type: r.mime });
        blobRef.current = blob.size > 0 ? blob : null;
        const seconds = Math.round((Date.now() - r.startedAt) / 1000);
        recordingSecondsRef.current = seconds;
        if (blob.size > 0) setRecording({ url: URL.createObjectURL(blob), mime: r.mime, seconds });
        resolve();
      };
      try {
        r.rec.stop();
      } catch {
        resolve();
      }
    });
  }, []);

  // Keeps the page's recording as the take's video in Media.
  const save = useCallback(async () => {
    const id = takeRef.current;
    const blob = blobRef.current;
    if (!id || !blob) return;
    if (!blob.type.startsWith("video/mp4")) {
      setSaving("local");
      return;
    }
    setSaving("saving");
    setSavedError(null);
    const place = await reserveLiveRecording(id, { type: blob.type, size: blob.size });
    if (place.error !== null) {
      setSaving(place.code === "recordingFormat" ? "local" : "failed");
      setSavedError(place.code ? m.err[place.code] : place.error);
      return;
    }
    const { error: upErr } = await createBrowserClient()
      .storage.from("generated-videos")
      .uploadToSignedUrl(place.path, place.token, blob, { contentType: "video/mp4", upsert: true });
    if (upErr) {
      setSaving("failed");
      setSavedError(m.err.recordingMissing);
      return;
    }
    const kept = await keepLiveRecording(id, recordingSecondsRef.current);
    if (kept.error !== null) {
      setSaving(kept.code === "recordingRefused" ? "local" : "failed");
      setSavedError(kept.code && kept.code !== "recordingRefused" ? m.err[kept.code] : kept.error);
      return;
    }
    setSaving("saved");
  }, [m]);

  // Ends the take, whatever ended it: Stop, the paid length, fal, or leaving.
  const end = useCallback(
    async (opts: { tellFal: boolean }) => {
      if (endingRef.current) return;
      endingRef.current = true;
      setPhase("stopping");
      const session = sessionRef.current;
      if (session && opts.tellFal) {
        try {
          session.send({ type: "stop" });
        } catch {
          // closing below ends it either way
        }
        // A moment for fal's last chunk and its stream_exhausted.
        await new Promise((r) => window.setTimeout(r, 1500));
      }
      await stopRecorder();
      try {
        await session?.close();
      } catch {
        // already closed
      }
      sessionRef.current = null;
      const id = takeRef.current;
      if (id) {
        const res = await stopLiveTake(id, sealed(directionsRef.current));
        if (res.error === null) setSettled(res);
        else say(res);
        if (res.error === null && res.ran) void save();
      }
      setPhase("ended");
    },
    [save, say, stopRecorder],
  );

  // The paid length runs out: stop on time (the relay stops forwarding the
  // heartbeat a few seconds after, whatever this page does).
  useEffect(() => {
    if (phase !== "live" || liveAt === null || !paid) return;
    if (now - liveAt >= paid.seconds * 1000) void end({ tellFal: true });
  }, [now, phase, liveAt, paid, end]);

  // Leaving mid-take closes the session and settles it. A start still in
  // flight when the page goes finds `mounted` false when it lands, and stops
  // its own take (review, 2026-09-24: it used to open and stream the whole
  // paid length to nobody).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (session) {
        try {
          session.send({ type: "stop" });
        } catch {}
        void session.close();
      }
      const id = takeRef.current;
      if (id && !endingRef.current) void stopLiveTake(id, sealed(directionsRef.current));
    };
  }, []);

  const onData = useCallback(
    (raw: string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      const version = typeof msg.prompt_version === "number" ? msg.prompt_version : null;
      switch (msg.type) {
        case "configured": {
          if (version !== 1 || configuredRef.current) return;
          configuredRef.current = true;
          for (const q of queuedRef.current) sessionRef.current?.send({ type: "prompt", prompt: q.text, prompt_version: q.version });
          queuedRef.current = [];
          return;
        }
        case "prompt_applied":
        case "prompt_rejected":
          if (version === null) return;
          setDirections((ds) =>
            ds.map((d) => (d.version === version ? { ...d, state: msg.type === "prompt_applied" ? "applied" : "rejected" } : d)),
          );
          return;
        case "chunk":
          setFirstFrame(true);
          return;
        case "error": {
          const code = typeof msg.code === "string" ? msg.code : typeof msg.error === "string" ? msg.error : "";
          if (code === "stale_prompt_version") return;
          setError(formatMsg(m.falError, { reason: code === "content_policy" ? m.falPolicy : code || m.falUnknown }));
          void end({ tellFal: false });
          return;
        }
        case "stream_exhausted":
          void end({ tellFal: false });
          return;
      }
    },
    [end, m],
  );

  const goLive = async () => {
    setError(null);
    const text = prompt.trim();
    if (!text) {
      setError(m.err.noPrompt);
      return;
    }
    setPhase("opening");
    endingRef.current = false;
    configuredRef.current = false;
    versionRef.current = 1;
    setDirections([]);
    setFirstFrame(false);
    setSettled(null);
    setRecording(null);
    setSaving("idle");
    setSavedError(null);
    blobRef.current = null;

    const res = await startLiveTake({
      sendId: uuid(),
      length,
      resolution,
      aspect,
      prompt: text,
      characterId: opening === "character" ? characterId : null,
      photoPath: opening === "character" ? photoPath : null,
      fromId: opening === "still" ? (still?.id ?? null) : null,
    });
    if (res.error !== null) {
      say(res);
      setPhase("setup");
      return;
    }
    if (!mountedRef.current) {
      void stopLiveTake(res.takeId, []);
      return;
    }
    takeRef.current = res.takeId;
    setTakeId(res.takeId);
    setPaid({ seconds: res.paidSeconds, credits: res.paidCredits });

    const fal = createFalClient({ proxyUrl: `/api/live/relay?take=${encodeURIComponent(res.takeId)}` });
    const session = fal.realtime.open(wma(LIVE_ENDPOINT), {
      receive: ["video", "audio"],
      // Longer than the relay's own wait on fal, so this page never gives up
      // on a session the relay is still about to open.
      negotiationTimeoutMs: LIVE_CLIENT_OPEN_TIMEOUT_MS,
      onMedia: (stream: MediaStream) => {
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
        if (recorderRef.current || typeof MediaRecorder === "undefined") return;
        const mime = RECORDER_MIMES.find((x) => MediaRecorder.isTypeSupported(x));
        if (!mime) return;
        try {
          const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: RECORDER_BITRATE });
          const holder = { rec, chunks: [] as Blob[], mime: mime.split(";")[0], startedAt: Date.now() };
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) holder.chunks.push(e.data);
          };
          rec.start(1000);
          recorderRef.current = holder;
        } catch {
          // No recording; the take still plays.
        }
      },
      onData,
      onState: (state) => {
        if (state === "live") {
          setLiveAt(Date.now());
          setPhase("live");
        } else if (state === "failed" && !endingRef.current) {
          setError(m.openFailed);
          void end({ tellFal: false });
        }
      },
      onError: () => {
        if (!endingRef.current) setError(m.openFailed);
      },
    });
    sessionRef.current = session;
    session.send(res.configure);
  };

  const direct = async () => {
    const id = takeRef.current;
    const text = draft.trim();
    if (!id || !text || checking) return;
    setChecking(true);
    setError(null);
    const res = await checkLiveDirection(id, text);
    setChecking(false);
    if (res.error !== null) {
      say(res);
      return;
    }
    versionRef.current += 1;
    const version = versionRef.current;
    setDirections((ds) => [...ds, { text: res.text, seal: res.seal, version, state: "pending" }]);
    setDraft("");
    if (configuredRef.current) sessionRef.current?.send({ type: "prompt", prompt: res.text, prompt_version: version });
    else queuedRef.current.push({ text: res.text, version });
  };

  const reset = () => {
    if (recording) URL.revokeObjectURL(recording.url);
    takeRef.current = null;
    setTakeId(null);
    setPaid(null);
    setLiveAt(null);
    setPhase("setup");
  };

  const castable = characters;
  const chosenPhoto =
    castable.find((c) => c.id === characterId)?.photos.find((p) => p.path === photoPath)?.url ?? null;
  const busy = phase !== "setup" && phase !== "ended";
  const left = paid && liveAt !== null ? Math.max(0, Math.ceil(paid.seconds - (now - liveAt) / 1000)) : null;
  const frameClass = aspect === "9:16" ? "aspect-[9/16] max-h-[70vh] mx-auto" : aspect === "1:1" ? "aspect-square max-h-[70vh] mx-auto" : "aspect-video";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="rounded-[28px] bg-[#0b0c10] px-5 pb-6 pt-7 text-[#c6c9d1] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_32px_72px_-28px_rgba(0,0,0,0.7)] sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="font-display flex items-center gap-2.5 text-3xl font-semibold tracking-tight text-[#ecedf1]">
              {m.headline}
              <span
                aria-hidden
                className={`inline-block h-2.5 w-2.5 rounded-full ${phase === "live" ? "bg-[#ff5a4f] shadow-[0_0_12px_rgba(255,90,79,0.8)]" : "bg-[#3a3d45]"}`}
              />
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[#9aa0ad]">{m.sub}</p>
          </div>
          <p className="text-xs text-[#6b6f7a] lg:text-right">{m.priceLine}</p>
        </div>

        {blocked ? (
          <p className="mt-6 rounded-2xl bg-[rgba(255,255,255,0.03)] p-4 text-sm text-[#c6c9d1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            {m.err[blocked]}
          </p>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* The screen */}
            <div className="min-w-0">
              <div className={`relative overflow-hidden rounded-2xl bg-black ${frameClass}`}>
                {phase === "setup" && opening === "still" && still ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={still.url} alt="" className="h-full w-full object-contain opacity-80" />
                ) : null}
                {phase === "setup" && opening === "character" && chosenPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={chosenPhoto} alt="" className="h-full w-full object-contain opacity-80" />
                ) : null}
                {phase === "setup" && opening === "words" ? (
                  <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                    <p className="text-sm text-[#6b6f7a]">{m.screenIdle}</p>
                  </div>
                ) : null}
                <video
                  ref={videoRef}
                  playsInline
                  autoPlay
                  className={`h-full w-full object-contain ${phase === "live" || phase === "stopping" ? "" : "hidden"}`}
                />
                {phase === "ended" && recording ? (
                  <video src={recording.url} controls playsInline className="absolute inset-0 h-full w-full bg-black object-contain" />
                ) : null}
                {(phase === "opening" || (phase === "live" && !firstFrame)) && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="animate-pulse text-sm text-[#9aa0ad]">{phase === "opening" ? m.opening : m.waiting}</p>
                  </div>
                )}
                {phase === "live" && left !== null && (
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-[5px] text-xs font-medium text-[rgba(255,255,255,0.94)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#ff5a4f]" />
                    {formatMsg(m.remaining, { s: left })}
                  </span>
                )}
              </div>

              {(phase === "live" || phase === "stopping") && (
                <div className="mt-4">
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void direct();
                    }}
                  >
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value.slice(0, LIVE_DIRECTION_MAX))}
                      placeholder={m.directPlaceholder}
                      aria-label={m.directLabel}
                      disabled={phase !== "live"}
                      className={field}
                    />
                    <button type="submit" disabled={phase !== "live" || checking || !draft.trim()} className={key}>
                      {checking ? m.checking : m.send}
                    </button>
                    <button type="button" onClick={() => void end({ tellFal: true })} disabled={phase !== "live"} className={ghost}>
                      {phase === "stopping" ? m.stopping : m.stop}
                    </button>
                  </form>
                  {directions.length > 0 && (
                    <ol className="mt-3 space-y-1.5">
                      {directions.map((d) => (
                        <li key={d.version} className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 text-[#c6c9d1]">{d.text}</span>
                          <span
                            className={`shrink-0 text-xs ${d.state === "applied" ? "text-[#f0cda6]" : d.state === "rejected" ? "text-[#ff8a80]" : "text-[#6b6f7a]"}`}
                          >
                            {d.state === "applied" ? m.dirApplied : d.state === "rejected" ? m.dirRejected : m.dirPending}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {phase === "ended" && (
                <div className="mt-4 space-y-3">
                  {settled && (
                    <p className="text-sm text-[#ecedf1]">
                      {!settled.ran
                        ? formatMsg(m.neverStarted, { n: settled.refunded })
                        : settled.refunded > 0
                          ? formatMsg(m.endedSummary, { s: settled.usedSeconds, n: settled.refunded })
                          : formatMsg(m.endedFull, { s: settled.usedSeconds })}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {saving === "saving" && <span className="text-sm text-[#9aa0ad]">{m.saving}</span>}
                    {saving === "saved" && takeId && (
                      <Link href={`/app/history/${takeId}`} className={key}>
                        {m.openTake}
                      </Link>
                    )}
                    {saving === "failed" && (
                      <button type="button" onClick={() => void save()} className={ghost}>
                        {m.saveAgain}
                      </button>
                    )}
                    {recording && (
                      <a href={recording.url} download={`picacho-live-${takeId ?? "take"}.${recording.mime === "video/mp4" ? "mp4" : "webm"}`} className={ghost}>
                        {m.download}
                      </a>
                    )}
                    <button type="button" onClick={reset} className={ghost}>
                      {m.again}
                    </button>
                  </div>
                  {saving === "saved" && <p className="text-xs text-[#9aa0ad]">{m.saved}</p>}
                  {saving === "local" && <p className="text-xs text-[#9aa0ad]">{savedError ?? m.localOnly}</p>}
                  {saving === "failed" && savedError && <p className="text-xs text-[#ff8a80]">{savedError}</p>}
                </div>
              )}

              {error && phase !== "setup" && <p className="mt-3 text-sm text-[#ff8a80]">{error}</p>}
            </div>

            {/* The setup */}
            <div className="space-y-5">
              <div>
                <p className={label}>{m.openingLabel}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {still && (
                    <button type="button" disabled={busy} aria-pressed={opening === "still"} onClick={() => setOpening("still")} className={pill(opening === "still")}>
                      {m.openStill}
                    </button>
                  )}
                  <button type="button" disabled={busy} aria-pressed={opening === "words"} onClick={() => setOpening("words")} className={pill(opening === "words")}>
                    {m.openWords}
                  </button>
                  {castable.map((c) => {
                    const on = opening === "character" && characterId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={busy}
                        aria-pressed={on}
                        onClick={() => {
                          setOpening("character");
                          setCharacterId(c.id);
                          setPhotoPath(c.photos[0]?.path ?? null);
                        }}
                        className={`flex cursor-pointer items-center gap-2 rounded-full py-1 pl-1 pr-3.5 text-sm font-medium transition-shadow disabled:cursor-not-allowed disabled:opacity-45 ${
                          on
                            ? "bg-[rgba(255,255,255,0.06)] text-[#ecedf1] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]"
                            : "text-[#c6c9d1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24)]"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.photos[0].url} alt="" className="h-7 w-7 rounded-full object-cover" />
                        {c.name}
                      </button>
                    );
                  })}
                </div>
                {castable.length === 0 && (
                  <p className="mt-2 text-xs text-[#6b6f7a]">
                    {m.noCharacters}{" "}
                    <Link href="/app/character/new" className="font-medium text-[#f0cda6] underline-offset-2 hover:underline">
                      {m.createCharacter}
                    </Link>
                  </p>
                )}
                {opening === "character" && characterId && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(castable.find((c) => c.id === characterId)?.photos ?? []).map((p) => (
                      <button
                        key={p.path}
                        type="button"
                        disabled={busy}
                        aria-pressed={photoPath === p.path}
                        onClick={() => setPhotoPath(p.path)}
                        className={`h-14 w-14 cursor-pointer overflow-hidden rounded-xl transition-shadow ${
                          photoPath === p.path ? "shadow-[0_0_0_2px_rgba(240,196,142,0.85)]" : "opacity-70 hover:opacity-100"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-[#6b6f7a]">{m.openingHint}</p>
              </div>

              <div>
                <label htmlFor="live-prompt" className={label}>
                  {m.promptLabel}
                </label>
                <textarea
                  id="live-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value.slice(0, LIVE_PROMPT_MAX))}
                  placeholder={m.promptPlaceholder}
                  rows={4}
                  disabled={busy}
                  className={`${field} mt-2 resize-none`}
                />
              </div>

              <div>
                <p className={label}>{m.lengthLabel}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {LIVE_LENGTHS.map((s) => (
                    <button key={s} type="button" disabled={busy} aria-pressed={length === s} onClick={() => setLength(s)} className={pill(length === s)}>
                      {formatMsg(m.lengthOption, { len: s < 60 ? formatMsg(m.seconds, { n: s }) : formatMsg(m.minutes, { n: s / 60 }), n: liveCreditsFor(s) })}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-4">
                <div>
                  <p className={label}>{m.qualityLabel}</p>
                  <div className="mt-2 flex gap-2">
                    {LIVE_RESOLUTIONS.map((r) => (
                      <button key={r} type="button" disabled={busy} aria-pressed={resolution === r} onClick={() => setResolution(r)} className={pill(resolution === r)}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className={label}>{m.shapeLabel}</p>
                  <div className="mt-2 flex gap-2">
                    {LIVE_ASPECTS.map((a) => (
                      <button key={a} type="button" disabled={busy} aria-pressed={aspect === a} onClick={() => setAspect(a)} className={pill(aspect === a)}>
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button type="button" onClick={() => void goLive()} disabled={busy || !prompt.trim()} className={`${key} w-full`}>
                {phase === "opening" ? m.opening : formatMsg(m.startButton, { n: liveCreditsFor(length) })}
              </button>
              {/* Beside the button that caused it: on a phone the screen is a scroll away. */}
              {error && phase === "setup" && (
                <p role="alert" className="text-sm text-[#ff8a80]">
                  {error}
                </p>
              )}
              <p className="text-xs text-[#6b6f7a]">{m.refundNote}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
