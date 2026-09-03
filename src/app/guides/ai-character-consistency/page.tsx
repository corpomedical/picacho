import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";

// The flagship SEO guide, targeting the head term the whole category
// searches for. Written from what this codebase actually proved in
// production — the reference-set recipe, identity references vs first-frame
// anchors, the ByteDance photoreal policy split, measured scoring — not
// recycled blog folklore. English-only body (same follow-up-pass convention
// as the deeper app screens); the shell chrome stays localized.
//
// Editorial rules for this and every future guide:
//  1. Genuinely useful with or without Picacho — the product appears where
//     it honestly automates a step, never as the premise.
//  2. Claims about model behavior are things we verified ourselves (the
//     Seedance 2.5/2.0 likeness split was live-tested 2026-08-21).
//  3. One CTA band at the end. No popups, no content gating.
export const metadata: Metadata = {
  title: "AI Character Consistency: The Practical Guide (2026)",
  description:
    "How to keep the same AI character across images and videos: reference-set composition, identity references vs first-frame anchors, prompt trait blocks, the photoreal policy trap, and how to measure the lock instead of hoping.",
  alternates: { canonical: "/guides/ai-character-consistency" },
};

export const dynamic = "force-dynamic";

const SECTION = "mx-auto max-w-2xl px-8";
const H2 = "mt-12 font-display text-2xl font-bold tracking-[-0.02em] text-neutral-900";
const P = "mt-4 text-[15px] leading-relaxed text-neutral-600";
const LI = "flex items-start gap-2.5 text-[15px] leading-relaxed text-neutral-600";
const DOT = "mt-[9px] h-1 w-1 flex-shrink-0 rounded-full bg-ochre";

