import Link from "next/link";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

// The in-app tutorial, reachable from the sidebar's settings menu.
//
// The visuals are high-fidelity replicas of the real UI (composer, character
// gallery, result bubble, action row), rebuilt in code with the same Tailwind
// vocabulary the actual components use — not screenshots. Screenshots bake
// their text into pixels, so they can't translate and go stale the moment
// the UI changes; here every visible label is live i18n text overlaid on the
// drawing, and where the real app already has the string (the Identity photo
// badge, the match score line, the Live badge) the tutorial reuses that exact
// key, so the guide can never disagree with the product.

type Tu = Awaited<ReturnType<typeof getServerMessages>>["t"]["tutorial"];
type Msgs = Awaited<ReturnType<typeof getServerMessages>>["t"];

export default async function TutorialPage() {
  const { t } = await getServerMessages();
  const tu = t.tutorial;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
          {tu.eyebrow}
        </p>
        <h1 className="mt-1 font-numeral text-3xl font-semibold tracking-tight text-atelier-ink">
          {tu.title}
        </h1>
        <p className="mt-1 text-sm text-atelier-muted">{tu.subtitle}</p>
        {/* Cross-link to the photographed course (2026-08-25) — this page
            stays the never-stale i18n'd overview; the course is the deep
            walkthrough with real screenshots. */}
        <Link
          href="/guides/getting-started"
          className="mt-2 inline-block text-sm font-medium text-atelier-accent hover:underline"
        >
          {tu.courseLink}
        </Link>
      </div>

      <div className="space-y-6">
        <Section heading={tu.s1h} paragraphs={[tu.s1p1, tu.s1p2]}>
          <FlowVisual t={t} />
        </Section>

        <Section heading={tu.s2h} paragraphs={[tu.s2p1, tu.s2p2, tu.s2p3]}>
          <CharacterVisual t={t} />
        </Section>

        <Section heading={tu.s3h} paragraphs={[tu.s3p1, tu.s3p2, tu.s3p3]}>
          <ComposerVisual tu={tu} />
        </Section>

        <Section heading={tu.s4h} paragraphs={[tu.s4p1, tu.s4p2, tu.s4p3]}>
          <ResultVisual t={t} />
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
      <h2 className="text-sm font-semibold text-atelier-ink">{heading}</h2>
      <div className="mt-2 space-y-2.5">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed text-atelier-muted">
            {p}
          </p>
        ))}
      </div>
      {children && <div className="mt-5" aria-hidden>{children}</div>}
    </Card>
  );
}

/* =============================== pieces =============================== */

// A stand-in photo that reads as a person without being one: head-and-
// shoulders silhouette with a hair shape, over a soft studio gradient. The
// same face everywhere on the page — the whole tutorial is about one
// character staying consistent, so the visuals had better practice it.
function Portrait({ className = "" }: { className?: string }) {
  return (
    <div className={"relative overflow-hidden rounded-[12px] " + className}>
      <div className="absolute inset-0 bg-gradient-to-br from-amber-50 via-orange-100 to-rose-100" />
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full">
        {/* shoulders */}
        <path d="M8 64c0-13 10-20 24-20s24 7 24 20Z" fill="#d6bfa8" />
        {/* neck */}
        <rect x="27" y="34" width="10" height="10" rx="3" fill="#e2c6ac" />
        {/* face */}
        <ellipse cx="32" cy="26" rx="11" ry="12.5" fill="#eed3b8" />
        {/* hair — blonde bob, the tutorial character */}
        <path
          d="M32 10c-9 0-15 6-15 15 0 7 2 11 4 13 -1-6-1-12 3-15 2.5 3 12 4 16 1 3 3 4 9 3 14 2-2 4-6 4-13 0-9-6-15-15-15Z"
          fill="#d9a441"
        />
      </svg>
    </div>
  );
}

function ArrowDown() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-atelier-muted/50" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </svg>
  );
}

