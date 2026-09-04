import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  saveProject,
  assignCharacterToProject,
  removeCharacterFromProject,
} from "@/lib/projects/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { DeleteProjectButton } from "@/components/delete-project-button";
import { ProjectWorkbench } from "@/components/project-workbench";
import { PAGE_SIZES, pageBounds, pageHref, pageRange, parsePage, takePage } from "@/lib/pagination";
import { mediaUrl, thumbUrl, toMediaUrl, isRenderableUrl } from "@/lib/media/url";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";

// The queries behind the Workbench. The layout itself lives in
// components/project-workbench.tsx — see the note there for the redesign.
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const FIELD =
  "w-full rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink placeholder:text-atelier-muted/60 outline-none transition-colors focus:border-atelier-accent";

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; page?: string }>;
}) {
  const { t } = await getServerMessages();
  const p = t.projects;
  const { id } = await params;
  const raw = await searchParams;
  const error = raw.error;
  const page = parsePage(raw.page);
  const size = PAGE_SIZES.projectWork;
  const { from, to } = pageRange(page, size);

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");
  const userId = userData.user.id;

  // .eq("user_id", ...) here isn't optional — an admin's SELECT policy
  // intentionally allows reading every user's projects (for /admin), so
  // without this an admin could open, edit, or delete someone else's
  // project through this page's own forms.
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  // Same reasoning as the History detail page: deleting the project you're
  // viewing re-renders this route before the redirect lands, so a 404 would
  // be the last thing you saw. Send people back to the list instead.
  if (!project) redirect("/app/projects");

  const { data: characters } = await supabase
    .from("character_profiles")
    .select("id, name, reference_image_urls")
    .eq("project_id", id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  // Every other character this user owns — unassigned ones and ones sitting
  // in a different project — so any of them can be moved into this one.
  // Plain .neq("project_id", id) would silently drop the unassigned ones:
  // SQL's <> against NULL is never true (the bug that hid 45 of 47 images
  // from the Layers picker on 2026-09-02), so it is spelled out.
  const { data: availableCharacters } = await supabase
    .from("character_profiles")
    .select("id, name")
    .eq("user_id", userId)
    .or(`project_id.is.null,project_id.neq.${id}`)
    .order("name", { ascending: true });

  const castIds = (characters ?? []).map((c) => c.id as string);

  // The work, and the figures. Both come from the characters in this project,
  // because a generation has no project_id of its own — see the note on the
  // projects list page. The grid is paged; the FIGURES are counted from a
  // separate, wider read so they describe the project rather than the page.
  const [{ data: workRows }, { data: statRows }] = await Promise.all([
    castIds.length
      ? supabase
          .from("generations")
          .select("id, result_url, content_type, match_score")
          .eq("user_id", userId)
          .in("character_profile_id", castIds)
          .eq("status", "succeeded")
          .is("deleted_at", null)
          .not("result_url", "is", null)
          .order("created_at", { ascending: false })
          .range(from, to)
      : Promise.resolve({ data: [] as never[] }),
    castIds.length
      ? supabase
          .from("generations")
          .select("match_score, created_at")
          .eq("user_id", userId)
          .in("character_profile_id", castIds)
          .eq("status", "succeeded")
          .is("deleted_at", null)
          // Bounded so one enormous project cannot make this page slow. The
          // figures are then "across the most recent 500", which is honest at
          // this scale and wants a SQL view past it.
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const { rows: pageWork, hasNext } = takePage(workRows ?? [], size);
  const work = pageWork
    .map((r) => {
      const url = toMediaUrl(r.result_url as string | null) ?? "";
      const isVideo = r.content_type === "video";
      return {
        id: r.id as string,
        isVideo,
        // thumbUrl on a video URL yields something neither <img> nor <video>
        // can show — the broken lineage tile, 2026-09-03.
        url: isRenderableUrl(url) ? (isVideo ? url : (thumbUrl(url, 640) ?? url)) : "",
        score: (r.match_score as number | null) ?? null,
      };
    })
    .filter((r) => r.url);

  const scored = (statRows ?? []).filter((r) => typeof r.match_score === "number");

  return (
    <ProjectWorkbench
      project={{ name: project.name, description: project.description ?? null }}
      cast={(characters ?? []).map((c) => {
        const first = (c.reference_image_urls as string[] | null)?.[0];
        return {
          id: c.id as string,
          name: c.name as string,
          face: first ? (thumbUrl(mediaUrl("character-references", first), 320) ?? null) : null,
        };
      })}
      work={work}
      stats={{
        renders: (statRows ?? []).length,
        meanIdentity:
          scored.length > 0
            ? Math.round(scored.reduce((n, r) => n + (r.match_score as number), 0) / scored.length)
            : null,
        lastWorkedAt: ((statRows ?? [])[0]?.created_at as string | undefined) ?? null,
      }}
      pager={{
        prevHref: page > 1 ? pageHref(`/app/projects/${id}`, raw, page - 1) : null,
        nextHref: hasNext ? pageHref(`/app/projects/${id}`, raw, page + 1) : null,
        label: formatMsg(t.history.pageRange, pageBounds(page, size, work.length)),
      }}
      settings={
        <>
          <form action={saveProject} className="mt-5 max-w-xl space-y-4">
            <input type="hidden" name="id" value={project.id} />
            <div>
              <label htmlFor="name" className={LABEL}>
                {p.projectName}
              </label>
              <input id="name" className={FIELD} name="name" defaultValue={project.name} required />
            </div>
            <div>
              <label htmlFor="description" className={LABEL}>
                {p.descriptionLabel}
              </label>
              <textarea
                id="description"
                className={`resize-none ${FIELD}`}
                name="description"
                rows={3}
                defaultValue={project.description ?? ""}
                placeholder={p.descriptionPlaceholder}
              />
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end">
              <SubmitButton
                className="rounded-control! bg-atelier-ink! text-atelier-paper! shadow-none! hover:bg-atelier-ink/90!"
                pendingLabel={p.savingChanges}
              >
                {p.saveChanges}
              </SubmitButton>
            </div>
          </form>

          {(characters ?? []).length > 0 && (
            <div className="mt-6 max-w-xl">
              <p className={LABEL}>{p.charactersInProject}</p>
              <ul className="space-y-2">
                {(characters ?? []).map((c) => (
                  <li key={c.id as string} className="flex items-center gap-2">
                    <span className="flex-1 rounded-control border border-atelier-rule/60 px-4 py-2.5 text-sm text-atelier-ink">
                      {c.name as string}
                    </span>
                    <form action={removeCharacterFromProject}>
                      <input type="hidden" name="project_id" value={project.id} />
                      <input type="hidden" name="character_id" value={c.id as string} />
                      <SubmitButton
                        variant="ghost"
                        size="sm"
                        pendingLabel={p.removeFromProject}
                        className="text-atelier-muted! hover:text-red-600! dark:hover:text-red-400!"
                      >
                        {p.removeFromProject}
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {availableCharacters && availableCharacters.length > 0 && (
            <form action={assignCharacterToProject} className="mt-6 max-w-xl">
              <input type="hidden" name="project_id" value={project.id} />
              <p className={LABEL}>{p.assignCharacter}</p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-control border border-atelier-rule p-2">
                {availableCharacters.map((c) => (
                  <label
                    key={c.id as string}
                    className="flex items-center gap-2.5 rounded-control px-2 py-1.5 text-sm text-atelier-ink transition-colors hover:bg-atelier-ink/5"
                  >
                    <input
                      type="checkbox"
                      name="character_id"
                      value={c.id as string}
                      className="h-3.5 w-3.5 flex-shrink-0 rounded border-atelier-rule accent-atelier-accent"
                    />
                    {c.name as string}
                  </label>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <SubmitButton
                  className="rounded-control! bg-atelier-ink! text-atelier-paper! shadow-none! hover:bg-atelier-ink/90!"
                  pendingLabel={p.assigning}
                  size="sm"
                >
                  {p.assign}
                </SubmitButton>
              </div>
            </form>
          )}

          <div className="mt-6">
            <DeleteProjectButton id={project.id} name={project.name} />
          </div>
        </>
      }
    />
  );
}
