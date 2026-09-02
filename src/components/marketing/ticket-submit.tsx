"use client";

import { useFormStatus } from "react-dom";

// The ticket-stub CTA for the dark homepage pricing (the Ticket Wall,
// 2026-09-02). Deliberately NOT the shared Button: that component paints
// with atelier theme tokens, which the pinned-dark marketing page must not
// inherit (the .dark remap would flip them out from under the design), and
// its size scale can't express the stub's full-width 14px-tall press.
// Pending behavior mirrors SubmitButton's contract — dimmed, locked — so a
// slow checkout action still visibly acknowledges the click.
export function TicketSubmit({ filled, children }: { filled?: boolean; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={
        filled
          ? "w-full rounded-[10px] bg-ochre px-4 py-3.5 text-sm font-semibold text-[#f7f6f4] shadow-[0_14px_34px_-10px_rgba(168,78,36,0.6)] transition-colors hover:bg-ochre-deep disabled:pointer-events-none disabled:opacity-60"
          : "w-full rounded-[10px] px-4 py-3.5 text-sm font-semibold text-[#f7f6f4] shadow-[inset_0_0_0_1px_rgba(247,246,244,0.3)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(247,246,244,0.55)] disabled:pointer-events-none disabled:opacity-60"
      }
    >
      {children}
    </button>
  );
}