/* 1 — the loop: identity photo -> your words -> same person, scored */
function FlowVisual({ t }: { t: Msgs }) {
  const tu = t.tutorial;
  return (
    <div className="frost-ground flex flex-col items-center gap-2.5 rounded-[12px] border border-atelier-rule p-5">
      <div className="flex items-end gap-2">
        <Portrait className="h-20 w-20" />
        <span className="mb-1 rounded-full border border-atelier-rule bg-atelier-surface/95 px-2 py-0.5 text-[9px] font-medium uppercase tracking-widest text-atelier-ink">
          {t.character.identityPhoto}
        </span>
      </div>
      <ArrowDown />
      {/* the user's message, exactly as the chat renders one */}
      <div className="max-w-[280px] rounded-[18px] rounded-br-[6px] bg-atelier-surface px-4 py-2.5 text-xs leading-relaxed text-atelier-ink shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]">
        {tu.visPromptSample}
      </div>
      <ArrowDown />
      <div className="flex items-end gap-2">
        <Portrait className="h-20 w-20" />
        <span className="mb-1 rounded-full bg-atelier-surface/95 px-2 py-0.5 font-numeral text-[10px] font-medium tabular-nums text-atelier-accent shadow-[0_0_0_1px_var(--frost-ring)]">
          {formatMsg(t.generate.identityMatch, { n: 92 })}
        </span>
      </div>
    </div>
  );
}

