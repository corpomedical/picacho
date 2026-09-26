import { formatMsg } from "@/lib/i18n/format";
import type { PressQuote, QuoteRow } from "@/lib/press-tour/campaign-types";
import { nextSpend } from "@/lib/press-tour/door-view";
import { cn } from "@/lib/cn";
import type { PressWords } from "./verdict";

// THE QUOTE (N3: one money grammar, sent by the server, printed by every
// surface). Every number here is a field of PressQuote, printed as it came;
// the card adds nothing up. Its policy line is chosen by quote.policy: the
// launch state (reshoot "off", no refund) says what a miss really means.
// Words for a re-shoot or a refund policy arrive with their own switches
// and the operator's yes (synthesis §3.4 Cut 9); until then no such line
// exists, so nothing here can promise one.

export function QuoteCard({ quote, stills, shotSeconds, m }: { quote: PressQuote; stills: number; shotSeconds: number | null; m: PressWords }) {
  const next = nextSpend(quote);
  const row = (key: QuoteRow["key"]) => quote.rows.find((r) => r.key === key) ?? null;
  const stillsRow = row("stills");
  const filmRow = row("film");

  const value = (r: QuoteRow | null) => {
    if (!r) return "";
    if (quote.trial) return m.onUs;
    if (r.credits === 0) return m.included;
    const credits = formatMsg(m.creditsShort, { n: r.credits });
    return r.paid ? `${credits} · ${m.paid}` : credits;
  };

  const due = next === "paint" ? quote.paint : next === "film" ? quote.animate : null;
  // The free first ad repaints nothing (critique #10): no repaint line there.
  // Before painting, what a still's miss means; once the stills are painted,
  // what a filmed shot's miss means (operator, 2026-09-26: keep it, cut it,
  // or film it again at the normal price).
  const policy = !quote.trial && quote.policy.reshoot === "off" && !quote.policy.refund ? (next === "paint" ? m.policyOff : m.policyFilm) : null;

  return (
    <section aria-labelledby="press-quote" className="rounded-2xl bg-[rgba(255,255,255,0.03)] px-4 pb-3 pt-3 ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
      <h2 id="press-quote" className="font-slate text-[11px] font-medium uppercase tracking-[0.12em] text-[#858994]">
        {m.quoteLabel}
      </h2>
      <dl className="mt-1.5 text-[12.5px] leading-[1.35]">
        {stillsRow && (
          <QuoteLine
            label={formatMsg(stillsRow.paid ? m.rowStillsPaid : m.rowStills, { n: stills })}
            value={value(stillsRow)}
            quiet={stillsRow.paid}
          />
        )}
        {filmRow && (
          <QuoteLine
            label={shotSeconds ? formatMsg(m.rowFilm, { n: stills, s: shotSeconds }) : formatMsg(m.rowFilmShots, { n: stills })}
            value={value(filmRow)}
            quiet={filmRow.paid}
          />
        )}
        {row("checks") && <QuoteLine label={m.rowChecks} value={value(row("checks"))} />}
        {row("posting") && <QuoteLine label={m.rowPosting} value={value(row("posting"))} />}
        {!quote.trial && (
          <div className="flex items-baseline justify-between gap-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <dt className="font-medium text-[#ecedf1]">
              {m.wholeAd}{" "}
              <span className="font-normal text-[#858994]">
                {formatMsg(stillsRow?.paid ? m.wholeFilmNext : m.wholePaintFirst, { paint: quote.paint, film: quote.animate })}
              </span>
            </dt>
            <dd className="font-slate whitespace-nowrap text-[11.5px] tracking-[0.02em] text-[#c6c9d1]">
              {formatMsg(m.creditsShort, { n: quote.total })}
            </dd>
          </div>
        )}
      </dl>
      {policy && <p className="mt-1.5 text-[11.5px] leading-[1.42] text-[#b9b2a6]">{policy}</p>}
      {due !== null && (
        <>
          <div className="mt-2 flex items-end justify-between pt-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
            <span className="font-slate mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[#858994]">{next === "paint" ? m.toPaint : m.toFilm}</span>
            {quote.trial ? (
              <span className="font-numeral text-2xl leading-none text-[#ecedf1]">{m.onUs}</span>
            ) : (
              <span className="font-numeral text-[36px] leading-[0.85] tabular-nums text-[#ecedf1]">
                {due}
                <small className="ml-1 font-sans text-[13px] text-[#9aa0ad]">{m.creditsUnit}</small>
              </span>
            )}
          </div>
          {!quote.trial && (
            <p className="mt-1.5 text-xs text-[#9aa0ad]">
              {formatMsg(next === "paint" ? m.balancePaint : m.balanceFilm, { now: quote.balanceNow, after: quote.balanceAfterNextStep })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function QuoteLine({ label, value, quiet }: { label: string; value: string; quiet?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5 py-1 [&+&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <dt className="text-[#9aa0ad]">{label}</dt>
      <dd className={cn("font-slate whitespace-nowrap text-[11.5px] tracking-[0.02em]", quiet ? "text-[#858994]" : "text-[#c6c9d1]")}>{value}</dd>
    </div>
  );
}
