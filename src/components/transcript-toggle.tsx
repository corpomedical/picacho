"use client";

// The page header's "Session transcript" affordance (approved A×B board:
// it sits baseline-aligned beside the Generate title). The header is a
// server component and the transcript state lives inside GenerateForm, so
// this fires a window event the form listens for — the same pattern the
// native pencil already uses for New chat (NEW_CHAT_EVENT).
export function TranscriptToggle({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("picacho:toggle-transcript"))}
      className="flex items-center gap-2 text-[12.5px] text-atelier-muted transition-colors hover:text-atelier-ink"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[13px] w-[13px] flex-shrink-0"
        aria-hidden
      >
        <path d="M4 6h16M4 12h10M4 18h7" />
      </svg>
      {label}
    </button>
  );
}
