import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveProject, assignCharacterToProject, removeCharacterFromProject } from "@/lib/projects/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { DeleteProjectButton } from "@/components/delete-project-button";
import { getServerMessages } from "@/lib/i18n/server";

// Atelier form idiom (settings-popover, extended): paper sheets with caps
// section titles, caps labels over ink-hairline fields at the control
// radius; accent only marks focus and checkbox ticks.
const SHEET = "rounded-control border border-atelier-rule bg-atelier-surface p-8";
const SHEET_TITLE = "text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const FIELD =
  "w-full rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink placeholder:text-atelier-muted/60 outline-none transition-colors focus:border-atelier-accent";

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { t } = await getServerMessages();
  const p = t.projects;
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  // .eq("user_id", ...) here isn't optional — an admin's SELECT policy
  // intentionally allows reading every user's projects (for /admin), so
  // without this an admin could open, edit, or delete someone else's
  // project via this page's own forms.
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", userData.user.id)
    .single();

  // Same reasoning as the History detail page: deleting the project you're
  // viewing re-renders this route before the redirect lands, so a 404 would
  // be the last thing you saw. Send people back to the list instead.
  if (!project) redirect("/app/projects");

  const { data: characters } = await supabase
    .from("character_profiles")
    .select("id, name")
    .eq("project_id", id)
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false });

  // Every other character this user owns — unassigned ones and ones sitting
  // in a different project — so any of them can be moved into this one
  // instead of only being assignable from the character's own edit page.
  // Plain .neq("project_id", id) would silently drop unassigned characters:
  // SQL's <> against NULL is never true, so it has to be spelled out with
  // an explicit "or is null" instead.
  const { data: availableCharacters } = await supabase
    .from("character_profiles")
    .select("id, name")
    .eq("user_id", userData.user.id)
    .or(`project_id.is.null,project_id.neq.${id}`)
    .order("name", { ascending: true });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/app/projects" className="text-sm text-atelier-muted hover:text-atelier-ink">
        {p.backToProjects}
      </Link>

      <div className={SHEET}>
        <h2 className={SHEET_TITLE}>{p.projectDetails}</h2>
        <form action={saveProject} className="mt-4 space-y-4">
          <input type="hidden" name="id" value={project.id} />
          <div>
            <label htmlFor="name" className={LABEL}>{p.projectName}</label>
            <input id="name" className={FIELD} name="name" defaultValue={project.name} required />
          </div>
          <div>
            <label htmlFor="description" className={LABEL}>{p.descriptionLabel}</label>
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
      </div>

      <div className={SHEET}>
        <div className="flex items-center justify-between">
          <h2 className={SHEET_TITLE}>{p.charactersInProject}</h2>
          <Link href="/app/character/new" className="text-xs text-atelier-muted hover:text-atelier-ink">
            {p.newCharacter}
          </Link>
        </div>
        {!characters || characters.length === 0 ? (
          <p className="mt-3 text-sm text-atelier-muted">
            {p.noCharactersYet}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {characters.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <Link
                  href={`/app/character/${c.id}`}
                  className="block flex-1 rounded-control border border-atelier-rule/60 px-4 py-2.5 text-sm text-atelier-ink transition-colors hover:border-atelier-muted"
                >
                  {c.name}
                </Link>
                <form action={removeCharacterFromProject}>
                  <input type="hidden" name="project_id" value={project.id} />
                  <input type="hidden" name="character_id" value={c.id} />
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
        )}

        {availableCharacters && availableCharacters.length > 0 ? (
          <form action={assignCharacterToProject} className="mt-4 border-t border-atelier-rule/60 pt-4">
            <input type="hidden" name="project_id" value={project.id} />
            <p className={LABEL}>{p.assignCharacter}</p>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-control border border-atelier-rule p-2">
              {availableCharacters.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2.5 rounded-control px-2 py-1.5 text-sm text-atelier-ink transition-colors hover:bg-atelier-ink/5"
                >
                  <input
                    type="checkbox"
                    name="character_id"
                    value={c.id}
                    className="h-3.5 w-3.5 flex-shrink-0 rounded border-atelier-rule accent-atelier-accent"
                  />
                  {c.name}
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
        ) : (
          characters &&
          characters.length > 0 && (
            <p className="mt-4 border-t border-atelier-rule/60 pt-4 text-xs text-atelier-muted">
              {p.noAvailableCharacters}
            </p>
          )
        )}
      </div>

      <DeleteProjectButton id={project.id} name={project.name} />
    </div>
  );
}
