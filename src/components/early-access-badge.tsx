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
export function EarlyAccessBadge({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span
      // No border, padding or pill — those made it read as a button people
      // might try to click. It's a label on the wordmark, so it should look
      // like part of the wordmark's lockup rather than a control.
      //
      // No vertical offset — this deliberately just rides the flex parent's
      // `items-center`. Two attempts at "correcting" that were both rejected
      // on sight, so leave it alone. logo.png is 1942x595 with the
      // letterforms only occupying y=20..400 and the orange accent rule down
      // at y=548..575, so geometric alignment to the type reads as too high,
      // and alignment to the bottom lines the label up with the rule instead
      // of the word. Centring on the whole image box is what looks right.
      className={cn(
        "select-none text-[10px] font-medium uppercase leading-none tracking-wide",
        // The dark front page pins literals so the site theme can't touch
        // them; everywhere else the badge keeps its theme-adaptive greys.
        dark ? "text-[#f7f6f4]/40" : "text-neutral-400 dark:text-neutral-500",
        className,
      )}
    >
      Early access
    </span>
  );
}
