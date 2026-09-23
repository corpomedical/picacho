import type { ComponentProps, SVGProps } from "react";
import Link from "next/link";
import type { Messages } from "@/lib/i18n/messages/en";
import { InstallAppHint } from "@/components/install-app-hint";
import { InviteCard } from "@/components/invite-card";
import { ReelBand } from "@/components/reel-band";
import { MomentumSurface } from "@/components/momentum-surface";
import { DashboardPromptBar } from "@/components/dashboard-prompt-bar";
import { EmptyState } from "@/components/ui/empty-state";

// The app's home, as markup only. The page (app/app/page.tsx) reads the
// session and gathers; this draws. Split out so the composition can be
// rendered on fixtures and looked at — the page itself cannot run without an
// account, which is how passes at this screen kept being judged on one piece
// at a time instead of the whole.

export type DashboardCharacter = { id: string; name: string; thumbUrl: string | null };

export type DashboardTile = {
  id: string;
  displayUrl: string;
  alt: string;
  isVideo: boolean;
  score: number | null;
};

type DashboardHomeProps = {
  d: Messages["dashboard"];
  /** The empty grid's call to action (t.gallery.generateOne). */
  generateOneLabel: string;
  reel: ComponentProps<typeof ReelBand>;
  momentum: ComponentProps<typeof MomentumSurface>;
  characters: DashboardCharacter[];
  recent: DashboardTile[];
  /** The person's own latest image and video frame, worn by the two create
      cards. Null falls back to Picacho stills with no face in them, so a new
      account never sees a stranger standing where their character will. */
  stills: { image: string | null; video: string | null };
  /** The course card, while someone is still new. */
  showCourseCard: boolean;
  inviteUsername: string | null;
  promptBar: ComponentProps<typeof DashboardPromptBar>;
};

