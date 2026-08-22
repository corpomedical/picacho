import Link from "next/link";
import { EngineRail } from "@/components/marketing/engine-rail";
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
import { HeroReel } from "@/components/marketing/hero-reel";
import { getShowcaseProof } from "@/lib/showcase";

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

// Small hand-rolled icons for the feature mockups below — same inline-SVG
// convention used everywhere else in the app (see download-button.tsx,
// result-actions.tsx, etc.), not a new icon dependency.
function SendIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m5 12 14-8-5 8 5 8-14-8Z" />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// "This is where generated media would be" glyph — used inside the two
// media-placeholder mockups (Validate/Result) below. Went through two bad
// tries before this: a rect+circle+jagged-line combo that read as the
// browser's own broken-image icon, then a 4-point sparkle that turned out
// to be a near-exact match for Gemini's logo. This is a plain play-in-a-
// circle instead — the same generic "media preview" glyph used all over
// the web (and already used for video thumbnails elsewhere in this app,
// see media-gallery.tsx's PlayIcon), tied to no particular brand.
function TwoModelsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="7" cy="12" r="4" />
      <circle cx="17" cy="12" r="4" />
    </svg>
  );
}

function ShieldCheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3 4.5 6v5c0 4.5 3 8.3 7.5 10 4.5-1.7 7.5-5.5 7.5-10V6L12 3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function LayersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  );
}

// Animated color-blob background for the hero and closing-CTA sections —
// see the wallpaper-drift-* keyframes in globals.css. Third pass used
// stronger tints at 70-80% opacity, which read as too
// bold/saturated. This pass lightens every blob a step or two (200s instead
// of 300-400s), drops opacity further, and blurs a bit more for a soft,
// pastel wash rather than distinct colored circles — still animated, just
// gentler. mix-blend-multiply (not screen) is still the right pairing for a
// light base — screen only lightens further, which would wash blues out to
// near-invisible on white.
//
// The wrapping <section> this renders into (see below) carries `isolate` —
// without it, mix-blend-multiply composites against the whole page's
// stacking context instead of just this section, which Chrome tends to
// paper over but Safari does not: real report, 2026-08-08, "the homepage
// looks nothing like the original in Safari" turned out to be blend-mode
// compositing without an isolated stacking context, not a Safari-only bug
// so much as Safari correctly following the spec where Chrome was lenient.
function LiveWallpaper() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="animate-wallpaper-a absolute -left-[15%] -top-[25%] h-[600px] w-[600px] rounded-full bg-orange-200 opacity-50 mix-blend-multiply blur-[95px]" />
      <div className="animate-wallpaper-b absolute -right-[12%] -top-[15%] h-[560px] w-[560px] rounded-full bg-amber-200 opacity-45 mix-blend-multiply blur-[95px] [animation-delay:-3s]" />
      <div className="animate-wallpaper-c absolute left-[28%] top-[5%] h-[500px] w-[500px] rounded-full bg-cyan-100 opacity-50 mix-blend-multiply blur-[95px] [animation-delay:-6s]" />
      <div className="animate-wallpaper-b absolute -bottom-[30%] right-[18%] h-[520px] w-[520px] rounded-full bg-rose-100 opacity-45 mix-blend-multiply blur-[95px] [animation-delay:-9s]" />
      <div className="animate-wallpaper-a absolute -bottom-[25%] left-[8%] h-[480px] w-[480px] rounded-full bg-amber-100 opacity-50 mix-blend-multiply blur-[95px] [animation-delay:-5s]" />
    </div>
  );
}

// The four mockups below are original, abstract illustrations of Picacho's
// actual draft → review → generate → validate pipeline (see pipeline.ts) —
// not screenshots of the real UI, and not stand-ins for real customer
// content. "Nova" is the same example name already used as the character-
// name placeholder in the character form, kept consistent here rather than
// inventing a new one.

type HomeMessages = Awaited<ReturnType<typeof getServerMessages>>["t"]["marketing"]["home"];
type ComposerPlaceholder = Awaited<ReturnType<typeof getServerMessages>>["t"]["dashboard"]["composerPlaceholder"];

