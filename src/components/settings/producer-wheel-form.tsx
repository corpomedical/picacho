"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { setProducerWheel } from "@/lib/producer/actions";
import { WHEEL_STYLES, WHEEL_STYLE_LABELS, type WheelStyle } from "@/components/producer/wheel-style";
import { Wheel } from "@/components/producer/wheel";
import { LookInner, lookClasses } from "@/components/producer/lamp-looks";
import type { LampLook } from "@/components/producer/lamp-look";
import styles from "@/components/producer/producer-lamp.module.css";

// Which wheel opens out of the lamp (2026-09-27, operator: "I like it, and
// add blossom. Let there be 2 options for the user to pick from"). Each
// choice shows the real wheel opening out of the person's own lamp, at half
// size; picking one plays it again. Saved on the account. English only while
// the assistant is, like its sheet.

const noop = () => {};
// The preview is drawn at full size and shrunk to half: a 480×320 corner of
// a page with the lamp where it sits (20 px in from the edges).
const W = 480;
const H = 320;
const SCALE = 0.5;

export function ProducerWheelForm({ current, look }: { current: WheelStyle; look: LampLook }) {
  const router = useRouter();
  const [choice, setChoice] = useState<WheelStyle>(current);
  const [saved, setSaved] = useState<WheelStyle>(current);
  const [plays, setPlays] = useState<Record<WheelStyle, number>>({ filament: 0, blossom: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function pick(style: WheelStyle) {
    setChoice(style);
    setPlays((p) => ({ ...p, [style]: p[style] + 1 }));
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    const r = await setProducerWheel(choice);
    setBusy(false);
    if (r.error) return setMessage(r.error);
    setSaved(choice);
    setMessage("Saved. The lamp opens its new wheel.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Its wheel" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {WHEEL_STYLES.map((style) => {
          const on = choice === style;
          return (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pick(style)}
              className={
                "flex flex-col gap-2 rounded-control border p-2 text-left transition-colors " +
                (on ? "border-atelier-accent bg-atelier-accent/10" : "border-atelier-rule hover:border-atelier-ink/30")
              }
            >
              <span
                aria-hidden="true"
                className="relative block overflow-hidden rounded-[10px] bg-[#0b0a08]"
                style={{ width: "100%", maxWidth: W * SCALE, aspectRatio: `${W} / ${H}` }}
              >
                <span
                  className="absolute left-0 top-0 block"
                  style={{ width: W, height: H, transform: `scale(${SCALE})`, transformOrigin: "0 0" } as CSSProperties}
                >
                  <Wheel
                    key={plays[style]}
                    style={style}
                    phone={false}
                    contained
                    demo
                    cx={W - 42}
                    cy={H - 42}
                    used={62}
                    cap={100}
                    phase="off"
                    level={0}
                    readAloud
                    notesOpen={false}
                    notesCount={3}
                    voiceAvailable
                    canFresh
                    onTalk={noop}
                    onReadAloud={noop}
                    onNotes={noop}
                    onFresh={noop}
                  />
                  <span
                    className={`${styles.previewLamp} ${lookClasses(look, "idle")} absolute grid place-items-center`}
                    style={{ left: W - 64, top: H - 64, zIndex: 49, "--glow": 0.5 } as CSSProperties}
                  >
                    <LookInner look={look} />
                  </span>
                </span>
              </span>
              <span className="min-w-0 px-1 pb-1">
                <span className="block text-sm font-medium text-atelier-ink">{WHEEL_STYLE_LABELS[style].name}</span>
                <span className="mt-0.5 block text-xs text-atelier-muted">{WHEEL_STYLE_LABELS[style].line}</span>
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
