import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { PricingCard } from "@/components/marketing/pricing-card";
import { PRICING_TIERS } from "@/lib/pricing";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { isNativeApp } from "@/lib/native/server";
import { cn } from "@/lib/cn";
import { ShowcaseVideoPlayer } from "@/components/showcase-video-player";
import { TryItWidget } from "@/components/marketing/try-it-widget";
import { HeroBackdropReel } from "@/components/marketing/hero-reel";
import { SerifNumerals } from "@/components/marketing/serif-numerals";
import { getShowcaseProof } from "@/lib/showcase";
import { brandName, uniqueBrands } from "@/components/marketing/engine-rail";
import { IMAGE_MODELS } from "@/lib/generations/providers/image-models";
import { VIDEO_MODELS } from "@/lib/generations/providers/video-models";

import type { Metadata } from "next";
import { localeAlternates } from "@/lib/i18n/metadata";

// The homepage had NO metadata export at all, so it inherited the root
// layout's `alternates: { canonical: "/" }` — which meant /es, /pt and /it
// would every one of them have declared the ENGLISH homepage as their
// canonical, telling Google to drop all three. This is the one page where
// the change is an addition rather than a conversion.
//
// Only `alternates` is set: title, description and openGraph keep inheriting
// from the root layout exactly as before. Next does NOT deep-merge
// openGraph, so setting any of it here would silently wipe the layout's
// siteName and images.
export async function generateMetadata(): Promise<Metadata> {
  return { alternates: await localeAlternates("/") };
}

// SoftwareApplication structured data, homepage-only (unlike the Organization
// block in the root layout, this describes the product itself, which only
// makes sense to attach where the product is actually being introduced).
// No aggregateRating/review/offers fields — nothing on this page shows a
// star rating or a specific price, and inventing either for the sake of a
// richer search snippet is exactly what Google's structured-data guidelines
// treat as spam, risking a manual action instead of the intended benefit.
const SOFTWARE_APPLICATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Picacho",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description: "The reliability layer for AI-generated character content.",
  url: "https://picacho.ai",
};

// ─────────────────────────────────────────────────────────────────────────
// THE DARK FRONT PAGE (operator-picked C×A merge, 2026-09-02; approved
// board on the "Picacho Front Page" canvas). The previous light homepage
// lives at git tag `pre-frontpage-redesign` — restoring it is one checkout.
//
// The page's one idea: PROOF AS THE AESTHETIC. The reel plays full-bleed
// behind the hero wearing the app's own identity plate; the thread shows
// the SAME live showcase tiles the old hero used (real generations of the
// showcase character, real match scores from their own DB rows — nothing
// baked into the repo, nothing invented); the studio section states the
// real feature set; the receipt section restates the product's money
// honesty in its own visual language.
//
// This page is ALWAYS dark regardless of the site theme, so it uses
// explicit literals (#101014 stage, #e0a468 ochre-on-dark, white alphas)
// rather than theme tokens — the same rule the app's Darkroom stage
// follows. Tokens here would flip with the theme and break the design.
// ─────────────────────────────────────────────────────────────────────────

// The one icon this page still hand-rolls (brand-rules card) — same
// inline-SVG convention as everywhere else, not an icon dependency.
function ShieldCheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

// The studio cards' small ochre glyphs, drawn once each.
function PresetIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="m4 8-1.5-3.5 15.5-2L19.5 6z" />
    </svg>
  );
}
function AnglesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3" />
    </svg>
  );
}
function StoryboardIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="6" width="5" height="12" rx="1" />
      <rect x="9.5" y="6" width="5" height="12" rx="1" />
      <rect x="15.5" y="6" width="5" height="12" rx="1" />
    </svg>
  );
}
function ClapperIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 9h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 9l1.5-4h13L20 9M8.5 5L7 9m6.5-4L12 9" />
    </svg>
  );
}
function SpeechIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 5.5h16v11H10l-5.5 4z" />
    </svg>
  );
}
function SparkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </svg>
  );
}
function PhoneIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="6" y="3" width="12" height="18" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}
function GlobeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.4-3.8-8.5s1.3-6.1 3.8-8.5z" />
    </svg>
  );
}

