import { createCreditCheckoutSession } from "@/lib/stripe/actions";
import {
  CREDIT_PACKS,
  CREDIT_PACK_PRICE_IDS,
  CREDIT_PACK_PRICE_IDS_EUR,
} from "@/lib/stripe/credit-packs";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { isEUVisitor } from "@/lib/geo";

// Atelier paper sheet (the local stand-in for ui/Card): raised warm surface,
// hairline rule, control radius. Pack numerals are set in the numeral serif
// — printed-proof voice — while ochre stays reserved for meters and proof.
const SHEET = "rounded-control border border-atelier-rule bg-atelier-surface p-8";

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
    <div className={`mt-4 ${SHEET}`}>
      <h2 className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{c.title}</h2>
      <p className="mt-1 text-sm text-atelier-muted">{c.subtitle}</p>

      {purchasedCredits > 0 && (
        <p className="mt-3 rounded-control border border-atelier-rule/60 bg-atelier-paper px-3.5 py-2.5 font-numeral text-sm tabular-nums text-atelier-ink">
          {formatMsg(c.currentBalance, { n: purchasedCredits })}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {available.map((pack) => (
          <form key={pack.id} action={createCreditCheckoutSession}>
            <input type="hidden" name="pack" value={pack.id} />
            <div className="flex h-full flex-col rounded-control border border-atelier-rule p-4">
              <p className="font-numeral text-lg font-semibold tabular-nums text-atelier-ink">
                {formatMsg(c.packCredits, { n: pack.credits })}
              </p>
              <p className="mt-0.5 font-numeral text-sm tabular-nums text-atelier-muted">
                {currencySymbol}
                {pack.price}
              </p>
              <p className="mt-0.5 font-numeral text-xs tabular-nums text-atelier-muted/80">
                {currencySymbol}
                {(pack.price / pack.credits).toFixed(2)} {c.perCredit}
              </p>
              <div className="mt-4">
                <SubmitButton
                  size="sm"
                  pendingLabel={c.starting}
                  className="w-full rounded-control! bg-atelier-ink! text-atelier-paper! shadow-none! hover:bg-atelier-ink/90!"
                >
                  {c.buy}
                </SubmitButton>
              </div>
            </div>
          </form>
        ))}
      </div>

      <p className="mt-4 text-xs text-atelier-muted">{c.note}</p>
    </div>
  );
}
