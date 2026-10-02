"use client";

// Press Tour › Clippings (2026-10-02; operator: "Build C, leave X out"). The
// tab is board C of claude.ai/artifact/X8W76bPZJL8r72a4XwH7wS, row for row:
// the sources strip, the four numbers, every post on one chart by views,
// "Which formats win", and "Inside the post" with its script anatomy and
// "Plan an ad like this". On a phone it stacks as the phone board does, with
// the key in a dock at the bottom.
//
// Only the person's own posts: their connected accounts (read with the
// permission they gave), Press Tour's own ads and videos they say they made.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMsg } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages/en";
import type { ClipError, ClipFail, ClipNetwork, ClipPart, ClipView, ClippingsHome } from "@/lib/clippings/types";
import { UPLOAD_MAX_BYTES, UPLOAD_TYPES } from "@/lib/clippings/types";
import type { UploadPlace } from "@/lib/clippings/service";
import {
  anatomy,
  bestClip,
  charted,
  chartScale,
  compact,
  formatRows,
  gridlines,
  monthTicks,
  rankOf,
  stamp,
  times,
  timesLabel,
  usualViews,
  xShare,
  yShare,
} from "@/lib/clippings/stats";
import type { ConnectNote } from "./press-line";
import { cn } from "@/lib/cn";
import s from "./press-tour.module.css";

export type ClippingsActions = {
  getClippings(): Promise<{ ok: true; home: ClippingsHome } | ClipFail>;
  readClippings(input: { carryOn?: boolean }): Promise<{ ok: true } | ClipFail>;
  clipUploadPlace(input: { clipId: string; type: string; size: number }): Promise<UploadPlace | ClipFail>;
  addClip(input: { clipId: string; views: string | number | null; postedAt: string | null; attest: boolean }): Promise<{ ok: true } | ClipFail>;
  removeClip(input: { clipId: string }): Promise<{ ok: true } | ClipFail>;
};

/** A clip the person picked to plan an ad on. */
export type PlanFrom = { clipId: string; format: string | null; times: string | null };

type Words = Messages["pressTour"];

const LABEL = "font-slate text-[11px] font-medium uppercase tracking-[0.12em] text-[#858994]";
const PANEL = "rounded-[18px] bg-[rgba(255,255,255,0.022)] ring-1 ring-inset ring-[rgba(255,255,255,0.08)]";
const GHOST =
  "mt-1 inline-flex min-h-9 items-center justify-center self-start rounded-[10px] px-3 text-[12.5px] font-medium text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50 max-lg:min-h-11";
const QUIET = "text-[12.5px] font-medium text-[#9aa0ad] underline decoration-[rgba(255,255,255,0.25)] underline-offset-[3px] hover:text-[#c6c9d1] disabled:opacity-50";

/** The tiles' tints, by the format's place in the table (board C's swatches). */
const TINTS = [
  "linear-gradient(160deg,#e9c49b,#8a5f3a)",
  "linear-gradient(160deg,#bcd0ea,#4f6684)",
  "linear-gradient(160deg,#9aa2ad,#474c55)",
  "linear-gradient(160deg,#b3a796,#5a5248)",
  "linear-gradient(160deg,#7d838d,#34373e)",
  "linear-gradient(160deg,#c9b8d8,#5c4f6e)",
];
const NO_FORMAT_TINT = "linear-gradient(160deg,#5b5f68,#2a2c33)";

const PART_COLOUR: Record<ClipPart, string> = { hook: "#f0bb84", costar: "#7fa8de", proof: "#8d877e", line: "#ecedf1" };
const NETWORK_NAME: Record<ClipNetwork, string> = { instagram: "Instagram", tiktok: "TikTok" };

const POLL_MS = 3000;

/** A share as a CSS percentage, rounded so the server's HTML and the browser agree. */
const pct = (share: number) => `${(share * 100).toFixed(3)}%`;

function partWord(part: ClipPart, m: Words): string {
  return part === "hook" ? m.clipPartHook : part === "costar" ? m.clipPartCostar : part === "proof" ? m.clipPartProof : m.clipPartLine;
}