// The engines band names the four flagship engines by their exact
// catalogue names (video-models.ts — " (reference)" is that file's internal
// disambiguator, not part of the product name) and DERIVES the "+ n more"
// count from the same catalogues the pipeline switches on, at brand level,
// plus the two engines with no catalogue entry (ElevenLabs speech, Claude
// drafting — same pair EngineRail names by hand, next to the code that
// calls them). Rename or remove a model and the band follows; it can never
// advertise an engine Picacho doesn't run.
const ENGINE_BAND_NAMES = ["Seedance 2.0", "Kling O3 Pro", "Gemini Omni Flash 1.1", "Veo 3.1"];

// The billing toggle's "save up to {n}%" — computed from the same table the
// tickets render, so a pricing change can never strand the claim. (The flat
// "-15%" badge died with the light band: real per-tier savings run 11–20%.)
const MAX_ANNUAL_SAVE_PCT = Math.max(
  ...PRICING_TIERS.map((t) => Math.round((1 - t.annualPrice / t.price) * 100)),
);
const ENGINE_BAND_MORE = (() => {
  const all = new Set([
    ...uniqueBrands(
      [...IMAGE_MODELS, ...VIDEO_MODELS].map((m) => m.name.replace(" (reference)", "")),
    ),
    "ElevenLabs",
    "Claude",
  ]);
  const shown = new Set(ENGINE_BAND_NAMES.map(brandName));
  return [...all].filter((b) => !shown.has(b)).length;
})();