/* 2 — the character page's reference gallery, as it really looks */
function CharacterVisual({ t }: { t: Msgs }) {
  const tu = t.tutorial;
  return (
    <div className="frost-ground rounded-[12px] border border-atelier-rule p-5">
      <div className="rounded-control border border-atelier-rule bg-atelier-surface p-5">
        <p className="text-sm font-semibold text-atelier-ink">Nova</p>
        <p className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{t.character.referenceImages}</p>
        <div className="mt-3 flex gap-2.5">
          <div className="relative">
            <Portrait className="h-[72px] w-[72px]" />
            <span className="absolute bottom-1 left-1 rounded-full border border-atelier-rule bg-atelier-surface/95 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest text-atelier-ink">
              {t.character.identityPhoto}
            </span>
          </div>
          {[0.85, 0.7].map((op) => (
            <div key={op} className="relative" style={{ opacity: op }}>
              <Portrait className="h-[72px] w-[72px]" />
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full border border-atelier-rule bg-atelier-surface/95 text-[9px] text-atelier-ink">
                ✕
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-1.5 border-t border-atelier-rule pt-3 text-xs text-atelier-muted">
          <p>{tu.visHair}</p>
          <p>{tu.visFeatures}</p>
          <p className="flex items-center gap-1.5">
            {tu.visOutfit}
            <span className="rounded-full border border-atelier-rule bg-atelier-paper px-1.5 py-0.5 text-[9px] text-atelier-muted">
              {tu.visDefaultTag}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

/* 3 — the composer, same bones as the real one in generate-form: a
   borderless floating glass dock, its edge drawn by the frost shadow ring */
function ComposerVisual({ tu }: { tu: Tu }) {
  return (
    <div className="frost-ground rounded-[12px] border border-atelier-rule p-5">
      <div className="rounded-[22px] bg-atelier-surface/90 p-3.5 shadow-[0_0_0_1px_var(--frost-ring),0_2px_6px_rgba(0,0,0,0.04),0_24px_56px_-20px_rgba(0,0,0,0.22)] backdrop-blur-xl">
        {/* the loadout row: the character chip with its face-lock meter */}
        <div className="flex items-center pb-2.5">
          <span className="flex items-center gap-2 rounded-full bg-atelier-ink/[0.045] py-1 pl-1 pr-2.5">
            <Portrait className="h-6 w-6 rounded-full" />
            <span className="text-xs font-medium text-atelier-ink">Nova</span>
            <span className="flex items-center gap-[2.5px]">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className={"h-[9px] w-[3px] rounded-[2px] " + (i < 3 ? "bg-atelier-accent" : "bg-atelier-accent/25")} />
              ))}
            </span>
            <svg viewBox="0 0 24 24" className="h-3 w-3 text-atelier-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </span>
        </div>
        <p className="px-1 pb-3 text-sm text-atelier-ink">{tu.visPromptSample}</p>
        <div className="flex items-center justify-between pt-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-atelier-rule text-atelier-muted">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <div className="flex items-center gap-1.5">
            {/* angles + storyboard, as on the video composer */}
            <span className="flex h-8 w-8 items-center justify-center rounded-full text-atelier-muted shadow-[inset_0_0_0_1px_var(--color-atelier-rule)]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 8 10 6 10-6" /><path d="m2 12 10 6 10-6" /></svg>
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full text-atelier-muted shadow-[inset_0_0_0_1px_var(--color-atelier-rule)]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="14" height="12" rx="2" /><path d="M7 3h14v12" /></svg>
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-atelier-ink text-atelier-paper shadow-[0_8px_18px_-8px_rgba(35,37,45,0.5)]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* 4 — a finished result, exactly as the chat shows one */
function ResultVisual({ t }: { t: Msgs }) {
  const tu = t.tutorial;
  const steps = [tu.visDrafted, tu.visValidated, tu.visGenerated];
  return (
    <div className="frost-ground rounded-[12px] border border-atelier-rule p-5">
      <div className="max-w-[380px] rounded-[18px] rounded-bl-[6px] bg-atelier-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]">
        <div className="flex flex-wrap items-center gap-2.5">
          {steps.map((label, i) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-atelier-rule" />
              <span className="text-[10px] font-medium uppercase tracking-widest text-atelier-muted">{label}</span>
              {i < steps.length - 1 && <span className="ml-1 h-px w-3 bg-atelier-rule" />}
            </span>
          ))}
        </div>
        <Portrait className="mt-3 h-36 w-full" />
        <div className="mt-2.5 flex items-center gap-2">
          <Badge tone="success">{t.generate.live}</Badge>
          <p className="font-numeral text-xs tabular-nums text-atelier-accent">{formatMsg(t.generate.passedOnAttempt, { n: 1 })}</p>
        </div>
        <p className="mt-1 font-numeral text-xs tabular-nums text-atelier-accent">{formatMsg(t.generate.identityMatch, { n: 92 })}</p>
        {/* the hover action row: copy · like · dislike · use as reference · report */}
        <div className="mt-2 flex items-center gap-1 text-atelier-muted">
          <span className="flex h-7 w-7 items-center justify-center rounded-full">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v11" /><path d="M7 10 11 3a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 1.94 2.49l-1.6 6.5A2 2 0 0 1 16.9 20H10a3 3 0 0 1-3-3v-7Z" /></svg>
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V3" /><path d="M17 14 13 21a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-1.94-2.49l1.6-6.5A2 2 0 0 1 7.1 4H14a3 3 0 0 1 3 3v7Z" /></svg>
          </span>
          <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-atelier-ink/5 text-atelier-ink">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /><circle cx="9" cy="9" r="2" /><path d="M16 5h6" /><path d="M19 2v6" /></svg>
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1Z" /><path d="M4 22V4" /></svg>
          </span>
        </div>
        {/* callout onto the highlighted button */}
        <div className="mt-1.5 flex items-center gap-1.5 pl-[84px]">
          <svg viewBox="0 0 24 24" className="h-3 w-3 -scale-y-100 text-atelier-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
          <span className="text-[10px] text-atelier-muted">{t.generate.useAsReference}</span>
        </div>
      </div>
    </div>
  );
}

/* 5 — multi-angle: one scene, three cameras */
function AnglesVisual() {
  return (
    <div className="frost-ground rounded-[12px] border border-atelier-rule p-5">
      <div className="flex justify-center gap-1.5 pb-3">
        {["A", "B", "C"].map((label, i) => (
          <span
            key={label}
            className={
              "rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-widest " +
              (i === 0 ? "border-atelier-ink bg-atelier-ink text-atelier-paper" : "border-atelier-rule text-atelier-muted")
            }
          >
            {label}
          </span>
        ))}
      </div>
      <div className="flex justify-center gap-3">
        {[1, 0.8, 0.65].map((op) => (
          <div key={op} style={{ opacity: op }}>
            <Portrait className="h-20 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* 6 — the usage meter from Settings, plus the refund promise */
function CreditsVisual({ tu }: { tu: Tu }) {
  return (
    <div className="frost-ground space-y-3 rounded-[12px] border border-atelier-rule p-5">
      <div className="rounded-control border border-atelier-rule bg-atelier-surface p-4">
        <div className="flex items-center justify-between text-xs text-atelier-muted">
          <span>{tu.visCredits}</span>
          <span className="font-numeral font-medium tabular-nums text-atelier-ink">34 / 50</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-atelier-ink/10">
          <div className="h-full w-[68%] rounded-full bg-atelier-accent" />
        </div>
      </div>
      <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        {tu.visRefunded}
      </span>
    </div>
  );
}
