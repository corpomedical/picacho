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
      className={cn(
        "select-none rounded-full border border-neutral-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-700 dark:text-neutral-400",
        className,
      )}
    >
      Early access
    </span>
  );
}
