"use client";

// Effects (operator, 2026-09-29: "sometimes people only want visual… make it
// its own door"): a finished film in, the same film out with opening titles,
// a corner badge, end credits, a vertical version with the words under it, a
// cover, and sound effects that can be switched off. Opus 5.5 does the
// finishing (lib/editor/effects*.ts); this page picks the film, the effects
// and their words, and shows what came back.
//
// Colours are literal hex, as on Director's Cut: the Screening theme
// redefines Tailwind's `white` as near-black.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/provider";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { reviseEdit } from "@/lib/editor/actions";
import {
  getEffects,
  listEffects,
  startEffects,
  submitEffects,
  type EffectsSummary,
  type LibraryVideo,
} from "@/lib/editor/effects-actions";
import { EDITOR_BUCKET } from "@/lib/editor/job";
import { EFFECTS_LIMITS, effectsOn, type EffectKey, type EffectsSpec } from "@/lib/editor/effects";
import { EffectForm } from "./effects-library";

const WORKING = new Set(["uploading", "analyzing", "directing", "bundling", "rendering"]);
const POLL_MS = 5000;

type Detail = NonNullable<Awaited<ReturnType<typeof getEffects>>["job"]>;
type Source = { kind: "take"; video: LibraryVideo } | { kind: "upload"; file: File; url: string; seconds: number | null };
type Form = Omit<EffectsSpec, "logo" | "source">;

const START: Form = {
  opening: { on: true, presenter: "", title: "" },
  badge: { on: false, text: "" },
  credits: { on: true, lines: "", endCard: "" },
  vertical: { on: false, words: "" },
  cover: { on: true },
  sound: true,
  notes: "",
};

type Guard = <T>(work: () => Promise<T>) => Promise<T | null>;

type Tab = "video" | "photo" | "titles";

