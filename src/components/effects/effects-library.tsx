"use client";

// The Effects library (operator, 2026-09-29: all four — "VFX in the shot",
// "one-tap effect library", "effects inside Generate", "effects tracks in the
// editor"): the video and photo halves of the door. A video gets an effect
// put INTO the shot — a recipe, their own words, or both — which Opus 5.5
// fits to the shot and checks after (lib/effects/). A photo gets one of the
// one-tap effects and comes back as a short video.
//
// Tiles carry no preview clips yet (operator: "No previews yet, remember me
// when we top up fal") — each wears its group's colour and glyph instead.
// Colours are literal hex, as on Director's Cut.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { startEffect, submitEffects, type LibraryVideo } from "@/lib/editor/effects-actions";
import { EDITOR_BUCKET } from "@/lib/editor/job";
import {
  ENGINES,
  FEATURED_PHOTO,
  PHOTO_CATEGORIES,
  PHOTO_PRESETS,
  SHOT_CATEGORIES,
  SHOT_RECIPES,
  creditsFor,
  expectedUsd,
  searchPresets,
  type PhotoCategory,
  type ShotCategory,
} from "@/lib/effects/catalog";

type Guard = <T>(work: () => Promise<T>) => Promise<T | null>;
type Picked = { kind: "take"; item: LibraryVideo } | { kind: "upload"; file: File; url: string };

// One colour and glyph per group: tiles without previews still read at a glance.
const HUE: Record<ShotCategory | PhotoCategory | "featured", [string, string]> = {
  powers: ["#1d3a7a", "#4aa3ff"],
  elements: ["#1c3b3f", "#5fc3b8"],
  magic: ["#3b2466", "#b28cff"],
  looks: ["#4a2f16", "#e0a468"],
  featured: ["#4a2f16", "#e0a468"],
  transform: ["#3b1f3f", "#e07ad0"],
  camera: ["#1f2f45", "#7fb2ff"],
  fun: ["#40361a", "#f2cf5b"],
  style: ["#233b24", "#8fd67a"],
  moves: ["#3f2323", "#ff8f7a"],
  love: ["#45203a", "#ff8fc2"],
};

