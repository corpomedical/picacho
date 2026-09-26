"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setProducerName } from "@/lib/producer/actions";

// What the person calls their assistant (operator, 2026-09-24: "User picks";
// 2026-09-26: Aly by default — Producer, the old default, and Concierge are
// the other named choices, or their own). English only, like its sheet.

const PRESETS = ["Aly", "Producer", "Concierge"] as const;

export function ProducerNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const isPreset = (PRESETS as readonly string[]).includes(initialName);
  const [choice, setChoice] = useState<string>(isPreset ? initialName : "custom");
  const [custom, setCustom] = useState(isPreset ? "" : initialName);
  const [saved, setSaved] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const wanted = choice === "custom" ? custom.trim() : choice;
  const dirty = wanted.length > 0 && wanted !== saved;

  async function save() {
    setBusy(true);
    setMessage(null);
    const r = await setProducerName(wanted);
    setBusy(false);
    if (r.error) return setMessage(r.error);
    setSaved(r.name);
    setMessage("Saved. It answers to the new name from your next message.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Its name">
        {[...PRESETS, "custom"].map((opt) => (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={choice === opt}
            onClick={() => setChoice(opt)}
            className={
              "rounded-full border px-3.5 py-1.5 text-sm transition-colors " +
              (choice === opt
                ? "border-atelier-accent bg-atelier-accent/15 text-atelier-ink"
                : "border-atelier-rule text-atelier-muted hover:text-atelier-ink")
            }
          >
            {opt === "custom" ? "Your own name" : opt}
          </button>
        ))}
      </div>
      {choice === "custom" && (
        <input
          id="producer-custom-name"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          maxLength={24}
          placeholder="e.g. Rosa"
          className="w-full max-w-xs rounded-control border border-atelier-rule bg-transparent px-3 py-2 text-sm text-atelier-ink outline-none focus:border-atelier-accent"
        />
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="rounded-full bg-atelier-accent px-4 py-1.5 text-sm font-semibold text-[#1a120a] disabled:opacity-40"
        >
          Save
        </button>
        {message && <span className="text-xs text-atelier-muted">{message}</span>}
      </div>
    </div>
  );
}
