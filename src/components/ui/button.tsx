import { ButtonHTMLAttributes, type Ref } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-800 shadow-[0_1px_1px_rgba(0,0,0,0.08)]",
  secondary: "bg-white text-neutral-900 border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50",
  ghost: "text-neutral-500 hover:text-neutral-900",
  destructive: "text-red-600 hover:text-red-700",
};

const sizes: Record<Size, string> = {
  sm: "px-3.5 py-1.5 text-xs",
  md: "px-5 py-2.5 text-sm",
};

// currentColor throughout, so one spinner works on every variant — white on
// the primary button, near-black on secondary — without a per-variant class.
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

function CheckIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 flex-shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * `pending` dims the button, locks it, and swaps in a spinner — the visible
 * acknowledgement that a click was received. Without it a slow save looks
 * identical to a dead button, which is how people end up clicking Save three
 * times and firing the action three times.
 *
 * `confirmed` is the brief green "Saved" that follows a successful one. It
 * deliberately overrides the disabled dimming: a confirmation that looks
 * greyed out reads as failure.
 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  pending = false,
  pendingLabel,
  confirmed = false,
  confirmedLabel,
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
  confirmed?: boolean;
  confirmedLabel?: string;
}) {
  // Confirmation wins over pending: if both are somehow set, the newer state
  // is the one worth showing.
  const state = confirmed ? "confirmed" : pending ? "pending" : "idle";

  // `disabled` and `aria-busy` are applied AFTER the {...props} spread below,
  // deliberately. They're computed from `pending`/`confirmed`, and a spread
  // that lands after them would overwrite the computed value with whatever
  // the caller passed — including `undefined`, which silently defeated the
  // pending lock entirely.
  return (
    <button
      ref={ref}
      className={cn(
        base,
        variants[variant],
        sizes[size],
        state === "confirmed" &&
          "!border-emerald-600 !bg-emerald-600 !text-white !opacity-100 hover:!bg-emerald-600",
        className,
      )}
      {...props}
      disabled={disabled || state !== "idle"}
      aria-busy={state === "pending" || undefined}
    >
      {state === "pending" && <Spinner />}
      {state === "confirmed" && <CheckIcon />}
      {state === "pending" ? (pendingLabel ?? children) : state === "confirmed" ? (confirmedLabel ?? children) : children}
    </button>
  );
}
