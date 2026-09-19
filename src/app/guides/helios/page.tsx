import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { marketingSocial } from "@/lib/i18n/metadata";
import { SETS_OPEN_TO_PLANS, SET_BUILDS_MONTHLY_LIMITS } from "@/lib/sets/set-config";

// The Helios guide (launch prep cut 2, 2026-09-19) — published with the
// launch: while SETS_OPEN_TO_PLANS is false this page is 404, off the
// guides index and out of the sitemap, so nothing public describes a
// feature nobody can buy. The flip commit turns the one constant and this
// page, the index card, the sitemap line and the home section all appear.
//
// Editorial rules (the guides' standing three, bent once on #1 on purpose:
// this one is about our own product, said so from the first line):
//  2. Every claim below shipped and was verified on the live stage — the
//     screenshots are the real workspace on a real set.
//  3. One CTA band at the end.
const TITLE = "Helios: Direct AI Shots Inside a Real 3D Set";
const DESCRIPTION =
  "Describe a location and get a walkable 3D set. Place your character and camera exactly — real lenses, stops and light — then shoot stills, takes and films that keep the same place and the same face, shot after shot.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/guides/helios" },
  ...marketingSocial("/guides/helios", TITLE, DESCRIPTION),
};

export const dynamic = "force-dynamic";

const SECTION = "mx-auto max-w-2xl px-8";
const H2 = "mt-12 font-display text-2xl font-bold tracking-[-0.02em] text-neutral-900";
const P = "mt-4 text-[15px] leading-relaxed text-neutral-600";
const LI = "flex items-start gap-2.5 text-[15px] leading-relaxed text-neutral-600";
const DOT = "mt-[9px] h-1 w-1 flex-shrink-0 rounded-full bg-ochre";

const STEPS: { name: string; copy: string }[] = [
  {
    name: "Build the set",
    copy: "Describe the location in a sentence or two — a rain-dark market, a racing circuit at golden hour, the sitting room in a photo you upload. Astra builds it as real 3D geometry: walls, floors, furniture, marks to stand on, cameras already placed. It's yours to keep and reshoot forever.",
  },
  {
    name: "Place the person and the camera",
    copy: "Drag your character to a mark, choose a pose, say where they look. Orbit the camera to the exact framing you want — the frame lines are the picture, and what you framed out never comes back in the render.",
  },
  {
    name: "Set the rig",
    copy: "Six formats from square to anamorphic Scope. Real focal lengths and stops with true depth-of-field readouts, light plots, palettes and film stocks. The viewfinder shows what the settings do before you spend anything.",
  },
  {
    name: "Shoot the still",
    copy: "One credit, like any Picacho image. The render is scored against your character's identity photos, and a refused request never uses your credits. Every still lands in the set's filmstrip, ready to be a look or a film's start.",
  },
  {
    name: "Take it into motion",
    copy: "A take turns a still into a clip: the stage shoots the end frame where you say the shot ends, and the clip is rendered between the two — a 5-second or an 8-second engine, quoted before you spend. Fourteen camera moves, rack focus, walk paths and eye-lines ride along.",
  },
  {
    name: "Cut the film",
    copy: "Film mode lays takes on a timeline — up to three beats with their own keyframes, figure marks and light — previews the whole move for free, and downloads the finished film as one MP4, joined in your browser with nothing re-encoded.",
  },
];

