import Link from "next/link";
import { LocalDate } from "@/components/local-date";
import { Card } from "@/components/ui/card";
import { ProjectRow } from "@/components/project-row";

// A project card in the Shelf (direction A, operator pick 2026-09-04).
//
// The old row was a folder glyph, a name, and "3 characters" — a database row
// wearing an icon. A project here is a cast and a body of work, so the card
// leads with the faces in it and then answers the only question a list of
// projects has to answer: is this one alive? Renders, mean identity, last
// worked. The figures are the Ledger's: serif tabular numerals, ochre reserved
// for the identity score because that is proof.

export type ShelfProject = {
  id: string;
  name: string;
  description: string | null;
  isPinned: boolean;
  isStarred: boolean;
  isArchived: boolean;
  /** Character thumbnails, newest first, already resized. */
  faces: { id: string; name: string; thumb: string | null }[];
  characterCount: number;
  renderCount: number;
  /** Mean identity across scored renders, or null when nothing is scored. */
  meanIdentity: number | null;
  /** ISO timestamp of the newest render, or null when nothing has been made.
   *  Formatted against the VIEWER's clock — see LocalDate's "since" mode. */
  lastWorkedAt: string | null;
};

export function ProjectShelfCard({
  project,
  labels,
}: {
  project: ShelfProject;
  labels: {
    characters: string;
    noCharacters: string;
    renders: string;
    identity: string;
    lastWorked: string;
    pinned: string;
    never: string;
    since: { minutes: string; hours: string; days: string; weeks: string };
  };
}) {
  return (
    <Card pad="none" className="relative flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The whole card opens the project; the menu sits above it as a
              sibling, never nested inside the link. */}
          <Link href={`/app/projects/${project.id}`} className="peer">
            <span
              aria-hidden
              className="absolute inset-0 z-0 rounded-control"
            />
            <h2 className="relative z-[1] truncate text-[15px] font-semibold text-atelier-ink">
              {project.name}
            </h2>
          </Link>
          {project.description && (
            <p className="mt-1 line-clamp-1 text-xs text-atelier-muted">
              {project.description}
            </p>
          )}
        </div>
        <div className="relative z-[2] flex flex-shrink-0 items-center gap-2">
          {project.isPinned && (
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-accent">
              {labels.pinned}
            </span>
          )}
          {/* The one control, shared with the sidebar's row — rename, star,
              pin, archive, delete all live in it. */}
          <ProjectRow
            variant="menu"
            project={{
              id: project.id,
              name: project.name,
              description: project.description,
              is_starred: project.isStarred,
              is_pinned: project.isPinned,
              is_archived: project.isArchived,
            }}
          />
        </div>
      </div>

      {/* The cast. Overlapping circles rather than a count, because "who is in
          this" is the thing a person actually recognises. */}
      <div className="relative z-[1] mt-3.5 flex items-center gap-3">
        {project.faces.length > 0 ? (
          <>
            <div className="flex items-center">
              {project.faces.map((face) => (
                <span
                  key={face.id}
                  title={face.name}
                  className="-mr-2.5 h-10 w-10 overflow-hidden rounded-full border-2 border-atelier-paper bg-atelier-stage last:mr-0"
                >
                  {face.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={face.thumb}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center font-display text-sm font-semibold text-atelier-paper/70">
                      {face.name?.[0]?.toUpperCase() ?? "?"}
                    </span>
                  )}
                </span>
              ))}
            </div>
            <span className="ml-2 text-xs text-atelier-muted">
              {project.characterCount} {labels.characters}
            </span>
          </>
        ) : (
          <span className="text-xs text-atelier-muted">
            {labels.noCharacters}
          </span>
        )}
      </div>

      <dl className="relative z-[1] mt-4 flex gap-7 border-t border-atelier-rule pt-3">
        <div>
          <dt className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            {labels.renders}
          </dt>
          <dd className="mt-1 font-numeral text-[19px] font-semibold leading-none tabular-nums text-atelier-ink">
            {project.renderCount}
          </dd>
        </div>
        <div>
          <dt className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            {labels.identity}
          </dt>
          {/* An em dash, not a zero: nothing scored is not a score of nothing. */}
          <dd
            className={
              project.meanIdentity === null
                ? "mt-1 font-numeral text-[19px] font-semibold leading-none tabular-nums text-atelier-muted"
                : "mt-1 font-numeral text-[19px] font-semibold leading-none tabular-nums text-atelier-accent"
            }
          >
            {project.meanIdentity ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            {labels.lastWorked}
          </dt>
          <dd className="mt-1 font-numeral text-[19px] font-semibold leading-none tabular-nums text-atelier-ink">
            {project.lastWorkedAt ? (
              <LocalDate
                date={project.lastWorkedAt}
                mode="since"
                labels={labels.since}
              />
            ) : (
              labels.never
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
