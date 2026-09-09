import Link from "next/link";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

// The in-app tutorial, reachable from the sidebar's settings menu.
//
// The visuals are high-fidelity replicas of the real UI (stage, character
// gallery, composer, transcript bubble), rebuilt in code with the same
// Tailwind vocabulary the actual components use — not screenshots.
// Screenshots bake their text into pixels, so they can't translate and go
// stale the moment the UI changes; here every visible label is live i18n
// text overlaid on the drawing, and where the real app already has the
// string (the Identity photo badge, the Identity match label, the Live
// badge, Enhance, Render) the tutorial reuses that exact key, so the guide
// can never disagree with the product.
//
// REDRAWN 2026-09-09 after the Stage x Control Room merge (ebcdc63). What
// changed is WHICH surface these replicas depict, not whether it exists:
//
//   - A take now lands on the STAGE — a dark #1b1c20 box above the composer
//     that does not flip with the theme, with a proof plate in its corner
//     carrying the identity match. FlowVisual and ResultVisual used to draw
//     the take as a chat bubble. That bubble is still real, but it lives in
//     the Session transcript, which starts CLOSED (generate-form.tsx:3054) —
//     so the tutorial was teaching a secondary surface as the primary one.
//     The stage is drawn with the same fixed Darkroom literals the real one
//     uses (#cfc8ba text, #a39a88 muted, #e0a468 accent, #141519 plate),
//     because those are deliberately not theme tokens.
//
//   - "Passed on attempt 1 of 3" is unreachable: every call site guards on
//     attempts.length > 1 (the 2026-09-05 audit removed the n=1 case because
//     it implied a guarantee the gate never made). The old ResultVisual drew
//     exactly that suppressed case, so it is gone from here too.
//
//   - An identity score is CONDITIONAL, not universal — the gate skips the
//     free daily render by design (lib/generations/actions.ts, !consumeFree),
//     and a take with no character is never scored. The prose says so now.
//
//   - "Drafted -> Validated -> Generated" was never a control the product
//     draws. The real trace is a variable-length <ol> of the steps that were
//     actually logged, and its labels live in t.history (Drafted, Reviewed,
//     Generating, Validated). The three-chip row is gone rather than
//     re-lettered: a fixed trio would misstate a variable list.
//
//   - The composer's mode controls are LABELED pills, not unlabeled icon
//     circles — see the "A×B redesign" comment in generate-form.tsx, which
//     deleted the confusable 16px glyphs on purpose.

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
          <ComposerVisual t={t} tu={tu} />
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

// The stage, as generate-form draws it: a #1b1c20 box that deliberately does
// NOT flip with the theme, so everything painted on it is a fixed Darkroom
// literal rather than a token. Same radius and shadow as the real one.
function StageBox({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "relative overflow-hidden rounded-[16px] bg-atelier-stage shadow-[0_1px_2px_rgba(33,29,22,0.06),0_24px_60px_-28px_rgba(33,29,22,0.28)] " +
        className
      }
    >
      {children}
    </div>
  );
}

// The proof plate that sits in the stage's bottom-left corner once a take
// has landed: the character's photo as it was at submit time, the "Identity
// match" eyebrow, and the score. Drawn only where a score genuinely exists —
// see the note on conditional scoring in the header comment.
function ProofPlate({ t, score }: { t: Msgs; score: number }) {
  return (
    <div className="absolute bottom-4 left-[18px] flex items-center gap-3.5 rounded-[12px] border border-onmedia/[0.08] bg-[#141519]/[0.66] p-3 pr-[18px] backdrop-blur-[10px]">
      <Portrait className="h-[42px] w-[42px] flex-shrink-0 rounded-[8px]" />
      <div>
        <p className="text-[10px] font-medium uppercase tracking-widest text-onmedia/55">
          {t.generate.identityMatchLabel}
        </p>
        <span className="font-numeral text-2xl font-semibold tabular-nums text-[#e0a468]">
          {score}%
        </span>
      </div>
    </div>
  );
}

