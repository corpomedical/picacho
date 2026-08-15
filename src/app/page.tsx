import Link from "next/link";
import { InstallBadges } from "@/components/install-badges";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { PricingCard } from "@/components/marketing/pricing-card";
import { PRICING_TIERS } from "@/lib/pricing";
import { getServerMessages } from "@/lib/i18n/server";
import { cn } from "@/lib/cn";
import { ShowcaseVideoPlayer } from "@/components/showcase-video-player";

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
function MediaGlyphIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

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
      <div className="flex aspect-video w-full items-center justify-center rounded-[12px] bg-gradient-to-br from-neutral-200 to-neutral-100">
        <MediaGlyphIcon className="h-8 w-8 text-neutral-400" />
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
      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-[12px] bg-gradient-to-br from-neutral-800 via-neutral-700 to-neutral-600">
        <MediaGlyphIcon className="h-8 w-8 text-neutral-400" />
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

export default async function Home() {
  const { t } = await getServerMessages();
  const m = t.marketing.home;

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
              <Link
                href="/pricing"
                className="text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 transition-colors hover:decoration-slate-500"
              >
                {m.seePricing}
              </Link>
            </div>
            {/* The trial exists in the product (5 free generations, no card)
                but was invisible on the marketing site — the single cheapest
                conversion lever there is. One quiet line, right where the
                decision happens. */}
            <p className="mt-4 text-sm text-slate-500">{m.heroFreeTrialNote}</p>
            <InstallBadges />
          </div>

          {/* Same face, six real tiles: [0] is Eva's identity photo (badged),
              the rest are images Picacho actually generated of her. No stock,
              no mockups — the product's own output is the pitch. */}
          <div>
            <div className="grid grid-cols-3 gap-2.5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
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
                </div>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-slate-400">{m.heroRealNote}</p>
          </div>
        </div>

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

      <section className="mx-auto max-w-5xl px-8 pb-24">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-neutral-900">
          {m.pricingHeading}
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING_TIERS.map((tier) => (
            <PricingCard key={tier.id} tier={tier} />
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-neutral-500">
          <Link href="/pricing" className="font-medium text-neutral-900 underline">
            {m.fullPlanDetails}
          </Link>
        </p>
      </section>

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
