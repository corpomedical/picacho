"use client";

import { useEffect, useState } from "react";
import styles from "./aly-chat.module.css";

// A picture being made in Aly's chat or Picacho Light, the way ChatGPT shows
// one (operator, 2026-10-02: the paying customer sent pictures twice "because
// they dont know if its stuck or not" → drafts at
// claude.ai/artifact/Ajh9s7pjTYBSae278jbSWi → "Build 2"). No card while it
// works: a shimmering "Creating picture" line with a seconds clock and a small
// Stop, over a bare frame in the picture's own shape with soft light moving
// through it. The card comes back once the picture is there.

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function CreatingPicture({
  label,
  stopLabel,
  onStop,
  startedAt,
  aspect = "1:1",
}: {
  label: string;
  stopLabel: string;
  /** Absent until the render has an id to stop. */
  onStop?: () => void;
  /** Epoch ms the render started; the clock counts from it. */
  startedAt: number;
  aspect?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const [w, h] = aspect.split(":").map(Number);

  return (
    <div className="space-y-2.5" role="status" aria-label={label}>
      <div className="flex items-baseline gap-2 text-sm">
        <span className={`font-medium ${styles.shimmer}`}>{label}</span>
        <span className="font-mono text-xs tabular-nums text-atelier-muted" aria-hidden="true">
          {formatElapsed((now - startedAt) / 1000)}
        </span>
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            className="ml-auto text-xs text-atelier-muted underline underline-offset-2 hover:text-atelier-ink"
          >
            {stopLabel}
          </button>
        )}
      </div>
      <div className={styles.makingFrame} style={{ aspectRatio: `${w || 1} / ${h || 1}` }} aria-hidden="true">
        <span className={`${styles.makingCloud} ${styles.makingCloudA}`} />
        <span className={`${styles.makingCloud} ${styles.makingCloudB}`} />
        <span className={styles.makingShine} />
        <span className={styles.makingGrain} />
      </div>
    </div>
  );
}
