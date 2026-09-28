import Link from "next/link";
import { ASSISTANT_TOPUPS, topUpCheckoutHref } from "@/lib/agent/topups";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { SettingsSection } from "@/components/settings/settings-section";

// Assistant top-ups on Plan & billing (2026-09-28, operator: "When a user
// reaches 100% of monthly consumption, give them the chance to recharge by
// payment"). The same card as the credit packs above it (buy-credits-panel):
// three packs, the price in the visitor's currency, each opening the embedded
// checkout. `id="assistant-topup"` is where the assistant's "Top up" lands.
// Never rendered in the Android app (the page doesn't mount it there, and the
// checkout refuses the app anyway).
export async function AssistantTopUpPanel({ currencySymbol, balance }: { currencySymbol: string; balance: number }) {
  const { t, locale } = await getServerMessages();
  const h = t.settingsHub;
  return (
    <div id="assistant-topup" className="scroll-mt-24">
      <SettingsSection title={h.assistantTopUpTitle} description={h.assistantTopUpSubtitle}>
        {balance > 0 && (
          <p className="font-numeral text-sm tabular-nums text-atelier-ink">
            {formatMsg(h.assistantTopUpBalance, { n: balance.toLocaleString(locale) })}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {ASSISTANT_TOPUPS.map((pack) => (
            <div key={pack.id} className="flex h-full flex-col rounded-control border border-atelier-rule p-4">
              <p className="font-numeral text-lg font-semibold tabular-nums text-atelier-ink">
                {formatMsg(h.assistantTopUpUnits, { n: pack.units.toLocaleString(locale) })}
              </p>
              <p className="mt-0.5 font-numeral text-sm tabular-nums text-atelier-muted">
                {currencySymbol}
                {pack.price}
              </p>
              <div className="mt-4">
                <Link
                  href={topUpCheckoutHref(pack.id, "/app/settings")}
                  className="flex w-full items-center justify-center rounded-control bg-atelier-ink px-3 py-1.5 text-sm font-semibold text-atelier-paper transition-colors hover:bg-atelier-ink/90"
                  aria-label={`${h.assistantTopUpBuy} — ${formatMsg(h.assistantTopUpUnits, { n: pack.units.toLocaleString(locale) })}, ${currencySymbol}${pack.price}`}
                >
                  {h.assistantTopUpBuy}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}
