"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_PTT_KEY,
  PTT_KEY_EVENT,
  PTT_KEY_STORAGE,
  isMac,
  pttKeyName,
  readPttKey,
  reservedKey,
  typesCharacter,
  writePttKey,
} from "@/components/producer/ptt-key";

// The push-to-talk key (2026-09-27, operator: "Right option"): which key,
// held, opens the mic for Aly; changed by pressing the new one, or turned
// off. Kept on this device, like the lamp's place. English only while the
// assistant is.

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => e.key === PTT_KEY_STORAGE && onChange();
  window.addEventListener("storage", onStorage);
  window.addEventListener(PTT_KEY_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(PTT_KEY_EVENT, onChange);
  };
}
const noSubscribe = () => () => {};

export function ProducerPttKeyForm() {
  const key = useSyncExternalStore(subscribe, readPttKey, () => DEFAULT_PTT_KEY);
  const mac = useSyncExternalStore(noSubscribe, isMac, () => false);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Waiting for the new key: the next one pressed (Escape cancels).
  useEffect(() => {
    if (!listening) return;
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setListening(false);
        setMessage(null);
        return;
      }
      if (!e.code || reservedKey(e.code)) {
        setMessage("That key is needed for other things. Press another one.");
        return;
      }
      writePttKey(e.code);
      setListening(false);
      setMessage(
        typesCharacter(e.code)
          ? `Saved. ${pttKeyName(e.code, mac)} types a character, so it won't work while you're typing in a box.`
          : `Saved. Hold ${pttKeyName(e.code, mac)} to talk.`,
      );
    };
    window.addEventListener("keydown", onDown, true);
    return () => window.removeEventListener("keydown", onDown, true);
  }, [listening, mac]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-atelier-ink">Push-to-talk key</p>
        <p className="mt-0.5 text-xs text-atelier-muted">
          {key === "off"
            ? "Off. Holding the lamp still works."
            : `Hold ${pttKeyName(key, mac)} to talk to her, and let go to send, while Picacho is the tab you're in. The mic is open only while you hold it.`}
        </p>
        {message && (
          <p role="status" aria-live="polite" className="mt-1 text-xs text-atelier-accent">
            {message}
          </p>
        )}
      </div>
      <div className="flex flex-none items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setListening((v) => !v);
          }}
          className={
            "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors " +
            (listening ? "border-atelier-accent bg-atelier-accent/10 text-atelier-ink" : "border-atelier-rule text-atelier-ink hover:bg-atelier-ink/5")
          }
        >
          {listening ? "Press the new key… (Esc to cancel)" : key === "off" ? "Choose a key" : "Change"}
        </button>
        {key !== "off" && !listening && (
          <button
            type="button"
            onClick={() => {
              writePttKey("off");
              setMessage(null);
            }}
            className="rounded-full px-3 py-1.5 text-sm text-atelier-muted hover:text-atelier-ink"
          >
            Turn off
          </button>
        )}
      </div>
    </div>
  );
}
