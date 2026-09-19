"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { BUTTON_SECONDARY } from "@/components/settings/hub/parts";

// A setting shown as what it IS, with the form one tap away (2026-09-19,
// the rooms after the Overview: "the other tabs" were still open forms
// stacked on each other). Label, current value, "Change"; the form opens
// in place under its row and stays open until closed, so a form's own
// confirmation ("check your new inbox") is never cut short.

const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-3 sm:grid-cols-[170px_minmax(0,1fr)_auto]";

/** Rows separated by hairlines, flush with the card's body padding. The
 *  bottom pull applies only as the body's last child: with -my-3 anything
 *  after the list rode up onto its last row. */
export function RowList({ children }: { children: ReactNode }) {
  return <div className="-mt-3 divide-y divide-atelier-rule/60 last:-mb-3">{children}</div>;
}

export function ValueRow({
  label,
  value,
  hint,
  action,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={ROW}>
      <span className="col-span-2 text-[13px] text-atelier-muted sm:col-span-1">{label}</span>
      <div className="min-w-0 text-sm text-atelier-ink">
        <div className="break-words">{value}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-atelier-muted">{hint}</div>}
      </div>
      <div className="justify-self-end">{action}</div>
    </div>
  );
}

export function EditRow({
  label,
  value,
  hint,
  editLabel,
  closeLabel,
  children,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  editLabel: string;
  closeLabel: string;
  /** The form, rendered only while open. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className={ROW}>
        <span className="col-span-2 text-[13px] text-atelier-muted sm:col-span-1">{label}</span>
        <div className="min-w-0 text-sm text-atelier-ink">
          {/* Wraps, never cuts: the value is the information. */}
          <div className="break-words">{value}</div>
          {hint && <div className="mt-0.5 text-xs leading-relaxed text-atelier-muted">{hint}</div>}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(BUTTON_SECONDARY, "justify-self-end")}
        >
          {open ? closeLabel : editLabel}
        </button>
      </div>
      {open && <div className="pb-4 pt-1 sm:pl-[186px]">{children}</div>}
    </div>
  );
}
