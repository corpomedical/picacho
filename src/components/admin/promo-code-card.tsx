"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { LocalDate } from "@/components/local-date";
import { deletePromoCode, setPromoCodeActive, updatePromoCode } from "@/lib/admin/promo-actions";

// One promo code, with its stats and its controls. A client component purely
// so Edit and Delete can open in place — everything that changes data still
// goes through a server action.
//
// Delete asks twice, inline, rather than through a browser confirm(): the
// second click needs to state what actually happens to the sales the code
// already brought in, which a native dialog can't do well.

export type PromoCodeRow = {
  id: string;
  code: string;
  rep_name: string;
  discount_percent: number;
  duration_months: number;
  commission_percent: number;
  active: boolean;
  notes: string | null;
  created_at: string;
};

// Totals arrive split per currency (see the rollup in admin/promo/page.tsx):
// a code can close both USD and EUR sales, and summing cents across
// currencies under one symbol misstates real money. Each entry renders as
// its own amount — "$120 + €80" — mirroring how admin/billing shows MRR.
export type PromoStats = {
  count: number;
  totals: { currency: string; subtotal: number; discount: number; commission: number }[];
} | null;

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function moneyList(
  totals: NonNullable<PromoStats>["totals"],
  field: "subtotal" | "commission",
): string {
  if (totals.length === 0) return "—";
  return totals.map((t) => money(t[field], t.currency)).join(" + ");
}

function durationLabel(months: number) {
  if (months === 0) return "forever";
  if (months === 1) return "first month";
  return `first ${months} months`;
}

export function PromoCodeCard({ promo, stats }: { promo: PromoCodeRow; stats: PromoStats }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-neutral-900">{promo.code}</span>
            <Badge tone={promo.active ? "success" : "neutral"}>
              {promo.active ? "active" : "off"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {promo.rep_name} · {promo.discount_percent}% off, {durationLabel(promo.duration_months)} ·{" "}
            {promo.commission_percent}% commission
            {promo.notes ? ` · ${promo.notes}` : ""} · created <LocalDate date={promo.created_at} />
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
            <div>
              <dt className="text-neutral-400">Clients</dt>
              <dd className="mt-0.5 text-sm font-semibold text-neutral-900">{stats?.count ?? 0}</dd>
            </div>
            <div>
              <dt className="text-neutral-400">Revenue (ex-tax)</dt>
              <dd className="mt-0.5 text-sm font-semibold text-neutral-900">
                {stats ? moneyList(stats.totals, "subtotal") : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-400">Commission owed</dt>
              <dd className="mt-0.5 text-sm font-semibold text-neutral-900">
                {stats ? moneyList(stats.totals, "commission") : "—"}
              </dd>
            </div>
          </dl>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing((v) => !v);
                setConfirmingDelete(false);
              }}
              className="rounded-[10px] border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-300"
            >
              {editing ? "Close" : "Edit"}
            </button>
            <form action={setPromoCodeActive}>
              <input type="hidden" name="id" value={promo.id} />
              <input type="hidden" name="active" value={String(!promo.active)} />
              <SubmitButton variant="secondary" size="sm" pendingLabel="Updating…">
                {promo.active ? "Turn off" : "Turn on"}
              </SubmitButton>
            </form>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete((v) => !v);
                setEditing(false);
              }}
              className="rounded-[10px] px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {confirmingDelete && (
        <div className="mt-4 rounded-[12px] border border-red-200 bg-red-50/60 p-4">
          <p className="text-sm font-semibold text-red-900">
            Delete {promo.code} permanently?
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-red-800/90">
            It stops working immediately and can&apos;t be recreated with the same discount later.
            {stats && stats.count > 0 ? (
              <>
                {" "}
                The {stats.count} sale{stats.count === 1 ? "" : "s"} it already brought in stay in
                the redemption record below, with the commission owed on them —{" "}
                {moneyList(stats.totals, "commission")} — but this card and its totals disappear.
                Clients already subscribed keep the discount they bought, which Stripe honours and we
                can&apos;t revoke.
              </>
            ) : (
              " It has no sales attached, so nothing else is affected."
            )}{" "}
            To pause it instead and keep everything, use <b>Turn off</b>.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <form action={deletePromoCode}>
              <input type="hidden" name="id" value={promo.id} />
              <SubmitButton
                variant="destructive"
                size="sm"
                className="bg-red-600 text-white hover:bg-red-700 hover:text-white"
                pendingLabel="Deleting…"
              >
                Yes, delete it
              </SubmitButton>
            </form>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-[10px] px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {editing && (
        <form action={updatePromoCode} className="mt-4 border-t border-neutral-100 pt-4">
          <input type="hidden" name="id" value={promo.id} />
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor={`rep-${promo.id}`}>Salesperson</Label>
              <Input id={`rep-${promo.id}`} name="rep_name" defaultValue={promo.rep_name} required />
            </div>
            <div>
              <Label htmlFor={`comm-${promo.id}`}>Commission %</Label>
              <Input
                id={`comm-${promo.id}`}
                name="commission_percent"
                type="number"
                min={0}
                max={100}
                defaultValue={promo.commission_percent}
                required
              />
            </div>
            <div>
              <Label htmlFor={`notes-${promo.id}`}>Notes</Label>
              <Input id={`notes-${promo.id}`} name="notes" defaultValue={promo.notes ?? ""} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SubmitButton size="sm" pendingLabel="Saving…">
              Save changes
            </SubmitButton>
            <p className="text-xs leading-relaxed text-neutral-400">
              The code itself, the {promo.discount_percent}% discount and its{" "}
              {durationLabel(promo.duration_months)} duration are fixed once issued — Stripe won&apos;t
              let a discount someone already subscribed under be rewritten. To change those, turn this
              code off and create a new one. A new commission rate applies to future sales only; past
              ones keep the rate they closed at.
            </p>
          </div>
        </form>
      )}
    </Card>
  );
}