/* 1 — the loop: identity photo -> your words -> the same face on the stage,
   scored. The middle step is the composer's prompt line, which is where the
   words are actually typed; the take lands on the stage, not in a bubble. */
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
      {/* the composer's prompt line — a bare line inside the floating card,
          which is how the real one reads (no tinted fill: that is hero-only,
          and hero mode is unreachable) */}
      <div className="w-full max-w-[420px] rounded-[22px] bg-atelier-surface/90 px-4 py-3 shadow-[0_0_0_1px_var(--frost-ring),0_2px_6px_rgba(0,0,0,0.04)]">
        <p className="text-xs leading-relaxed text-atelier-ink">{tu.visPromptSample}</p>
      </div>
      <ArrowDown />
      {/* Wide enough that the plate sits BESIDE the face rather than over it.
          The real stage letterboxes a portrait the same way (object-contain). */}
      <StageBox className="w-full max-w-[420px]">
        <div className="flex h-[150px] w-full items-center justify-center">
          <Portrait className="h-full w-[104px] rounded-none" />
        </div>
        <ProofPlate t={t} score={92} />
      </StageBox>
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
   borderless floating glass dock, its edge drawn by the frost shadow ring.
   The controls beside Render are LABELED pills — the A×B redesign deleted
   the unlabeled icon circles this used to draw, and the ones it drew
   (multi-angle, storyboard) are video-only anyway, in a section about
   images. Enhance is what an image composer actually offers here. */
function ComposerVisual({ t, tu }: { t: Msgs; tu: Tu }) {
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
            {/* Prompt Studio, the one extra an image composer offers — an
                ochre-outlined pill, appearing once there's something to
                enhance */}
            <span className="flex items-center gap-1.5 rounded-full border border-atelier-accent/40 px-3 py-1.5 text-xs font-semibold text-atelier-accent">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></svg>
              {t.generate.enhance}
            </span>
            {/* the send button carries the word from sm up — ink for a
                render, ochre for an Ask */}
            <span className="flex h-9 items-center justify-center gap-2 rounded-[10px] bg-atelier-ink px-[18px] text-[13.5px] font-medium text-atelier-paper shadow-[0_8px_18px_-8px_rgba(35,37,45,0.5)]">
              {t.generate.sendRender}
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* 4 — a finished take, on the two surfaces it actually lives on.
   Top: the stage, which is what you meet — the take, a Download ghost, and
   the proof plate carrying the score. Bottom: the Session transcript, closed
   until you open it, where the working and the per-take actions live. */
function ResultVisual({ t }: { t: Msgs }) {
  return (
    <div className="frost-ground space-y-4 rounded-[12px] border border-atelier-rule p-5">
      <StageBox>
        <div className="flex h-[196px] w-full items-center justify-center">
          <Portrait className="h-full w-[150px] rounded-none" />
        </div>
        {/* the ghost cluster: Download is the only one an IMAGE take gets —
            Expand view and Upscale are both stageTakeIsVideo-gated */}
        <div className="absolute right-3.5 top-3.5 flex gap-2">
          <span
            title={t.generate.download}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-onmedia/10 text-[#cfc8ba]"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
          </span>
        </div>
        <ProofPlate t={t} score={92} />
      </StageBox>

      <div>
        <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
          {t.generate.sessionTranscript}
        </p>
        {/* the transcript bubble — still exactly this shape, just no longer
            the first thing you see */}
        <div className="max-w-[380px] rounded-[18px] rounded-bl-[6px] bg-atelier-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]">
          {/* the real bubble puts badge and score on ONE row */}
          <div className="flex items-center gap-2">
            <Badge tone="success">{t.generate.live}</Badge>
            <p className="font-numeral text-xs tabular-nums text-atelier-accent">{formatMsg(t.generate.identityMatch, { n: 92 })}</p>
          </div>
          {/* the action row: copy · like · dislike · use as reference · report.
              Five icons on an image take; the reference button is gated on
              promotable, so a video take gets four. */}
          <div className="mt-2.5 flex items-center gap-1 text-atelier-muted">
            <span title={t.generate.copyPrompt} className="flex h-7 w-7 items-center justify-center rounded-full">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>
            </span>
            <span title={t.generate.likeResult} className="flex h-7 w-7 items-center justify-center rounded-full">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v11" /><path d="M7 10 11 3a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 1.94 2.49l-1.6 6.5A2 2 0 0 1 16.9 20H10a3 3 0 0 1-3-3v-7Z" /></svg>
            </span>
            <span title={t.generate.dislikeResult} className="flex h-7 w-7 items-center justify-center rounded-full">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V3" /><path d="M17 14 13 21a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-1.94-2.49l1.6-6.5A2 2 0 0 1 7.1 4H14a3 3 0 0 1 3 3v7Z" /></svg>
            </span>
            <span title={t.generate.useAsReference} className="relative flex h-7 w-7 items-center justify-center rounded-full bg-atelier-ink/5 text-atelier-ink">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /><circle cx="9" cy="9" r="2" /><path d="M16 5h6" /><path d="M19 2v6" /></svg>
            </span>
            <span title={t.generate.reportProblem} className="flex h-7 w-7 items-center justify-center rounded-full">
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
