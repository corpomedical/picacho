import { cn } from "@/lib/cn";

// Small pill shown beside the wordmark on the marketing site and in the app.
//
// "Early access" rather than "Beta", deliberately. Picacho's whole pitch is
// reliability — consistent on the first try, validated before you see it —
// and a BETA badge sitting next to that claim argues against it. Early
// access sets the same expectation (things are still moving, be forgiving)
// without implying the product is unstable, and it doesn't undercut the
// price on a EUR499 tier the way "beta" would. It also reads better to the
// risk-averse end of the audience: a clinic evaluating a compliance feature
// hears "beta" as a reason to wait.
//
// Deliberately one component in one file with one string, so removing it
// later is a two-minute job. Badges like this have a habit of becoming
// permanent because nobody can find every place they were pasted.
//
// NOT shown in /admin — that's internal, and nobody needs reassuring about
// the maturity of a product they built.
export function EarlyAccessBadge({ className }: { className?: string }) {
  return (
    <span
      // No border, padding or pill — those made it read as a button people
      // might try to click. It's a label on the wordmark, so it should look
      // like part of the wordmark's lockup rather than a control.
      //
      // The nudge is doing real work, so don't "clean it up". logo.png is
      // 1942x595 with the letterforms occupying only y=20..400; below them
      // sits ~150px of empty space and then the orange accent rule at
      // y=548..575. So a third of the image height is below the type. Plain
      // `items-center` centres this label against the whole image box, which
      // parks it noticeably below the letters it's labelling, and aligning to
      // the bottom is worse — that lines it up with the accent rule.
      //
      // Measured at the h-6 (24px) the three call sites use: letterforms run
      // 0.81px..16.13px, optical centre 8.47px, box centre 12px. Hence 3.5px
      // up, which puts this label's optical centre on the wordmark's. Both
      // are uppercase with no descenders, so centre-matching lines the
      // baselines up without depending on the font's ascent/descent metrics.
      //
      // Fixed px because every call site renders the logo at h-6. If one ever
      // renders it larger, scale this with it (offset = 0.147 x logo height).
      className={cn(
        "-translate-y-[3.5px] select-none text-[10px] font-medium uppercase leading-none tracking-wide text-neutral-400 dark:text-neutral-500",
        className,
      )}
    >
      Early access
    </span>
  );
}
