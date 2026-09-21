"use client";

import { capPlugin } from "@/lib/native/bridge";

// "Share Picacho" on the More page: the system share sheet, with the person's
// own referral link when they have a username (the same link the ⋯ menu's
// share has used since 2026-08-22, so every share can earn its sender a
// credit). App-only: the page renders this row only inside the app.
export function MoreShareRow({ label, url }: { label: string; url: string }) {
  function share() {
    const plugin = capPlugin("Share");
    void plugin?.share?.({ title: "Picacho", url });
  }
  return (
    <button type="button" onClick={share} className="flex min-h-[52px] w-full items-center gap-3 py-3 text-left transition-colors active:opacity-70">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5 flex-shrink-0 text-atelier-muted">
        <path d="M12 3v12" />
        <path d="m7 8 5-5 5 5" />
        <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
      </svg>
      <span className="min-w-0 flex-1 truncate text-sm text-atelier-ink">{label}</span>
    </button>
  );
}
