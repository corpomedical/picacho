"use client";

// The voice sheet (2026-10-01, operator: "Build a full voice picker and
// generator on characters like in Elevenlabs"; his pick: A, a card on the
// character with Change voice opening a large sheet). Four tabs:
//   Picacho picks — the curated voices, as before;
//   Library       — ElevenLabs' shared library, filtered and searchable,
//                   with each voice's own free sample;
//   Generate      — describe a voice and hear three options, or clone your
//                   own voice (Studio and Elite);
//   My voices     — what this person picked, generated or cloned.
// Choosing a voice hands it to the form (onSelect) and closes the sheet;
// the character keeps it when the form is saved.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";
import { previewVoice } from "@/lib/voices/actions";
import {
  browseVoiceLibrary,
  chooseLibraryVoice,
  cloneMyVoice,
  generateVoiceOptions,
  keepGeneratedVoice,
  listMyVoices,
  removeMyVoice,
  type DesignOption,
  type OwnVoice,
  type VoiceErrorCode,
} from "@/lib/voices/picker-actions";
import type { LibraryVoice } from "@/lib/voices/elevenlabs";
import {
  AGES,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  GENDERS,
  LANGUAGES,
  PREVIEW_TEXT_MAX,
  PREVIEW_TEXT_MIN,
  SORTS,
  USE_CASES,
} from "@/lib/voices/library-options";
import { cloneConsentFor } from "@/lib/voices/consent";

export type SheetVoice = { id: string; label: string; description: string | null; source?: OwnVoice["source"]; meta?: string };
type Tab = "picks" | "library" | "generate" | "mine";

const FIELD =
  "rounded-control border border-atelier-rule bg-transparent px-3 py-2 text-sm text-atelier-ink placeholder:text-atelier-muted/80 outline-none transition-colors focus:border-atelier-accent";
const LABEL = "block text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-control border border-atelier-rule px-3 py-1.5 text-sm text-atelier-ink transition-colors hover:border-atelier-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-atelier-accent";
const PRIMARY =
  "inline-flex items-center justify-center gap-1.5 rounded-control bg-atelier-accent px-3.5 py-1.5 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atelier-accent";

/** One clip at a time across the whole sheet. */
function usePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  }, []);
  const play = useCallback(
    (key: string, src: string) => {
      if (playing === key) return stop();
      audio.current?.pause();
      const a = new Audio(src);
      audio.current = a;
      setPlaying(key);
      a.onended = () => setPlaying((p) => (p === key ? null : p));
      a.play().catch(() => setPlaying(null));
    },
    [playing, stop],
  );
  useEffect(() => () => audio.current?.pause(), []);
  return { playing, play, stop };
}

function PlayButton({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-40",
        on ? "border-atelier-accent text-atelier-accent" : "border-atelier-rule text-atelier-ink hover:border-atelier-accent",
      )}
    >
      {on ? (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <path d="M8 5v14l11-7Z" />
        </svg>
      )}
    </button>
  );
}