function errorWord(e: ClipError, m: Words): string {
  switch (e) {
    case "closed":
      return m.clipErrClosed;
    case "busy":
      return m.clipErrBusy;
    case "limit":
      return m.clipErrLimit;
    case "bad_file":
      return m.clipErrBadFile;
    case "too_big":
      return m.clipErrTooBig;
    case "bad_views":
      return m.clipErrBadViews;
    case "attest":
      return m.clipErrAttest;
    case "not_found":
      return m.clipErrNotFound;
    case "nothing_to_read":
      return m.clipErrNothing;
    default:
      return m.clipErrUnavailable;
  }
}

function ago(iso: string, locale: string): string {
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

function wordsNote(c: ClipView, m: Words): string | null {
  switch (c.wordsState) {
    case "pending":
      return m.clipWordsPending;
    case "none":
      return m.clipWordsNone;
    case "no_file":
      return m.clipWordsNoFile;
    case "too_long":
      return m.clipWordsTooLong;
    case "failed":
      return m.clipWordsFailed;
    case "views_only":
      return m.clipWordsViewsOnly;
    default:
      return null;
  }
}

function connectNoteWords(note: ConnectNote, m: Words): string {
  const network = note.network === "instagram" ? "Instagram" : note.network === "tiktok" ? "TikTok" : note.network;
  if (note.outcome === "connected") return formatMsg(m.connectedNet, { network });
  if (note.outcome === "denied") return formatMsg(m.connectDenied, { network });
  if (note.outcome === "expired") return m.connectExpired;
  if (note.outcome === "session") return m.connectSession;
  if (note.outcome === "closed") return formatMsg(m.connectClosed, { network });
  return formatMsg(m.connectFailedNet, { network });
}

export function ClippingsView({
  initial,
  actions,
  connect,
  onPlan,
  connectNote,
  m,
  locale,
}: {
  initial: ClippingsHome;
  actions: ClippingsActions;
  /** Start connecting a network for reading: answers an error sentence (English, server words), or navigates away. */
  connect: (network: ClipNetwork) => Promise<string | null>;
  onPlan: (from: PlanFrom) => void;
  connectNote: ConnectNote | null;
  m: Words;
  locale: string;
}) {
  const [home, setHome] = useState(initial);
  const [selId, setSelId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<ConnectNote | null>(connectNote);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [moreFormats, setMoreFormats] = useState(false);

  const refresh = useCallback(async () => {
    const r = await actions.getClippings().catch(() => null);
    if (r && r.ok) setHome(r.home);
    return r && r.ok ? r.home : null;
  }, [actions]);

  // While a read runs, look every few seconds; when it ends with words still
  // waiting (it ran out of time), carry on once (free).
  const carried = useRef<string | null>(null);
  useEffect(() => {
    if (home.run.state !== "reading") {
      const waiting = home.clips.some((c) => c.wordsState === "pending" && (c.source === "upload" || c.source === "instagram"));
      const mark = home.run.finishedAt ?? "none";
      // Only after a read that got somewhere and hit no limit: never a loop of empty reads.
      const progressed = home.run.done > 0 && home.run.error === null;
      if (waiting && progressed && home.run.finishedAt && carried.current !== mark && Date.now() - Date.parse(home.run.finishedAt) < 10 * 60 * 1000) {
        carried.current = mark;
        void actions.readClippings({ carryOn: true }).then((r) => {
          if (r.ok) void refresh();
        });
      }
      return;
    }
    const timer = setTimeout(() => void refresh(), POLL_MS);
    return () => clearTimeout(timer);
  }, [home, actions, refresh]);

  // Back from connecting a network for Clippings: read at once.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || connectNote?.outcome !== "connected") return;
    arrived.current = true;
    void actions.readClippings({}).then((r) => {
      if (r.ok) void refresh();
    });
  }, [connectNote, actions, refresh]);

  const usual = useMemo(() => usualViews(home.clips), [home.clips]);
  const rows = useMemo(() => formatRows(home.clips), [home.clips]);
  const tintOf = useMemo(() => {
    const map = new Map(rows.map((r, i) => [r.format, TINTS[i % TINTS.length]]));
    return (c: ClipView) => (c.format ? (map.get(c.format) ?? NO_FORMAT_TINT) : NO_FORMAT_TINT);
  }, [rows]);
  const onChart = useMemo(() => charted(home.clips), [home.clips]);
  // The clock only matters for a chart with no dated posts, which isn't drawn: 0 keeps the render pure.
  const scale = useMemo(() => chartScale(home.clips, 0), [home.clips]);
  const best = useMemo(() => bestClip(home.clips), [home.clips]);
  const sel = home.clips.find((c) => c.id === selId) ?? best;
  const topViews = rows[0]?.median ?? 1;

  const startRead = async () => {
    setBusy("read");
    setError(null);
    const r = await actions.readClippings({}).catch(() => ({ ok: false as const, error: "unavailable" as ClipError }));
    setBusy(null);
    if (!r.ok) setError(errorWord(r.error, m));
    else await refresh();
  };

  const doConnect = async (network: ClipNetwork) => {
    setBusy(`connect-${network}`);
    setError(null);
    const err = await connect(network);
    if (err) {
      setError(err);
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy("remove");
    const r = await actions.removeClip({ clipId: id }).catch(() => ({ ok: false as const, error: "unavailable" as ClipError }));
    setBusy(null);
    if (!r.ok) setError(errorWord(r.error, m));
    else {
      setSelId(null);
      await refresh();
    }
  };

  const reading = home.run.state === "reading";
  const anyConnected = home.sources.instagram.state === "connected" || home.sources.tiktok.state === "connected";
  const canRead = anyConnected || home.uploads > 0 || home.pressTourAds > 0;

  const readLine = reading
    ? home.run.total > 0
      ? formatMsg(m.clipReading, { done: Math.min(home.run.done, home.run.total), total: home.run.total })
      : m.clipReadingStart
    : home.run.finishedAt
      ? formatMsg(m.clipReadAgo, { when: ago(home.run.finishedAt, locale) })
      : m.clipNeverRead;

  // ── The sources strip ──────────────────────────────────────────────────
  const networkCell = (network: ClipNetwork, first: boolean) => {
    const src = home.sources[network];
    const n = src.posts;
    return (
      <div className={cn("flex min-w-0 flex-col gap-1 px-4 py-3", !first && "lg:border-l lg:border-[rgba(255,255,255,0.07)]")}>
        <span className="font-slate text-[11px] font-medium uppercase tracking-[0.1em] text-[#b3aca2]">{NETWORK_NAME[network]}</span>
        {src.state === "connected" ? (
          <>
            <span className="text-[12.5px] leading-[1.38] text-[#9aa0ad]">
              <span className="text-[#f0cda6]">{m.clipConnected}</span> · {n === 1 ? m.clipPostsOne : formatMsg(m.clipPostsN, { n })}
            </span>
            <span className="text-[12.5px] leading-[1.38] text-[#9aa0ad]">{network === "instagram" ? m.clipViewsWords : m.clipViewsOnly}</span>
          </>
        ) : src.state === "closed" ? (
          <span className="text-[12.5px] leading-[1.38] text-[#858994]">{m.clipSoon}</span>
        ) : (
          <>
            <span className="text-[12.5px] leading-[1.38] text-[#9aa0ad]">
              {src.state === "reconnect" ? m.clipReconnectLine : network === "instagram" ? m.clipViewsWords : m.clipViewsOnly}
            </span>
            {home.webOnly ? (
              <span className="text-[12px] text-[#858994]">{m.clipConnectWeb}</span>
            ) : (
              <button type="button" className={GHOST} disabled={busy !== null} onClick={() => void doConnect(network)}>
                {src.state === "reconnect" ? m.clipConnectAgain : m.clipConnect}
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  // ── The script card ────────────────────────────────────────────────────
  const selTimes = sel && typeof sel.views === "number" ? timesLabel(sel.views, usual) : null;
  const selX = sel && typeof sel.views === "number" ? times(sel.views, usual) : null;
  const rank = sel ? rankOf(home.clips, sel.id) : null;
  const where = sel ? (sel.source === "upload" ? m.clipSourceUpload : NETWORK_NAME[sel.source]) : "";
  const planKey = sel && (
    <button
      type="button"
      className={cn(s.key)}
      aria-disabled={sel.lines.length === 0 ? "true" : undefined}
      onClick={() => {
        if (sel.lines.length === 0) return;
        onPlan({ clipId: sel.id, format: sel.format, times: selTimes });
      }}
    >
      {m.clipPlanLike} <span className={s.price}>{m.clipFree}</span>
    </button>
  );
  const planNote = sel && (
    <p className="text-center text-[11.5px] leading-[1.4] text-[#858994]">
      {sel.lines.length === 0 ? m.clipPlanNoWords : formatMsg(m.clipPlanNote, { format: (sel.format ?? m.clipNoFormat).toLowerCase() })}
    </p>
  );

  const card = sel ? (
    <aside aria-label={m.clipInside} className={cn(PANEL, "flex flex-col gap-3 px-4 pb-3.5 pt-4")}>
      <div className="flex items-baseline justify-between">
        <h2 className={LABEL}>{m.clipInside}</h2>
        {rank !== null && <span className="text-[12px] text-[#858994]">{formatMsg(m.clipRank, { n: rank, total: onChart.length })}</span>}
      </div>
      <div className="flex items-center gap-3">
        <span
          className="h-[62px] w-[44px] flex-none rounded-lg bg-cover bg-center shadow-[0_0_0_1px_rgba(255,240,220,0.22),0_14px_26px_-12px_rgba(0,0,0,0.9)]"
          style={{ backgroundImage: sel.thumbUrl ? `url("${sel.thumbUrl.replace(/"/g, "%22")}"), ${tintOf(sel)}` : tintOf(sel) }}
        />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-[#ecedf1]">
            {sel.format ?? m.clipNoFormat}
            {sel.pressTour ? ` · ${m.clipPressTourAd}` : ""}
          </p>
          <p className="mt-[3px] text-[12px] text-[#9aa0ad]">
            {sel.permalink ? (
              <a href={sel.permalink} target="_blank" rel="noopener noreferrer" className="underline decoration-[rgba(255,255,255,0.25)] underline-offset-2 hover:text-[#c6c9d1]">
                {where}
              </a>
            ) : (
              where
            )}
            {sel.postedAt ? ` · ${new Date(sel.postedAt).toLocaleDateString(locale, { day: "numeric", month: "short" })}` : ""}
            {sel.durationS ? ` · ${formatMsg(m.clipSeconds, { n: Math.round(sel.durationS) })}` : ""}
          </p>
          {typeof sel.views === "number" && (
            <p className="mt-1.5 font-numeral text-[20px] italic leading-none text-[#f0cda6]">
              {compact(sel.views)}{" "}
              <span className="font-sans text-[12px] not-italic text-[#9aa0ad]">
                {m.clipViewsWord}
                {selTimes ? ` · ${formatMsg(m.clipTimesMedian, { x: selTimes })}` : ""}
              </span>
            </p>
          )}
        </div>
      </div>
      {sel.lines.length > 0 ? (
        <>
          <div>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]">
              {anatomy(sel.lines, sel.durationS).map((a, i) => (
                <span key={i} style={{ width: `${(a.share * 100).toFixed(1)}%`, background: PART_COLOUR[a.part] }} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2.5 text-[11.5px] text-[#9aa0ad]">
              {(["hook", "costar", "proof", "line"] as const).map((p) => (
                <span key={p} className="inline-flex items-center gap-[5px]">
                  <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: PART_COLOUR[p] }} />
                  {partWord(p, m)}
                </span>
              ))}
            </div>
          </div>
          <ol className="flex flex-col gap-2.5">
            {sel.lines.map((l, i) => (
              <li key={i} className="grid grid-cols-[3px_minmax(0,1fr)] gap-2.5">
                <span className="rounded-sm" style={{ background: PART_COLOUR[l.part] }} />
                <div>
                  <p className="font-slate text-[10.5px] uppercase tracking-[0.06em] text-[#858994]">
                    {stamp(l.t)} · {partWord(l.part, m)}
                  </p>
                  <p className="mt-0.5 text-[13.5px] leading-[1.4] text-[#ecedf1]">{l.said}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="text-[12.5px] leading-[1.45] text-[#9aa0ad]">{wordsNote(sel, m)}</p>
      )}
      {sel.why && (
        <p className="rounded-xl bg-[rgba(255,214,164,0.06)] px-3 py-2.5 text-[12.5px] leading-[1.45] text-[#e6d6c2] ring-1 ring-inset ring-[rgba(255,214,164,0.14)]">
          <b className="text-[#f6dcb8]">{selX !== null && selX < 1 ? m.clipWhyDidnt : m.clipWhyWorked}</b> {sel.why}
        </p>
      )}
      <div className="hidden flex-col gap-2 lg:flex">
        {planKey}
        {planNote}
      </div>
      {sel.source === "upload" && (
        <button type="button" className={cn(QUIET, "self-center")} disabled={busy !== null} onClick={() => void remove(sel.id)}>
          {m.clipRemove}
        </button>
      )}
    </aside>
  ) : null;

  return (
    <div className="mt-[18px]">
      {note && (
        <p
          role="status"
          className={cn(
            "mb-3 rounded-xl px-3 py-2 text-[12.5px] leading-[1.4] ring-1 ring-inset",
            note.outcome === "connected"
              ? "bg-[rgba(240,196,142,0.06)] text-[#f0cda6] ring-[rgba(240,196,142,0.3)]"
              : "bg-[rgba(238,214,160,0.06)] text-[#eed6a0] ring-[rgba(238,214,160,0.25)]",
          )}
        >
          {connectNoteWords(note, m)}
          <button type="button" onClick={() => setNote(null)} className="ml-2 underline underline-offset-2">
            {m.dismiss}
          </button>
        </p>
      )}

      {/* The sources strip. */}
      <div aria-label={m.clipSourcesLabel} className={cn(PANEL, "grid grid-cols-2 max-lg:divide-[rgba(255,255,255,0.07)] lg:grid-cols-4")}>
        {networkCell("instagram", true)}
        {networkCell("tiktok", false)}
        <div className="flex min-w-0 flex-col gap-1 px-4 py-3 max-lg:border-t max-lg:border-[rgba(255,255,255,0.07)] lg:border-l lg:border-[rgba(255,255,255,0.07)]">
          <span className="font-slate text-[11px] font-medium uppercase tracking-[0.1em] text-[#b3aca2]">{m.clipAds}</span>
          <span className="text-[12.5px] leading-[1.38] text-[#9aa0ad]">
            <span className="text-[#f0cda6]">{home.pressTourAds === 1 ? m.clipAdsOne : formatMsg(m.clipAdsN, { n: home.pressTourAds })}</span> · {m.clipAdsLine}
          </span>
          <span className="text-[12.5px] leading-[1.38] text-[#9aa0ad] max-lg:hidden">{m.clipAdsScripts}</span>
        </div>
        <div className="flex min-w-0 flex-col gap-1 px-4 py-3 max-lg:border-l max-lg:border-t max-lg:border-[rgba(255,255,255,0.07)] lg:border-l lg:border-[rgba(255,255,255,0.07)]">
          <span className="font-slate text-[11px] font-medium uppercase tracking-[0.1em] text-[#b3aca2]">{m.clipVideos}</span>
          <span className="text-[12.5px] leading-[1.38] text-[#9aa0ad]">
            {home.uploads === 1 ? m.clipFilesOne : formatMsg(m.clipFilesN, { n: home.uploads })} · {m.clipFilesLine}
          </span>
          <button type="button" className={cn(GHOST, "max-lg:hidden")} disabled={busy !== null} onClick={() => setUploadOpen((v) => !v)} aria-expanded={uploadOpen}>
            {m.clipAddVideos}
          </button>
        </div>
      </div>
      <button
        type="button"
        className={cn(GHOST, "mt-3 w-full lg:hidden")}
        disabled={busy !== null}
        onClick={() => setUploadOpen((v) => !v)}
        aria-expanded={uploadOpen}
      >
        {m.clipAddVideos}
      </button>
      {uploadOpen && (
        <UploadForm
          m={m}
          actions={actions}
          onDone={async () => {
            setUploadOpen(false);
            await refresh();
          }}
          onCancel={() => setUploadOpen(false)}
        />
      )}

      {/* The four numbers, and the read. */}
      <div className="mt-[18px] flex flex-wrap items-end gap-x-10 gap-y-3 max-lg:justify-between max-lg:gap-x-4">
        <Stat label={m.clipStatPosts} value={String(home.clips.length)} />
        <Stat
          label={m.clipStatMedian}
          value={usual !== null ? compact(usual) : "—"}
          unit={usual !== null ? m.clipViewsWord : undefined}
        />
        <Stat label={m.clipStatBest} value={best && typeof best.views === "number" ? compact(best.views) : "—"} lit />
        <Stat label={m.clipStatFormats} value={String(rows.length)} className="max-lg:hidden" />
        <div className="flex flex-col items-end gap-1.5 text-right max-lg:w-full max-lg:flex-row max-lg:items-center max-lg:justify-between lg:ml-auto">
          <span className={cn("text-[12px]", reading ? "text-[#f0cda6]" : "text-[#858994]")} role="status">
            {readLine}
          </span>
          {!reading && (
            <button type="button" className={QUIET} disabled={busy !== null || !canRead} onClick={() => void startRead()}>
              {home.run.finishedAt ? m.clipReadAgain : m.clipReadFirst}
            </button>
          )}
        </div>
      </div>
      {(error || home.run.error) && (
        <p role="alert" className="mt-2 text-[12.5px] leading-[1.4] text-[#eed6a0]">
          {error ? error : home.run.error === "limit" ? m.clipErrLimit : m.clipErrRead}
        </p>
      )}

      <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Every post, by views. */}
          <section className={cn(PANEL, "px-4 pb-8 pt-3.5 max-lg:px-3 max-lg:pb-6")}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className={LABEL}>{m.clipChartTitle}</h2>
              <div className="flex flex-wrap gap-2.5 text-[11.5px] text-[#9aa0ad] max-lg:hidden">
                <span className="inline-flex items-center gap-[5px]">
                  <i className="inline-block h-2 w-2 rounded-[2px] bg-[#9aa2ad]" />
                  {m.clipLegendPost}
                </span>
                <span className="inline-flex items-center gap-[5px]">
                  <i className="inline-block h-2 w-2 rounded-[2px] ring-[1.5px] ring-[#e0a468]" />
                  {m.clipLegendAd}
                </span>
                <span className="inline-flex items-center gap-[5px]">
                  <i className="inline-block w-3 border-t-[1.5px] border-dashed border-[#c9a57f]" />
                  {m.clipLegendMedian}
                </span>
              </div>
            </div>
            {onChart.length === 0 ? (
              <p className="mt-6 max-w-[520px] text-[13.5px] leading-[1.5] text-[#9aa0ad]">{m.clipChartEmpty}</p>
            ) : (
              <div className="relative mb-1 ml-[34px] mr-1.5 mt-3.5 h-[190px] lg:ml-10 lg:h-[300px]">
                {gridlines(scale).map((g) => (
                  <div key={g.views}>
                    <div className="absolute left-0 right-0 h-px bg-[rgba(255,255,255,0.06)]" style={{ top: pct(g.share) }} />
                    <span className="font-slate absolute -left-[34px] w-7 -translate-y-1/2 text-right text-[10px] text-[#6b6f79] lg:-left-10 lg:w-8 lg:text-[10.5px]" style={{ top: pct(g.share) }}>
                      {compact(g.views)}
                    </span>
                  </div>
                ))}
                {usual !== null && (
                  <>
                    <div className="absolute left-0 right-0 border-t-[1.5px] border-dashed border-[rgba(240,205,166,0.45)]" style={{ top: pct(yShare(usual, scale)) }} />
                    <span className="font-slate absolute right-0 -translate-y-[120%] text-[10.5px] text-[#c9a57f] max-lg:hidden" style={{ top: pct(yShare(usual, scale)) }}>
                      {formatMsg(m.clipMedianLine, { n: compact(usual) })}
                    </span>
                  </>
                )}
                {monthTicks(scale).map((t) => (
                  <span key={t.at} className="font-slate absolute -bottom-5 text-[10px] text-[#6b6f79] lg:-bottom-[22px] lg:text-[10.5px]" style={{ left: pct(t.share) }}>
                    {new Date(t.at).toLocaleDateString(locale, { month: "short", timeZone: "UTC" })}
                  </span>
                ))}
                {onChart.map((c) => {
                  const on = sel?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-label={`${c.format ?? m.clipNoFormat}, ${compact(c.views as number)} ${m.clipViewsWord}${c.postedAt ? `, ${new Date(c.postedAt).toLocaleDateString(locale, { day: "numeric", month: "short" })}` : ""}${c.pressTour ? `, ${m.clipPressTourAd}` : ""}`}
                      aria-pressed={on}
                      onClick={() => setSelId(c.id)}
                      className={cn(
                        "absolute h-[17px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-cover bg-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] lg:h-[26px] lg:w-[18px] lg:rounded",
                        on
                          ? "z-[2] shadow-[0_0_0_2px_#0b0c10,0_0_0_4px_#fbf6ee,0_0_18px_rgba(240,205,166,0.5)]"
                          : c.pressTour
                            ? "shadow-[0_0_0_2px_#0b0c10,0_0_0_3.5px_#e0a468]"
                            : "shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_6px_10px_-4px_rgba(0,0,0,0.8)]",
                      )}
                      style={{
                        left: pct(xShare(c.postedAt, scale)),
                        top: pct(yShare(c.views as number, scale)),
                        backgroundImage: c.thumbUrl ? `url("${c.thumbUrl.replace(/"/g, "%22")}"), ${tintOf(c)}` : tintOf(c),
                      }}
                    />
                  );
                })}
              </div>
            )}
          </section>

          {/* Which formats win. */}
          <section className={cn(PANEL, "overflow-hidden")}>
            <div className="flex items-baseline justify-between px-3.5 pb-2.5 pt-3">
              <h2 className={LABEL}>{m.clipFormatsTitle}</h2>
              <span className="text-[12px] text-[#858994] max-lg:hidden">{m.clipFormatsSub}</span>
            </div>
            {rows.length === 0 ? (
              <p className="border-t border-[rgba(255,255,255,0.06)] px-3.5 py-3 text-[13px] text-[#9aa0ad]">{m.clipFormatsEmpty}</p>
            ) : (
              <>
                {rows.map((r, i) => {
                  const up = r.times !== null && r.times >= 1.5;
                  const on = sel?.format === r.format;
                  return (
                    <button
                      key={r.format}
                      type="button"
                      onClick={() => setSelId(r.bestId)}
                      className={cn(
                        "grid min-h-11 w-full grid-cols-[12px_minmax(0,1fr)_54px_44px] items-center gap-2.5 border-t border-[rgba(255,255,255,0.06)] px-3 text-left text-[13.5px] text-[#c6c9d1] hover:bg-[rgba(255,255,255,0.025)] lg:grid-cols-[22px_minmax(0,1.3fr)_104px_minmax(0,2fr)_72px] lg:gap-3 lg:px-3.5",
                        on && "bg-[rgba(240,205,166,0.05)]",
                        i >= 3 && !moreFormats && "max-lg:hidden",
                      )}
                    >
                      <span className="h-[17px] w-3 rounded-[3px] lg:h-5 lg:w-3.5" style={{ background: TINTS[i % TINTS.length] }} />
                      <span className="truncate font-medium text-[#ecedf1]">{r.format}</span>
                      <span className="whitespace-nowrap text-[12px] text-[#858994] max-lg:hidden">{r.posts === 1 ? m.clipPostsOne : formatMsg(m.clipPostsN, { n: r.posts })}</span>
                      <span className="grid grid-cols-[minmax(0,1fr)_48px] items-center gap-2.5 max-lg:hidden">
                        <span className="h-1.5 overflow-hidden rounded-[3px] bg-[rgba(255,255,255,0.06)]">
                          <i className="block h-full rounded-[3px] bg-[linear-gradient(90deg,#97602f,#f0bb84)]" style={{ width: `${Math.round((r.median / topViews) * 100)}%` }} />
                        </span>
                        <span className="text-[12px] text-[#c6c9d1]">{compact(r.median)}</span>
                      </span>
                      <span className="text-[12px] text-[#858994] lg:hidden">{compact(r.median)}</span>
                      <span className={cn("text-right font-numeral text-[16px] lg:text-[17px]", up ? "text-[#f0cda6]" : "text-[#ecedf1]")}>
                        {r.times !== null ? `${Math.round(r.times * 10) / 10}×` : "—"}
                      </span>
                    </button>
                  );
                })}
                {rows.length > 3 && !moreFormats && (
                  <button
                    type="button"
                    onClick={() => setMoreFormats(true)}
                    className="flex min-h-11 w-full items-center justify-between border-t border-[rgba(255,255,255,0.06)] px-3 text-[13.5px] text-[#858994] lg:hidden"
                  >
                    <span className="pl-[22px]">{formatMsg(m.clipMoreFormats, { n: rows.length - 3 })}</span>
                    <span aria-hidden="true">›</span>
                  </button>
                )}
              </>
            )}
          </section>
        </div>
        {card}
      </div>

      <p className="mt-4 flex items-start gap-2 text-[12px] leading-[1.45] text-[#858994]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9aa0ad" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-px flex-none" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <span>{m.clipFoot}</span>
      </p>

      {sel && (
        <div className="sticky bottom-0 z-[3] -mx-3 -mb-4 mt-3.5 border-t border-[rgba(255,255,255,0.08)] bg-[#0e0f14] px-3 pb-4 pt-3 lg:hidden">
          {planKey}
        </div>
      )}
      {sel && <div className="mt-2 lg:hidden">{planNote}</div>}
    </div>
  );
}

function Stat({ label, value, unit, lit, className }: { label: string; value: string; unit?: string; lit?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-[3px]", className)}>
      <span className="font-slate text-[11px] font-medium uppercase tracking-[0.12em] text-[#858994]">{label}</span>
      <span className={cn("font-numeral text-[21px] leading-none lg:text-[26px]", lit ? "italic text-[#f0cda6]" : "text-[#ecedf1]")}>
        {value}
        {unit && <span className="ml-1 font-sans text-[12px] text-[#858994] max-lg:hidden">{unit}</span>}
      </span>
    </div>
  );
}

function UploadForm({ m, actions, onDone, onCancel }: { m: Words; actions: ClippingsActions; onDone: () => Promise<void>; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [views, setViews] = useState("");
  const [date, setDate] = useState("");
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!file) return setError(m.clipErrBadFile);
    if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) return setError(m.clipErrBadFile);
    if (file.size > UPLOAD_MAX_BYTES) return setError(m.clipErrTooBig);
    if (!attest) return setError(m.clipErrAttest);
    setBusy(true);
    setError(null);
    const clipId = crypto.randomUUID();
    try {
      const place = await actions.clipUploadPlace({ clipId, type: file.type, size: file.size });
      if (!place.ok) {
        setError(errorWord(place.error, m));
        return;
      }
      const { error: upErr } = await createClient().storage.from(place.bucket).uploadToSignedUrl(place.path, place.token, file, { contentType: file.type });
      if (upErr) {
        setError(m.clipErrUnavailable);
        return;
      }
      const done = await actions.addClip({ clipId, views: views.trim() || null, postedAt: date || null, attest });
      if (!done.ok) {
        setError(errorWord(done.error, m));
        return;
      }
      await onDone();
    } catch {
      setError(m.clipErrUnavailable);
    } finally {
      setBusy(false);
    }
  };

  const field = "mt-1 block w-full rounded-[10px] bg-[rgba(255,255,255,0.03)] px-2.5 py-2 text-[13px] text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6]";
  return (
    <section aria-label={m.clipUploadTitle} className={cn(PANEL, "mt-3 grid gap-3 p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]")}>
      <h2 className={cn(LABEL, "lg:col-span-3")}>{m.clipUploadTitle}</h2>
      <label className="block text-[12px] text-[#9aa0ad]">
        {m.clipUploadFile}
        <input type="file" accept={UPLOAD_TYPES.join(",")} className={cn(field, "file:mr-3 file:rounded-md file:border-0 file:bg-[rgba(255,255,255,0.08)] file:px-2 file:py-1 file:text-[#ecedf1]")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label className="block text-[12px] text-[#9aa0ad]">
        {m.clipUploadViews}
        <input type="text" inputMode="numeric" value={views} onChange={(e) => setViews(e.target.value)} className={field} />
      </label>
      <label className="block text-[12px] text-[#9aa0ad]">
        {m.clipUploadDate}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(field, "[color-scheme:dark]")} />
      </label>
      <label className="flex items-start gap-2 text-[12.5px] leading-[1.4] text-[#c6c9d1] lg:col-span-3">
        <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#e0a468]" />
        {m.clipUploadAttest}
      </label>
      <p className="text-[12px] leading-[1.45] text-[#858994] lg:col-span-2">{m.clipUploadNote}</p>
      <div className="flex items-center justify-end gap-3">
        <button type="button" className={QUIET} onClick={onCancel} disabled={busy}>
          {m.clipCancel}
        </button>
        <button type="button" className={cn(s.key, "w-auto")} onClick={() => void add()} aria-disabled={busy ? "true" : undefined}>
          {busy ? m.clipUploading : m.clipUploadAdd}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[12.5px] text-[#eed6a0] lg:col-span-3">
          {error}
        </p>
      )}
    </section>
  );
}