export default async function CharacterConsistencyGuide() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="isolate relative overflow-hidden bg-paper">
        <div className="mx-auto max-w-3xl px-8 pb-14 pt-20 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Guide · updated August 2026
          </p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-slate-900 sm:text-5xl">
            AI character consistency: the practical guide
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            Why AI characters drift between generations, and the five techniques that actually
            hold a face — from reference-set composition to measuring the lock instead of hoping.
            Everything here was verified against live models, not recycled from other blogs.
          </p>
        </div>
      </section>

      <article className="pb-20">
        <div className={SECTION}>
          <h2 className={H2}>Why your character keeps changing</h2>
          <p className={P}>
            Image and video models don&apos;t remember. Every generation starts from noise, and
            &quot;the same woman as last time&quot; is not something a model can look up — it can
            only re-derive a plausible woman from your prompt. Small wording changes, different
            seeds, or just the model&apos;s own randomness produce someone <em>similar</em>, and
            similar is exactly what audiences notice. Character consistency is therefore never a
            property you switch on; it&apos;s a set of constraints you stack until the range of
            possible faces narrows to one.
          </p>

          <h2 className={H2}>1 · Build a reference set, not a reference photo</h2>
          <p className={P}>
            Modern reference-to-video models (Seedance, Kling&apos;s element system) accept several
            identity images and average toward a stable person. One photo anchors a face from one
            angle in one light; a <em>set</em> triangulates it. The composition that works:
          </p>
          <ul className="mt-4 space-y-2.5">
            <li className={LI}><span className={DOT} />A clean, front-facing portrait — this is the identity anchor, and the photo any scoring runs against.</li>
            <li className={LI}><span className={DOT} />A three-quarter angle — the single highest-value addition, because most cinematic shots aren&apos;t frontal.</li>
            <li className={LI}><span className={DOT} />A full-body shot — proportions and wardrobe stop drifting the moment the model has seen them.</li>
            <li className={LI}><span className={DOT} />One or two expressions — a smile and a neutral, so emotion doesn&apos;t remodel the face.</li>
          </ul>
          <p className={P}>
            Variety beats volume: four photos covering four aspects outperform eight near-identical
            selfies. (In Picacho, the character page&apos;s lock-strength meter coaches exactly this
            recipe as you add photos.)
          </p>

          <h2 className={H2}>2 · Know the difference: identity references vs first frames</h2>
          <p className={P}>
            Two very different mechanisms both get called &quot;image-to-video,&quot; and choosing
            the wrong one causes the most common failure in the category:
          </p>
          <ul className="mt-4 space-y-2.5">
            <li className={LI}><span className={DOT} /><span><strong className="text-neutral-800">First-frame anchoring</strong> uses your photo as the literal opening frame. Identity is perfect at second zero — and the clip begins frozen in the photographed pose, in the photographed room, whatever your prompt said.</span></li>
            <li className={LI}><span className={DOT} /><span><strong className="text-neutral-800">Identity references</strong> (Seedance&apos;s <code className="rounded bg-neutral-100 px-1 text-[13px]">@Image1</code> citations, Kling&apos;s elements) tell the model who the person is without dictating frame one — the character can start mid-action, in a new scene, from a new camera.</span></li>
          </ul>
          <p className={P}>
            If your clips all start with the character standing still, facing camera, in the pose of
            your reference photo — you&apos;re on a first-frame endpoint and need an identity-reference
            one.
          </p>

          <h2 className={H2}>3 · The photoreal policy fence (updated September 2026)</h2>
          <p className={P}>
            A finding we verified with live requests, because nobody publishes it: ByteDance&apos;s
            Seedance endpoints <em>reject</em> reference images that look like real people — the
            request fails with a content-policy error before generating. It&apos;s an anti-deepfake
            fence, and it applies to photoreal AI-generated faces too, since the filter can&apos;t
            tell the difference. Illustrated and mascot-style characters pass without complaint.
          </p>
          <p className={P}>
            When we first published this in August 2026 the fence was on 2.5 only, and Seedance 2.0
            accepted the same faces. That gap has since closed: on 3 September 2026, 2.0 refused
            reference photos it had accepted eleven days earlier, and ByteDance&apos;s own
            documentation now states the Seedance 2.0 series does not support direct uploads of
            reference images containing real-person faces — the sanctioned route is a verified
            asset library instead. So if a tool tells you Seedance &quot;doesn&apos;t work&quot;
            with your character, this fence — not your prompt — is usually why. Photoreal
            characters belong on Kling O3 Pro; Picacho routes them there and warns before you
            spend if you pick a Seedance lane.
          </p>

          <h2 className={H2}>4 · Keep the prompt&apos;s description block identical</h2>
          <p className={P}>
            References carry the face; words carry everything else. If shot one says &quot;a rugged
            field scientist in a khaki jacket&quot; and shot two just says &quot;the man,&quot; the
            model re-invents whatever the words dropped. The fix is a fixed trait block — hair,
            wardrobe, distinguishing features, rendering style — pasted verbatim into every prompt,
            with only the scene changing around it. This is tedious to maintain by hand, which is
            why it&apos;s the step people skip and the step tools should automate. (Picacho compiles
            the character&apos;s saved traits into every prompt automatically, and validates the
            compiled prompt against the character&apos;s rulebook before anything generates.)
          </p>

          <h2 className={H2}>5 · Measure the lock — don&apos;t eyeball it</h2>
          <p className={P}>
            The uncomfortable truth about every technique above: they narrow the range, they never
            guarantee. The difference between hoping and knowing is measurement — comparing each
            output against the identity photo with a vision model and getting a number. A 90%+ match
            ships; a 70% match regenerates before an audience ever sees it. Doing this by eye at
            thumbnail size is how off-model renders slip into published content. (This is
            Picacho&apos;s core mechanic: every image is scored against the identity photo and the
            number is printed under the result — the same scores shown publicly on our homepage.)
          </p>

          <h2 className={H2}>Multi-shot work: keeping the world, not just the face</h2>
          <p className={P}>
            Consistency across a <em>sequence</em> adds a second problem: the setting, light, and
            wardrobe must survive the cut. Two mechanisms handle it — passing the previous clip
            itself as a reference so the next shot continues its world, and multi-shot storyboards
            where one job renders several shots with shared context. Both exist in current
            frontier models (and both shipped in Picacho as &quot;Continue this clip&quot; and
            Kling O3 Pro storyboards, live-tested before release).
          </p>

          <h2 className={H2}>The checklist</h2>
          <ul className="mt-4 space-y-2.5">
            <li className={LI}><span className={DOT} />Reference set: front + three-quarter + full body + expressions.</li>
            <li className={LI}><span className={DOT} />Identity-reference endpoints for acting; first-frame only when you want the photo animated.</li>
            <li className={LI}><span className={DOT} />Photoreal person? Mind the Seedance 2.5 policy fence — use 2.0-class models.</li>
            <li className={LI}><span className={DOT} />One immutable trait block in every prompt.</li>
            <li className={LI}><span className={DOT} />Score every output against the identity photo; regenerate below your threshold.</li>
            <li className={LI}><span className={DOT} />For sequences: continuation references or storyboards, not isolated prompts.</li>
          </ul>
        </div>

        {/* Single CTA band — rule 3 in the header comment. */}
        <div className="mx-auto mt-16 max-w-2xl px-8">
          <div className="rounded-[18px] bg-ink px-8 py-10 text-center">
            <h2 className="font-display text-2xl font-bold tracking-[-0.02em] text-paper">
              Or let the pipeline do steps 1–5 for you
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">
              Picacho saves the character once — references, traits, rules — engineers them into
              every prompt, and scores every output against the identity photo. A free generation
              every day, no credit card.
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex items-center justify-center rounded-[10px] bg-ochre px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-ochre-deep"
            >
              Try it with your character
            </Link>
          </div>
        </div>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Article",
              headline: "AI Character Consistency: The Practical Guide",
              datePublished: "2026-08-21",
              dateModified: "2026-08-21",
              author: { "@type": "Organization", name: "Picacho" },
              publisher: { "@type": "Organization", name: "Picacho", url: "https://picacho.ai" },
              mainEntityOfPage: "https://picacho.ai/guides/ai-character-consistency",
            }),
          }}
        />
      </article>

      <MarketingFooter />
    </div>
  );
}
