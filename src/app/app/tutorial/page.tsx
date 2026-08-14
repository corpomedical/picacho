import { getServerMessages } from "@/lib/i18n/server";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// The in-app tutorial, reachable from the sidebar's settings menu. The
// "visuals" are deliberately built as small mock-UI illustrations in code
// rather than screenshots: they can't go stale when the real UI evolves,
// they localize with the rest of the page, and they weigh nothing.

type Tu = Awaited<ReturnType<typeof getServerMessages>>["t"]["tutorial"];

export default async function TutorialPage() {
  const { t } = await getServerMessages();
  const tu = t.tutorial;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-lg font-semibold text-neutral-900">{tu.title}</h1>
        <p className="mt-1 text-sm text-neutral-500">{tu.subtitle}</p>
      </div>

      <div className="space-y-6">
        <Section heading={tu.s1h} paragraphs={[tu.s1p1, tu.s1p2]}>
          <FlowVisual tu={tu} />
        </Section>

        <Section heading={tu.s2h} paragraphs={[tu.s2p1, tu.s2p2, tu.s2p3]}>
          <CharacterVisual tu={tu} />
        </Section>

        <Section heading={tu.s3h} paragraphs={[tu.s3p1, tu.s3p2, tu.s3p3]} />

        <Section heading={tu.s4h} paragraphs={[tu.s4p1, tu.s4p2, tu.s4p3]}>
          <ResultVisual tu={tu} />
        </Section>

        <Section heading={tu.s5h} paragraphs={[tu.s5p1, tu.s5p2, tu.s5p3]}>
          <AnglesVisual />
        </Section>

        <Section heading={tu.s6h} paragraphs={[tu.s6p1, tu.s6p2, tu.s6p3]}>
          <CreditsVisual tu={tu} />
        </Section>

        <Section heading={tu.s7h} paragraphs={[tu.s7p1, tu.s7p2, tu.s7p3]} />
      </div>
    </div>
  );
}

function Section({
  heading,
  paragraphs,
  children,
}: {
  heading: string;
  paragraphs: string[];
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-neutral-900">{heading}</h2>
      <div className="mt-2 space-y-2.5">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed text-neutral-600">
            {p}
          </p>
        ))}
      </div>
      {children && <div className="mt-5" aria-hidden>{children}</div>}
    </Card>
  );
}

// ---- Visuals (decorative mock-UI, aria-hidden via Section) ----

// A stand-in "photo": soft gradient square with a simple person silhouette.
function Portrait({ className = "" }: { className?: string }) {
  return (
    <div
      className={
        "flex items-end justify-center overflow-hidden rounded-[10px] bg-gradient-to-br from-amber-100 via-rose-100 to-indigo-100 " +
        className
      }
    >
      <svg viewBox="0 0 40 28" className="w-3/4 text-neutral-400/70" fill="currentColor">
        <circle cx="20" cy="8" r="6" />
        <path d="M6 28c0-8 6-12 14-12s14 4 14 12H6Z" />
      </svg>
    </div>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 text-neutral-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function FlowVisual({ tu }: { tu: Tu }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[14px] border border-neutral-100 bg-neutral-50 p-4 sm:flex-row sm:justify-center">
      <div className="flex flex-col items-center gap-1.5">
        <Portrait className="h-16 w-16" />
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-600 shadow-sm">
          {tu.visIdentity}
        </span>
      </div>
      <div className="rotate-90 sm:rotate-0"><Arrow /></div>
      <div className="max-w-[220px] rounded-[14px] rounded-br-[4px] bg-neutral-900 px-3.5 py-2.5 text-xs leading-relaxed text-white">
        {tu.visPromptSample}
      </div>
      <div className="rotate-90 sm:rotate-0"><Arrow /></div>
      <div className="flex flex-col items-center gap-1.5">
        <Portrait className="h-16 w-16" />
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 shadow-sm">
          {tu.visMatch}
        </span>
      </div>
    </div>
  );
}

function CharacterVisual({ tu }: { tu: Tu }) {
  return (
    <div className="flex flex-col gap-4 rounded-[14px] border border-neutral-100 bg-neutral-50 p-4 sm:flex-row sm:items-center">
      <div className="flex gap-2">
        <div className="relative">
          <Portrait className="h-16 w-16" />
          <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-1.5 py-0.5 text-[9px] font-medium text-neutral-700 shadow-sm">
            {tu.visIdentity}
          </span>
        </div>
        <Portrait className="h-16 w-16 opacity-70" />
        <Portrait className="h-16 w-16 opacity-50" />
      </div>
      <div className="space-y-1.5 text-xs text-neutral-600">
        <p className="font-medium text-neutral-900">Nova</p>
        <p>{tu.visHair}</p>
        <p>{tu.visFeatures}</p>
        <p className="flex items-center gap-1.5">
          {tu.visOutfit}
          <span className="rounded-full border border-neutral-200 bg-white px-1.5 py-0.5 text-[9px] text-neutral-500">
            {tu.visDefaultTag}
          </span>
        </p>
      </div>
    </div>
  );
}

function StepDot({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span className="text-[11px] font-medium text-neutral-700">{label}</span>
    </span>
  );
}

function ResultVisual({ tu }: { tu: Tu }) {
  return (
    <div className="rounded-[14px] border border-neutral-100 bg-neutral-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <StepDot label={tu.visDrafted} />
        <span className="h-px w-4 bg-neutral-200" />
        <StepDot label={tu.visValidated} />
        <span className="h-px w-4 bg-neutral-200" />
        <StepDot label={tu.visGenerated} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Portrait className="h-14 w-14" />
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-emerald-700">{tu.visMatch}</p>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-5 w-5 rounded-full border border-neutral-200 bg-white" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AnglesVisual() {
  return (
    <div className="flex justify-center gap-3 rounded-[14px] border border-neutral-100 bg-neutral-50 p-4">
      {["A", "B", "C"].map((label) => (
        <div key={label} className="flex flex-col items-center gap-1.5">
          <Portrait className="h-14 w-20" />
          <span className="text-[10px] font-medium text-neutral-500">{label}</span>
        </div>
      ))}
    </div>
  );
}

function CreditsVisual({ tu }: { tu: Tu }) {
  return (
    <div className="space-y-3 rounded-[14px] border border-neutral-100 bg-neutral-50 p-4">
      <div>
        <div className="flex items-center justify-between text-[11px] text-neutral-600">
          <span>{tu.visCredits}</span>
          <span>34 / 50</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full w-[68%] rounded-full bg-neutral-900" />
        </div>
      </div>
      <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
        {tu.visRefunded}
      </span>
    </div>
  );
}