function ComposerMockup({ m, composerPlaceholder }: { m: HomeMessages; composerPlaceholder: ComposerPlaceholder }) {
  return (
    <div className="rounded-[18px] border border-neutral-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_20px_44px_-18px_rgba(0,0,0,0.14)]">
      <div className="flex items-center gap-2 text-xs font-medium text-neutral-400">
        <span className="h-2 w-2 rounded-full bg-neutral-300" />
        Nova
      </div>
      <p className="mt-3 text-sm leading-relaxed text-neutral-700">&ldquo;{m.mockupQuote}&rdquo;</p>
      <div className="mt-4 flex items-center justify-between rounded-[12px] border border-neutral-100 bg-neutral-50 px-3.5 py-2.5">
        <span className="text-xs text-neutral-400">{composerPlaceholder}</span>
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 text-white">
          <SendIcon className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
  );
}

function RulebookMockup({ m }: { m: HomeMessages }) {
  const traits = [m.mockupTraitHair, m.mockupTraitOutfit, m.mockupTraitPersonality];
  return (
    <div className="rounded-[18px] border border-neutral-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_20px_44px_-18px_rgba(0,0,0,0.14)]">
      <p className="text-xs font-medium text-neutral-400">{m.mockupRulebookTitle}</p>
      <div className="mt-3 space-y-2">
        {traits.map((trait) => (
          <div key={trait} className="flex items-center gap-2.5 rounded-[10px] bg-neutral-50 px-3 py-2.5 text-xs text-neutral-600">
            <CheckIcon className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
            {trait}
          </div>
        ))}
      </div>
    </div>
  );
}

