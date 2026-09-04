import Link from "next/link";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  ProjectShelfCard,
  type ShelfProject,
} from "@/components/project-shelf-card";
import { Pager } from "@/components/pager";
import {
  PAGE_SIZES,
  pageBounds,
  pageHref,
  pageRange,
  parsePage,
  takePage,
} from "@/lib/pagination";
import { mediaUrl, thumbUrl } from "@/lib/media/url";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";

// Projects as THE SHELF — direction A from the design canvas, operator pick
// 2026-09-04 ("Go with A").
//
// What it replaces: a 672px column of rows, each a folder glyph, a name and
// "3 characters". That is a database row wearing an icon — it says nothing
// about what is in a project or whether it is alive, which are the only two
// questions a list of projects has to answer. It was also the last surface in
// the old heading dialect (18px sans, no eyebrow) and the ONLY library
// surface with no paging at all: not a large limit, none.
//
// Now a project leads with its cast — the actual faces — and carries three
// figures: renders, mean identity, last worked.
//
// HOW THE FIGURES ARE COUNTED, and its limit. A generation has no project_id;
// it links to a character, and a character links to a project. So the stats
// are assembled here: characters of the VISIBLE page's projects, then the
// generations belonging to those characters. That is bounded by the page (12
// projects), not by the account, which is what makes it safe to do in the
// page at all. It is still a client-side aggregate: past a few thousand
// renders per page of projects this wants a SQL view or a materialised count,
// and this comment is the marker for whoever hits that.
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const { t } = await getServerMessages();
  const p = t.projects;
  const raw = await searchParams;
  const showArchived = raw.view === "archived";
  const page = parsePage(raw.page);
  const size = PAGE_SIZES.projects;
  const { from, to } = pageRange(page, size);

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null; // AppLayout already redirects unauthenticated users to /login
  const userId = userData.user.id;

  const { data: projectRows, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .eq("is_archived", showArchived)
    .order("is_pinned", { ascending: false })
    .order("is_starred", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) console.error("Failed to load projects:", error);
  const { rows: pageProjects, hasNext } = takePage(projectRows ?? [], size);
  const projectIds = pageProjects.map((row) => row.id as string);

  // Characters of the visible projects, then their renders. Both queries are
  // skipped entirely when the page is empty rather than sent with an empty
  // `in` list, which PostgREST answers with everything.
  const { data: characters } = projectIds.length
    ? await supabase
        .from("character_profiles")
        .select("id, name, project_id, reference_image_urls, created_at")
        .eq("user_id", userId)
        .in("project_id", projectIds)
        .order("created_at", { ascending: false })
    : { data: [] as never[] };

  const characterIds = (characters ?? []).map((c) => c.id as string);
  const { data: renders } = characterIds.length
    ? await supabase
        .from("generations")
        .select("character_profile_id, match_score, created_at")
        .eq("user_id", userId)
        .eq("status", "succeeded")
        .is("deleted_at", null)
        .in("character_profile_id", characterIds)
    : { data: [] as never[] };

  // Fold the renders onto their project via the character that made them.
  const projectOfCharacter = new Map<string, string>();
  for (const c of characters ?? []) {
    if (c.project_id)
      projectOfCharacter.set(c.id as string, c.project_id as string);
  }
  type Stats = {
    renders: number;
    scoreTotal: number;
    scored: number;
    last: number | null;
  };
  const stats = new Map<string, Stats>();
  for (const r of renders ?? []) {
    const projectId = projectOfCharacter.get(r.character_profile_id as string);
    if (!projectId) continue;
    const s = stats.get(projectId) ?? {
      renders: 0,
      scoreTotal: 0,
      scored: 0,
      last: null,
    };
    s.renders += 1;
    if (typeof r.match_score === "number") {
      s.scoreTotal += r.match_score;
      s.scored += 1;
    }
    const at = new Date(r.created_at as string).getTime();
    if (s.last === null || at > s.last) s.last = at;
    stats.set(projectId, s);
  }

  const shelf: ShelfProject[] = pageProjects.map((row) => {
    const id = row.id as string;
    const cast = (characters ?? []).filter((c) => c.project_id === id);
    const s = stats.get(id);
    return {
      id,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      isPinned: Boolean(row.is_pinned),
      isStarred: Boolean(row.is_starred),
      isArchived: Boolean(row.is_archived),
      // Four faces, then a count — a fifth circle is noise at this size.
      faces: cast.slice(0, 4).map((c) => {
        const first = (c.reference_image_urls as string[] | null)?.[0];
        return {
          id: c.id as string,
          name: (c.name as string | null) ?? "",
          thumb: first
            ? thumbUrl(mediaUrl("character-references", first), 320)
            : null,
        };
      }),
      characterCount: cast.length,
      renderCount: s?.renders ?? 0,
      meanIdentity:
        s && s.scored > 0 ? Math.round(s.scoreTotal / s.scored) : null,
      lastWorkedAt: s?.last ? new Date(s.last).toISOString() : null,
    };
  });

  const labels = {
    since: {
      minutes: p.agoMinutes,
      hours: p.agoHours,
      days: p.agoDays,
      weeks: p.agoWeeks,
    },
    characters: p.castCount,
    noCharacters: p.noCast,
    renders: p.statRenders,
    identity: p.statIdentity,
    lastWorked: p.statLastWorked,
    pinned: p.pinnedLabel,
    never: p.statNever,
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            {p.eyebrow}
          </p>
          <h1 className="mt-1 font-numeral text-3xl font-semibold tracking-tight text-atelier-ink">
            {showArchived ? p.archivedTitle : p.title}
          </h1>
        </div>
        {!showArchived && (
          <Link href="/app/projects/new">
            <button className="inline-flex items-center justify-center gap-2 rounded-control bg-atelier-ink px-5 py-2.5 text-sm font-medium text-atelier-paper transition-opacity duration-150 hover:opacity-90">
              {p.newProject}
            </button>
          </Link>
        )}
      </div>

      <div className="mt-5 h-px bg-atelier-rule" />

      {error ? (
        <Card className="mt-5 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">
            {p.couldntLoad}
          </p>
        </Card>
      ) : shelf.length === 0 ? (
        <Card className="mt-5 text-center">
          <p className="text-sm text-atelier-muted">
            {showArchived ? p.noArchivedProjects : p.noProjectsYet}
          </p>
        </Card>
      ) : (
        <>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {shelf.map((project) => (
              <ProjectShelfCard
                key={project.id}
                project={project}
                labels={labels}
              />
            ))}
          </div>
          <Pager
            prevHref={
              page > 1 ? pageHref("/app/projects", raw, page - 1) : null
            }
            nextHref={hasNext ? pageHref("/app/projects", raw, page + 1) : null}
            label={formatMsg(
              t.history.pageRange,
              pageBounds(page, size, shelf.length),
            )}
            prevLabel={t.common.prev}
            nextLabel={t.common.next}
          />
        </>
      )}

      <p className="mt-6 text-center text-xs text-atelier-muted">
        {showArchived ? (
          <Link href="/app/projects" className="hover:text-atelier-ink">
            {p.backToActive}
          </Link>
        ) : (
          <Link
            href="/app/projects?view=archived"
            className="hover:text-atelier-ink"
          >
            {p.viewArchived}
          </Link>
        )}
      </p>
    </div>
  );
}