function Glyph({ group }: { group: keyof typeof HUE }) {
  const common = { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (group) {
    case "powers":
      return <svg {...common}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>;
    case "elements":
      return <svg {...common}><path d="M7 16a4 4 0 1 1 .6-7.95A5 5 0 0 1 17.5 9 3.5 3.5 0 0 1 17 16H7Z" /><path d="M9 19l-1 2M13 19l-1 2M17 19l-1 2" /></svg>;
    case "magic":
    case "featured":
      return <svg {...common}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>;
    case "looks":
      return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
    case "transform":
      return <svg {...common}><path d="m15 4 5 5L9 20H4v-5L15 4Z" /><path d="M13 6l5 5" /></svg>;
    case "camera":
      return <svg {...common}><rect x="3" y="7" width="13" height="10" rx="2" /><path d="m16 11 5-3v8l-5-3" /></svg>;
    case "fun":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M8 14a4.5 4.5 0 0 0 8 0M9 9.5h.01M15 9.5h.01" /></svg>;
    case "style":
      return <svg {...common}><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.9 1-1.8-.6-1-.1-2.2 1.1-2.2H17a4 4 0 0 0 4-4c0-5-4-10-9-10Z" /><path d="M7.5 11h.01M10 7h.01M15 7.5h.01" /></svg>;
    case "moves":
      return <svg {...common}><circle cx="13" cy="4" r="2" /><path d="m9 21 2-6 3 2v4M6 12l3-4h5l3 4M11 15l-1-5" /></svg>;
    case "love":
      return <svg {...common}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>;
  }
}

function Tile({ name, sub, group, on, onClick }: { name: string; sub?: string; group: keyof typeof HUE; on: boolean; onClick: () => void }) {
  const [from, ink] = HUE[group];
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`group relative flex aspect-[4/3] min-w-0 flex-col justify-between overflow-hidden rounded-[14px] p-2.5 text-left ring-1 transition ${
        on ? "ring-2 ring-[#e0a468]" : "ring-[rgba(255,255,255,0.08)] hover:ring-[rgba(255,255,255,0.28)]"
      }`}
      style={{ background: `radial-gradient(120% 90% at 20% 10%, ${from} 0%, #0d0e13 75%)` }}
    >
      <span style={{ color: ink }} className="opacity-90 transition-transform group-hover:scale-110">
        <Glyph group={group} />
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 block text-[12.5px] font-medium leading-tight text-[#ecedf1]">{name}</span>
        {sub ? <span className="mt-0.5 block truncate font-mono text-[9.5px] uppercase tracking-[0.08em] text-[#8b909c]">{sub}</span> : null}
      </span>
      {on && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#e0a468] shadow-[0_0_8px_#e0a468]" />}
    </button>
  );
}

function Chips<T extends string>({ value, options, label, onChange }: { value: T; options: { key: T; label: string }[]; label: string; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`min-h-8 shrink-0 rounded-full border px-3 text-xs ${
            value === o.key ? "border-[#e0a468] bg-[#e0a468] text-[#1a0f07]" : "border-[rgba(255,255,255,0.12)] text-[#c6c9d1] hover:border-[rgba(255,255,255,0.3)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6f7a]">{children}</span>;
}

/** The clip or photo the effect goes on: an upload, or one of theirs from History. */
function SourcePicker({
  media,
  library,
  picked,
  onPick,
  onSize,
}: {
  media: "video" | "image";
  library: LibraryVideo[];
  picked: Picked | null;
  onPick: (p: Picked | null) => void;
  onSize: (w: number, h: number, seconds: number | null) => void;
}) {
  const { t } = useLocale();
  const e = t.effects;
  const input = useRef<HTMLInputElement>(null);
  const url = picked ? (picked.kind === "take" ? picked.item.url : picked.url) : null;
  const uploadUrl = picked?.kind === "upload" ? picked.url : null;
  useEffect(() => () => {
    if (uploadUrl) URL.revokeObjectURL(uploadUrl);
  }, [uploadUrl]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Label>{media === "video" ? e.yourClip : e.yourPhoto}</Label>
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-[18px] bg-[#050608] ring-1 ring-[rgba(255,255,255,0.08)]">
        {url ? (
          <>
            {media === "video" ? (
              <video
                key={url}
                src={`${url}#t=0.5`}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(ev) => onSize(ev.currentTarget.videoWidth, ev.currentTarget.videoHeight, Number.isFinite(ev.currentTarget.duration) ? ev.currentTarget.duration : null)}
                className="h-full w-full object-contain"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="" onLoad={(ev) => onSize(ev.currentTarget.naturalWidth, ev.currentTarget.naturalHeight, null)} className="h-full w-full object-contain" />
            )}
            <button type="button" onClick={() => onPick(null)} className="absolute right-2 top-2 rounded-full bg-[rgba(7,8,11,0.75)] px-3 py-1.5 text-xs text-[#c6c9d1] hover:text-[#ecedf1]">
              {e.change}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-[rgba(255,255,255,0.16)] text-sm text-[#9aa0ad] hover:border-[rgba(224,164,104,0.5)] hover:text-[#ecedf1]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {media === "video" ? e.uploadClip : e.uploadPhoto}
            <span className="font-mono text-[11px] text-[#6b6f7a]">{media === "video" ? e.uploadClipHint : e.uploadPhotoHint}</span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={media === "video" ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp"}
        className="hidden"
        onChange={(ev) => {
          const file = ev.currentTarget.files?.[0];
          ev.currentTarget.value = "";
          if (file) onPick({ kind: "upload", file, url: URL.createObjectURL(file) });
        }}
      />
      {library.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>{media === "video" ? e.fromLibraryVideos : e.fromLibraryPhotos}</Label>
          <div className="grid grid-cols-4 gap-2">
            {library.slice(0, 12).map((v) => {
              const on = picked?.kind === "take" && picked.item.id === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={v.title}
                  title={v.title}
                  onClick={() => onPick({ kind: "take", item: v })}
                  className={`relative aspect-square overflow-hidden rounded-[10px] bg-[#101116] ring-1 transition ${on ? "ring-2 ring-[#e0a468]" : "ring-[rgba(255,255,255,0.08)] hover:ring-[rgba(255,255,255,0.3)]"}`}
                >
                  {v.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : v.kind === "video" ? (
                    <video src={`${v.url}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  ) : null}
                  {v.seconds ? <span className="absolute bottom-1 right-1 rounded bg-[rgba(7,8,11,0.75)] px-1 font-mono text-[10px] text-[#c6c9d1]">{Math.round(v.seconds)}s</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** "On a video" or "On a photo": a source, the library, and one button. */
export function EffectForm({
  kind,
  library,
  initialPick,
  guard,
  offEngines = [],
  onStarted,
}: {
  kind: "shot" | "photo";
  offEngines?: string[];
  library: LibraryVideo[];
  initialPick: LibraryVideo | null;
  guard: Guard;
  onStarted: (id: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const e = t.effects;
  const media = kind === "shot" ? "video" : "image";
  const [picked, setPicked] = useState<Picked | null>(initialPick && initialPick.kind === media ? { kind: "take", item: initialPick } : null);
  const [size, setSize] = useState<{ w: number; h: number; seconds: number | null } | null>(null);
  const [effectId, setEffectId] = useState<string | null>(null);
  const [words, setWords] = useState("");
  const [shotCat, setShotCat] = useState<ShotCategory | "all">("all");
  const [photoCat, setPhotoCat] = useState<PhotoCategory | "featured" | "all">("featured");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const shotName = (id: string, fallback: string) => (e.shots as Record<string, string>)[id] ?? fallback;
  const catName = (k: string) => (e.cats as Record<string, string>)[k] ?? k;

  const photos = useMemo(() => {
    // Effects whose engine was taken off the menu on Admin → Models drop out of the library.
    const on = (list: readonly (typeof PHOTO_PRESETS)[number][]) => list.filter((p) => !offEngines.includes(p.engine));
    if (query.trim()) return on(searchPresets(query));
    if (photoCat === "featured") return on(FEATURED_PHOTO.map((id) => PHOTO_PRESETS.find((p) => p.id === id)!).filter(Boolean));
    if (photoCat === "all") return on(PHOTO_PRESETS);
    return on(PHOTO_PRESETS.filter((p) => p.category === photoCat));
  }, [query, photoCat, offEngines]);

  const preset = kind === "photo" ? PHOTO_PRESETS.find((p) => p.id === effectId) ?? null : null;
  const seconds = size?.seconds ?? (picked?.kind === "take" ? picked.item.seconds : null);
  const credits = kind === "shot" ? creditsFor(expectedUsd("shot", "flux3", seconds)) : creditsFor(expectedUsd("photo", preset?.engine ?? "pixverse", null));
  const ready = picked !== null && (kind === "photo" ? preset !== null : effectId !== null || words.trim().length > 0);

  async function go() {
    if (!picked || !ready || busy) return;
    setProblem(null);
    setBusy(picked.kind === "take" ? e.copying : t.directorsCut.starting);
    const started = await guard(() =>
      startEffect({
        kind,
        effectId,
        words,
        file: picked.kind === "upload" ? { name: picked.file.name, size: picked.file.size, type: picked.file.type } : null,
        takeId: picked.kind === "take" ? picked.item.id : null,
        width: size?.w ?? null,
        height: size?.h ?? null,
      }),
    );
    if (!started || started.error !== null) {
      setProblem(started?.error ?? null);
      setBusy(null);
      return;
    }
    if (started.upload && picked.kind === "upload") {
      setBusy(e.uploadingFilm);
      const { error } = await createClient().storage.from(EDITOR_BUCKET).uploadToSignedUrl(started.upload.path, started.upload.token, picked.file, { contentType: picked.file.type });
      if (error) {
        setProblem(error.message);
        setBusy(null);
        return;
      }
    }
    const submitted = await guard(() => submitEffects(started.editId));
    setBusy(null);
    if (!submitted || submitted.error) return setProblem(submitted?.error ?? null);
    setEffectId(null);
    setWords("");
    await onStarted(started.editId);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
      <SourcePicker
        media={media}
        library={library}
        picked={picked}
        onPick={(p) => {
          setPicked(p);
          setSize(null);
        }}
        onSize={(w, h, s) => setSize({ w, h, seconds: s })}
      />

      <div className="flex min-w-0 flex-col gap-3">
        {kind === "shot" ? (
          <>
            <label className="flex flex-col gap-2">
              <Label>{e.describe}</Label>
              <textarea
                rows={2}
                value={words}
                maxLength={1500}
                onChange={(ev) => setWords(ev.target.value)}
                placeholder={e.describePlaceholder}
                className="resize-none rounded-[14px] border border-[rgba(255,255,255,0.1)] bg-[#101116] px-4 py-3 text-[15px] leading-relaxed text-[#ecedf1] placeholder:text-[#6b6f7a] focus:border-[rgba(224,164,104,0.6)] focus:outline-none"
              />
              <span className="text-[11.5px] text-[#6b6f7a]">{e.describeHint}</span>
            </label>
            <Chips
              label={e.theEffects}
              value={shotCat}
              onChange={setShotCat}
              options={[{ key: "all" as const, label: e.cats.all }, ...SHOT_CATEGORIES.map((c) => ({ key: c, label: catName(c) }))]}
            />
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
              {SHOT_RECIPES.filter((r) => shotCat === "all" || r.category === shotCat).map((r) => (
                <Tile key={r.id} name={shotName(r.id, r.name)} group={r.category} on={effectId === r.id} onClick={() => setEffectId(effectId === r.id ? null : r.id)} />
              ))}
            </div>
          </>
        ) : (
          <>
            <input
              type="search"
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder={formatMsg(e.searchPlaceholder, { n: PHOTO_PRESETS.length })}
              aria-label={formatMsg(e.searchPlaceholder, { n: PHOTO_PRESETS.length })}
              className="min-h-11 rounded-full border border-[rgba(255,255,255,0.1)] bg-[#101116] px-4 text-[14px] text-[#ecedf1] placeholder:text-[#6b6f7a] focus:border-[rgba(224,164,104,0.6)] focus:outline-none"
            />
            {!query.trim() && (
              <Chips
                label={e.theEffects}
                value={photoCat}
                onChange={setPhotoCat}
                options={[{ key: "featured" as const, label: e.cats.featured }, ...PHOTO_CATEGORIES.map((c) => ({ key: c, label: catName(c) })), { key: "all" as const, label: e.cats.all }]}
              />
            )}
            {photos.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#9aa0ad]">{e.noMatch}</p>
            ) : (
              <div className="grid max-h-[520px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 xl:grid-cols-5">
                {photos.map((p) => (
                  <Tile key={p.id} name={p.name} group={p.category} on={effectId === p.id} onClick={() => setEffectId(effectId === p.id ? null : p.id)} />
                ))}
              </div>
            )}
          </>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="text-[11.5px] leading-snug text-[#6b6f7a]">
            {kind === "shot" ? formatMsg(e.priceShot, { credits }) : formatMsg(e.pricePhoto, { credits, engine: preset ? ENGINES[preset.engine].label : ENGINES.pixverse.label })}
          </span>
          <button
            type="button"
            onClick={go}
            disabled={!ready || busy !== null}
            className="ml-auto min-h-11 w-full rounded-full bg-[#e0a468] px-7 py-3 text-[15px] font-semibold text-[#1a0f07] transition-opacity disabled:opacity-40 sm:w-auto"
          >
            {busy ?? (kind === "shot" ? e.addEffect : e.makeItMove)}
          </button>
        </div>
        {!picked && <p className="text-right text-[11px] text-[#6b6f7a]">{kind === "shot" ? e.pickClipFirst : e.pickPhotoFirst}</p>}
        {problem && <p className="text-sm text-[#f0a3a3]">{problem}</p>}
      </div>
    </div>
  );
}