export function EffectsDoor({
  initialJobs,
  library,
  pictures = [],
  initialPick = null,
  initialTab,
  offEngines = [],
}: {
  initialJobs: EffectsSummary[];
  /** Effect engines taken off the menu on Admin → Models. */
  offEngines?: string[];
  /** Their own finished videos. */
  library: LibraryVideo[];
  /** Their own finished pictures. */
  pictures?: LibraryVideo[];
  /** A History item's "Add an effect" door (/app/effects?take=<id>): that video or picture, already picked. */
  initialPick?: LibraryVideo | null;
  initialTab?: Tab;
}) {
  const { t } = useLocale();
  const e = t.effects;
  const [tab, setTab] = useState<Tab>(initialTab ?? (initialPick?.kind === "image" ? "photo" : "video"));
  const [jobs, setJobs] = useState(initialJobs);
  const [openId, setOpenId] = useState<string | null>(initialJobs[0]?.id ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guard: Guard = useCallback(async (work) => {
    try {
      return await work();
    } catch (err) {
      if (isStaleDeployError(err) && reloadForNewDeploy()) return null;
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  const refresh = useCallback(
    async (id: string | null) => {
      const list = await guard(() => listEffects());
      if (list && !list.error) setJobs(list.jobs);
      if (id) {
        const one = await guard(() => getEffects(id));
        if (one?.job) setDetail(one.job);
      }
    },
    [guard],
  );

  useEffect(() => {
    if (!openId) return;
    setDetail((cur) => (cur?.id === openId ? cur : null));
    void refresh(openId);
  }, [openId, refresh]);

  const anyWorking = jobs.some((j) => WORKING.has(j.stage)) || (detail !== null && WORKING.has(detail.stage));
  useEffect(() => {
    if (!anyWorking) return;
    const timer = setInterval(() => void refresh(openId), POLL_MS);
    return () => clearInterval(timer);
  }, [anyWorking, openId, refresh]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <section className="flex flex-col gap-6 rounded-[28px] bg-[#0b0c10] px-4 pb-6 pt-6 text-[#c6c9d1] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_32px_72px_-28px_rgba(0,0,0,0.7)] sm:px-8 sm:pt-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-[#ecedf1]">{e.title}</h1>
            <p className="mt-1.5 max-w-xl text-sm text-[#9aa0ad]">{e.lede}</p>
          </div>
          <span className="font-mono text-xs text-[#6b6f7a]">{t.directorsCut.testing}</span>
        </div>
        <div role="tablist" aria-label={e.title} className="flex gap-1 rounded-full bg-[#101116] p-1 ring-1 ring-[rgba(255,255,255,0.08)] sm:self-start">
          {(["video", "photo", "titles"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`min-h-10 flex-1 rounded-full px-4 text-sm transition-colors sm:flex-none ${tab === k ? "bg-[#e0a468] font-semibold text-[#1a0f07]" : "text-[#c6c9d1] hover:text-[#ecedf1]"}`}
            >
              {k === "video" ? e.tabVideo : k === "photo" ? e.tabPhoto : e.tabTitles}
            </button>
          ))}
        </div>
        {tab === "titles" ? (
          <NewJob
            library={library}
            initialPick={initialPick?.kind === "video" ? initialPick : null}
            guard={guard}
            onStarted={async (id) => {
              setOpenId(id);
              await refresh(id);
            }}
          />
        ) : (
          <EffectForm
            key={tab}
            kind={tab === "video" ? "shot" : "photo"}
            library={tab === "video" ? library : pictures}
            initialPick={initialPick}
            guard={guard}
            offEngines={offEngines}
            onStarted={async (id) => {
              setOpenId(id);
              await refresh(id);
            }}
          />
        )}
        {error && <p className="text-sm text-[#f0a3a3]">{error}</p>}
      </section>

      {jobs.length > 0 && (
        <section aria-label={e.yourEffects} className="flex flex-col gap-3">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{e.yourEffects}</h2>
          <div className="flex flex-col gap-3">
            {jobs.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                open={openId === j.id}
                detail={openId === j.id && detail?.id === j.id ? detail : null}
                onToggle={() => setOpenId((cur) => (cur === j.id ? null : j.id))}
                guard={guard}
                onChanged={() => refresh(j.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------- a new film

function NewJob({
  library,
  initialPick,
  guard,
  onStarted,
}: {
  library: LibraryVideo[];
  initialPick: LibraryVideo | null;
  guard: Guard;
  onStarted: (id: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const e = t.effects;
  const [source, setSource] = useState<Source | null>(initialPick ? { kind: "take", video: initialPick } : null);
  const [form, setForm] = useState<Form>(() => (initialPick ? { ...START, vertical: { on: false, words: initialPick.prompt } } : START));
  const [logo, setLogo] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const filmInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // Local previews are let go when replaced and when the form goes away.
  const uploadUrl = source?.kind === "upload" ? source.url : null;
  useEffect(() => () => {
    if (uploadUrl) URL.revokeObjectURL(uploadUrl);
  }, [uploadUrl]);
  useEffect(() => {
    if (!logo) return setLogoUrl(null);
    const url = URL.createObjectURL(logo);
    setLogoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const pickTake = (video: LibraryVideo) => {
    setSource({ kind: "take", video });
    // The words it was made from are the natural words under a vertical version.
    setForm((f) => (f.vertical.words ? f : { ...f, vertical: { ...f.vertical, words: video.prompt } }));
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function finish() {
    if (!source || busy) return;
    setProblem(null);
    setBusy(source.kind === "take" ? e.copying : t.directorsCut.starting);
    const started = await guard(() =>
      startEffects({
        effects: form,
        film: source.kind === "upload" ? { name: source.file.name, size: source.file.size, type: source.file.type } : null,
        takeId: source.kind === "take" ? source.video.id : null,
        logo: logo ? { name: logo.name, size: logo.size, type: logo.type } : null,
      }),
    );
    if (!started || started.error !== null) {
      setProblem(started?.error ?? null);
      setBusy(null);
      return;
    }
    const supabase = createClient();
    for (const place of started.uploads) {
      const file = place.kind === "film" && source.kind === "upload" ? source.file : place.kind === "logo" ? logo : null;
      if (!file) continue;
      setBusy(place.kind === "film" ? e.uploadingFilm : e.uploadingLogo);
      const { error } = await supabase.storage.from(EDITOR_BUCKET).uploadToSignedUrl(place.path, place.token, file, { contentType: file.type });
      if (error) {
        setProblem(error.message);
        setBusy(null);
        return;
      }
    }
    const submitted = await guard(() => submitEffects(started.editId));
    setBusy(null);
    if (!submitted || submitted.error) {
      setProblem(submitted?.error ?? null);
      return;
    }
    setSource(null);
    setLogo(null);
    setForm(START);
    await onStarted(started.editId);
  }

  const anyOn = form.opening.on || form.badge.on || form.credits.on || form.vertical.on || form.cover.on;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* The film */}
      <div className="flex min-w-0 flex-col gap-3">
        <Label>{e.yourVideo}</Label>
        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-[18px] bg-[#050608] ring-1 ring-[rgba(255,255,255,0.08)]">
          {source ? (
            <>
              <video
                key={source.kind === "take" ? source.video.url : source.url}
                src={`${source.kind === "take" ? source.video.url : source.url}#t=0.5`}
                poster={source.kind === "take" ? source.video.poster ?? undefined : undefined}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(ev) => {
                  const secs = ev.currentTarget.duration;
                  if (source.kind === "upload") setSource({ ...source, seconds: Number.isFinite(secs) ? secs : null });
                }}
                className="h-full w-full object-contain"
              />
              <button
                type="button"
                onClick={() => setSource(null)}
                className="absolute right-2 top-2 rounded-full bg-[rgba(7,8,11,0.75)] px-3 py-1.5 text-xs text-[#c6c9d1] hover:text-[#ecedf1]"
              >
                {e.change}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => filmInput.current?.click()}
              className="flex h-full w-full flex-col items-center justify-center gap-2 border border-dashed border-[rgba(255,255,255,0.16)] text-sm text-[#9aa0ad] hover:border-[rgba(224,164,104,0.5)] hover:text-[#ecedf1] rounded-[18px]"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {e.upload}
              <span className="font-mono text-[11px] text-[#6b6f7a]">{e.uploadHint}</span>
            </button>
          )}
        </div>
        {source && (
          <p className="flex min-w-0 items-baseline gap-2 text-xs text-[#9aa0ad]">
            <span className="min-w-0 truncate">{source.kind === "take" ? source.video.title : source.file.name}</span>
            {(source.kind === "take" ? source.video.seconds : source.seconds) ? (
              <span className="shrink-0 font-mono text-[#6b6f7a]">{clock((source.kind === "take" ? source.video.seconds : source.seconds) ?? 0)}</span>
            ) : null}
          </p>
        )}
        <input
          ref={filmInput}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(ev) => {
            const file = ev.currentTarget.files?.[0];
            ev.currentTarget.value = "";
            if (file) setSource({ kind: "upload", file, url: URL.createObjectURL(file), seconds: null });
          }}
        />

        {library.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label>{e.fromLibrary}</Label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {library.slice(0, 12).map((v) => {
                const picked = source?.kind === "take" && source.video.id === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={picked}
                    aria-label={v.title}
                    title={v.title}
                    onClick={() => pickTake(v)}
                    className={`relative aspect-video overflow-hidden rounded-[10px] bg-[#101116] ring-1 transition ${
                      picked ? "ring-2 ring-[#e0a468]" : "ring-[rgba(255,255,255,0.08)] hover:ring-[rgba(255,255,255,0.3)]"
                    }`}
                  >
                    {v.poster ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <video src={`${v.url}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    )}
                    {v.seconds ? (
                      <span className="absolute bottom-1 right-1 rounded bg-[rgba(7,8,11,0.75)] px-1 font-mono text-[10px] text-[#c6c9d1]">{clock(v.seconds)}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* The effects */}
      <div className="flex min-w-0 flex-col gap-2.5">
        <Label>{e.theEffects}</Label>

        <Effect title={e.opening} sub={e.openingSub} on={form.opening.on} onToggle={(on) => set("opening", { ...form.opening, on })}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label={e.presenter} value={form.opening.presenter} max={EFFECTS_LIMITS.presenter} placeholder={e.presenterPlaceholder} onChange={(v) => set("opening", { ...form.opening, presenter: v })} />
            <Field label={e.filmTitle} value={form.opening.title} max={EFFECTS_LIMITS.title} placeholder={e.filmTitlePlaceholder} onChange={(v) => set("opening", { ...form.opening, title: v })} />
          </div>
          <div className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-10 max-w-[120px] rounded-md bg-[#050608] object-contain p-1 ring-1 ring-[rgba(255,255,255,0.1)]" />
            ) : null}
            <button type="button" onClick={() => logoInput.current?.click()} className="min-h-9 rounded-full border border-[rgba(255,255,255,0.14)] px-3.5 text-xs text-[#c6c9d1] hover:border-[rgba(255,255,255,0.3)]">
              {logo ? e.replaceLogo : e.addLogo}
            </button>
            {logo ? (
              <button type="button" onClick={() => setLogo(null)} className="text-xs text-[#9aa0ad] hover:text-[#ecedf1]">
                {e.removeLogo}
              </button>
            ) : (
              <span className="text-[11px] text-[#6b6f7a]">{e.logoHint}</span>
            )}
            <input
              ref={logoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(ev) => {
                const file = ev.currentTarget.files?.[0];
                ev.currentTarget.value = "";
                if (file) setLogo(file);
              }}
            />
          </div>
        </Effect>

        <Effect title={e.badge} sub={e.badgeSub} on={form.badge.on} onToggle={(on) => set("badge", { ...form.badge, on })}>
          <Field label={e.badgeText} value={form.badge.text} max={EFFECTS_LIMITS.badge} placeholder={e.badgePlaceholder} onChange={(v) => set("badge", { ...form.badge, text: v })} />
        </Effect>

        <Effect title={e.credits} sub={e.creditsSub} on={form.credits.on} onToggle={(on) => set("credits", { ...form.credits, on })}>
          <Field multiline rows={3} label={e.creditLines} value={form.credits.lines} max={EFFECTS_LIMITS.credits} placeholder={e.creditLinesPlaceholder} onChange={(v) => set("credits", { ...form.credits, lines: v })} />
          <Field label={e.endCard} value={form.credits.endCard} max={EFFECTS_LIMITS.endCard} placeholder={e.endCardPlaceholder} onChange={(v) => set("credits", { ...form.credits, endCard: v })} />
        </Effect>

        <Effect title={e.vertical} sub={e.verticalSub} on={form.vertical.on} onToggle={(on) => set("vertical", { ...form.vertical, on })}>
          <Field multiline rows={3} label={e.words} value={form.vertical.words} max={EFFECTS_LIMITS.words} placeholder={e.wordsPlaceholder} onChange={(v) => set("vertical", { ...form.vertical, words: v })} />
        </Effect>

        <Effect title={e.cover} sub={e.coverSub} on={form.cover.on} onToggle={(on) => set("cover", { on })} />

        <Effect title={e.sound} sub={form.sound ? e.soundOnSub : e.soundOffSub} on={form.sound} onToggle={(on) => set("sound", on)} />

        <Field multiline rows={2} label={e.notes} value={form.notes} max={EFFECTS_LIMITS.notes} placeholder={e.notesPlaceholder} onChange={(v) => set("notes", v)} />

        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="text-[11px] leading-snug text-[#6b6f7a]">{e.howLong}</span>
          <button
            type="button"
            onClick={finish}
            disabled={!source || !anyOn || busy !== null}
            className="ml-auto min-h-11 w-full rounded-full bg-[#e0a468] px-7 py-3 text-[15px] font-semibold text-[#1a0f07] transition-opacity disabled:opacity-40 sm:w-auto"
          >
            {busy ?? e.finish}
          </button>
        </div>
        {!source && <p className="text-right text-[11px] text-[#6b6f7a]">{e.pickFirst}</p>}
        {problem && <p className="text-sm text-[#f0a3a3]">{problem}</p>}
      </div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6f7a]">{children}</span>;
}

/** One effect: a switch with its name and one line, and its fields while it is on. */
function Effect({ title, sub, on, onToggle, children }: { title: string; sub: string; on: boolean; onToggle: (on: boolean) => void; children?: ReactNode }) {
  return (
    <div className={`rounded-[14px] px-3.5 py-3 ring-1 transition-colors ${on ? "bg-[#101116] ring-[rgba(224,164,104,0.35)]" : "bg-transparent ring-[rgba(255,255,255,0.08)]"}`}>
      <label className="flex cursor-pointer items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-[#ecedf1]">{title}</span>
          <span className="mt-0.5 block text-[12px] leading-snug text-[#9aa0ad]">{sub}</span>
        </span>
        <input type="checkbox" role="switch" checked={on} onChange={(ev) => onToggle(ev.currentTarget.checked)} className="peer sr-only" />
        <span
          aria-hidden="true"
          className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[#e0a468] ${on ? "bg-[#e0a468]" : "bg-[rgba(255,255,255,0.14)]"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#ecedf1] shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
        </span>
      </label>
      {on && children ? <div className="mt-3 flex flex-col gap-2.5">{children}</div> : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  max,
  placeholder,
  multiline = false,
  rows = 2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const cls =
    "w-full rounded-[10px] border border-[rgba(255,255,255,0.1)] bg-[#0b0c10] px-3 py-2 text-[14px] text-[#ecedf1] placeholder:text-[#6b6f7a] focus:border-[rgba(224,164,104,0.6)] focus:outline-none";
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-[#9aa0ad]">{label}</span>
      {multiline ? (
        <textarea rows={rows} value={value} maxLength={max} placeholder={placeholder} onChange={(ev) => onChange(ev.target.value)} className={`${cls} resize-none leading-relaxed`} />
      ) : (
        <input value={value} maxLength={max} placeholder={placeholder} onChange={(ev) => onChange(ev.target.value)} className={`${cls} min-h-10`} />
      )}
    </label>
  );
}

// ------------------------------------------------------------- your films

function JobCard({
  job,
  open,
  detail,
  onToggle,
  guard,
  onChanged,
}: {
  job: EffectsSummary;
  open: boolean;
  detail: Detail | null;
  onToggle: () => void;
  guard: Guard;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const e = t.effects;
  const d = t.directorsCut;
  const working = WORKING.has(job.stage);
  const status =
    job.stage === "done"
      ? d.phase.done
      : job.stage === "failed"
        ? d.phase.failed
        : job.stage === "uploading"
          ? d.phase.uploading
          : job.fx
            ? job.progress ?? e.working
            : job.stage === "analyzing"
              ? e.reading
              : e.finishing;
  const activity = detail?.activity ? (detail.activity.code ? d.activity[detail.activity.code] : null) ?? detail.activity.text : null;

  return (
    <article className="overflow-hidden rounded-[20px] bg-[#0b0c10] text-[#c6c9d1] shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full min-w-0 items-center gap-3 p-3 text-left sm:p-4">
        <span className="relative flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#050608] ring-1 ring-[rgba(255,255,255,0.08)]">
          {job.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={job.cover} alt="" className="h-full w-full object-cover" />
          ) : working ? (
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#e0a468]" />
          ) : (
            <span className="font-mono text-[10px] text-[#6b6f7a]">FX</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-[#ecedf1]">{job.label}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {job.fx && (
              <span className="rounded-full bg-[rgba(224,164,104,0.14)] px-2 py-0.5 font-mono text-[10px] text-[#e0a468]">
                {job.fx.kind === "shot" ? e.chipOnVideo : e.chipOnPhoto} · {job.fx.effectId ? ((e.shots as Record<string, string>)[job.fx.effectId] ?? job.fx.effectName) : e.chipOwnWords}
              </span>
            )}
            {job.fx && job.fx.tries > 1 && <span className="rounded-full bg-[rgba(255,255,255,0.06)] px-2 py-0.5 font-mono text-[10px] text-[#9aa0ad]">{e.chipSecondTry}</span>}
            {job.spec && effectsOn(job.spec).map((k) => (
              <span key={k} className="rounded-full bg-[rgba(255,255,255,0.06)] px-2 py-0.5 font-mono text-[10px] text-[#9aa0ad]">
                {chip(e, k)}
              </span>
            ))}
            {job.spec && !job.spec.sound && <span className="rounded-full bg-[rgba(255,255,255,0.06)] px-2 py-0.5 font-mono text-[10px] text-[#9aa0ad]">{e.chipPictureOnly}</span>}
          </span>
        </span>
        <span className={`shrink-0 font-mono text-[11px] ${job.stage === "failed" ? "text-[#f0a3a3]" : working ? "text-[#e0a468]" : "text-[#9aa0ad]"}`}>{status}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-[rgba(255,255,255,0.06)] p-3 sm:p-4">
          {working && (
            <div className="flex flex-col gap-1.5 rounded-[14px] bg-[#101116] px-4 py-3">
              <span className="text-sm text-[#ecedf1]">{activity ?? job.progress ?? status}</span>
              <span className="text-xs text-[#6b6f7a]">{d.leave}</span>
            </div>
          )}
          {job.stage === "failed" && job.error && <p className="text-sm text-[#f0a3a3]">{job.error}</p>}
          {detail && detail.outputs.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {detail.outputs
                .filter((o) => o.turn === detail.outputs[0].turn)
                .map((o) => (
                  <figure key={o.generationId} className="flex min-w-0 flex-col gap-2">
                    {o.url && (
                      <video
                        src={`${o.url}#t=0.5`}
                        poster={o.cover ?? undefined}
                        controls
                        playsInline
                        preload="metadata"
                        className={`w-full rounded-[14px] bg-[#050608] ${o.aspect === "9:16" ? "mx-auto max-h-[560px] w-auto max-w-full" : ""}`}
                      />
                    )}
                    <figcaption className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-[#ecedf1]">
                        {o.title || job.label} <span className="font-mono text-xs font-normal text-[#6b6f7a]">· {o.aspect} · {clock(o.seconds)}</span>
                      </span>
                      {o.summary && <span className="text-xs leading-relaxed text-[#9aa0ad]">{o.summary}</span>}
                      <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                        {o.url && (
                          <a href={o.url} download className="text-[#e0a468] hover:text-[#f0bd86]">
                            {d.download}
                          </a>
                        )}
                        {o.cover && (
                          <a href={o.cover} download className="text-[#e0a468] hover:text-[#f0bd86]">
                            {e.downloadCover}
                          </a>
                        )}
                        <Link href={`/app/history/${o.generationId}`} className="text-[#c6c9d1] hover:text-[#ecedf1]">
                          {d.openHistory}
                        </Link>
                      </span>
                    </figcaption>
                  </figure>
                ))}
            </div>
          )}
          {detail && detail.notes.some((n) => n.role === "editor") && (
            <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-[#9aa0ad]">
              {detail.notes.slice(-4).map((n, i) => (
                <li key={i} className={n.role === "you" ? "text-[#c6c9d1]" : ""}>
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#6b6f7a]">{n.role === "you" ? e.you : "Opus"} · </span>
                  {n.text}
                </li>
              ))}
            </ul>
          )}
          {job.stage === "done" && job.spec && <Change editId={job.id} guard={guard} onSent={onChanged} />}
        </div>
      )}
    </article>
  );
}

function Change({ editId, guard, onSent }: { editId: string; guard: Guard; onSent: () => Promise<void> }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    const res = await guard(() => reviseEdit(editId, text, null));
    setBusy(false);
    if (res?.error) return setProblem(res.error);
    setText("");
    await onSent();
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={text}
          maxLength={2000}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") void send();
          }}
          placeholder={t.effects.changePlaceholder}
          aria-label={d.askChange}
          className="min-h-10 min-w-0 flex-1 rounded-full border border-[rgba(255,255,255,0.1)] bg-[#101116] px-4 text-[14px] text-[#ecedf1] placeholder:text-[#6b6f7a] focus:border-[rgba(224,164,104,0.6)] focus:outline-none"
        />
        <button type="button" onClick={send} disabled={!text.trim() || busy} className="min-h-10 rounded-full bg-[#e0a468] px-5 text-sm font-semibold text-[#1a0f07] disabled:opacity-40">
          {busy ? d.sending : d.send}
        </button>
      </div>
      {problem && <p className="text-sm text-[#f0a3a3]">{problem}</p>}
    </div>
  );
}

function chip(e: ReturnType<typeof useLocale>["t"]["effects"], k: EffectKey): string {
  switch (k) {
    case "opening":
      return e.chipOpening;
    case "badge":
      return e.chipBadge;
    case "credits":
      return e.chipCredits;
    case "vertical":
      return e.chipVertical;
    case "cover":
      return e.chipCover;
    case "sound":
      return e.chipSound;
  }
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