function ValidateMockup({ m }: { m: HomeMessages }) {
  const checks = [m.mockupCheckHair, m.mockupCheckOutfit, m.mockupCheckMotion];
  return (
    <div className="rounded-[18px] border border-neutral-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_20px_44px_-18px_rgba(0,0,0,0.14)]">
      {/* Third pass on this panel (2026-08-21, operator: still reads as an
          empty image): abstract dark surfaces keep failing no matter how
          they're dressed, so it now shows the REAL thing — the showcase's
          cooking render, which is genuinely the 92% row (see lib/showcase.ts
          index 3), under the scan bar and the same identity-match chip the
          product prints. The chip's number stopped being decoration. */}
      <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-neutral-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/api/showcase/3" alt="" className="h-full w-full object-cover object-[50%_25%]" />
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950/45 via-transparent to-transparent" />
        <div className="scan-sweep pointer-events-none absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-white/25 to-transparent" />
        <span className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-neutral-800 shadow-sm">
          {m.scoreBandMatch}
          <span className="text-ochre">92%</span>
        </span>
      </div>
      <div className="mt-4 space-y-1.5">
        {checks.map((check) => (
          <div key={check} className="flex items-center gap-2 text-xs text-neutral-500">
            <CheckIcon className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
            {check}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultMockup({ m }: { m: HomeMessages }) {
  return (
    <div className="rounded-[18px] border border-neutral-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_20px_44px_-18px_rgba(0,0,0,0.14)]">
      {/* Real output here too (2026-08-21, same operator report as the
          validate panel): the reel's own Seedance clip loops quietly behind
          the badge instead of a glyph on an empty box — "the good one you
          see" IS one. */}
      <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-neutral-900">
        <video
          src="/hero-band-3.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden
          className="h-full w-full object-cover"
        />
        <span className="absolute left-3 top-3 rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-medium text-white">
          {m.mockupPassedBadge}
        </span>
      </div>
      <p className="mt-3 text-xs text-neutral-400 line-through decoration-neutral-300">
        {m.mockupHiddenAttempts}
      </p>
    </div>
  );
}

// Always render fresh, never serve a CDN-cached copy. These marketing/legal
// pages were getting stuck: after a deploy, one hostname (picacho.ai) kept
// serving a weeks-old prerendered copy while others served the new build,
// because the pages were statically cacheable and a stale per-host edge copy
// never got evicted. force-dynamic makes every request render on the server,
// so a stale copy can't be served and the content always matches the deploy.
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
}) {
  const { t } = await getServerMessages();
  const m = t.marketing.home;
  const p = t.marketing.pricing;
  // Same URL-param billing toggle as /pricing (see the rationale there) —
  // added 2026-08-19: this section used to show annual prices with a struck
  // monthly figure and NO way to see monthly, so "$8/mo" met "$9" at
  // checkout for anyone who never found the toggle on /pricing. The #pricing
  // anchor keeps the page from jumping back to the hero on switch (the page
  // is force-dynamic, so the toggle is a full server render).
  const { billing } = await searchParams;
  const interval: "annual" | "month" = billing === "monthly" ? "month" : "annual";
  // No pricing UI inside the native app (Apple 3.1.1 / Google Play): the
  // "See pricing" hero link, the pricing card grid, and the "full plan
  // details" link are all omitted. Everything else on the page is unchanged.
  const native = await isNativeApp();
  // Real match_score/prompt data for the SAME rows the hero grid serves
  // (shared row selection in lib/showcase.ts, service client — the rows
  // belong to the showcase owner, not the visitor). Best-effort: on any
  // failure this comes back empty and the score chips + "Try it" section
  // below simply don't render — a score is either real or absent.
  const { scores: showcaseScores, tryIt: tryItEntries } = await getShowcaseProof();

  const STEPS = [
    {
      title: m.step1Title,
      detail: m.step1Detail,
      mockup: <ComposerMockup m={m} composerPlaceholder={t.dashboard.composerPlaceholder} />,
    },
    { title: m.step2Title, detail: m.step2Detail, mockup: <RulebookMockup m={m} /> },
    { title: m.step3Title, detail: m.step3Detail, mockup: <ValidateMockup m={m} /> },
    { title: m.step4Title, detail: m.step4Detail, mockup: <ResultMockup m={m} /> },
  ];

  return (
    <div className="min-h-screen bg-neutral-50">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_APPLICATION_JSON_LD) }}
      />
      <MarketingHeader />

      {/* Hero — bg-paper (not bg-white/bg-neutral-50, both of which the
          theme remaps to a dark shade under .dark) so this section stays
          genuinely light regardless of the site's own light/dark toggle,
          same anchoring idea as the earlier dark version just flipped. Text
          uses slate (never remapped by dark mode) rather than neutral/ink
          for the same reason. */}
      {/* Hero — "Ochre & Grotesk" theme (see the pre-theme-ochre git tag
          for the previous centered version). Asymmetric on purpose:
          headline left, PROOF right — a real character's identity photo
          plus genuinely generated scenes of her, served from her gallery
          via /api/showcase/[i]. Slate/sky/explicit colors here, never the
          neutral scale, so the dark-mode remap can't touch the marketing
          hero. */}
      <section className="isolate relative overflow-hidden bg-paper">
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-8 pb-20 pt-24 lg:grid-cols-[1.05fr_.95fr] sm:pt-28">
          <div>
            <h1 className="font-display text-4xl font-bold leading-[1.02] tracking-[-0.035em] text-slate-900 sm:text-6xl">
              {m.heroTitle} <em className="not-italic text-ochre">{m.heroAccent}</em>
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-slate-600 sm:text-lg">
              {m.heroSubtitle}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-[10px] bg-ochre px-6 py-3 text-sm font-semibold text-white shadow-[0_1px_1px_rgba(0,0,0,0.08)] transition-colors hover:bg-ochre-deep"
              >
                {m.getStarted}
              </Link>
              {!native && (
                <Link
                  href="/pricing"
                  className="text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 transition-colors hover:decoration-slate-500"
                >
                  {m.seePricing}
                </Link>
              )}
            </div>
            {/* The trial exists in the product (a free generation every day,
                no card) but was invisible on the marketing site — the single
                cheapest conversion lever there is. One quiet line, right
                where the decision happens. */}
            <p className="mt-4 text-sm text-slate-500">{m.heroFreeTrialNote}</p>
          </div>

          {/* Same face, six real tiles: [0] is Eva's identity photo (badged),
              the rest are images Picacho actually generated of her. No stock,
              no mockups — the product's own output is the pitch. */}
          <div>
            <div className="grid grid-cols-3 gap-2.5">
              {[0, 1, 2, 3, 4, 5].map((i) => {
                // The tile's REAL vision score, read from the same DB row
                // the image itself comes from (lib/showcase.ts). null —
                // reference-gallery tiles have no generations row, and a
                // row without a numeric match_score stays chipless too —
                // renders nothing: no score is ever invented for the hero.
                const score = i === 0 ? null : (showcaseScores[i] ?? null);
                return (
                  <div
                    key={i}
                    className="relative aspect-square overflow-hidden rounded-[12px] bg-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/showcase/${i}`}
                      alt=""
                      loading={i < 3 ? "eager" : "lazy"}
                      className={cn(
                        "h-full w-full object-cover",
                        // Tile 3 is the full-length cooking-show shot; square-
                        // cropping it from the centre would land on the plate.
                        // Anchoring near the top keeps it chest-up, so her face
                        // still reads at this size.
                        i === 3 && "object-[50%_12%]",
                      )}
                    />
                    {i === 0 && (
                      <span className="absolute bottom-1.5 left-1.5 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-slate-800 shadow-sm">
                        {m.heroIdentityPhoto}
                      </span>
                    )}
                    {score !== null && (
                      <span
                        className="absolute bottom-1.5 left-1.5 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-slate-800 shadow-sm"
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
            <p className="mt-3 text-center text-xs text-slate-400">{m.heroRealNote}</p>
          </div>
        </div>

        {/* Full-width motion band (operator-placed, 2026-08-19): real
            Picacho renders of the same hero character, edge to edge, directly
            under the still grid — the stills claim identity, this shows it
            MOVING. Grew from one clip to a two-clip reel the same day; the
            sequencing lives in HeroReel (each clip plays to the end, then
            the next, looping the set forever). Both files are 1280x720
            transcodes of the operator's 1080p originals (~8MB + ~7MB),
            served from public/. The chip reuses the showcase badge — same
            claim, same words. */}
        {/* Third clip added 2026-08-21: the operator's Seedance 2.0 render —
            the reel now also demos the newest catalog model. Same 1280x720
            10s shape as the first two. */}
        <HeroReel
          sources={["/hero-band.mp4", "/hero-band-2.mp4", "/hero-band-3.mp4"]}
          badge={m.showcaseBadge}
        />

        {/* Engine rail — the models Picacho actually runs, named for the
            first time on the marketing site. Sits between the hero's proof
            and the numbers because it answers the question the photos
            provoke: "generated with what?" */}
        <EngineRail />

        {/* Proof band — three verifiable numbers, ruled like a spec sheet. */}
        <div className="border-y border-slate-200">
          <div className="mx-auto grid max-w-6xl sm:grid-cols-3">
            {[
              [m.stat1, m.stat1Caption],
              [m.stat2, m.stat2Caption],
              [m.stat3, m.stat3Caption],
            ].map(([num, caption], i) => (
              <div
                key={i}
                className={
                  "px-8 py-7" + (i > 0 ? " border-t border-slate-200 sm:border-l sm:border-t-0" : "")
                }
              >
                <div className="font-display text-3xl font-bold tracking-[-0.03em] text-slate-900">
                  {num}
                </div>
                <p className="mt-1.5 max-w-[240px] text-xs leading-relaxed text-slate-500">{caption}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Dark score band — the product's honesty, restated as design. */}
        <div className="bg-ink">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-8 py-14 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-[-0.03em] text-paper sm:text-3xl">
                {m.scoreBandTitle}
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">{m.scoreBandBody}</p>
            </div>
            <div className="rounded-[14px] bg-white/[0.06] p-5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{m.scoreBandMatch}</span>
                <span className="font-semibold text-paper">92%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-[92%] rounded-full bg-ochre" />
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                <span>{m.scoreBandPassed}</span>
                <span className="font-semibold text-paper">1 / 3</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* "Try it" — the score band above states the claim; this lets a
          visitor act it out. Every prompt, image and score in the widget is
          a real stored generation from the showcase character (same rows as
          the hero grid — lib/showcase.ts), replayed with a short pipeline
          trace; the widget's own footnote says so. Renders only when at
          least two rows genuinely qualify (image + prompt + score) —
          otherwise the section is absent entirely, never padded with
          placeholders. */}
      {tryItEntries.length >= 2 && (
        <section className="mx-auto max-w-5xl px-8 pt-16">
          <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-neutral-400">
            {m.tryItEyebrow}
          </h2>
          <h3 className="mx-auto mt-3 max-w-xl text-center text-2xl font-semibold tracking-tight text-neutral-900">
            {m.tryItTitle}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-center text-sm text-neutral-500">{m.tryItSubtitle}</p>
          <div className="mx-auto mt-10 max-w-4xl">
            <TryItWidget
              entries={tryItEntries.map((e) => ({
                ...e,
                // Same crop quirk as hero tile 3 (full-length shot — anchor
                // near the top so the face reads in a square box).
                objectPosition: e.index === 3 ? "50% 12%" : undefined,
              }))}
              labels={{
                pick: m.tryItPick,
                steps: [m.tryItStepDraft, m.tryItStepReview, m.tryItStepValidate, m.tryItStepScore],
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

      {/* Differentiators — what Picacho does that a single-shot "type a
          prompt, get an image" tool doesn't: two AI models checking each
          other's work on the prompt, and one character reused across
          formats most competitors don't support at all (multi-angle video,
          multi-character scenes, lip-synced dialogue). Sits right under the
          hero since these are the two things most worth a visitor knowing
          before they scroll further. */}
      <section className="mx-auto max-w-5xl px-8 pt-16">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-[18px] border border-neutral-100 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
            <TwoModelsIcon className="h-6 w-6 text-ochre" />
            <h3 className="mt-4 text-base font-semibold text-neutral-900">{m.diffModelsTitle}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">{m.diffModelsDetail}</p>
          </div>
          <div className="rounded-[18px] border border-neutral-100 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
            <LayersIcon className="h-6 w-6 text-ochre" />
            <h3 className="mt-4 text-base font-semibold text-neutral-900">{m.diffFormatsTitle}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">{m.diffFormatsDetail}</p>
          </div>
          {/* Brand rules are the most defensible thing in the product —
              require/forbid rules with block/warn severity, enforced by the
              validation gate — and until now they weren't mentioned anywhere
              on the marketing site. */}
          <div className="rounded-[18px] border border-neutral-100 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)] sm:col-span-2 lg:col-span-1">
            <ShieldCheckIcon className="h-6 w-6 text-ochre" />
            <h3 className="mt-4 text-base font-semibold text-neutral-900">{m.diffRulesTitle}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">{m.diffRulesDetail}</p>
          </div>
        </div>
      </section>

      {/* Showcase — an actual Picacho result, not another illustration. The
          four mockups above and below are deliberately abstract; this is the
          one spot on the page with real proof. Framed with a soft animated
          glow (reusing the same wallpaper-drift keyframes, just toned way
          down) so it feels like a deliberate spotlight rather than a plain
          embedded file. */}
      <section className="mx-auto max-w-5xl px-8 pt-24 text-center">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {m.showcaseEyebrow}
        </h2>
        <h3 className="mx-auto mt-3 max-w-xl text-2xl font-semibold tracking-tight text-neutral-900">
          {m.showcaseTitle}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">{m.showcaseSubtitle}</p>

        <div className="mx-auto mt-10 flex w-full max-w-4xl flex-col items-center gap-6 sm:flex-row sm:justify-center">
          <div className="relative w-full max-w-sm">
            <div aria-hidden className="isolate pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
              <div className="animate-wallpaper-a absolute -left-[10%] -top-[10%] h-[260px] w-[260px] rounded-full bg-orange-200 opacity-60 mix-blend-multiply blur-[70px]" />
              <div className="animate-wallpaper-b absolute -bottom-[10%] -right-[10%] h-[260px] w-[260px] rounded-full bg-amber-200 opacity-60 mix-blend-multiply blur-[70px] [animation-delay:-4s]" />
            </div>
            <ShowcaseVideoPlayer
              badge={m.showcaseBadge}
              playLabel={m.showcasePlay}
              pauseLabel={m.showcasePause}
              muteLabel={m.showcaseMute}
              unmuteLabel={m.showcaseUnmute}
            />
          </div>
          <div className="relative w-full max-w-sm">
            <div aria-hidden className="isolate pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
              <div className="animate-wallpaper-b absolute -left-[10%] -top-[10%] h-[260px] w-[260px] rounded-full bg-amber-200 opacity-60 mix-blend-multiply blur-[70px] [animation-delay:-2s]" />
              <div className="animate-wallpaper-a absolute -bottom-[10%] -right-[10%] h-[260px] w-[260px] rounded-full bg-orange-200 opacity-60 mix-blend-multiply blur-[70px] [animation-delay:-6s]" />
            </div>
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

      <section className="mx-auto max-w-5xl px-8 py-24">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {m.howItWorks}
        </h2>
        <div className="mt-16 space-y-20">
          {STEPS.map((step, idx) => (
            <div key={step.title} className="grid items-center gap-8 sm:grid-cols-2 sm:gap-14">
              <div className={cn(idx % 2 === 1 && "sm:order-2")}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">
                  {idx + 1}
                </span>
                <h3 className="mt-4 text-2xl font-semibold tracking-tight text-neutral-900">{step.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-neutral-500">{step.detail}</p>
              </div>
              <div className={cn(idx % 2 === 1 && "sm:order-1")}>{step.mockup}</div>
            </div>
          ))}
        </div>
      </section>

      {!native && (
        // max-w-6xl + a 5-column top break, same as /pricing (2026-08-19):
        // the Basic tier made it five cards, and five into lg:grid-cols-4
        // left one orphaned on its own row.
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-8 px-8 pb-24">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-neutral-900">
            {m.pricingHeading}
          </h2>
          <div className="mt-8 flex justify-center">
            <div className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white p-1">
              <Link
                href="/#pricing"
                className={
                  interval === "annual"
                    ? "flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white"
                    : "rounded-full px-4 py-1.5 text-sm text-neutral-500 hover:text-neutral-900"
                }
              >
                {p.billingAnnual}
                {/* Matches the real annualPrice discount in lib/pricing.ts
                    (~15% since 2026-08-19) — change together with /pricing. */}
                <span
                  className={
                    interval === "annual"
                      ? "rounded-full bg-ochre px-1.5 py-0.5 text-[10px] font-semibold text-white"
                      : "hidden"
                  }
                >
                  -15%
                </span>
              </Link>
              <Link
                href="/?billing=monthly#pricing"
                className={
                  interval === "month"
                    ? "rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white"
                    : "rounded-full px-4 py-1.5 text-sm text-neutral-500 hover:text-neutral-900"
                }
              >
                {p.billingMonthly}
              </Link>
            </div>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {PRICING_TIERS.map((tier) => (
              <PricingCard key={tier.id} tier={tier} interval={interval} />
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-neutral-500">
            <Link href="/pricing" className="font-medium text-neutral-900 underline">
              {m.fullPlanDetails}
            </Link>
          </p>
        </section>
      )}

      {/* Final CTA — the light bookend to the hero above, same fixed
          bg-paper treatment for the same reason. */}
      <section className="isolate relative overflow-hidden bg-paper">
        <LiveWallpaper />
        <div className="relative mx-auto max-w-2xl px-8 py-24 text-center">
          <h2 className="font-display text-3xl font-bold tracking-[-0.03em] text-slate-900 sm:text-4xl">{m.ctaTitle}</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-slate-600">{m.ctaSubtitle}</p>
          <Link
            href="/signup"
            className="mt-8 inline-flex items-center justify-center rounded-[10px] bg-ochre px-6 py-3 text-sm font-medium text-white shadow-[0_1px_1px_rgba(0,0,0,0.08)] transition-colors hover:bg-ochre-deep"
          >
            {m.getStarted}
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
