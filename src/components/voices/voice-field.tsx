"use client";

// The character's voice as one card: its name, what it is, ▶ to hear it,
// and Change voice, which opens the voice sheet (2026-10-01, operator's pick
// A). Replaces the dropdown of curated voices.

import { useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { VoicePreviewButton } from "@/components/voice-preview-button";
import { VoiceSheet, type SheetVoice } from "./voice-sheet";

export function VoiceField({
  value,
  onChange,
  curated,
  own,
  characterId,
}: {
  value: string;
  onChange: (id: string) => void;
  curated: SheetVoice[];
  /** This person's own voices the page already knows (the character's current one among them). */
  own: SheetVoice[];
  characterId: string | null;
}) {
  const { t } = useLocale();
  const v = t.voiceSheet;
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<SheetVoice | null>(null);
  const current = (picked && picked.id === value ? picked : null) ?? curated.find((c) => c.id === value) ?? own.find((o) => o.id === value) ?? null;
  const badge = current?.source && current.source !== "curated" ? (v.sources as Record<string, string>)[current.source] : null;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 rounded-control border border-atelier-rule p-4">
        {current ? <VoicePreviewButton voicePresetId={current.id} characterId={characterId} label={`${v.play} ${current.label}`} /> : null}
        <div className="min-w-0 flex-1">
          {current ? (
            <>
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-atelier-ink">
                <span className="truncate">{current.label}</span>
                {badge && <span className="rounded-full border border-atelier-rule px-2 py-0.5 text-[10.5px] font-normal text-atelier-muted">{badge}</span>}
              </p>
              {(current.meta || current.description) && (
                <p className="truncate text-xs text-atelier-muted">{current.meta || current.description}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-atelier-muted">{v.cardAuto}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-control border border-atelier-rule px-3 py-1.5 text-sm text-atelier-ink transition-colors hover:border-atelier-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-atelier-accent"
        >
          {current ? v.cardChange : v.cardChoose}
        </button>
      </div>
      <VoiceSheet
        open={open}
        onClose={() => setOpen(false)}
        curated={curated}
        selectedId={value}
        onSelect={(voice) => {
          setPicked(voice);
          onChange(voice.id);
        }}
      />
    </div>
  );
}
