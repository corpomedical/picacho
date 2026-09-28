"use client";

import { useState, useSyncExternalStore } from "react";
import { LIVE_VOICES, type LiveVoice } from "@/lib/producer/live";
import { liveVoiceName, liveVoiceOn, saveLiveVoice } from "@/components/producer/live-voice-prefs";

// Admins only while it's tried (2026-09-29, lib/producer/live.ts): her live
// voice on this device, and which of GPT-Live's voices speaks. Talk on the
// lamp then starts it instead of her usual voice.

const noSubscribe = () => () => {};

export function ProducerLiveForm() {
  // Read after hydration: the choice lives on this device only.
  const storedOn = useSyncExternalStore(noSubscribe, liveVoiceOn, () => false);
  const storedVoice = useSyncExternalStore(noSubscribe, liveVoiceName, () => "marin" as LiveVoice);
  const [on, setOn] = useState<boolean | null>(null);
  const [voice, setVoice] = useState<LiveVoice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = { on: on ?? storedOn, voice: voice ?? storedVoice };

  function save(next: { on: boolean; voice: LiveVoice }) {
    setOn(next.on);
    setVoice(next.voice);
    setMessage(
      saveLiveVoice(next.on, next.voice)
        ? next.on
          ? "On for this device. Press Talk on the lamp to start."
          : "Off. Talk uses her usual voice."
        : "This browser won't keep the choice.",
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={current.on}
          onClick={() => save({ on: !current.on, voice: current.voice })}
          className={
            "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors " +
            (current.on ? "bg-atelier-accent text-[#1a120a]" : "border border-atelier-rule text-atelier-ink hover:bg-atelier-ink/5")
          }
        >
          {current.on ? "On" : "Off"}
        </button>
        <label className="flex items-center gap-2 text-sm text-atelier-muted">
          Voice
          <select
            value={current.voice}
            onChange={(e) => save({ on: current.on, voice: e.target.value as LiveVoice })}
            className="rounded-control border border-atelier-rule bg-transparent px-2 py-1 text-sm text-atelier-ink"
          >
            {LIVE_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} — {v.about}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-atelier-muted">
        {message}
      </p>
    </div>
  );
}
