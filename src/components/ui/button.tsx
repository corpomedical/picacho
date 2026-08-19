import { ButtonHTMLAttributes, type Ref } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atelier-accent disabled:opacity-50 disabled:pointer-events-none";

// Atelier variants: ink is the only "loud" fill; the accent stays reserved
// for proof (here, just the focus ring). Reds are semantic, so they carry
// explicit dark: twins — unlike the atelier-* tokens, which flip on their
// own via the .dark block in globals.css.
const variants: Record<Variant, string> = {
  primary: "bg-atelier-ink text-atelier-paper hover:bg-atelier-ink/90",
  secondary:
    "border border-atelier-rule bg-atelier-surface text-atelier-ink hover:border-atelier-muted hover:bg-atelier-ink/5",
  ghost: "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
  destructive: "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/15",
};

const sizes: Record<Size, string> = {
  sm: "px-3.5 py-1.5 text-xs",
  md: "px-5 py-2.5 text-sm",
};

// currentColor throughout, so one spinner works on every variant — paper on
// the ink-filled primary, ink on secondary — without a per-variant class.
function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-3.5 w-3.5 flex-shrink-0 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * `pending` dims the button, locks it, and swaps in a spinner — the visible
 * acknowledgement that a click was received. Without it a slow save looks
 * identical to a dead button, which is how people end up clicking Save three
 * times and firing the action three times.
 *
 * There is deliberately no success state here. A green "Saved" was tried and
 * removed: it outlives the action it describes, so clearing it reliably means
 * fighting re-renders and server-action navigations, and every miss left a
 * button stuck mid-celebration. The real change on screen — the row updating,
 * the value saving — is the confirmation.
 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  pending = false,
  pendingLabel,
  disabled,
  children,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  // React 19 passes ref as an ordinary prop — no forwardRef needed. Declared
  // explicitly because ButtonHTMLAttributes doesn't include it.
  ref?: Ref<HTMLButtonElement>;
  variant?: Variant;
  size?: Size;
  pending?: boolean;
  pendingLabel?: string;
}) {
  // `disabled` and `aria-busy` are applied AFTER the {...props} spread below,
  // deliberately. They're computed from `pending`, and a spread that lands
  // after them would overwrite the computed value with whatever the caller
  // passed — including `undefined`, which silently defeated the lock entirely.
  return (
    <button
      ref={ref}
      className={cn(
        base,
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    >
      {pending && <Spinner />}
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
