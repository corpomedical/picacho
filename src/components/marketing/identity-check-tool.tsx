"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

// The free identity checker's interactive half (2026-08-30).
//
// Deliberately the first thing on picacho.ai a stranger can actually DO. The
// homepage's "Try it" widget is honest but it is a replay of stored
// generations — nobody has ever run anything. This runs the real scorer on
// the visitor's own files.

type Result = { score: number; notes: string; unusable: boolean };

function Drop({
  label,
  hint,
  file,
  onPick,
}: {
  label: string;
  hint: string;
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function take(f: File | null) {
    onPick(f);
    // Revoked before replacing so a session of repeated checks cannot leak
    // object URLs — the exact bug the character form was carrying.
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">{label}</p>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={cn(
          "relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[14px] border-2 border-dashed transition-colors",
          file
            ? "border-transparent"
            : "border-neutral-300 bg-neutral-50 hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900",
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="px-4 text-center text-xs leading-relaxed text-neutral-500">{hint}</span>
        )}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => take(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

export function IdentityCheckTool() {
  const [reference, setReference] = useState<File | null>(null);
  const [candidate, setCandidate] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!reference || !candidate || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.set("reference", reference);
      body.set("candidate", candidate);
      const res = await fetch("/api/tools/identity-check", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Something went wrong.");
      else setResult(json as Result);
    } catch {
      setError("Couldn't reach the scorer. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // Bands, not a bare number: 92 means nothing to someone seeing this for the
  // first time. These are the same thresholds the product's own analysis
  // uses when it talks about a render being usable.
  const band =
    result === null
      ? null
      : result.score >= 85
        ? { label: "Strong match", tone: "text-emerald-600", bar: "bg-emerald-500" }
        : result.score >= 70
          ? { label: "Drifting", tone: "text-amber-600", bar: "bg-amber-500" }
          : { label: "Different person", tone: "text-red-600", bar: "bg-red-500" };

  return (
    <div className="rounded-[18px] border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
      <div className="grid gap-5 sm:grid-cols-2">
        <Drop
          label="The real face"
          hint="A clear photo of the person your character is based on"
          file={reference}
          onPick={setReference}
        />
        <Drop
          label="The generated one"
          hint="Any AI render — from Picacho or anywhere else"
          file={candidate}
          onPick={setCandidate}
        />
      </div>

      <button
        type="button"
        onClick={run}
        disabled={!reference || !candidate || busy}
        className="mt-5 w-full rounded-full bg-neutral-900 px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
      >
        {busy ? "Scoring…" : "Score the match"}
      </button>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {result && band && (
        <div className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
              Identity match
            </span>
            <span className={cn("text-3xl font-bold tabular-nums", band.tone)}>{result.score}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className={cn("h-full rounded-full transition-all", band.bar)}
              style={{ width: `${Math.max(2, Math.min(100, result.score))}%` }}
            />
          </div>
          <p className={cn("mt-3 text-sm font-semibold", band.tone)}>{band.label}</p>
          {result.notes && (
            <p className="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              {result.notes}
            </p>
          )}
          <p className="mt-4 text-xs leading-relaxed text-neutral-400">
            Scored by the same vision check Picacho runs on every image it generates. Your files are
            sent to the scorer and not stored.
          </p>
        </div>
      )}
    </div>
  );
}
