import Link from "next/link";
import { ReactNode } from "react";
import { cn } from "@/lib/cn";

// The one "nothing here yet" object. Before this file the app drew empty
// states four different ways at once — dashed vs solid frames, three corner
// radii, link vs button vs no next step at all (flaw-hunt 47, 2026-09-05).
// The call-to-action is the quiet underlined-ink link the galleries and
// History already used, not a primary button: the accent stays reserved,
// and an empty page shouldn't shout.
//
// `frame` is a prop, not a className override, for the same reason Card's
// padding is: cn() is a plain string join, so a caller's "border-0" can't
// reliably beat the dashed border. A pane that already draws its own frame
// (the Notes editor sheet) passes frame={false}.
export function EmptyState({
  icon,
  message,
  action,
  frame = true,
  className,
}: {
  icon?: ReactNode;
  message: string;
  // href renders a Link; onClick renders a button — for the rare empty
  // state whose next step is an in-place action rather than a navigation.
  action?: { label: string; href?: string; onClick?: () => void };
  frame?: boolean;
  className?: string;
}) {
  const actionClass =
    "mt-3 text-sm font-medium text-atelier-ink underline decoration-atelier-accent/50 underline-offset-2";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        frame && "rounded-control border border-dashed border-atelier-rule py-14",
        className,
      )}
    >
      {icon && <div className="mb-3 text-atelier-muted">{icon}</div>}
      <p className="text-sm text-atelier-muted">{message}</p>
      {action &&
        (action.href ? (
          <Link href={action.href} className={actionClass}>
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className={actionClass}>
            {action.label}
          </button>
        ))}
    </div>
  );
}