function fmt(s: string, vars: Record<string, string | number>) {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export function VoiceSheet({
  open,
  onClose,
  curated,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  curated: SheetVoice[];
  selectedId: string;
  onSelect: (voice: SheetVoice) => void;
}) {
  const { t, locale } = useLocale();
  const v = t.voiceSheet;
  const [tab, setTab] = useState<Tab>("picks");
  const player = usePlayer();
  const panel = useRef<HTMLDivElement | null>(null);
  const errorText = (code: VoiceErrorCode | string) => (v.errors as Record<string, string>)[code] ?? v.errors.failed;

  // Escape closes; focus moves into the sheet and back out with it.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [open, onClose]);
  const { stop } = player;
  useEffect(() => {
    if (!open) stop();
  }, [open, stop]);

  // My voices: read when the sheet opens, kept while it is open.
  const [mine, setMine] = useState<{ voices: OwnVoice[]; canMake: boolean; made: number; limit: number } | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);
  const loadMine = useCallback(async () => {
    const r = await listMyVoices();
    if (r.ok) {
      setMine({ voices: r.voices, canMake: r.canMake, made: r.made, limit: r.limit });
      setMineError(null);
    } else setMineError(r.error);
  }, []);
  useEffect(() => {
    if (open && !mine) void loadMine();
  }, [open, mine, loadMine]);

  const metaOf = useCallback(
    (o: { gender?: string; age?: string; accent?: string; language?: string }) => {
      const g = (v.genders as Record<string, string>)[o.gender ?? ""] ?? o.gender;
      const a = (v.ages as Record<string, string>)[o.age ?? ""] ?? o.age?.replace(/_/g, " ");
      const l = (v.languages as Record<string, string>)[o.language ?? ""] ?? o.language;
      const accent = o.accent ? o.accent.charAt(0).toUpperCase() + o.accent.slice(1) : "";
      // "Spanish · Spanish": an accent that names the language says it once.
      const lang = l && accent && l.toLowerCase() === accent.toLowerCase() ? "" : l;
      return [g, a, accent, lang].filter(Boolean).join(" · ");
    },
    [v],
  );

  const choose = useCallback(
    (voice: SheetVoice) => {
      onSelect(voice);
      onClose();
    },
    [onSelect, onClose],
  );
  const chooseOwn = useCallback(
    (o: OwnVoice) => {
      setMine((m) => (m && !m.voices.some((x) => x.id === o.id) ? { ...m, voices: [o, ...m.voices], made: m.made + (o.source === "designed" || o.source === "cloned" ? 1 : 0) } : m));
      choose({ id: o.id, label: o.label, description: o.description, source: o.source, meta: metaOf(o) });
    },
    [choose, metaOf],
  );

  if (!open || typeof document === "undefined") return null;

  const tabs: [Tab, string][] = [
    ["picks", v.tabPicks],
    ["library", v.tabLibrary],
    ["generate", v.tabGenerate],
    ["mine", v.tabMine],
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-sheet-title"
        className="flex h-full w-full max-w-3xl flex-col bg-atelier-paper outline-none sm:h-[86vh] sm:rounded-control sm:border sm:border-atelier-rule sm:shadow-[0_24px_48px_-12px_rgba(33,29,18,0.35)]"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-atelier-rule px-5 py-4">
          <h2 id="voice-sheet-title" className="text-base font-medium text-atelier-ink">
            {v.title}
          </h2>
          <button type="button" onClick={onClose} className={BTN} aria-label={v.close}>
            ✕
          </button>
        </div>
        <div role="tablist" aria-label={v.title} className="flex gap-1 overflow-x-auto border-b border-atelier-rule px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              id={`voice-tab-${id}`}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors",
                tab === id ? "border-atelier-accent text-atelier-ink" : "border-transparent text-atelier-muted hover:text-atelier-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-labelledby={`voice-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === "picks" && <PicksTab curated={curated} selectedId={selectedId} onChoose={choose} player={player} />}
          {tab === "library" && (
            <LibraryTab onChosen={chooseOwn} player={player} metaOf={metaOf} errorText={errorText} />
          )}
          {tab === "generate" && (
            <GenerateTab mine={mine} locale={locale} onKept={chooseOwn} player={player} errorText={errorText} />
          )}
          {tab === "mine" && (
            <MineTab
              mine={mine}
              mineError={mineError}
              selectedId={selectedId}
              onChoose={chooseOwn}
              onRemoved={(id) =>
                setMine((m) => {
                  if (!m) return m;
                  const gone = m.voices.find((x) => x.id === id);
                  return {
                    ...m,
                    voices: m.voices.filter((x) => x.id !== id),
                    made: m.made - (gone && (gone.source === "designed" || gone.source === "cloned") ? 1 : 0),
                  };
                })
              }
              player={player}
              metaOf={metaOf}
              errorText={errorText}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

type Player = ReturnType<typeof usePlayer>;

/** The paid spoken sample (fal) for a voice with no free clip of its own. */
function useSpokenSample(player: Player) {
  const [loading, setLoading] = useState<string | null>(null);
  return {
    loading,
    async play(presetId: string) {
      if (player.playing === presetId) return player.stop();
      setLoading(presetId);
      const r = await previewVoice(presetId);
      setLoading(null);
      if (r.url) player.play(presetId, r.url);
    },
  };
}

function Row({
  title,
  meta,
  detail,
  playButton,
  action,
  badge,
}: {
  title: string;
  meta?: string;
  detail?: string | null;
  playButton: React.ReactNode;
  action: React.ReactNode;
  badge?: string;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-atelier-rule/70 py-3 last:border-b-0">
      {playButton}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-atelier-ink">
          <span className="truncate">{title}</span>
          {badge && <span className="rounded-full border border-atelier-rule px-2 py-0.5 text-[10.5px] font-normal text-atelier-muted">{badge}</span>}
        </p>
        {meta && <p className="truncate text-xs text-atelier-muted">{meta}</p>}
        {detail && <p className="line-clamp-2 text-xs text-atelier-muted/90">{detail}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{action}</div>
    </li>
  );
}

function UseButton({ selected, busy, onClick }: { selected: boolean; busy?: boolean; onClick: () => void }) {
  const { t } = useLocale();
  return selected ? (
    <span className="text-xs font-medium text-atelier-accent">{t.voiceSheet.selected}</span>
  ) : (
    <button type="button" className={BTN} onClick={onClick} disabled={busy}>
      {busy ? t.voiceSheet.loading : t.voiceSheet.use}
    </button>
  );
}

function PicksTab({ curated, selectedId, onChoose, player }: { curated: SheetVoice[]; selectedId: string; onChoose: (v: SheetVoice) => void; player: Player }) {
  const { t } = useLocale();
  const spoken = useSpokenSample(player);
  return (
    <div>
      <p className="text-sm text-atelier-muted">{t.voiceSheet.picksNote}</p>
      <ul className="mt-2">
        {curated.map((c) => (
          <Row
            key={c.id}
            title={c.label}
            detail={c.description}
            playButton={<PlayButton on={player.playing === c.id} disabled={spoken.loading === c.id} onClick={() => spoken.play(c.id)} label={`${t.voiceSheet.play} ${c.label}`} />}
            action={<UseButton selected={selectedId === c.id} onClick={() => onChoose({ ...c, source: "curated" })} />}
          />
        ))}
      </ul>
    </div>
  );
}

function LibraryTab({
  onChosen,
  player,
  metaOf,
  errorText,
}: {
  onChosen: (o: OwnVoice) => void;
  player: Player;
  metaOf: (o: { gender?: string; age?: string; accent?: string; language?: string }) => string;
  errorText: (c: string) => string;
}) {
  const { t, locale } = useLocale();
  const v = t.voiceSheet;
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [language, setLanguage] = useState(["es", "pt", "it"].includes(locale) ? locale : "");
  const [accent, setAccent] = useState("");
  const [useCase, setUseCase] = useState("");
  const [sort, setSort] = useState("trending");
  const [voices, setVoices] = useState<LibraryVoice[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 400);
    return () => clearTimeout(id);
  }, [search]);

  // A new filter starts again at page 0; Load more asks for the next page.
  const seq = useRef(0);
  const load = useCallback(
    async (p: number) => {
      const mine = ++seq.current;
      setLoading(true);
      const r = await browseVoiceLibrary({ search: query, gender, age, language, accent, useCase, sort, page: p });
      if (mine !== seq.current) return;
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setError(null);
      setVoices((prev) => (p === 0 ? r.voices : [...prev, ...r.voices.filter((x) => !prev.some((y) => y.voiceId === x.voiceId))]));
      setHasMore(r.hasMore);
      setPage(p);
    },
    [query, gender, age, language, accent, useCase, sort],
  );
  useEffect(() => {
    void load(0);
  }, [load]);

  const select = (id: string, value: string, set: (s: string) => void, label: string, options: [string, string][]) => (
    <label className="min-w-0">
      <span className={LABEL}>{label}</span>
      <select id={id} aria-label={label} value={value} onChange={(e) => set(e.target.value)} className={`mt-1 w-full ${FIELD}`}>
        {options.map(([val, text]) => (
          <option key={val} value={val}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const anyOpt: [string, string] = ["", v.any];

  return (
    <div>
      <p className="text-sm text-atelier-muted">{v.libraryNote}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="col-span-2 min-w-0">
          <span className={LABEL}>{v.search}</span>
          <input id="voice-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={v.searchPlaceholder} className={`mt-1 w-full ${FIELD}`} />
        </label>
        {select("voice-language", language, setLanguage, v.language, [anyOpt, ...LANGUAGES.map((l) => [l, (v.languages as Record<string, string>)[l] ?? l] as [string, string])])}
        {select("voice-sort", sort, setSort, v.sort, SORTS.map((s) => [s, (v.sorts as Record<string, string>)[s]] as [string, string]))}
        {select("voice-gender", gender, setGender, v.gender, [anyOpt, ...GENDERS.map((g) => [g, (v.genders as Record<string, string>)[g]] as [string, string])])}
        {select("voice-age", age, setAge, v.age, [anyOpt, ...AGES.map((a) => [a, (v.ages as Record<string, string>)[a]] as [string, string])])}
        {select("voice-use", useCase, setUseCase, v.useCase, [anyOpt, ...USE_CASES.map((u) => [u, (v.useCases as Record<string, string>)[u]] as [string, string])])}
        <label className="min-w-0">
          <span className={LABEL}>{v.accent}</span>
          <input id="voice-accent" value={accent} onChange={(e) => setAccent(e.target.value)} onBlur={(e) => setAccent(e.target.value.trim())} placeholder={v.accentPlaceholder} className={`mt-1 w-full ${FIELD}`} />
        </label>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{errorText(error)}</p>}
      <ul className="mt-3" aria-busy={loading}>
        {voices.map((x) => (
          <Row
            key={x.voiceId}
            title={x.name}
            meta={metaOf(x)}
            detail={[x.descriptive, (v.useCases as Record<string, string>)[x.useCase] ?? x.useCase.replace(/_/g, " ")].filter(Boolean).join(" · ") || x.description}
            playButton={
              <PlayButton
                on={player.playing === x.voiceId}
                disabled={!x.previewUrl}
                onClick={() => x.previewUrl && player.play(x.voiceId, x.previewUrl)}
                label={x.previewUrl ? `${v.play} ${x.name}` : v.noPreview}
              />
            }
            action={
              <UseButton
                selected={false}
                busy={busy === x.voiceId}
                onClick={async () => {
                  setBusy(x.voiceId);
                  setError(null);
                  const r = await chooseLibraryVoice({ voiceId: x.voiceId, publicOwnerId: x.publicOwnerId, name: x.name });
                  setBusy(null);
                  if (r.ok) onChosen(r.voice);
                  else setError(r.error);
                }}
              />
            }
          />
        ))}
      </ul>
      {!loading && !error && voices.length === 0 && <p className="mt-6 text-center text-sm text-atelier-muted">{v.noResults}</p>}
      {loading && <p className="mt-4 text-center text-sm text-atelier-muted">{v.loading}</p>}
      {!loading && hasMore && (
        <div className="mt-4 flex justify-center">
          <button type="button" className={BTN} onClick={() => load(page + 1)}>
            {v.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}

function GenerateTab({
  mine,
  locale,
  onKept,
  player,
  errorText,
}: {
  mine: { canMake: boolean; made: number; limit: number } | null;
  locale: string;
  onKept: (o: OwnVoice) => void;
  player: Player;
  errorText: (c: string) => string;
}) {
  const { t } = useLocale();
  const v = t.voiceSheet;
  const [description, setDescription] = useState("");
  const [sample, setSample] = useState("");
  const [busy, setBusy] = useState<"design" | "keep" | "clone" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<(DesignOption & { url: string })[]>([]);
  const [used, setUsed] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [consent, setConsent] = useState(false);

  // Blob URLs for the options' audio, freed when they go.
  useEffect(
    () => () => {
      for (const o of options) URL.revokeObjectURL(o.url);
    },
    [options],
  );

  if (!mine) return <p className="text-sm text-atelier-muted">{v.loading}</p>;
  if (!mine.canMake) {
    return (
      <div className="rounded-control border border-atelier-rule p-5">
        <p className="text-sm text-atelier-ink">{v.studioOnly}</p>
        <Link href="/app/settings?tab=billing" className={`mt-3 ${PRIMARY}`}>
          {v.upgrade}
        </Link>
      </div>
    );
  }
  const full = mine.made >= mine.limit;
  const descOk = description.trim().length >= DESCRIPTION_MIN && description.trim().length <= DESCRIPTION_MAX;
  const sampleOk = !sample.trim() || (sample.trim().length >= PREVIEW_TEXT_MIN && sample.trim().length <= PREVIEW_TEXT_MAX);

  async function generate() {
    setBusy("design");
    setError(null);
    player.stop();
    const r = await generateVoiceOptions({ description: description.trim(), previewText: sample.trim() || null });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setUsed(description.trim());
    setOptions(
      r.options.map((o) => {
        const bytes = Uint8Array.from(atob(o.audioBase64), (c) => c.charCodeAt(0));
        return { ...o, audioBase64: "", url: URL.createObjectURL(new Blob([bytes], { type: o.mediaType || "audio/mpeg" })) };
      }),
    );
    if (!sample.trim() && r.text) setSample(r.text);
  }

  async function keep(o: DesignOption, n: number) {
    setBusy("keep");
    setError(null);
    const r = await keepGeneratedVoice({
      generatedVoiceId: o.generatedVoiceId,
      seal: o.seal,
      description: used,
      name: names[o.generatedVoiceId]?.trim() || fmt(v.option, { n }),
    });
    setBusy(null);
    if (r.ok) onKept(r.voice);
    else setError(r.error);
  }

  async function clone() {
    if (!file) return;
    setBusy("clone");
    setError(null);
    const fd = new FormData();
    fd.set("recording", file);
    fd.set("name", cloneName.trim());
    fd.set("consent", consent ? "yes" : "no");
    fd.set("locale", locale);
    const r = await cloneMyVoice(fd);
    setBusy(null);
    if (r.ok) onKept(r.voice);
    else setError(r.error);
  }

  return (
    <div className="grid gap-8">
      <p className="text-xs text-atelier-muted">{fmt(v.madeCount, { made: mine.made, limit: mine.limit })}</p>
      {error && <p className="-mt-6 text-sm text-red-600 dark:text-red-400">{errorText(error)}</p>}
      {full && <p className="-mt-6 text-sm text-atelier-ink">{errorText("full")}</p>}

      <section className="grid gap-3">
        <h3 className="text-sm font-medium text-atelier-ink">{v.generateTitle}</h3>
        <label>
          <span className={LABEL}>{v.describeLabel}</span>
          <textarea id="voice-describe" rows={3} maxLength={DESCRIPTION_MAX} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={v.describePlaceholder} className={`mt-1 w-full ${FIELD}`} />
          <span className="mt-1 block text-xs text-atelier-muted">{v.describeHelp}</span>
        </label>
        <label>
          <span className={LABEL}>{v.sampleLabel}</span>
          <textarea id="voice-sample" rows={3} maxLength={PREVIEW_TEXT_MAX} value={sample} onChange={(e) => setSample(e.target.value)} className={`mt-1 w-full ${FIELD}`} />
          <span className="mt-1 block text-xs text-atelier-muted">{v.sampleHelp}</span>
        </label>
        <div>
          <button type="button" className={PRIMARY} disabled={!descOk || !sampleOk || busy !== null || full} onClick={generate}>
            {busy === "design" ? v.generating : v.generate}
          </button>
        </div>
        {options.length > 0 && (
          <ul className="mt-1 rounded-control border border-atelier-rule px-4">
            {options.map((o, i) => (
              <li key={o.generatedVoiceId} className="flex flex-wrap items-center gap-3 border-b border-atelier-rule/70 py-3 last:border-b-0">
                <PlayButton on={player.playing === o.generatedVoiceId} onClick={() => player.play(o.generatedVoiceId, o.url)} label={`${v.play} ${fmt(v.option, { n: i + 1 })}`} />
                <span className="text-sm font-medium text-atelier-ink">{fmt(v.option, { n: i + 1 })}</span>
                <span className="text-xs tabular-nums text-atelier-muted">{o.durationSecs ? `${o.durationSecs.toFixed(1)} s` : ""}</span>
                <label className="ml-auto flex min-w-0 items-center gap-2">
                  <span className="sr-only">{v.nameLabel}</span>
                  <input
                    id={`voice-name-${i}`}
                    value={names[o.generatedVoiceId] ?? ""}
                    onChange={(e) => setNames((n) => ({ ...n, [o.generatedVoiceId]: e.target.value }))}
                    placeholder={v.namePlaceholder}
                    maxLength={40}
                    className={`w-32 ${FIELD}`}
                  />
                  <button type="button" className={PRIMARY} disabled={busy !== null || full} onClick={() => keep(o, i + 1)}>
                    {busy === "keep" ? v.keeping : v.keep}
                  </button>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3 border-t border-atelier-rule pt-6">
        <h3 className="text-sm font-medium text-atelier-ink">{v.cloneTitle}</h3>
        <p className="text-xs text-atelier-muted">{v.cloneHelp}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="min-w-0">
            <span className={LABEL}>{v.cloneFile}</span>
            <input
              id="voice-clone-file"
              type="file"
              accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/webm,audio/ogg,.mp3,.wav,.m4a,.webm,.ogg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-atelier-ink file:mr-3 file:rounded-control file:border file:border-atelier-rule file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-atelier-ink"
            />
          </label>
          <label className="min-w-0">
            <span className={LABEL}>{v.cloneName}</span>
            <input id="voice-clone-name" value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder={v.cloneNamePlaceholder} maxLength={40} className={`mt-1 w-full ${FIELD}`} />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm text-atelier-ink">
          <input id="voice-clone-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>{cloneConsentFor(locale)}</span>
        </label>
        <div>
          <button type="button" className={PRIMARY} disabled={!file || !consent || busy !== null || full} onClick={clone}>
            {busy === "clone" ? v.cloning : v.clone}
          </button>
        </div>
      </section>
    </div>
  );
}

function MineTab({
  mine,
  mineError,
  selectedId,
  onChoose,
  onRemoved,
  player,
  metaOf,
  errorText,
}: {
  mine: { voices: OwnVoice[] } | null;
  mineError: string | null;
  selectedId: string;
  onChoose: (o: OwnVoice) => void;
  onRemoved: (id: string) => void;
  player: Player;
  metaOf: (o: { gender?: string; age?: string; accent?: string; language?: string }) => string;
  errorText: (c: string) => string;
}) {
  const { t } = useLocale();
  const v = t.voiceSheet;
  const spoken = useSpokenSample(player);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (mineError) return <p className="text-sm text-red-600 dark:text-red-400">{errorText(mineError)}</p>;
  if (!mine) return <p className="text-sm text-atelier-muted">{v.loading}</p>;
  if (mine.voices.length === 0) return <p className="text-sm text-atelier-muted">{v.mineEmpty}</p>;
  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{errorText(error)}</p>}
      <ul>
        {mine.voices.map((o) => (
          <Row
            key={o.id}
            title={o.label}
            badge={(v.sources as Record<string, string>)[o.source]}
            meta={metaOf(o) || undefined}
            detail={o.description}
            playButton={
              <PlayButton
                on={player.playing === o.id}
                disabled={spoken.loading === o.id}
                onClick={() => (o.previewUrl ? player.play(o.id, o.previewUrl) : spoken.play(o.id))}
                label={`${v.play} ${o.label}`}
              />
            }
            action={
              confirm === o.id ? (
                <>
                  <button type="button" className={BTN} onClick={() => setConfirm(null)}>
                    {v.cancel}
                  </button>
                  <button
                    type="button"
                    className={PRIMARY}
                    disabled={busy === o.id}
                    onClick={async () => {
                      setBusy(o.id);
                      setError(null);
                      const r = await removeMyVoice(o.id);
                      setBusy(null);
                      setConfirm(null);
                      if (r.ok) onRemoved(o.id);
                      else setError(r.error);
                    }}
                  >
                    {v.confirmRemove}
                  </button>
                </>
              ) : (
                <>
                  <UseButton selected={selectedId === o.id} onClick={() => onChoose(o)} />
                  {selectedId !== o.id && (
                    <button type="button" className={BTN} onClick={() => setConfirm(o.id)}>
                      {v.remove}
                    </button>
                  )}
                </>
              )
            }
          />
        ))}
      </ul>
    </div>
  );
}
