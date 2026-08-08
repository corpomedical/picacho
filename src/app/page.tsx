import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { PricingCard } from "@/components/marketing/pricing-card";
import { PRICING_TIERS } from "@/lib/pricing";
import { getServerMessages } from "@/lib/i18n/server";
import { cn } from "@/lib/cn";
import { ShowcaseVideoPlayer } from "@/components/showcase-video-player";

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
// sky-300/blue-400-strength colors at 70-80% opacity, which read as too
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
      <div className="animate-wallpaper-a absolute -left-[15%] -top-[25%] h-[600px] w-[600px] rounded-full bg-sky-200 opacity-50 mix-blend-multiply blur-[95px]" />
      <div className="animate-wallpaper-b absolute -right-[12%] -top-[15%] h-[560px] w-[560px] rounded-full bg-blue-200 opacity-45 mix-blend-multiply blur-[95px] [animation-delay:-3s]" />
      <div className="animate-wallpaper-c absolute left-[28%] top-[5%] h-[500px] w-[500px] rounded-full bg-cyan-100 opacity-50 mix-blend-multiply blur-[95px] [animation-delay:-6s]" />
      <div className="animate-wallpaper-b absolute -bottom-[30%] right-[18%] h-[520px] w-[520px] rounded-full bg-indigo-100 opacity-45 mix-blend-multiply blur-[95px] [animation-delay:-9s]" />
      <div className="animate-wallpaper-a absolute -bottom-[25%] left-[8%] h-[480px] w-[480px] rounded-full bg-sky-100 opacity-50 mix-blend-multiply blur-[95px] [animation-delay:-5s]" />
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
      <MarketingHeader />

      {/* Hero — bg-sky-50 (not bg-white/bg-neutral-50, both of which the
          theme remaps to a dark shade under .dark) so this section stays
          genuinely light regardless of the site's own light/dark toggle,
          same anchoring idea as the earlier dark version just flipped. Text
          uses slate (never remapped by dark mode) rather than neutral/ink
          for the same reason. */}
      <section className="isolate relative overflow-hidden bg-sky-50">
        <LiveWallpaper />
        <div className="relative mx-auto max-w-3xl px-8 pb-24 pt-28 text-center sm:pt-36">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-6xl">
            {m.heroTitle}
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-slate-600 sm:text-lg">{m.heroSubtitle}</p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-[10px] bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-[0_1px_1px_rgba(0,0,0,0.08)] transition-colors hover:bg-blue-700"
            >
              {m.getStarted}
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white/70 px-6 py-3 text-sm font-medium text-slate-700 backdrop-blur transition-colors hover:border-slate-400 hover:bg-white"
            >
              {m.seePricing}
            </Link>
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
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-[18px] border border-neutral-100 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
            <TwoModelsIcon className="h-6 w-6 text-blue-600" />
            <h3 className="mt-4 text-base font-semibold text-neutral-900">{m.diffModelsTitle}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">{m.diffModelsDetail}</p>
          </div>
          <div className="rounded-[18px] border border-neutral-100 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
            <LayersIcon className="h-6 w-6 text-blue-600" />
            <h3 className="mt-4 text-base font-semibold text-neutral-900">{m.diffFormatsTitle}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">{m.diffFormatsDetail}</p>
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
              <div className="animate-wallpaper-a absolute -left-[10%] -top-[10%] h-[260px] w-[260px] rounded-full bg-sky-200 opacity-60 mix-blend-multiply blur-[70px]" />
              <div className="animate-wallpaper-b absolute -bottom-[10%] -right-[10%] h-[260px] w-[260px] rounded-full bg-blue-200 opacity-60 mix-blend-multiply blur-[70px] [animation-delay:-4s]" />
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
              <div className="animate-wallpaper-b absolute -left-[10%] -top-[10%] h-[260px] w-[260px] rounded-full bg-blue-200 opacity-60 mix-blend-multiply blur-[70px] [animation-delay:-2s]" />
              <div className="animate-wallpaper-a absolute -bottom-[10%] -right-[10%] h-[260px] w-[260px] rounded-full bg-sky-200 opacity-60 mix-blend-multiply blur-[70px] [animation-delay:-6s]" />
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
          bg-sky-50 treatment for the same reason. */}
      <section className="isolate relative overflow-hidden bg-sky-50">
        <LiveWallpaper />
        <div className="relative mx-auto max-w-2xl px-8 py-24 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{m.ctaTitle}</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-slate-600">{m.ctaSubtitle}</p>
          <Link
            href="/signup"
            className="mt-8 inline-flex items-center justify-center rounded-[10px] bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-[0_1px_1px_rgba(0,0,0,0.08)] transition-colors hover:bg-blue-700"
          >
            {m.getStarted}
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
