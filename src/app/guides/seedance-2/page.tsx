import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { marketingSocial } from "@/lib/i18n/metadata";

// SEO guide #3 (2026-08-28): the model-specific guide for Seedance 2.0 —
// model-name queries are how practitioners search, and this is the model
// this codebase knows best. Every behavioral claim below is something we
// verified end-to-end in production (dates inline), not paraphrased from
// docs: the identity-reference contract, the 2.5 photoreal rejection, the
// outfit-photo lane, durations/pricing from fal's own pricing page.
//
// Editorial rules (same as the other guides): useful without Picacho;
// verified claims only; one CTA band.
const TITLE = "Seedance 2.0: The Practical Guide (2026)";
const DESCRIPTION =
  "How Seedance 2.0 actually behaves in production: identity references vs first frames, the 2.5 photoreal policy trap, exact outfit matching with a clothing photo, durations and real per-second pricing, and prompt patterns that hold a face.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/guides/seedance-2" },
  ...marketingSocial("/guides/seedance-2", TITLE, DESCRIPTION),
};

export const dynamic = "force-dynamic";

const SECTION = "mx-auto max-w-2xl px-8";
const H2 = "mt-12 font-display text-2xl font-bold tracking-[-0.02em] text-neutral-900";
const P = "mt-4 text-[15px] leading-relaxed text-neutral-600";
const LI = "flex items-start gap-2.5 text-[15px] leading-relaxed text-neutral-600";
const DOT = "mt-[9px] h-1 w-1 flex-shrink-0 rounded-full bg-ochre";

