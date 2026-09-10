"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import { isStaleDeployError } from "@/lib/stale-deploy";
import { deleteSet, pollSetBuild, submitSetBuild } from "@/lib/sets/actions";
import { SET_BRIEF_MAX_CHARS } from "@/lib/sets/set-config";
import { SETS_NOT_OPEN, SETS_SESSION_EXPIRED, SETS_SUSPENDED, SETS_UNAVAILABLE, SET_NOT_FOUND } from "@/lib/sets/messages";
import type { SetSummary } from "@/lib/sets/types";
import { LocalDate } from "@/components/local-date";

// The Sets page (Astra Sets, 2026-09-10): describe a place, and the list of
// places already built. A build runs at OpenAI in the background for about
// a minute and a half; this page polls each one that is still building, and
// the server does the collecting (pollSetBuild) — so leaving and coming back
// within the ten minutes background mode keeps an answer loses nothing.

const POLL_MS = 5000;
const POLL_MAX_MS = 30_000;
// Answers that mean no set on this page can be collected from here any
// more: polling stops and the sentence is shown.
const ACCESS_ERRORS = new Set([SETS_UNAVAILABLE, SETS_NOT_OPEN, SETS_SESSION_EXPIRED, SETS_SUSPENDED]);

export function SetsHome({
  initialSets,
  usedThisMonth,
  monthlyLimit,
}: {
  initialSets: SetSummary[];
  usedThisMonth: number;
  monthlyLimit: number;
}) {
  const { t } = useLocale();
  const s = t.sets;
  const router = useRouter();

  const [sets, setSets] = useState<SetSummary[]>(initialSets);
  const [seenInitial, setSeenInitial] = useState(initialSets);
  const [brief, setBrief] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pollingStopped, setPollingStopped] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A refresh brings the server's truth (titles, thumbnails) for sets that
  // finished; it replaces the local list. Adjusted during render, not in an
  // effect, so the stale list never paints first.
  if (initialSets !== seenInitial) {
    setSeenInitial(initialSets);
    setSets(initialSets);
  }

  const buildingIds = pollingStopped
    ? ""
    : sets.filter((x) => x.status === "building").map((x) => x.id).join(",");

  // Collects every build still running. The server does the collecting; a
  // tick that throws (a dropped connection, a laptop waking) must never end
  // the loop, because the answer it is waiting for is already paid for and
  // lasts only minutes at OpenAI — so it backs off and tries again, and a
  // tab running an old deploy reloads itself onto the new one.
  useEffect(() => {
    if (!buildingIds) return;
    let cancelled = false;
    let delay = POLL_MS;
    const tick = async () => {
      let settled = false;
      let threw = false;
      for (const id of buildingIds.split(",")) {
        let res: Awaited<ReturnType<typeof pollSetBuild>>;
        try {
          res = await pollSetBuild(id);
        } catch (err) {
          if (isStaleDeployError(err)) {
            window.location.reload();
            return;
          }
          threw = true;
          continue;
        }
        if (cancelled) return;
        if (res.error !== null) {
          if (res.error === SET_NOT_FOUND) {
            // Deleted in another tab or on another device.
            setSets((prev) => prev.filter((x) => x.id !== id));
            continue;
          }
          if (ACCESS_ERRORS.has(res.error)) {
            setError(res.error);
            setPollingStopped(true);
            return;
          }
          threw = true;
          continue;
        }
        if (res.state === "building") continue;
        settled = true;
        setSets((prev) =>
          prev.map((x) =>
            x.id === id
              ? { ...x, status: res.state, failure: res.state === "failed" ? res.message : null }
              : x,
          ),
        );
      }
      if (cancelled) return;
      if (settled) router.refresh();
      delay = threw ? Math.min(POLL_MAX_MS, delay * 2) : POLL_MS;
      timerRef.current = setTimeout(tick, delay);
    };
    timerRef.current = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [buildingIds, router]);

  async function build() {
    if (starting) return;
    setError("");
    setStarting(true);
    let res: Awaited<ReturnType<typeof submitSetBuild>>;
    try {
      res = await submitSetBuild(brief);
    } catch (err) {
      const stale = isStaleDeployError(err);
      setError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) setTimeout(() => window.location.reload(), 1800);
      return;
    } finally {
      setStarting(false);
    }
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    setSets((prev) => [
      {
        id: res.id,
        title: "",
        brief: brief.trim(),
        status: "building",
        createdAt: new Date().toISOString(),
        thumbUrl: null,
        failure: null,
      },
      ...prev,
    ]);
    setBrief("");
    router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm(s.deleteConfirm)) return;
    setDeleting(id);
    let res: Awaited<ReturnType<typeof deleteSet>>;
    try {
      res = await deleteSet(id);
    } catch (err) {
      const stale = isStaleDeployError(err);
      setError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) setTimeout(() => window.location.reload(), 1800);
      return;
    } finally {
      setDeleting(null);
    }
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    setSets((prev) => prev.filter((x) => x.id !== id));
    router.refresh();
  }

  const used = usedThisMonth;
  const atCap = monthlyLimit >= 0 && used >= monthlyLimit;

  return (
    <div className="space-y-8">
      {/* New set */}
      <section className="space-y-3 rounded-media border border-atelier-rule bg-atelier-surface p-5">
        <h2 className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{s.newTitle}</h2>
        <label className="block">
          <span className="sr-only">{s.briefLabel}</span>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value.slice(0, SET_BRIEF_MAX_CHARS))}
            rows={3}
            placeholder={s.briefPlaceholder}
            aria-label={s.briefLabel}
            className="w-full rounded-control border border-atelier-rule bg-transparent px-3 py-2 text-sm text-atelier-ink outline-none transition-colors placeholder:text-atelier-muted/70 focus:border-atelier-accent"
          />
        </label>
        <p className="text-xs text-atelier-muted">{s.briefHint}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 text-xs text-atelier-muted">
            <p>{s.buildMeta}</p>
            <p className="tabular-nums">
              {monthlyLimit < 0 ? s.unlimitedUsage : formatMsg(s.monthlyUsage, { used, limit: monthlyLimit })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs tabular-nums text-atelier-muted">
              {brief.length}/{SET_BRIEF_MAX_CHARS}
            </span>
            <button
              type="button"
              onClick={() => void build()}
              disabled={starting || atCap || brief.trim().length === 0}
              className="cursor-pointer rounded-control bg-atelier-ink px-5 py-2.5 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {starting ? s.starting : s.buildButton}
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{localizeServerText(error, t)}</p>}
      </section>

      {/* The sets */}
      {sets.length === 0 ? (
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium text-atelier-ink">{s.emptyTitle}</p>
          <p className="mx-auto max-w-md text-sm text-atelier-muted">{s.emptyBody}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sets.map((x) => {
            const name = x.title || (x.status === "ready" ? s.untitled : x.brief);
            return (
              <li key={x.id} className="overflow-hidden rounded-media border border-atelier-rule bg-atelier-surface">
                <div className="relative aspect-square bg-atelier-stage">
                  {x.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={x.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div
                      aria-hidden
                      className="h-full w-full opacity-40 [background-image:linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:28px_28px]"
                    />
                  )}
                  <span
                    className={`absolute left-3 top-3 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
                      x.status === "ready"
                        ? "bg-black/60 text-onmedia"
                        : x.status === "building"
                          ? "animate-pulse bg-atelier-accent text-atelier-stage"
                          : "bg-red-600/90 text-white"
                    }`}
                  >
                    {x.status === "ready" ? s.statusReady : x.status === "building" ? s.statusBuilding : s.statusFailed}
                  </span>
                  {x.status === "ready" && (
                    <Link href={`/app/sets/${x.id}`} className="absolute inset-0" aria-label={`${s.open}: ${name}`} />
                  )}
                </div>
                <div className="space-y-1.5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-2 text-sm font-medium text-atelier-ink">{name}</p>
                    <span className="flex-shrink-0 text-xs tabular-nums text-atelier-muted">
                      <LocalDate date={x.createdAt} />
                    </span>
                  </div>
                  {x.status === "building" && <p className="text-xs text-atelier-muted">{s.statusBuildingHint}</p>}
                  {x.status === "failed" && x.failure && (
                    <p className="text-xs text-atelier-muted">{localizeServerText(x.failure, t)}</p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    {x.status === "ready" ? (
                      <Link href={`/app/sets/${x.id}`} className="text-xs font-medium text-atelier-accent underline underline-offset-2">
                        {s.open}
                      </Link>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      onClick={() => void remove(x.id)}
                      disabled={deleting === x.id}
                      className="cursor-pointer text-xs text-atelier-muted transition-colors hover:text-red-600 disabled:opacity-50"
                    >
                      {deleting === x.id ? s.deleting : s.delete}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