export function DashboardHome({
  d,
  generateOneLabel,
  reel,
  momentum,
  characters,
  recent,
  stills,
  showCourseCard,
  inviteUsername,
  promptBar,
}: DashboardHomeProps) {
  const actions = [
    { href: "/app/generate?type=image", label: d.quickImage, icon: ImageIcon, still: stills.image ?? "/presets/western-sunset.jpg" },
    { href: "/app/generate?type=video", label: d.quickVideo, icon: FilmIcon, still: stills.video ?? "/presets/aerial-pullback.jpg" },
    { href: "/app/tutorial", label: d.quickTutorial, icon: BookIcon, still: "/presets/crane-reveal.jpg" },
  ];

  return (
    <div data-dash className="mx-auto max-w-3xl space-y-9 sm:space-y-11">
      {/* Cinema first, working surface under it — direction F. The band is not
          a card on a dashboard; it is the top of the page, and the sheet below
          rides up over its bottom edge. */}
      <div data-dash-hero className="rounded-card">
        <ReelBand {...reel} />
        <MomentumSurface {...momentum} />
      </div>

      {/* Quick actions, as picture cards: the person's own latest image and
          video frame behind the two ways to make another. A card of work reads
          as a door into more of it; an icon on an empty tile read as a form. */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {actions.map(({ href, label, icon: Icon, still }) => (
          <Link
            key={href}
            href={href}
            data-dash-media
            className="group relative flex aspect-[4/5] flex-col justify-between overflow-hidden rounded-card bg-[#0e0d0c] p-3 ring-1 ring-atelier-rule sm:aspect-[16/11] sm:p-4"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={still}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover opacity-70 transition-[transform,opacity] duration-500 ease-out group-hover:scale-[1.04] group-hover:opacity-85"
            />
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-[#0e0d0c] via-[#0e0d0c]/35 to-[#0e0d0c]/10"
            />
            <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-onmedia ring-1 ring-onmedia/20 backdrop-blur-md">
              <Icon className="h-4 w-4" />
            </span>
            <span className="relative flex items-end justify-between gap-2">
              <span className="text-[12.5px] font-semibold leading-snug text-onmedia sm:text-sm">{label}</span>
              <span
                aria-hidden
                className="hidden flex-none text-sm text-onmedia/60 transition-transform duration-200 group-hover:translate-x-0.5 sm:block"
              >
                →
              </span>
            </span>
          </Link>
        ))}
      </div>

      {/* The course card (2026-08-25) — shown while someone is still new
          (fewer than 3 successful images on the wall). It sells the course
          on its two honest hooks: real screenshots, and not wasting credits.
          Disappears on its own once they're clearly up and running. */}
      {showCourseCard && (
        <Link
          href="/guides/getting-started"
          data-dash-slab
          className="flex items-center gap-4 rounded-card border border-atelier-accent/25 bg-atelier-accent/[0.06] p-4 transition-colors hover:border-atelier-accent/50 sm:p-5"
        >
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-atelier-accent/15 text-atelier-accent">
            <BookIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-atelier-ink">{d.courseCardTitle}</span>
            <span className="mt-0.5 block text-xs leading-snug text-atelier-muted">{d.courseCardBody}</span>
            {/* Under the words on a phone, where beside them it squeezed the
                body into a five-line column. */}
            <span className="mt-2 block text-xs font-semibold text-atelier-accent sm:hidden">{d.courseCardCta} →</span>
          </span>
          <span className="hidden flex-shrink-0 text-xs font-semibold text-atelier-accent sm:block">{d.courseCardCta} →</span>
        </Link>
      )}

      {/* The cast, as portraits: faces are the product, so they get the room
          a face needs instead of a 64px coin. */}
      <section>
        <SectionHead title={d.yourCharacters} href="/app/character" seeAll={d.seeAll} />
        <div className="-mx-4 flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:scroll-px-0 sm:gap-3 sm:px-0 [&::-webkit-scrollbar]:hidden">
          {characters.map((c) => (
            <Link
              key={c.id}
              href={`/app/generate?character=${c.id}`}
              data-dash-media
              className="group relative aspect-[3/4] w-[92px] flex-none snap-start overflow-hidden rounded-media bg-atelier-ink/5 ring-1 ring-atelier-rule sm:w-[112px]"
            >
              {c.thumbUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.thumbUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]"
                />
              )}
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 to-transparent" />
              <span className="absolute inset-x-2 bottom-2 truncate text-[12px] font-semibold text-onmedia">{c.name}</span>
            </Link>
          ))}
          <Link
            href="/app/character/new"
            className="flex aspect-[3/4] w-[92px] flex-none snap-start flex-col items-center justify-center gap-2 rounded-media border border-dashed border-atelier-rule text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink sm:w-[112px]"
          >
            <PlusIcon className="h-5 w-5" />
            <span className="max-w-full truncate px-2 text-[11px]">{d.newCharacter}</span>
          </Link>
        </div>
      </section>

      {/* Recent takes, as a contact sheet: the newest one large, each with the
          score it earned and a mark when it moves. */}
      <section>
        <SectionHead title={d.recentCreations} href="/app/images" seeAll={d.seeAll} />
        {recent.length === 0 ? (
          <EmptyState message={d.emptyRecent} action={{ href: "/app/generate", label: generateOneLabel }} />
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {recent.map((g, i) => (
              <Link
                key={g.id}
                href={`/app/history/${g.id}`}
                data-dash-media
                className={`group relative aspect-square overflow-hidden rounded-media bg-atelier-ink/5 ring-1 ring-atelier-rule ${
                  i === 0 && recent.length >= 3 ? "col-span-2 row-span-2" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={g.displayUrl}
                  alt={g.alt}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                />
                {typeof g.score === "number" && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/55 px-1.5 py-0.5 font-numeral text-[10.5px] leading-none tabular-nums text-onmedia backdrop-blur-sm">
                    {g.score}
                  </span>
                )}
                {g.isVideo && (
                  <span className="absolute bottom-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-[7px] text-onmedia backdrop-blur-sm">
                    ▶
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Referral tile (2026-08-22): the dashboard is the highest-traffic
          surface in the product — a referral card only in Settings referred
          nobody. Same component the settings sheet uses. data-dash-foot
          gives it and the install hint the page's slab in dark. */}
      <div data-dash-foot className="space-y-4">
        {inviteUsername && <InviteCard username={inviteUsername} />}
        <InstallAppHint />
      </div>

      <DashboardPromptBar {...promptBar} />
    </div>
  );
}

// A section's head: the slate label, a hairline to the edge, and the way in.
function SectionHead({ title, href, seeAll }: { title: string; href: string; seeAll: string }) {
  return (
    <div className="mb-3.5 flex items-center gap-3">
      <h2 className="flex-none text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{title}</h2>
      <span aria-hidden className="h-px flex-1 bg-atelier-rule" />
      <Link
        href={href}
        className="group flex flex-none items-center gap-1 text-xs text-atelier-muted transition-colors hover:text-atelier-ink"
      >
        {seeAll}
        <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
      </Link>
    </div>
  );
}

function ImageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function FilmIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
