"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setProducerPersonality } from "@/lib/producer/actions";
import { PERSONALITIES, PERSONALITY_LABELS, type Personality } from "@/lib/producer/personality";

// Aly's personality (2026-09-28, operator: "Give Aly different personalities,
// the default that is the actual one, the sarcastic and the rude"). Saved on
// the account; it applies from the next thing said to her. English only
// while the assistant is.

const SAMPLE: Record<Personality, string> = {
  default: "“Nice. Golden hour on the canyon road it is. Want a close-up to go with it?”",
  sarcastic: "“Golden hour. How daring. Fine, it'll look great. Close-up next, or shall we live dangerously?”",
  rude: "“Golden hour again? Groundbreaking. It'll look good, obviously. Now pick a close-up before I fall asleep.”",
};

export function ProducerPersonalityForm({ current }: { current: Personality }) {
  const router = useRouter();
  const [choice, setChoice] = useState<Personality>(current);
  const [saved, setSaved] = useState<Personality>(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    const r = await setProducerPersonality(choice);
    setBusy(false);
    if (r.error) return setMessage(r.error);
    setSaved(choice);
    setMessage("Saved. She'll talk this way from your next message.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Its personality" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {PERSONALITIES.map((p) => {
          const on = choice === p;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setChoice(p)}
              className={
                "flex flex-col gap-1.5 rounded-control border p-3 text-left transition-colors " +
                (on ? "border-atelier-accent bg-atelier-accent/10" : "border-atelier-rule hover:border-atelier-ink/30")
              }
            >
              <span className="text-sm font-medium text-atelier-ink">{PERSONALITY_LABELS[p].name}</span>
              <span className="text-xs text-atelier-muted">{PERSONALITY_LABELS[p].line}</span>
              <span className="mt-1 text-xs italic text-atelier-ink/80">{SAMPLE[p]}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={choice === saved || busy}
          className="rounded-full bg-atelier-accent px-4 py-1.5 text-sm font-semibold text-[#1a120a] disabled:opacity-40"
        >
          Save
        </button>
        <span role="status" aria-live="polite" className="text-xs text-atelier-muted">
          {message}
        </span>
      </div>
    </div>
  );
}
