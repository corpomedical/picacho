import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";

// SEO guide #2 (2026-08-28, from the operator's "our Search Console
// performance is embarrassing" push): the camera-movement vocabulary,
// targeting "ai video camera movements / camera movement prompts" queries.
// Its unfair advantage over every recycled listicle on this query: the
// clips ARE our preset validation renders — every movement on this page is
// shown working, on the same character, from public/presets/. ~175KB each,
// so all nine embed for well under 2MB.
//
// Editorial rules (same as ai-character-consistency):
//  1. Useful without Picacho — the phrasing patterns work in any tool.
//  2. Every claim was verified by firing the movement as a real render
//     (the 2026-08-26 preset validation matrix) and judging it by eye.
//  3. One CTA band at the end.
export const metadata: Metadata = {
  title: "AI Video Camera Movements: The Director's Cheat Sheet (2026)",
  description:
    "Nine camera movements that actually work in AI video — crash zoom, dolly-in, orbit, crane reveal, bullet time and more — each shown as a real generated clip, with the exact prompt wording that produces it and the shots it's for.",
  alternates: { canonical: "/guides/ai-camera-movements" },
};

export const dynamic = "force-dynamic";

const SECTION = "mx-auto max-w-2xl px-8";
const H2 = "mt-12 font-display text-2xl font-bold tracking-[-0.02em] text-neutral-900";
const P = "mt-4 text-[15px] leading-relaxed text-neutral-600";
const LI = "flex items-start gap-2.5 text-[15px] leading-relaxed text-neutral-600";
const DOT = "mt-[9px] h-1 w-1 flex-shrink-0 rounded-full bg-ochre";

// Each movement: its proof clip (the validation render that earned it a
// preset chip), what it does, when to reach for it, and the wording that
// reliably produces it. The `phrase` lines are distilled from the tested
// preset blocks — shortened for prose, same craft ingredients.
const MOVES: {
  id: string;
  name: string;
  what: string;
  use: string;
  phrase: string;
}[] = [
  {
    id: "crash-zoom",
    name: "Crash zoom",
    what: "A whip-fast punch-in from wide to close-up, with a little motion blur riding the speed.",
    use: "Comedy beats, dramatic realizations, hype cuts — anywhere you want the edit to feel like a slap.",
    phrase: "“rapid crash zoom from a wide view punching in fast to her face, whip-fast with slight motion blur”",
  },
  {
    id: "dolly-35mm",
    name: "35mm dolly-in",
    what: "One slow, smooth push from medium shot to close-up, on vintage anamorphic glass with film grain.",
    use: "Emotional weight. The prestige-drama move — let a performance land without a single cut.",
    phrase: "“one slow, smooth dolly-in from medium shot to close-up, shot on 35mm film, shallow depth of field”",
  },
  {
    id: "handheld-chase",
    name: "Handheld chase",
    what: "A shaky, urgent camera running right behind the subject, wide lens close to the action.",
    use: "Action, panic, found-footage energy. Instantly raises the heart rate of any scene.",
    phrase: "“frantic handheld camera chasing right behind her as she breaks into a run, shaky urgent movement”",
  },
  {
    id: "orbit",
    name: "Orbit",
    what: "The camera circles the subject continuously while they hold still — a full glide, never stopping.",
    use: "Music-video glamour, product heroes, any moment that deserves to be seen from every side.",
    phrase: "“continuous orbit around her as she stands still — the camera keeps circling the entire clip, steady gimbal glide”",
  },
  {
    id: "crane-reveal",
    name: "Crane reveal",
    what: "Starts high above looking down, then descends smoothly until it settles at eye level.",
    use: "Openings and establishing shots — geography first, then the person in it.",
    phrase: "“starts high above looking down at the scene, then cranes smoothly down until it settles at her eye level”",
  },
  {
    id: "aerial-pullback",
    name: "Aerial pull-back",
    what: "The camera rises and retreats, shrinking the subject into a widening world.",
    use: "Endings, scale, loneliness — the emotional inverse of a dolly-in.",
    phrase: "“the camera rises and pulls back into the sky, the figure growing smaller in the widening landscape”",
  },
  {
    id: "low-hero",
    name: "Hero angle",
    what: "A low camera looking up, lens slightly wide, sky or ceiling behind the subject.",
    use: "Power. Villains, champions, reveals of who's really in charge.",
    phrase: "“low angle looking up at her, slightly wide lens, she towers against the sky”",
  },
  {
    id: "bullet-time",
    name: "Bullet time",
    what: "The world freezes mid-motion while the camera keeps traveling around the frozen instant.",
    use: "The show-off shot. Impacts, splashes, rain caught mid-air — one per video, maximum.",
    phrase: "“time freezes mid-action while the camera continues to travel around her, droplets suspended in the air”",
  },
  {
    id: "slowmo-glamour",
    name: "Slow motion",
    what: "High-frame-rate glamour slow-mo: hair, fabric and light stretched into silk.",
    use: "Beauty, sport, celebration — anything whose detail deserves more time than reality gives it.",
    phrase: "“ultra slow motion, hair and fabric drifting, every detail stretched and deliberate”",
  },
];

