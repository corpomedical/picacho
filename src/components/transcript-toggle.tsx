"use client";

// The page header's "Session transcript" affordance (approved A×B board:
// it sits baseline-aligned beside the Generate title). The header is a
// server component and the transcript state lives inside GenerateForm, so
// this fires a window event the form listens for — the same pattern the
// native pencil already uses for New chat (NEW_CHAT_EVENT).
export function TranscriptToggle({
  label,
  tone = "page",
}: {
  label: string;
  /** "screen" = drawn over the Screening Room's dark room (md+), where the
      page's ink tokens would be invisible in the light theme. */
  tone?: "page" | "screen";
}) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("picacho:toggle-transcript"))}
      className={
        tone === "screen"
          ? "flex flex-shrink-0 items-center gap-2 text-[12.5px] text-[#cfc6b8] transition-colors hover:text-[#f3ede4]"
          : "flex items-center gap-2 text-[12.5px] text-atelier-muted transition-colors hover:text-atelier-ink"
      }
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
