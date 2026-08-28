import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { isNativeApp } from "@/lib/native/server";

// Shared shell for the /compare/* pages. One competitor per page, one shape
// for both, so the comparison stays structurally identical (same rows, same
// order) no matter who is in the left column — that symmetry is part of the
// fairness story, not just DRY.
//
// Comparative-advertising rules these pages follow (and that any future
// competitor page added here must follow too):
//
//  1. Every competitor claim is verified from the competitor's OWN public
//     pricing page, the page links that source, and the copy is dated
//     ("as of August 2026"). When the source page doesn't state something,
//     the cell says "not advertised" / "not verified" rather than guessing —
//     never assert a negative about the product itself.
//  2. Competitor strengths are acknowledged for real (hero subtitle + the
//     "Choose {them} if…" column). A comparison that can't concede anything
//     isn't credible, and credibility is the whole point of these pages.
//  3. No comparison JSON-LD — inventing rich-result structured data for a
//     self-serving comparison is the kind of thing Google's guidelines
//     treat as spam (same reasoning as the homepage's deliberately minimal
//     SoftwareApplication block).
//
// Competitor names, plan names, and prices stay literal in every locale —
// only the prose around them is translated (see marketing.compare in the
// message dictionaries).
const COMPETITORS = {
  heygen: {
    name: "HeyGen",
    pricingUrl: "https://www.heygen.com/pricing",
    pricingLabel: "heygen.com/pricing",
  },
  hedra: {
    name: "Hedra",
    pricingUrl: "https://www.hedra.com/pricing",
    pricingLabel: "hedra.com/pricing",
  },
  renoise: {
    name: "Renoise",
    pricingUrl: "https://renoise.ai/pricing",
    pricingLabel: "renoise.ai/pricing",
  },
  imagineart: {
    name: "ImagineArt",
    pricingUrl: "https://www.imagine.art/pricing",
    pricingLabel: "imagine.art/pricing",
  },
  higgsfield: {
    name: "Higgsfield",
    pricingUrl: "https://higgsfield.ai/pricing",
    pricingLabel: "higgsfield.ai/pricing",
  },
} as const;

export type CompetitorId = keyof typeof COMPETITORS;

