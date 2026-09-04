import Link from "next/link";
import { Pager } from "@/components/pager";
import { LocalDate } from "@/components/local-date";
import { QuietVideo } from "@/components/quiet-video";
import { getServerMessages } from "@/lib/i18n/server";

// Inside a project — THE WORKBENCH, direction A, operator pick 2026-09-04.
//
// What it replaces was a settings form: two p-8 sheets in a 672px column, a
// name and description, then the cast as a list of NAMES with Remove beside
// each. None of the work was on it. The Shelf card the list page now shows
// promises faces and figures; opening the project made both disappear, which
// is the worst kind of inconsistency — the summary was richer than the thing
// it summarised.
//
// Now the page IS the work: the same three figures the card carries, the cast
// as faces, then everything made in this project. Settings fold away at the
// bottom, the same idiom the render page uses for its attempt log, because
// the common visit is looking rather than renaming.
//
// The layout lives here, apart from the page that queries for it, so it can
// be rendered from mock data without a session — the only way to actually
// LOOK at a signed-in page from a dev machine that isn't signed in.
export type WorkbenchCast = { id: string; name: string; face: string | null };
export type WorkbenchItem = { id: string; url: string; isVideo: boolean; score: number | null };

export async function ProjectWorkbench({
  project,
  cast,
  work,
  stats,
  pager,
  settings,
}: {
  project: { name: string; description: string | null };
  cast: WorkbenchCast[];
  work: WorkbenchItem[];
  stats: { renders: number; meanIdentity: number | null; lastWorkedAt: string | null };
  pager: { prevHref: string | null; nextHref: string | null; label: string };
  /** The forms. They carry server actions, so they are built by the page. */
  settings: React.ReactNode;
}) {
  const { t } = await getServerMessages();
  const p = t.projects;

  return (
    <div>
      <Link
        href="/app/projects"
        className="text-sm text-atelier-muted transition-colors hover:text-atelier-ink"
      >
        {p.backToProjects}
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            {p.eyebrowOne}
          </p>
          <h1 className="mt-1 font-numeral text-3xl font-semibold tracking-tight text-atelier-ink">
            {project.name}
          </h1>
          {project.description && (
            <p className="mt-1.5 max-w-prose text-sm text-atelier-muted">{project.description}</p>
          )}
        </div>
        <dl className="flex flex-shrink-0 gap-8">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
              {p.statRenders}
            </dt>
            <dd className="mt-1 font-numeral text-[22px] font-semibold leading-none tabular-nums text-atelier-ink">
              {stats.renders}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
              {p.statIdentity}
            </dt>
            <dd
              className={
                stats.meanIdentity === null
                  ? "mt-1 font-numeral text-[22px] font-semibold leading-none tabular-nums text-atelier-muted"
                  : "mt-1 font-numeral text-[22px] font-semibold leading-none tabular-nums text-atelier-accent"
              }
            >
              {stats.meanIdentity ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
              {p.statLastWorked}
            </dt>
            <dd className="mt-1 font-numeral text-[22px] font-semibold leading-none tabular-nums text-atelier-ink">
              {stats.lastWorkedAt ? (
                <LocalDate
                  date={stats.lastWorkedAt}
                  mode="since"
                  labels={{ minutes: p.agoMinutes, hours: p.agoHours, days: p.agoDays, weeks: p.agoWeeks }}
                />
              ) : (
                p.statNever
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-5 h-px bg-atelier-rule" />

      {/* THE CAST — faces, not a list of names. Each one opens the character. */}
      <h2 className="mt-5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
        {p.charactersInProject}
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        {cast.map((member) => (
          <Link
            key={member.id}
            href={`/app/character/${member.id}`}
            className="flex items-center gap-2.5 rounded-[12px] border border-atelier-rule bg-atelier-surface p-1.5 pr-3.5 transition-colors hover:border-atelier-muted"
          >
            <span className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-atelier-stage">
              {member.face ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={member.face} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <span className="flex h-full w-full items-center justify-center font-display text-xs font-semibold text-atelier-paper/70">
                  {member.name?.[0]?.toUpperCase() ?? "?"}
                </span>
              )}
            </span>
            <span className="whitespace-nowrap text-[13px] font-medium text-atelier-ink">
              {member.name}
            </span>
          </Link>
        ))}
        <Link
          href="/app/character/new"
          className="rounded-[12px] border-[1.5px] border-dashed border-atelier-rule px-4 py-2.5 text-[13px] text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink"
        >
          {p.newCharacter}
        </Link>
      </div>

      {/* THE WORK — everything made in this project. */}
      <h2 className="mt-7 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
        {p.theWork}
      </h2>
      {work.length === 0 ? (
        <p className="mt-3 text-sm text-atelier-muted">
          {cast.length === 0 ? p.noCharactersYet : p.noWorkYet}
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {work.map((r) => (
              <Link
                key={r.id}
                href={`/app/history/${r.id}`}
                className="group relative block aspect-[4/3] overflow-hidden rounded-media bg-atelier-stage"
              >
                {r.isVideo ? (
                  <QuietVideo
                    pending="disc"
                    src={`${r.url}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                )}
                {typeof r.score === "number" && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-[#1b1c20]/72 px-2 py-1 backdrop-blur-sm">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#e0a468]" />
                    <span className="font-numeral text-[11px] font-semibold tabular-nums text-[#f4ede4]">
                      {r.score}
                    </span>
                  </span>
                )}
              </Link>
            ))}
          </div>
          <Pager
            prevHref={pager.prevHref}
            nextHref={pager.nextHref}
            label={pager.label}
            prevLabel={t.common.prev}
            nextLabel={t.common.next}
          />
        </>
      )}

      {/* SETTINGS, FOLDED. Same idiom as the render page's attempt log: kept,
          reachable, and not standing between someone and their own work. */}
      <details className="group mt-8 border-t border-atelier-rule pt-5">
        <summary className="flex cursor-pointer list-none items-center justify-between">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            {p.projectDetails}
          </h2>
          <span className="flex items-center gap-2 text-xs text-atelier-muted">
            {p.showSettings}
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="h-3.5 w-3.5 transition-transform group-[[open]]:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </summary>
        {settings}
      </details>
    </div>
  );
}