export default async function CameraMovementsGuide() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="isolate relative overflow-hidden bg-paper">
        <div className="mx-auto max-w-3xl px-8 pb-14 pt-20 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Guide · updated August 2026
          </p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-slate-900 sm:text-5xl">
            AI camera movements: the director&apos;s cheat sheet
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            Nine movements that actually work in current AI video models — each one shown as a real
            generated clip, not a stock illustration, with the exact wording that produces it and
            the shots it&apos;s built for.
          </p>
        </div>
      </section>

      <article className="pb-20">
        <div className={SECTION}>
          <h2 className={H2}>Why &quot;make the camera move&quot; fails</h2>
          <p className={P}>
            Video models understand camera language the way a crew does: they respond to{" "}
            <em>craft vocabulary</em>, not vibes. &quot;Cool camera movement&quot; produces a
            coin-flip; &quot;a slow dolly-in from medium shot to close-up&quot; produces a dolly-in,
            because those words appear next to real dollies in everything the model learned from.
            The difference between the two prompts is the difference between hoping and directing.
          </p>
          <p className={P}>
            Three rules make any movement prompt more reliable. Name the <b>move</b> with its film
            term. Name the <b>speed and quality</b> (&quot;whip-fast&quot;, &quot;slow and
            deliberate&quot;, &quot;steady gimbal glide&quot;). And say what the camera does{" "}
            <b>for the whole clip</b> — models love to complete a move in one second and then sit
            still; &quot;the camera keeps circling the entire clip, never stopping&quot; is what
            keeps an orbit orbiting.
          </p>
          <p className={P}>
            Every clip below was generated on Seedance 2.0 with the same reference-anchored
            character, as part of validating Picacho&apos;s one-tap presets — which is the honest
            disclosure and also the point: these are results, not mockups. The wording patterns work
            in any capable model.
          </p>

          {MOVES.map((m, i) => (
            <section key={m.id}>
              <h2 className={H2}>
                {i + 1} · {m.name}
              </h2>
              <video
                src={`/presets/${m.id}.mp4`}
                poster={`/presets/${m.id}.jpg`}
                muted
                loop
                playsInline
                autoPlay
                preload="metadata"
                className="mt-4 w-full rounded-2xl border border-neutral-200 shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
                aria-label={`${m.name} — real generated example clip`}
              />
              <p className={P}>{m.what}</p>
              <ul className="mt-3 space-y-2.5">
                <li className={LI}>
                  <span className={DOT} />
                  <span>
                    <b>Use it for:</b> {m.use}
                  </span>
                </li>
                <li className={LI}>
                  <span className={DOT} />
                  <span>
                    <b>The wording:</b> {m.phrase}
                  </span>
                </li>
              </ul>
            </section>
          ))}

          <h2 className={H2}>Stacking a movement with a look</h2>
          <p className={P}>
            A camera move and a lighting look are orthogonal decisions — a crash zoom can land in
            golden hour or in film noir, and the model handles both instructions at once as long as
            each stays in its own lane: movement language for the camera, light language for the
            grade. Keep them as separate sentences and don&apos;t let them contradict (a
            &quot;frantic handheld&quot; sentence next to a &quot;serene, floating&quot; sentence
            splits the difference into mush).
          </p>
          <p className={P}>
            One honest warning from testing these at scale: <em>two</em> camera moves in one prompt
            fight each other. A dolly-in plus an orbit doesn&apos;t produce a spiral; it produces
            whichever the model felt like, or a smear of both. One move per shot, the way a real
            crew blocks it.
          </p>

          <h2 className={H2}>Troubleshooting</h2>
          <ul className="mt-4 space-y-2.5">
            <li className={LI}>
              <span className={DOT} />
              <span>
                <b>The move happens for one second, then stops:</b> add &quot;for the entire
                clip&quot; / &quot;never stopping&quot; and state the start and end framing.
              </span>
            </li>
            <li className={LI}>
              <span className={DOT} />
              <span>
                <b>The subject moves instead of the camera:</b> say &quot;she stands still&quot;
                explicitly — the model needs to know what is fixed.
              </span>
            </li>
            <li className={LI}>
              <span className={DOT} />
              <span>
                <b>The face drifts during fast moves:</b> that&apos;s an identity problem, not a
                camera one — anchor the character with reference photos first (our{" "}
                <Link href="/guides/ai-character-consistency" className="underline underline-offset-2 hover:text-neutral-900">
                  consistency guide
                </Link>{" "}
                covers the recipe).
              </span>
            </li>
            <li className={LI}>
              <span className={DOT} />
              <span>
                <b>A move you can&apos;t phrase reliably:</b> some genuinely aren&apos;t stable —
                the vertigo dolly-zoom failed our validation on current models and was cut rather
                than shipped. If a move won&apos;t prove itself on screen, stop paying to retry it.
              </span>
            </li>
          </ul>
        </div>

        {/* Single CTA band — editorial rule 3. */}
        <div className="mx-auto mt-16 max-w-2xl px-8">
          <div className="rounded-[18px] bg-ink px-8 py-10 text-center">
            <h2 className="font-display text-2xl font-bold tracking-[-0.02em] text-paper">
              Or make every move a one-tap preset
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">
              Every movement on this page ships in Picacho as a validated preset — hover to preview
              the real clip, tap to arm it, stack it with a lighting look. A free generation every
              day, no credit card.
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex items-center justify-center rounded-[10px] bg-ochre px-6 py-3 text-sm font-semibold text-onmedia transition-colors hover:bg-ochre-deep"
            >
              Try the presets
            </Link>
          </div>
        </div>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Article",
              headline: "AI Video Camera Movements: The Director's Cheat Sheet",
              datePublished: "2026-08-28",
              dateModified: "2026-08-28",
              author: { "@type": "Organization", name: "Picacho" },
              publisher: { "@type": "Organization", name: "Picacho", url: "https://picacho.ai" },
              mainEntityOfPage: "https://picacho.ai/guides/ai-camera-movements",
            }),
          }}
        />
      </article>

      <MarketingFooter />
    </div>
  );
}
