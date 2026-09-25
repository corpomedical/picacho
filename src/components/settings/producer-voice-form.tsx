"use client";

import { useEffect, useRef, useState } from "react";
import { previewProducerVoice, setProducerVoice, type ProducerVoiceChoice } from "@/lib/producer/actions";

// The voice the Producer speaks with (2026-09-25, operator: "lets change the
// voice character, its sounds ai"). The list is Admin > Voices — the same
// voices characters speak with. ▶ plays a line exactly as the Producer would
// say it. English only while the Producer is admins-only, like its sheet.

export function ProducerVoiceForm({ voices, current }: { voices: ProducerVoiceChoice[]; current: string | null }) {
  const [choice, setChoice] = useState<string | null>(current ?? voices[0]?.id ?? null);
  const [saved, setSaved] = useState<string | null>(current ?? voices[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  if (voices.length === 0) {
    return <p className="text-sm text-atelier-muted">No voices yet. Add them in Admin → Voices.</p>;
  }

  async function preview(id: string) {
    audio.current?.pause();
    if (playing === id) return setPlaying(null);
    setPlaying(id);
    setMessage(null);
    const r = await previewProducerVoice(id);
    if (!r.url) {
      setPlaying(null);
      return setMessage(r.error ?? "That voice didn't play. Try again.");
    }
    const el = new Audio(r.url);
    audio.current = el;
    el.onended = () => setPlaying((p) => (p === id ? null : p));
    el.onerror = () => setPlaying((p) => (p === id ? null : p));
    void el.play().catch(() => setPlaying(null));
  }

  async function save() {
    if (!choice) return;
    setBusy(true);
    setMessage(null);
    const r = await setProducerVoice(choice);
    setBusy(false);
    if (r.error) return setMessage(r.error);
    setSaved(choice);
    setMessage("Saved. It speaks in this voice from its next answer.");
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-atelier-rule/60 rounded-control border border-atelier-rule" role="radiogroup" aria-label="Its voice">
        {voices.map((v) => (
          <li key={v.id} className="flex items-center gap-3 px-3 py-2.5">
            <button
              type="button"
              role="radio"
              aria-checked={choice === v.id}
              onClick={() => setChoice(v.id)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span
                aria-hidden
                className={
                  "grid size-4 shrink-0 place-items-center rounded-full border " +
                  (choice === v.id ? "border-atelier-accent" : "border-atelier-rule")
                }
              >
                {choice === v.id && <span className="size-2 rounded-full bg-atelier-accent" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-atelier-ink">{v.label}</span>
                {v.description && <span className="block truncate text-xs text-atelier-muted">{v.description}</span>}
              </span>
            </button>
            <button
              type="button"
              onClick={() => preview(v.id)}
              aria-label={playing === v.id ? `Stop ${v.label}` : `Hear ${v.label}`}
              className="grid size-8 shrink-0 place-items-center rounded-full border border-atelier-rule text-atelier-muted transition-colors hover:text-atelier-ink"
            >
              {playing === v.id ? (
                <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden>
                  <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden>
                  <path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5Z" />
                </svg>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!choice || choice === saved || busy}
          className="rounded-full bg-atelier-accent px-4 py-1.5 text-sm font-semibold text-[#1a120a] disabled:opacity-40"
        >
          Save
        </button>
        {message && <span className="text-xs text-atelier-muted">{message}</span>}
      </div>
    </div>
  );
}
