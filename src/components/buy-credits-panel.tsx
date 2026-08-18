import { createCreditCheckoutSession } from "@/lib/stripe/actions";
import {
  CREDIT_PACKS,
  CREDIT_PACK_PRICE_IDS,
  CREDIT_PACK_PRICE_IDS_EUR,
} from "@/lib/stripe/credit-packs";
import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { isEUVisitor } from "@/lib/geo";

// Server component: the packs are static config and checkout is a plain
// form action, so there's nothing here that needs to be a client component.
export async function BuyCreditsPanel({
  purchasedCredits,
  currencySymbol,
}: {
  purchasedCredits: number;
  currencySymbol: string;
}) {
  const { t } = await getServerMessages();
  const c = t.credits;

  // Hide any pack THIS visitor can't actually buy rather than rendering a
  // button that can only fail — setup-credit-packs.js has to be run before
  // these work at all. Mirrors EXACTLY how createCreditCheckoutSession
  // resolves the price ((EUR if EU visitor) ?? USD): the old check showed a
  // pack when EITHER price id existed, so a pack with only a EUR price
  // rendered a Buy button for a non-EU visitor whose action then bounced
  // with "not set up yet" (the action falls back to the USD id, never the
  // EUR one, for them).
  const wantsEUR = await isEUVisitor();
  const available = CREDIT_PACKS.filter(
    (p) => (wantsEUR ? CREDIT_PACK_PRICE_IDS_EUR[p.id] : null) ?? CREDIT_PACK_PRICE_IDS[p.id],
  );

  if (available.length === 0) return null;

  return (
    <Card className="mt-4">
      <h2 className="text-sm font-semibold text-neutral-900">{c.title}</h2>
      <p className="mt-1 text-sm text-neutral-500">{c.subtitle}</p>

      {purchasedCredits > 0 && (
        <p className="mt-3 rounded-[10px] bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-700">
          {formatMsg(c.currentBalance, { n: purchasedCredits })}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {available.map((pack) => (
          <form key={pack.id} action={createCreditCheckoutSession}>
            <input type="hidden" name="pack" value={pack.id} />
            <div className="flex h-full flex-col rounded-[14px] border border-neutral-200 p-4">
              <p className="text-lg font-semibold text-neutral-900">
                {formatMsg(c.packCredits, { n: pack.credits })}
              </p>
              <p className="mt-0.5 text-sm text-neutral-500">
                {currencySymbol}
                {pack.price}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">
                {currencySymbol}
                {(pack.price / pack.credits).toFixed(2)} {c.perCredit}
              </p>
              <div className="mt-4">
                <SubmitButton size="sm" pendingLabel={c.starting} className="w-full">
                  {c.buy}
                </SubmitButton>
              </div>
            </div>
          </form>
        ))}
      </div>

      <p className="mt-4 text-xs text-neutral-400">{c.note}</p>
    </Card>
  );
}
