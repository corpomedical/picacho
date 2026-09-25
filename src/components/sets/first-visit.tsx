"use client";

// The first visit (Helios Cut 3, step 9, 2026-09-26): three short tips on a
// set that has no stills yet — the grey figure, the blocks and the bright
// box — so the stage explains itself once. A card, not a tour: it sits
// beside the stage (or at the top of a phone's conversation), never over
// it, takes no focus and blocks nothing, so the page works around it. It is
// shown once per browser (picacho.heliosTour.v1) and ?tour=1 shows it again.
// The page decides when and where; this only draws it. Literal colours only
// (the Screening theme turns Tailwind's `white` near-black, 42b64bc).

/** This browser has seen the tips: "1" once the card is put away. */
export const HELIOS_TOUR_KEY = "picacho.heliosTour.v1";

export function FirstVisit({
  tips,
  step,
  onNext,
  onClose,
  words,
  surface,
  className = "",
}: {
  /** The tips in order; `step` is the one showing. */
  tips: readonly string[];
  step: number;
  onNext: () => void;
  /** × and Close both put it away for good. */
  onClose: () => void;
  words: { stepsLabel: string; next: string; close: string; dismiss: string };
  /** The studio's panel ground, so the card is the page's own glass. */
  surface: string;
  className?: string;
}) {
  const at = Math.min(Math.max(step, 0), tips.length - 1);
  const last = at === tips.length - 1;
  return (
    <div
      data-first-visit
      aria-live="polite"
      className={`${surface} relative rounded-[14px] p-3.5 pr-10 backdrop-blur transition-[opacity,translate] duration-200 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none ${className}`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={words.dismiss}
        title={words.dismiss}
        className="absolute right-1.5 top-1.5 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[15px] leading-none text-[#d6d9e0] hover:text-[#ecedf1]"
      >
        ×
      </button>
      <p className="text-[12px] tabular-nums text-[#9aa0ad]" data-first-visit-count>
        <span className="sr-only">{words.stepsLabel} </span>
        {at + 1}/{tips.length}
      </p>
      <p key={at} className="mt-1 text-[12.5px] leading-[1.55] text-[#c6c9d1] transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none">
        {tips[at]}
      </p>
      <div className="mt-2.5 flex justify-end">
        {/* One button that turns into Close on the last tip: focus stays where it was. */}
        <button
          type="button"
          onClick={last ? onClose : onNext}
          data-first-visit-next
          className="flex h-8 cursor-pointer items-center rounded-full border border-[rgba(255,255,255,0.11)] bg-[#2a2b33] px-3.5 text-[12px] font-medium text-[#d6d9e0] transition-colors hover:text-[#ecedf1] motion-reduce:transition-none"
        >
          {last ? words.close : words.next}
        </button>
      </div>
    </div>
  );
}