export async function ComparePage({ competitor }: { competitor: CompetitorId }) {
  const { t } = await getServerMessages();
  const c = t.marketing.compare;
  const page = c[competitor];
  const comp = COMPETITORS[competitor];
  // Chip language reused verbatim from the homepage score band ("Identity
  // match" / "Passed on attempt") — same words the product itself prints, so
  // the proof band here can't drift from what a signup actually sees.
  const home = t.marketing.home;

  // Same App Store guard as /pricing: this page is wall-to-wall prices, so
  // inside the native shell (Apple 3.1.1 / Google Play) render the minimal
  // "manage on the web" screen instead. Nothing links here in the native
  // app, but a deep link must not become a purchase entry point either.
  const native = await isNativeApp();
  if (native) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <MarketingHeader />
        <section className="mx-auto flex max-w-2xl flex-col items-center px-8 py-32 text-center">
          <h1 className="font-display text-2xl font-bold tracking-[-0.03em] text-neutral-900 sm:text-3xl">
            Picacho vs {comp.name}
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-neutral-500">
            {t.marketing.pricing.manageOnWeb}
          </p>
          <Link
            href="/app"
            className="mt-8 inline-flex items-center justify-center rounded-[10px] bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
          >
            {t.marketing.nav.goToApp}
          </Link>
        </section>
        <MarketingFooter />
      </div>
    );
  }

  // Row order tells the story deliberately: what the character fundamentally
  // IS first (the real difference), money last. Cells where we have no
  // verified competitor data use the shared "not advertised"/"not verified"
  // strings — see rule 1 above.
  const rows = [
    { label: c.rowIdentity, them: page.cellIdentity, us: c.picIdentity },
    { label: c.rowFormat, them: page.cellFormat, us: c.picFormat },
    { label: c.rowScoring, them: c.notAdvertised, us: c.picScoring },
    { label: c.rowFailures, them: c.notAdvertised, us: c.picFailures },
    { label: c.rowEntry, them: page.cellEntry, us: c.picEntry },
    { label: c.rowCost, them: page.cellCost, us: c.picCost },
    { label: c.rowWatermark, them: page.cellWatermark, us: c.picWatermark },
    { label: c.rowApi, them: c.notCompared, us: c.picApi },
  ];

  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      {/* Hero — bg-paper + slate text, same fixed-light treatment as the
          homepage hero (the site's dark-mode remap must not touch it). */}
      <section className="isolate relative overflow-hidden bg-paper">
        <div className="mx-auto max-w-3xl px-8 pb-16 pt-20 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            {c.eyebrow}
          </p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-slate-900 sm:text-5xl">
            Picacho <span className="font-normal text-slate-400">vs</span> {comp.name}
            <em className="mt-3 block text-2xl not-italic text-ochre sm:text-3xl">
              {c.heroQuestion}
            </em>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            {page.heroSubtitle}
          </p>
          <p className="mx-auto mt-5 max-w-xl text-xs leading-relaxed text-slate-500">
            {formatMsg(c.factCheck, { name: comp.name })}{" "}
            <a
              href={comp.pricingUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500"
            >
              {comp.pricingLabel}
            </a>
          </p>
        </div>
      </section>

      {/* The comparison table. A real <table> (not a styled grid) on
          purpose — row/column headers carry the semantics for screen
          readers and search engines alike. Wide content scrolls inside its
          own container; the page never scrolls sideways. */}
      <section className="mx-auto max-w-5xl px-8 py-16">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-neutral-900">
          {c.tableTitle}
        </h2>
        <div className="mt-8 overflow-x-auto rounded-[18px] border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <th
                  scope="col"
                  className="w-[22%] px-5 py-4 align-bottom text-xs font-semibold uppercase tracking-wide text-neutral-400"
                >
                  {c.colCriterion}
                </th>
                <th scope="col" className="w-[39%] px-5 py-4 align-bottom text-base font-semibold text-neutral-900">
                  {comp.name}
                </th>
                <th scope="col" className="w-[39%] px-5 py-4 align-bottom text-base font-semibold text-ochre">
                  Picacho
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-neutral-100 last:border-b-0">
                  <th
                    scope="row"
                    className="px-5 py-4 align-top text-xs font-medium leading-relaxed text-neutral-500"
                  >
                    {row.label}
                  </th>
                  <td className="px-5 py-4 align-top leading-relaxed text-neutral-600">
                    {row.them}
                  </td>
                  <td className="px-5 py-4 align-top leading-relaxed text-neutral-800">
                    {row.us}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* "Credits" mean different things on every platform — comparing the
            raw numbers would flatter whoever inflates their denominations,
            so the table explicitly disclaims it. */}
        <p className="mx-auto mt-4 max-w-2xl text-center text-xs leading-relaxed text-neutral-400">
          {c.creditsNote}
        </p>
      </section>

      {/* "Choose them / choose us" — genuinely two-sided. The competitor's
          column comes first and concedes real strengths; the Picacho card
          gets the same quiet ochre ring the highlighted pricing card uses,
          nothing louder. */}
      <section className="mx-auto max-w-5xl px-8 pb-16">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-[18px] border border-neutral-100 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <h3 className="text-base font-semibold text-neutral-900">
              {formatMsg(c.chooseThemTitle, { name: comp.name })}
            </h3>
            <ul className="mt-4 space-y-2.5">
              {page.chooseThem.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-neutral-600">
                  <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-neutral-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[18px] border border-neutral-100 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ring-1 ring-ochre">
            <h3 className="text-base font-semibold text-neutral-900">{c.choosePicachoTitle}</h3>
            <ul className="mt-4 space-y-2.5">
              {page.choosePicacho.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-neutral-600">
                  <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-ochre" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Scored-output proof band — the homepage score band restated here,
          reusing its exact chip strings (scoreBandMatch / scoreBandPassed)
          and the same 92% / 1-of-3 figures, so the claim on a comparison
          page can never say more than the homepage does. */}
      <section className="bg-ink">
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-8 py-14 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-[-0.03em] text-paper sm:text-3xl">
              {c.proofTitle}
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">{c.proofBody}</p>
          </div>
          <div className="rounded-[14px] bg-white/[0.06] p-5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{home.scoreBandMatch}</span>
              <span className="font-semibold text-paper">92%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[92%] rounded-full bg-ochre" />
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
              <span>{home.scoreBandPassed}</span>
              <span className="font-semibold text-paper">1 / 3</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA — signup first, pricing as the quieter second path. */}
      <section className="mx-auto max-w-2xl px-8 py-20 text-center">
        <h2 className="font-display text-3xl font-bold tracking-[-0.03em] text-neutral-900">
          {c.ctaTitle}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-neutral-500">{c.ctaSubtitle}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-[10px] bg-ochre px-6 py-3 text-sm font-semibold text-white shadow-[0_1px_1px_rgba(0,0,0,0.08)] transition-colors hover:bg-ochre-deep"
          >
            {c.ctaSignup}
          </Link>
          <Link
            href="/pricing"
            className="text-sm font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-neutral-500"
          >
            {c.ctaPricing}
          </Link>
        </div>
      </section>

      {/* Sources & fairness footnote — the dated citation the whole page
          leans on, plus what "not advertised" does and doesn't mean, plus
          the trademark disclaimer. */}
      <section className="mx-auto max-w-3xl px-8 pb-16">
        <div className="rounded-[18px] border border-neutral-100 bg-white p-5 text-xs leading-relaxed text-neutral-400">
          <p className="font-medium text-neutral-500">{c.sourcesTitle}</p>
          <p className="mt-2">
            {formatMsg(c.sourceLine, { name: comp.name })}{" "}
            <a
              href={comp.pricingUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500"
            >
              {comp.pricingLabel}
            </a>{" "}
            ({c.asOfNote}).
          </p>
          <p className="mt-2">{c.footnoteChange}</p>
          <p className="mt-2">{c.footnoteNotAdvertised}</p>
          <p className="mt-2">{formatMsg(c.trademarkNote, { name: comp.name })}</p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
