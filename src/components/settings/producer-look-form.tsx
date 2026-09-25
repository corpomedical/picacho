"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { setProducerLook } from "@/lib/producer/actions";
import { LAMP_LOOKS, LAMP_LOOK_LABELS, type LampLook, type LampMood } from "@/components/producer/lamp-look";
import { LookInner, lookClasses } from "@/components/producer/lamp-looks";
import styles from "@/components/producer/producer-lamp.module.css";

// How the Producer's lamp looks (2026-09-25, operator: "I like Two fireflies.
// Lets try that and add Eclipse and The original perfected in the settings
// for the user to select from"). Each choice is the real lamp at its real
// size, alive; pointing at one shows it talking, and picking one makes it
// talk for a moment (a tap on a phone is too short to point). Saved on the
// account, so the lamp in the corner changes as soon as it saves. English
// only while the Producer is admins-only, like its sheet.

export function ProducerLookForm({ current }: { current: LampLook }) {
  const router = useRouter();
  const [choice, setChoice] = useState<LampLook>(current);
  const [saved, setSaved] = useState<LampLook>(current);
  const [hover, setHover] = useState<LampLook | null>(null);
  const [demo, setDemo] = useState<LampLook | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const demoTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(demoTimer.current), []);

  function pick(look: LampLook) {
    setChoice(look);
    setDemo(look);
    window.clearTimeout(demoTimer.current);
    demoTimer.current = window.setTimeout(() => setDemo(null), 2400);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    const r = await setProducerLook(choice);
    setBusy(false);
    if (r.error) return setMessage(r.error);
    setSaved(choice);
    setMessage("Saved. The lamp has its new look.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Its look" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {LAMP_LOOKS.map((look) => {
          const on = choice === look;
          const mood: LampMood = hover === look || demo === look ? "talking" : "idle";
          return (
            <button
              key={look}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pick(look)}
              onPointerEnter={() => setHover(look)}
              onPointerLeave={() => setHover((h) => (h === look ? null : h))}
              onFocus={() => setHover(look)}
              onBlur={() => setHover((h) => (h === look ? null : h))}
              className={
                "flex items-center gap-3 rounded-control border p-3 text-left transition-colors sm:flex-col sm:gap-2 sm:py-4 sm:text-center " +
                (on ? "border-atelier-accent bg-atelier-accent/10" : "border-atelier-rule hover:border-atelier-ink/30")
              }
            >
              <span className="grid h-16 w-16 flex-none place-items-center overflow-hidden rounded-control bg-[#0b0a08]">
                <span
                  aria-hidden="true"
                  className={`${styles.previewLamp} ${lookClasses(look, mood)} grid place-items-center`}
                  style={{ "--glow": 0.7 } as React.CSSProperties}
                >
                  <LookInner look={look} />
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-atelier-ink">{LAMP_LOOK_LABELS[look].name}</span>
                <span className="mt-0.5 block text-xs text-atelier-muted">{LAMP_LOOK_LABELS[look].line}</span>
              </span>
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
