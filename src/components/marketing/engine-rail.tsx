import { getServerMessages } from "@/lib/i18n/server";
import { IMAGE_MODELS } from "@/lib/generations/providers/image-models";
import { VIDEO_MODELS } from "@/lib/generations/providers/video-models";

// The "running on the frontier" rail under the hero.
//
// Two rules this component exists to keep:
//
//  1. It can never advertise an engine Picacho doesn't actually run. The
//     image and video names are DERIVED from the same catalogues the
//     generate pipeline switches on (image-models.ts / video-models.ts) —
//     add or remove a model there and this rail follows. Only the two
//     engines with no catalogue entry (ElevenLabs for speech, Claude for
//     prompt drafting) are named here, next to the code that calls them.
//  2. It shows names, not borrowed brand logos. Seven third-party marks
//     would be visual noise and a trademark question we don't need; the
//     names in our own display face read as more deliberate anyway.
//
// Visually: smoked glass over a heavily blurred wall of Picacho's OWN
// generations, lit from underneath in ochre rather than white — the
// engines literally float above the work they made.

// "Kling 2.5 Turbo Pro" -> "Kling", "GPT Image 2" -> "GPT Image".
// Versions and tier words date fast and add nothing on a marketing rail;
// the brand is the signal.
const VERSION_TOKEN = /^(v?\d+(\.\d+)*|o\d+|turbo|pro|standard|max|fast|lite)$/i;

export function brandName(name: string): string {
  const tokens = name.split(" ");
  while (tokens.length > 1 && VERSION_TOKEN.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

export function uniqueBrands(names: readonly string[]): string[] {
  return [...new Set(names.map(brandName))];
}

export async function EngineRail() {
  const { t } = await getServerMessages();
  const m = t.marketing.home;

  const engines: { name: string; capability: string }[] = [
    ...uniqueBrands(IMAGE_MODELS.map((model) => model.name)).map((name) => ({
      name,
      capability: m.engineImage,
    })),
    ...uniqueBrands(VIDEO_MODELS.map((model) => model.name)).map((name) => ({
      name,
      capability: m.engineVideo,
    })),
    // No catalogue for these two: speech goes through fal's ElevenLabs
    // endpoint (providers/fal.ts) and every prompt is drafted by Claude
    // (providers/anthropic.ts).
    { name: "ElevenLabs", capability: m.engineVoice },
    { name: "Claude", capability: m.engineScript },
  ];

  return (
    // Explicit slate/white/black values throughout, never the neutral scale
    // — same reason as the hero: the site's dark-mode remap must not touch
    // the marketing page.
    <div className="relative isolate overflow-hidden border-y border-slate-200 bg-slate-900">
      {/* The backdrop: three real generations, blurred past recognition and
          darkened, so the glass has something to actually refract. scale-110
          hides the soft edges blur leaves behind. aria-hidden — it carries
          no information a screen reader needs. */}
      <div aria-hidden className="absolute inset-0 -z-10 grid grid-cols-3 scale-110 blur-3xl">
        {[1, 2, 3].map((i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={`/api/showcase/${i}`} alt="" className="h-full w-full object-cover" />
        ))}
      </div>
      <div aria-hidden className="absolute inset-0 -z-10 bg-slate-950/70" />

      <div className="mx-auto max-w-6xl px-8 py-12">
        <p className="mb-5 text-center text-[10.5px] font-semibold uppercase tracking-[0.16em] text-onmedia/45">
          {m.engineEyebrow}
        </p>

        {/* The capsule. The underglow is a blurred ochre ellipse behind the
            glass rather than a box-shadow, so it spills past the pill's
            rounded ends the way real light would. */}
        <div className="relative mx-auto max-w-4xl">
          <div
            aria-hidden
            className="absolute inset-x-8 -bottom-6 h-12 rounded-[999px] bg-ochre/55 blur-2xl"
          />
          <div className="relative overflow-hidden rounded-[999px] border border-onmedia/15 bg-gradient-to-b from-onmedia/[0.14] to-black/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-14px_30px_-18px_rgba(233,160,119,0.6),0_24px_60px_-26px_rgba(0,0,0,0.85)] backdrop-blur-md backdrop-saturate-150">
            {/* Rim light along the top edge, fading at both ends. */}
            <div
              aria-hidden
              className="absolute inset-x-[8%] top-0 h-px bg-gradient-to-r from-transparent via-[rgb(255,220,190)]/75 to-transparent"
            />

            {/* Wide screens: everything on one line, evenly spaced.
                Narrow screens: a slow marquee (the track is rendered twice
                so the loop is seamless) with faded edges, because seven
                names either wrap into three ragged lines or get cut off. */}
            <div className="hidden items-center justify-center px-6 py-4 lg:flex">
              {engines.map((engine, i) => (
                <div key={engine.name} className="flex items-center">
                  {i > 0 && (
                    <span
                      aria-hidden
                      className="h-5 w-px bg-gradient-to-b from-transparent via-white/25 to-transparent"
                    />
                  )}
                  <EngineName name={engine.name} capability={engine.capability} />
                </div>
              ))}
            </div>

            <div className="relative overflow-hidden py-4 lg:hidden">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-slate-950/90 to-transparent"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-slate-950/90 to-transparent"
              />
              <div className="animate-engine-marquee flex w-max">
                {[0, 1].map((copy) => (
                  <div key={copy} className="flex" aria-hidden={copy === 1}>
                    {engines.map((engine) => (
                      <EngineName
                        key={engine.name}
                        name={engine.name}
                        capability={engine.capability}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-white/40">{m.engineNote}</p>
      </div>
    </div>
  );
}

function EngineName({ name, capability }: { name: string; capability: string }) {
  return (
    <span className="group whitespace-nowrap px-5 text-center transition-transform duration-200 hover:-translate-y-px">
      <span className="block font-display text-[14.5px] font-semibold tracking-[-0.01em] text-[rgb(244,239,233)] transition-colors group-hover:text-onmedia">
        {name}
      </span>
      <span className="mt-0.5 block text-[8.5px] font-medium uppercase tracking-[0.13em] text-onmedia/40 transition-colors group-hover:text-ochre">
        {capability}
      </span>
    </span>
  );
}