export default function HeliosGuidePage() {
  if (!SETS_OPEN_TO_PLANS) notFound();
  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <article className="pb-20">
        <header className="isolate relative overflow-hidden bg-paper">
          <div className="mx-auto max-w-2xl px-8 pb-12 pt-16">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Guides · September 2026</p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-[1.1] tracking-[-0.035em] text-neutral-900">
              Helios: direct AI shots inside a real 3D set
            </h1>
            <p className={P}>
              Prompt-only AI video has a camera problem: you can ask for “low angle, 35&nbsp;mm, she walks to the car”, and the
              model places all of it roughly, differently every time. Helios turns that around. You direct a real 3D location —
              the camera, the lens, the light and the person all have exact positions — and the words are left to do what only
              words can do: performance and mood.
            </p>
          </div>
        </header>

        <div className="mx-auto mt-10 max-w-4xl px-8">
          <Image
            src="/guides/helios/workspace.jpg"
            alt="The Helios workspace: a 3D racing-circuit set with anamorphic frame lines, a figure on its mark beside a red car, the rig readout and the director's chat"
            width={1600}
            height={1000}
            className="rounded-[18px] border border-neutral-200 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
            priority
          />
          <p className="mt-2 text-center text-xs text-neutral-400">
            The workspace on a real set: Scope frame lines, a 24&nbsp;mm at f/2 with its focus readout, and the figure on its mark.
          </p>
        </div>

        <section className={SECTION}>
          <h2 className={H2}>Why geometry beats prompts for the camera</h2>
          <p className={P}>
            An image model reads words with a light touch: “from behind, 50&nbsp;mm” might land anywhere behind, at any distance.
            Helios never asks. The set renders a layout sketch from your exact camera — position, lens, framing, horizon, light
            direction — and the model is told to match it. The place stays the same place across every shot, because it
            literally is the same place.
          </p>
          <p className={P}>
            The same geometry keeps your character consistent in space: where they stand, which way they face, where their eyes
            go, how far the walk is. Identity stays Picacho&apos;s usual promise — every render is scored against the
            character&apos;s identity photos, and refused requests never use your credits.
          </p>
        </section>

        <section className={SECTION}>
          <h2 className={H2}>From words to a finished film, in six steps</h2>
          <ol className="mt-6 space-y-6">
            {STEPS.map((s, i) => (
              <li key={s.name}>
                <h3 className="flex items-baseline gap-3 text-[15px] font-semibold text-neutral-900">
                  <span className="font-display text-lg text-ochre">{i + 1}</span>
                  {s.name}
                </h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-neutral-600">{s.copy}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="mx-auto mt-12 max-w-4xl px-8">
          <Image
            src="/guides/helios/film.jpg"
            alt="Film mode: the move library on the right, the sequencer under the viewport with camera, figure, sun and takes tracks"
            width={1600}
            height={1000}
            className="rounded-[18px] border border-neutral-200 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
          />
          <p className="mt-2 text-center text-xs text-neutral-400">
            Film mode: beats on a timeline, a move library, and a previz that plays the whole film before a credit is spent.
          </p>
        </div>

        <section className={SECTION}>
          <h2 className={H2}>What each plan gets</h2>
          <p className={P}>
            Helios is part of every paid plan. Set builds are capped per month — stills, takes and films inside your sets are
            ordinary renders, priced in credits like everything else on Picacho and quoted before you spend.
          </p>
          <ul className="mt-4 space-y-2">
            {(["basic", "starter", "growth", "studio", "elite"] as const).map((plan) => (
              <li key={plan} className={LI}>
                <span className={DOT} />
                <span>
                  <span className="font-semibold capitalize text-neutral-900">{plan}</span> — {SET_BUILDS_MONTHLY_LIMITS[plan]}{" "}
                  {SET_BUILDS_MONTHLY_LIMITS[plan] === 1 ? "set" : "sets"} a month
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Single CTA band — editorial rule 3. */}
        <div className="mx-auto mt-16 max-w-2xl px-8">
          <div className="rounded-[18px] bg-ink px-8 py-10 text-center">
            <h2 className="font-display text-2xl font-bold tracking-[-0.02em] text-paper">Build your first set tonight</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-paper/60">
              Describe a place, walk a camera through it, and shoot your character there — on the first try, and on every try
              after that.
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex items-center justify-center rounded-[10px] bg-ochre px-6 py-3 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
            >
              Start with Helios
            </Link>
          </div>
        </div>
      </article>

      <MarketingFooter />
    </div>
  );
}