const MICRO = "text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f7f6f4]/45";
const CARD = "rounded-[16px] border border-[#f7f6f4]/[0.08] bg-[#f7f6f4]/[0.04] p-6";
const CARD_TITLE = "mt-3.5 text-base font-semibold text-[#f7f6f4]";
const CARD_COPY = "mt-2 text-sm leading-relaxed text-[#f7f6f4]/60";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
}) {
  const { t } = await getServerMessages();
  const m = t.marketing.home;
  const p = t.marketing.pricing;
  // Same URL-param billing toggle as /pricing (see the rationale there).
  const { billing } = await searchParams;
  const interval: "annual" | "month" = billing === "monthly" ? "month" : "annual";
  // No pricing UI inside the native app (Apple 3.1.1 / Google Play): the
  // "See pricing" hero link, the pricing card grid, and the "full plan
  // details" link are all omitted. Everything else on the page is unchanged.
  const native = await isNativeApp();
  // Real match_score/prompt data for the SAME rows the tiles serve
  // (shared row selection in lib/showcase.ts, service client). Best-effort:
  // on failure this comes back empty and score chips simply don't render —
  // a score is either real or absent.
  const { scores: showcaseScores, tryIt: tryItEntries } = await getShowcaseProof();
  // The hero plate's number: the first REAL score among the showcase rows.
  // No score in the data → no plate. A score is never invented for the hero.
  const plateScore = [1, 2, 3, 4, 5].map((i) => showcaseScores[i]).find((s) => s != null) ?? null;

  const STUDIO_CARDS = [
    { icon: PresetIcon, title: m.studioCameraTitle, copy: m.studioCameraCopy },
    { icon: AnglesIcon, title: m.studioAnglesTitle, copy: m.studioAnglesCopy },
    { icon: StoryboardIcon, title: m.studioStoryboardTitle, copy: m.studioStoryboardCopy },
    { icon: ClapperIcon, title: m.studioCinemaTitle, copy: m.studioCinemaCopy },
    { icon: SpeechIcon, title: m.studioDialogueTitle, copy: m.studioDialogueCopy },
    { icon: SparkIcon, title: m.studioAssistantTitle, copy: m.studioAssistantCopy },
  ];
  // The board's four output tiles: real curated renders (indices 1–4 of the
  // showcase set — index 0 is the identity photo, which lives in the hero
  // plate). Scene names describe what each curated image actually shows;
  // tile 3 is the portrait shot, cropped toward the face.
  const THREAD_TILES = [
    { index: 1, scene: m.threadScene1, crop: "" },
    { index: 2, scene: m.threadScene2, crop: "" },
    { index: 3, scene: m.threadScene3, crop: "object-[50%_12%]" },
    { index: 4, scene: m.threadScene4, crop: "" },
  ];
  const STUDIO_CHIPS = [
    m.chipTemplates,
    m.chipCasts,
    m.chipContinue,
    m.chipOutfit,
    m.chipProjects,
    m.chipCommunity,
  ];

  return (
    <div className="min-h-screen bg-[#101014]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_APPLICATION_JSON_LD) }}
      />

      {/* ── HERO — the reel plays full-bleed behind everything, including
             the header. The gradients keep the type readable over any
             frame of any clip. ─────────────────────────────────────── */}
      <section className="isolate relative overflow-hidden">
        <HeroBackdropReel
          sources={["/hero-band-4.mp4", "/hero-band.mp4", "/hero-band-2.mp4", "/hero-band-3.mp4"]}
          // Per-clip provenance, verified before it was written down:
          // hero-band-4 is the Seedance 2.0 15s space trailer (DB row,
          // 2026-08-23), hero-band-3 was committed as "operator's Seedance
          // 2.0 render, 10s" (0bee2f7). Bands 1–2 predate that record-
          // keeping, so they carry the bare truthful caption rather than a
          // guessed engine name.
          captions={[
            `Seedance 2.0 · 15s · ${m.heroClipRealOutput}`,
            m.heroClipRealOutput,
            m.heroClipRealOutput,
            `Seedance 2.0 · 10s · ${m.heroClipRealOutput}`,
          ]}
          pillLabel={m.heroPlayingReel}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(100deg,rgba(16,16,20,0.88)_0%,rgba(16,16,20,0.6)_36%,rgba(16,16,20,0.08)_64%,rgba(16,16,20,0.15)_100%),linear-gradient(0deg,#101014_0%,rgba(16,16,20,0)_22%),linear-gradient(180deg,rgba(16,16,20,0.75)_0%,rgba(16,16,20,0)_24%)]"
        />

        <div className="relative">
          <MarketingHeader dark />

          <div className="mx-auto max-w-6xl px-4 pb-40 pt-24 sm:px-8 sm:pb-48 sm:pt-32">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e0a468]">
              {m.heroKicker}
            </p>
            <h1 className="mt-4 max-w-2xl font-display text-4xl font-extrabold leading-[1.0] tracking-[-0.022em] text-[#f7f6f4] sm:text-6xl lg:text-7xl">
              {m.heroTitle} <em className="not-italic text-[#e0a468]">{m.heroAccent}</em>
            </h1>
            <p className="mt-6 max-w-[470px] text-base leading-relaxed text-[#f7f6f4]/[0.78] sm:text-[17px]">
              {m.heroSubtitle}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-[14px]">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-[10px] bg-ochre px-[30px] py-[15px] text-[15.5px] font-semibold text-[#f7f6f4] shadow-[0_14px_34px_-10px_rgba(168,78,36,0.6)] transition-colors hover:bg-ochre-deep"
              >
                {m.getStarted}
              </Link>
              {!native && (
                <Link
                  href="/#pricing"
                  className="inline-flex items-center justify-center rounded-[10px] px-6 py-[15px] text-[15.5px] font-medium text-[#f7f6f4] shadow-[inset_0_0_0_1px_rgba(247,246,244,0.3)] transition-colors hover:shadow-[inset_0_0_0_1px_rgba(247,246,244,0.55)]"
                >
                  {m.seePricing}
                </Link>
              )}
            </div>
            <p className="mt-4 text-[12.5px] text-[#f7f6f4]/55">{m.heroFreeTrialNote}</p>
          </div>

          {/* The signature: the app's identity plate, on the playing
              footage — real identity photo, real score from a real row. */}
          {plateScore !== null && (
            <div className="pointer-events-none absolute bottom-8 left-4 sm:bottom-10 sm:left-8 lg:left-[max(2rem,calc((100%-72rem)/2))]">
              <div className="flex items-center gap-3.5 rounded-[14px] border border-[#f7f6f4]/10 bg-[#101014]/[0.66] p-3.5 pr-5 backdrop-blur-[10px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/api/showcase/0"
                  alt=""
                  className="h-[46px] w-[46px] rounded-[9px] object-cover object-[50%_30%]"
                />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f7f6f4]/55">
                    {m.scoreBandMatch}
                  </p>
                  <p className="mt-0.5 flex items-baseline gap-2.5">
                    <span className="font-numeral text-[27px] font-semibold leading-none tabular-nums text-[#e0a468]">
                      {plateScore}%
                    </span>
                    <span className="text-[12.5px] text-[#f7f6f4]/[0.78]">{m.heroPlateScored}</span>
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── THE THREAD — the same live showcase tiles the old hero used:
             identity photo first, then real generations with their real
             scores. One character, every world. ─────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-8 sm:pt-[72px]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="font-display text-2xl font-bold tracking-[-0.01em] text-[#f7f6f4] sm:text-[32px]">
            {m.threadTitle}
          </h2>
          <p className="text-[13.5px] text-[#f7f6f4]/50">{m.heroRealNote}</p>
        </div>
        <div className="mt-[26px] grid grid-cols-2 gap-[14px] lg:grid-cols-4">
          {THREAD_TILES.map(({ index, scene, crop }, n) => {
            const score = showcaseScores[index] ?? null;
            return (
              <div
                key={index}
                className="relative aspect-[7/5] overflow-hidden rounded-[14px] bg-black shadow-[0_20px_50px_-24px_rgba(0,0,0,0.9)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/showcase/${index}`}
                  alt=""
                  loading={n < 2 ? "eager" : "lazy"}
                  className={cn("h-full w-full object-cover", crop)}
                />
                <span className="absolute bottom-[9px] left-[10px] text-[11px] text-[#f7f6f4]/70">
                  {scene}
                </span>
                {score !== null && (
                  <span
                    className="absolute bottom-[9px] right-[10px] rounded-[7px] bg-[#101014]/[0.72] px-2 py-[3px] font-numeral text-[12.5px] font-semibold tabular-nums text-[#e0a468]"
                    title={formatMsg(t.generate.identityMatch, { n: score })}
                    aria-label={formatMsg(t.generate.identityMatch, { n: score })}
                  >
                    {score}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-[13px] text-[#f7f6f4]/55">
          {m.threadFootnote}{" "}
          <span className="font-medium text-[#e0a468]">{m.threadFootnoteAccent}</span>
        </p>
      </section>

      {/* ── THE STUDIO — the real feature set, six cards + the brand-rules
             guarantee + the extras strip. ─────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pt-20 sm:px-8 sm:pt-24">
        <p className={MICRO}>{m.studioEyebrow}</p>
        <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.01em] text-[#f7f6f4] sm:text-[32px]">
          {m.studioTitle}
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STUDIO_CARDS.map((card) => (
            <div key={card.title} className={CARD}>
              <card.icon className="h-[22px] w-[22px] text-[#e0a468]" />
              <h3 className={CARD_TITLE}>{card.title}</h3>
              <p className={CARD_COPY}>{card.copy}</p>
            </div>
          ))}
        </div>
        {/* Brand rules — the most defensible feature in the product keeps
            its card (same strings the old differentiator section used). */}
        <div className={cn(CARD, "mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6")}>
          <ShieldCheckIcon className="h-6 w-6 flex-shrink-0 text-[#e0a468]" />
          <div>
            <h3 className="text-base font-semibold text-[#f7f6f4]">{m.diffRulesTitle}</h3>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-[#f7f6f4]/60">{m.diffRulesDetail}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {STUDIO_CHIPS.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-[#f7f6f4]/[0.12] px-3.5 py-1.5 text-xs text-[#f7f6f4]/60"
            >
              {chip}
            </span>
          ))}
        </div>
      </section>

      {/* ── ENGINES band ───────────────────────────────────────────────── */}
      <section className="mx-auto mt-20 max-w-6xl border-y border-[#f7f6f4]/[0.08] px-4 py-[26px] sm:mt-[88px] sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
          <p className={MICRO}>{m.enginesEyebrow}</p>
          <div className="flex flex-wrap items-center gap-x-[34px] gap-y-2">
            {ENGINE_BAND_NAMES.map((name) => (
              <span key={name} className="font-display text-[15.5px] font-semibold text-[#f7f6f4]/80">
                {name}
              </span>
            ))}
            <span className="text-[12.5px] text-[#f7f6f4]/45">
              {formatMsg(m.enginesMoreN, { n: ENGINE_BAND_MORE })}
            </span>
          </div>
        </div>
      </section>

      {/* ── THE RECEIPT — money honesty as a section: copy + the app's
             receipt idiom on dark glass, using the SAME strings the real
             composer renders. Stats row keeps the three claim-source-
             verified numbers from the previous page. ─────────────────── */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-20 sm:px-8 sm:pt-[88px] lg:grid-cols-2 lg:gap-14">
        <div>
          <p className={MICRO}>{t.generate.receiptTitle}</p>
          <h2 className="mt-3 font-display text-2xl font-bold leading-[1.15] tracking-[-0.02em] text-[#f7f6f4] sm:text-[34px]">
            {m.receiptSecTitle}
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#f7f6f4]/62">{m.receiptSecBody}</p>
          <div className="mt-7 flex flex-wrap gap-x-9 gap-y-5">
            {[
              [m.stat1, m.stat1Caption],
              [m.stat2, m.stat2Caption],
              [m.stat3, m.stat3Caption],
            ].map(([num, caption], i) => (
              <div key={i} className="max-w-[150px]">
                {/* Third stat in proof ochre, per the board. */}
                <p
                  className={cn(
                    "font-numeral text-[32px] font-semibold leading-none tabular-nums",
                    i === 2 ? "text-[#e0a468]" : "text-[#f7f6f4]",
                  )}
                >
                  {num}
                </p>
                <p className="mt-2 text-[11px] font-semibold uppercase leading-relaxed tracking-[0.16em] text-[#f7f6f4]/45">
                  {caption}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-[18px] border border-[#f7f6f4]/[0.09] bg-[#f7f6f4]/[0.05] shadow-[0_34px_80px_-34px_rgba(0,0,0,0.9)]">
          <div className="flex items-start gap-4 border-b border-[#f7f6f4]/[0.07] bg-[#e0a468]/[0.07] px-5 py-3.5">
            <div className="flex-shrink-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f7f6f4]/50">
                {t.generate.receiptTitle}
              </p>
              <p className="mt-0.5 text-[10.5px] text-[#f7f6f4]/35">{t.generate.receiptQuoted}</p>
            </div>
            <span aria-hidden className="mt-0.5 h-7 w-px flex-shrink-0 bg-[#f7f6f4]/10" />
            <div className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-1.5">
              <div>
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#f7f6f4]/45">
                  {t.generate.receiptFace}
                </p>
                <p className="mt-0.5 text-xs text-[#f7f6f4]/85">{t.generate.receiptSrcSaved} ✓</p>
              </div>
              <div>
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#f7f6f4]/45">
                  {t.generate.receiptDialogue}
                </p>
                <p
                  className="mt-0.5 font-numeral text-xs tabular-nums text-[#e0a468]"
                  title={formatMsg(t.generate.dialogueCreditNote, { n: 1 })}
                >
                  +{formatMsg(t.generate.creditsShortN, { n: 1 })} / 3s
                </p>
              </div>
              <div>
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#f7f6f4]/45">
                  {t.generate.totalLabel}
                </p>
                <p className="mt-0.5 font-numeral text-xs font-semibold tabular-nums text-[#f7f6f4]/90">
                  {formatMsg(t.generate.durationCredits, { n: 4 })}
                </p>
              </div>
            </div>
          </div>
          <div className="px-5 py-4">
            <p className="text-[14.5px] text-[#f7f6f4]/85">{m.receiptPromptSample}</p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full px-3 py-1.5 text-[11.5px] text-[#f7f6f4]/55 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
                  {t.generate.multiAngleLabel}
                </span>
                <span className="rounded-full px-3 py-1.5 text-[11.5px] text-[#f7f6f4]/55 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
                  {t.generate.cinemaLabel}
                </span>
                <span className="rounded-full bg-[#e0a468]/[0.12] px-3 py-1.5 text-[11.5px] text-[#e0a468] shadow-[inset_0_0_0_1px_rgba(224,164,104,0.4)]">
                  {t.generate.presetTabCamera} · Orbit
                </span>
              </div>
              <span className="inline-flex items-center gap-2 rounded-[9px] bg-[#f7f6f4] px-[18px] py-[9px] text-[13px] font-medium text-[#1c1c1e]">
                {t.generate.sendRender}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[13px] w-[13px]" aria-hidden>
                  <path d="M12 19V5m0 0l-6 6m6-6l6 6" />
                </svg>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── THE APP + THE LANGUAGES — the board's paired cards: the studio
             on Google Play (reader-mode binary — install, sign in, render;
             purchases live on the web) and the four full localizations. ── */}
      <section className="mx-auto grid max-w-6xl gap-4 px-4 pt-20 sm:grid-cols-2 sm:px-8 sm:pt-[88px]">
        {[
          { icon: PhoneIcon, title: m.appCardTitle, copy: m.appCardCopy },
          { icon: GlobeIcon, title: m.langCardTitle, copy: m.langCardCopy },
        ].map((card) => (
          <div
            key={card.title}
            className="flex items-center gap-6 rounded-[16px] border border-[#f7f6f4]/[0.08] bg-[#f7f6f4]/[0.04] p-7"
          >
            <span className="flex h-[54px] w-[54px] flex-shrink-0 items-center justify-center rounded-[14px] bg-[#e0a468]/10">
              <card.icon className="h-6 w-6 text-[#e0a468]" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-[#f7f6f4]">{card.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#f7f6f4]/60">{card.copy}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ── SHOWCASE — the two real players (the first carries AUDIO: the
             dialogue + lip-sync proof the muted hero can't give). ─────── */}
      <section className="mx-auto max-w-5xl px-4 pt-20 text-center sm:px-8 sm:pt-[88px]">
        <h2 className={MICRO}>{m.showcaseEyebrow}</h2>
        <h3 className="mx-auto mt-3 max-w-xl font-display text-2xl font-bold tracking-[-0.02em] text-[#f7f6f4]">
          {m.showcaseTitle}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-[#f7f6f4]/50">{m.showcaseSubtitle}</p>
        <div className="mx-auto mt-9 flex w-full max-w-4xl flex-col items-center gap-6 sm:flex-row sm:justify-center">
          <div className="w-full max-w-sm">
            <ShowcaseVideoPlayer
              badge={m.showcaseBadge}
              playLabel={m.showcasePlay}
              pauseLabel={m.showcasePause}
              muteLabel={m.showcaseMute}
              unmuteLabel={m.showcaseUnmute}
            />
          </div>
          <div className="w-full max-w-sm">
            {/* No mute control — this clip has no audio track (see
                showcase-video-player.tsx: omitting muteLabel/unmuteLabel
                hides the speaker button rather than showing a dead one). */}
            <ShowcaseVideoPlayer
              src="/showcase-video-2.mp4"
              poster="/showcase-poster-2.jpg"
              badge={m.showcaseBadge}
              playLabel={m.showcasePlay}
              pauseLabel={m.showcasePause}
            />
          </div>
        </div>
      </section>

      {/* ── TRY IT — the interactive proof, now on the same dark stage
             as everything else (the paper-light break died 2026-09-02:
             operator, "You left one part below in white background"). ── */}
      {tryItEntries.length >= 2 && (
        <section className="mx-auto max-w-5xl px-4 pt-20 sm:px-8 sm:pt-[88px]">
          <h2 className={cn(MICRO, "text-center")}>{m.tryItEyebrow}</h2>
          <h3 className="mx-auto mt-3 max-w-xl text-center font-display text-2xl font-bold tracking-[-0.01em] text-[#f7f6f4]">
            {m.tryItTitle}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-center text-sm text-[#f7f6f4]/50">{m.tryItSubtitle}</p>
          <div className="mx-auto mt-10 max-w-4xl">
            <TryItWidget
              dark
              entries={tryItEntries.map((e) => ({
                ...e,
                // Same crop quirk as the thread's portrait tile (full-length
                // shot — anchor near the top so the face reads in a square).
                objectPosition: e.index === 3 ? "50% 12%" : undefined,
              }))}
              labels={{
                pick: m.tryItPick,
                // Draft → Validate → Generate → Score, in the order the
                // pipeline actually runs them.
                steps: [m.tryItStepDraft, m.tryItStepValidate, m.tryItStepGenerate, m.tryItStepScore],
                match: m.scoreBandMatch,
                matchTitle: t.generate.identityMatch,
                passed: m.scoreBandPassed,
                realNote: m.tryItRealNote,
                cta: m.tryItCta,
              }}
            />
          </div>
        </section>
      )}

      {/* ── BOX OFFICE — the Ticket Wall (operator-picked board B,
             2026-09-02): five admission tickets, Growth lifted with the
             only filled CTA. The tickets are PricingCard's ticket variant,
             so checkout, portal, current-plan and EU-currency behavior are
             the same machinery /pricing runs. ─────────────────────────── */}
      {!native && (
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-8 px-4 pt-20 sm:px-8 sm:pt-[88px]">
          <div className="text-center">
            <p className={MICRO}>{m.boxOfficeEyebrow}</p>
            <h2 className="mt-4 font-display text-2xl font-bold tracking-[-0.01em] text-[#f7f6f4] sm:text-[32px]">
              {m.ticketTitle}
            </h2>
            <p className="mx-auto mt-3 max-w-[560px] text-[15px] text-[#f7f6f4]/62">{m.ticketSub}</p>
          </div>
          <div className="mt-8 flex justify-center">
            <div className="inline-flex items-center gap-1 rounded-full p-1 shadow-[inset_0_0_0_1px_rgba(247,246,244,0.12)]">
              <Link
                href="/#pricing"
                className={
                  interval === "annual"
                    ? "flex items-center gap-2 rounded-full bg-[#f7f6f4]/[0.08] px-4 py-2 text-[13px] font-semibold text-[#f7f6f4]"
                    : "flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold text-[#f7f6f4]/45 transition-colors hover:text-[#f7f6f4]"
                }
              >
                {p.billingAnnual}
                <span className="rounded-full bg-[#e0a468]/[0.14] px-2 py-0.5 font-numeral text-[11px] lowercase text-[#e0a468]">
                  {formatMsg(m.saveUpToPct, { n: MAX_ANNUAL_SAVE_PCT })}
                </span>
              </Link>
              <Link
                href="/?billing=monthly#pricing"
                className={
                  interval === "month"
                    ? "rounded-full bg-[#f7f6f4]/[0.08] px-4 py-2 text-[13px] font-semibold text-[#f7f6f4]"
                    : "rounded-full px-4 py-2 text-[13px] font-semibold text-[#f7f6f4]/45 transition-colors hover:text-[#f7f6f4]"
                }
              >
                {p.billingMonthly}
              </Link>
            </div>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:mt-12 lg:grid-cols-5 lg:gap-4 xl:-mx-24">
            {PRICING_TIERS.map((tier) => (
              <PricingCard key={tier.id} tier={tier} interval={interval} variant="ticket" />
            ))}
          </div>
          <p className="mt-11 text-center text-[13px] text-[#f7f6f4]/62">
            <SerifNumerals
              className="text-[#f7f6f4]/80"
              text={m.exchangeLine.replaceAll(" · ", "\u2002·\u2002")}
            />
          </p>
          <p className="mt-4 text-center text-[13px] text-[#f7f6f4]/45">
            {m.heroFreeTrialNote}{"  "}
            <Link href="/pricing" className="font-medium text-[#e0a468] underline decoration-[#e0a468]/40 underline-offset-4">
              {m.fullPlanDetails}
            </Link>
          </p>
        </section>
      )}

      {/* ── CLOSING — back to the dark stage: a real render behind the
             radial dim, the board's sign-off. ─────────────────────────── */}
      <section className="isolate relative overflow-hidden bg-[#101014]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/api/showcase/5"
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover opacity-[0.28]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(70%_80%_at_50%_45%,rgba(16,16,20,0.3)_0%,rgba(16,16,20,0.96)_100%)]"
        />
        <div className="relative mx-auto max-w-2xl px-4 py-24 text-center sm:px-8 sm:py-28">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e0a468]">
            {m.closingKicker}
          </p>
          <h2 className="mt-4 font-display text-3xl font-extrabold tracking-[-0.015em] text-[#f7f6f4] sm:text-5xl">
            {m.closingTitle}
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[15px] text-[#f7f6f4]/65">{m.closingSubtitle}</p>
          <Link
            href="/signup"
            className="mt-8 inline-flex items-center justify-center rounded-[10px] bg-ochre px-8 py-[15px] text-[15.5px] font-semibold text-[#f7f6f4] shadow-[0_16px_40px_-12px_rgba(168,78,36,0.65)] transition-colors hover:bg-ochre-deep"
          >
            {m.closingCta}
          </Link>
        </div>
      </section>

      <MarketingFooter dark />
    </div>
  );
}
