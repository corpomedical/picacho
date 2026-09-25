"use client";

// The Score tab (board A's composer, operator 2026-09-25: "Add a track
// composer"): describe the music, pick moods and sounds, and compose takes
// timed to the cut — ElevenLabs Music for the real track, ACE-Step for quick
// drafts. Each take plays here; Use puts it on the music track (and turns the
// old score down) as one undoable step.

import { useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { composeTrack, type EditDetail } from "@/lib/editor/actions";
import { composeCostUsd, MAX_TAKES, sectionsFromCuts, type ComposerEngine } from "@/lib/editor/composer";

const VIBES = ["Dramatic", "Epic", "Tense", "Dreamy", "Uplifting", "Dark"] as const;
const SOUNDS = ["Hybrid orchestral", "Synthwave", "Drum and bass", "Piano", "Lo-fi", "Rock"] as const;

type Take = EditDetail["takes"][number];

export function ScorePanel({
  editId,
  generationId,
  base,
  duration,
  cuts,
  takes,
  inUse,
  onComposed,
  onUse,
}: {
  editId: string;
  generationId: string;
  base: string;
  duration: number;
  cuts: number[];
  takes: Take[];
  /** The take file on the music track now, if one is. */
  inUse: string | null;
  onComposed: () => Promise<void>;
  onUse: (take: Take) => void;
}) {
  const { t } = useLocale();
  const b = t.directorsCut.bay;
  const s = b.scorePanel;
  const [prompt, setPrompt] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(["Dramatic", "Hybrid orchestral"]));
  const [instrumental, setInstrumental] = useState(true);
  const [engine, setEngine] = useState<ComposerEngine>("eleven");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sections = useMemo(() => sectionsFromCuts(duration, cuts), [duration, cuts]);
  const cost = composeCostUsd(engine, duration, MAX_TAKES);
  const price = cost >= 0.1 ? `$${cost.toFixed(2)}` : `${Math.max(1, Math.round(cost * 100))}¢`;

  function toggle(v: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  async function compose() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await composeTrack(editId, generationId, {
        engine,
        prompt,
        styles: [...picked],
        instrumental,
        seconds: duration,
        sections,
        takes: MAX_TAKES,
      });
      if (res.error !== null) setProblem(res.error);
      else await onComposed();
    } catch {
      setProblem(s.failed);
    } finally {
      setBusy(false);
    }
  }

  const chip = (value: string, label: string) => (
    <button
      key={value}
      type="button"
      aria-pressed={picked.has(value)}
      onClick={() => toggle(value)}
      className={`h-7 rounded-full border px-2.5 text-[12px] ${picked.has(value) ? "border-[#4fb6a0] bg-[rgba(79,182,160,0.16)] text-[#ecedf1]" : "border-[rgba(255,255,255,0.12)] text-[#9aa0ad] hover:text-[#ecedf1]"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-[#ecedf1]">{s.title}</span>
        <label className="sr-only" htmlFor="score-engine">
          {s.engine}
        </label>
        <select
          id="score-engine"
          value={engine}
          onChange={(e) => setEngine(e.target.value as ComposerEngine)}
          className="h-7 rounded-md border border-[rgba(255,255,255,0.08)] bg-[#13151b] px-1.5 font-mono text-[11px] text-[#9aa0ad]"
        >
          <option value="eleven">{s.engineEleven}</option>
          <option value="ace">{s.engineAce}</option>
        </select>
      </div>
      <label htmlFor="score-describe" className="font-mono text-[11px] text-[#6b6f7a]">
        {s.describe}
      </label>
      <textarea
        id="score-describe"
        rows={3}
        value={prompt}
        maxLength={800}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={s.placeholder}
        className="-mt-1.5 resize-none rounded-[10px] border border-[rgba(255,255,255,0.1)] bg-[#0f1116] px-3 py-2 text-[13px] leading-relaxed text-[#ecedf1] placeholder:text-[#6b6f7a] focus:border-[rgba(79,182,160,0.6)] focus:outline-none"
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={s.vibe}>
        {VIBES.map((v) => chip(v, s.vibes[v] ?? v))}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={s.sound}>
        {SOUNDS.map((v) => chip(v, s.sounds[v] ?? v))}
      </div>
      <label className="flex items-center justify-between text-[12px] text-[#9aa0ad]">
        <span>{s.instrumental}</span>
        <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} className="h-4 w-4 accent-[#4fb6a0]" />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] text-[#6b6f7a]">{s.sections}</span>
        <div className="flex h-7 gap-0.5 overflow-hidden rounded-md">
          {sections.map((x) => (
            <div
              key={x.name}
              title={`${x.name} ${x.start.toFixed(1)}–${x.end.toFixed(1)} s`}
              className="flex items-center overflow-hidden px-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[#ecedf1]"
              style={{ flexGrow: x.end - x.start, background: `rgba(79,182,160,${x.name === "Drop" ? 0.42 : x.name === "Rise" ? 0.26 : 0.16})` }}
            >
              {s.sectionNames[x.name as keyof typeof s.sectionNames] ?? x.name}
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void compose()}
        disabled={busy || (!prompt.trim() && picked.size === 0)}
        className="h-10 rounded-[10px] bg-[#e0a468] text-[14px] font-semibold text-[#1a0f07] disabled:opacity-50"
      >
        {busy ? s.composing : `${s.compose.replace("{n}", String(MAX_TAKES))} · ${price}`}
      </button>
      {problem && <p className="text-[12px] text-[#f0a3a3]">{problem}</p>}

      <div className="mt-1 flex flex-col gap-2 border-t border-[rgba(255,255,255,0.07)] pt-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6f7a]">{s.takes}</span>
        {takes.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-[#6b6f7a]">{s.noTakes}</p>
        ) : (
          [...takes].reverse().map((take, i) => (
            <div key={take.id} className={`flex flex-col gap-1.5 rounded-lg p-2 ${inUse === take.file ? "bg-[rgba(79,182,160,0.12)] shadow-[inset_0_0_0_1px_rgba(79,182,160,0.5)]" : "bg-[#13151b]"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-[#ecedf1]">
                  {s.take.replace("{n}", String(takes.length - i))} <span className="font-mono text-[10px] text-[#6b6f7a]">· {take.engine === "eleven" ? "ElevenLabs" : "ACE-Step"}</span>
                </span>
                {inUse === take.file ? (
                  <span className="text-[11px] text-[#4fb6a0]">{s.inUse}</span>
                ) : (
                  <button type="button" onClick={() => onUse(take)} className="h-6 rounded-md border border-[rgba(79,182,160,0.55)] px-2 text-[11px] text-[#4fb6a0]">
                    {s.use}
                  </button>
                )}
              </div>
              <audio controls preload="none" src={`${base}${take.file}`} className="h-8 w-full" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