export default async function SeedanceGuide() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="isolate relative overflow-hidden bg-paper">
        <div className="mx-auto max-w-3xl px-8 pb-14 pt-20 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Guide · updated August 2026
          </p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-slate-900 sm:text-5xl">
            Seedance 2.0: the practical guide
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            ByteDance&apos;s Seedance family is the current workhorse for character video — and the
            most misunderstood, because its two tiers behave differently in exactly the places that
            matter. Everything below was verified end-to-end in production, with dates.
          </p>
        </div>
      </section>

      <article className="pb-20">
        <div className={SECTION}>
          <h2 className={H2}>The one-sentence mental model</h2>
          <p className={P}>
            Seedance 2.0 is a <em>reference-to-video</em> model: you hand it identity photos, refer
            to them in the prompt, and it renders the person those photos triangulate — acting,
            moving, in new scenes. That contract is what separates it from first-frame models,
            and it&apos;s why it holds a face through motion instead of merely animating a
            photograph.
          </p>

          <h2 className={H2}>Identity references, not first frames</h2>
          <p className={P}>
            Most &quot;image-to-video&quot; endpoints treat your upload as the opening frame: the
            clip literally starts as your photo and animates away from it — same pose, same
            framing, same room. Seedance&apos;s reference endpoints treat uploads as{" "}
            <em>identity citations</em>: the schema has you reference them in the prompt itself
            (&quot;@Image1&quot;), and the model composes a brand-new shot starring that person.
            Practical consequences:
          </p>
          <ul className="mt-4 space-y-2.5">
            <li className={LI}>
              <span className={DOT} />
              You can ask for any framing and camera movement — the shot is composed fresh, so a
              close-up reference still yields a wide shot when the prompt asks for one.
            </li>
            <li className={LI}>
              <span className={DOT} />
              Several references beat one: a front portrait plus a three-quarter plus a full-body
              triangulates the person (the full recipe is in our{" "}
              <Link href="/guides/ai-character-consistency" className="underline underline-offset-2 hover:text-neutral-900">
                consistency guide
              </Link>
              ).
            </li>
            <li className={LI}>
              <span className={DOT} />
              The reference decides <em>who</em>; the prompt decides <em>everything else</em>.
              Spend your words on scene, action, light, and camera.
            </li>
          </ul>

          <h2 className={H2}>The photoreal fence: real faces get rejected</h2>
          <p className={P}>
            The single most expensive thing to learn by surprise: ByteDance&apos;s{" "}
            <b>Seedance</b> endpoints refuse reference images of photoreal people — the request
            fails with a content-policy violation after you&apos;ve already queued it. We verified
            it live on 21 August 2026, when the fence was on 2.5 alone and 2.0 took the same faces
            happily. It is no longer a split: on 3 September 2026 <b>2.0 refused photos it had
            accepted eleven days earlier</b>, and ByteDance now documents that the 2.0 series does
            not support direct uploads of reference images containing real-person faces at all.
            Where that leaves things:
          </p>
          <ul className="mt-4 space-y-2.5">
            <li className={LI}>
              <span className={DOT} />
              <b>Photoreal humans → Kling O3 Pro.</b> Both Seedance lanes now refuse them; no policy
              fence, up to 15-second clips.
            </li>
            <li className={LI}>
              <span className={DOT} />
              <b>Illustrated and mascot characters → Seedance 2.5.</b> The newer model, clips up to
              30 seconds — its policy only bites on real-looking people.
            </li>
          </ul>
          <p className={P}>
            If a tool doesn&apos;t route this for you, route it yourself — a Seedance render of a
            photoreal character isn&apos;t a quality risk, it&apos;s a guaranteed rejection that
            still costs you the attempt on some platforms. (Picacho fences this before send: pick
            either Seedance lane with a photoreal character and a banner offers the one-tap switch
            to a model that accepts them.)
          </p>

          <h2 className={H2}>The outfit trick nobody uses</h2>
          <p className={P}>
            Because Seedance accepts several reference images, one of them can be a{" "}
            <em>clothing photo</em> — a product shot or flat-lay, no person in it — cited in the
            prompt as what the character wears. The render then matches the garment{" "}
            <em>pixel-for-pixel</em>: cut, color, print. On models that can&apos;t take a clothing
            image, the outfit travels as a written description instead — colors and logos land,
            exact stitching doesn&apos;t. We live-tested this split before shipping wardrobe
            support: for a specific real garment, Seedance 2.0 with the photo riding along is the
            only reliable route.
          </p>

          <h2 className={H2}>Durations and honest economics</h2>
          <p className={P}>
            Seedance 2.0 renders 5, 10, or 15-second clips at 720p; fal.ai&apos;s list price is
            $0.3024 per second (verified against fal&apos;s pricing page, 21 August 2026) — about
            $1.51 for a 5-second clip. Seedance 2.5 runs $0.4730 per second and reaches 30
            seconds. Two budgeting consequences: a failed take costs the same as a good one, so
            everything that reduces retries (reference sets, validated camera phrasing, policy
            routing) is directly money; and 15 seconds of 2.0 costs less than 10 seconds of 2.5 —
            when the character is photoreal the cheaper model is also the only correct one, a rare
            free lunch.
          </p>

          <h2 className={H2}>Prompt patterns that hold</h2>
          <ul className="mt-4 space-y-2.5">
            <li className={LI}>
              <span className={DOT} />
              <b>One scene, one action, one camera move.</b> Seedance follows a clean shot brief
              beautifully and splits the difference on a muddled one — two camera moves in one
              prompt fight (our{" "}
              <Link href="/guides/ai-camera-movements" className="underline underline-offset-2 hover:text-neutral-900">
                camera-movement cheat sheet
              </Link>{" "}
              shows nine that work, as real clips).
            </li>
            <li className={LI}>
              <span className={DOT} />
              <b>Keep identity words out of the scene prompt.</b> The references own the face;
              re-describing it in words gives the model two masters. Describe what happens, not who
              they are.
            </li>
            <li className={LI}>
              <span className={DOT} />
              <b>State what stays still.</b> &quot;She stands still as the camera orbits&quot;
              beats &quot;orbit shot&quot; — the model needs to know what is fixed.
            </li>
            <li className={LI}>
              <span className={DOT} />
              <b>For sequences, continue — don&apos;t restart.</b> Seedance accepts a previous clip
              as reference material, so the next shot inherits the world instead of reinventing it
              (shipped in Picacho as &quot;Continue this clip&quot;, live-tested before release).
            </li>
          </ul>

          <h2 className={H2}>When Seedance is the wrong tool</h2>
          <ul className="mt-4 space-y-2.5">
            <li className={LI}>
              <span className={DOT} />
              <b>You want your exact photo animated:</b> that&apos;s a first-frame job — use an
              image-to-video lane, not a reference lane.
            </li>
            <li className={LI}>
              <span className={DOT} />
              <b>No character at all:</b> pure landscape/product motion doesn&apos;t need identity
              references; cheaper text-to-video models do fine.
            </li>
            <li className={LI}>
              <span className={DOT} />
              <b>Budget clips in volume:</b> at roughly $0.06/second-class pricing, Kling&apos;s
              budget tier renders five drafts for the price of one Seedance take — draft cheap,
              finish on Seedance.
            </li>
          </ul>
        </div>

        {/* Single CTA band — editorial rule 3. */}
        <div className="mx-auto mt-16 max-w-2xl px-8">
          <div className="rounded-[18px] bg-ink px-8 py-10 text-center">
            <h2 className="font-display text-2xl font-bold tracking-[-0.02em] text-paper">
              Seedance 2.0, with the sharp edges fenced
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">
              Picacho routes photoreal characters away from the 2.5 rejection, rides outfit photos
              on the models that take them, and scores every render against the identity photo. A
              free generation every day, no credit card.
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex items-center justify-center rounded-[10px] bg-ochre px-6 py-3 text-sm font-semibold text-onmedia transition-colors hover:bg-ochre-deep"
            >
              Render on Seedance 2.0
            </Link>
          </div>
        </div>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Article",
              headline: "Seedance 2.0: The Practical Guide",
              datePublished: "2026-08-28",
              dateModified: "2026-08-28",
              author: { "@type": "Organization", name: "Picacho" },
              publisher: { "@type": "Organization", name: "Picacho", url: "https://picacho.ai" },
              mainEntityOfPage: "https://picacho.ai/guides/seedance-2",
            }),
          }}
        />
      </article>

      <MarketingFooter />
    </div>
  );
}
