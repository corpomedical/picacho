import type { ReactNode } from "react";
import { createPortalSession } from "@/lib/stripe/actions";

// Every "change it" on Plan & billing opens Stripe's own customer portal:
// plan changes, cancelling, the card, the name and address on invoices. It
// takes payment, so it never renders inside the store apps (the page leaves
// these buttons out there). `flow` opens the portal straight on one task.
export function PortalButton({
  flow,
  className,
  inline,
  children,
}: {
  flow?: "payment_method";
  className?: string;
  /** Sits inside a sentence ("… · Switch") rather than as a button of its own. */
  inline?: boolean;
  children: ReactNode;
}) {
  return (
    <form action={createPortalSession} className={inline ? "inline" : "flex-shrink-0"}>
      {flow && <input type="hidden" name="flow" value={flow} />}
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}
