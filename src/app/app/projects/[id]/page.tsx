import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveProject, assignCharacterToProject, removeCharacterFromProject } from "@/lib/projects/actions";
import { Card } from "@/components/ui/card";
import { Label, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { DeleteProjectButton } from "@/components/delete-project-button";
import { getServerMessages } from "@/lib/i18n/server";

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

  const { data: project } = await supabase.from("projects").select("*").eq("id", id).single();

  if (!project) notFound();

  const { data: characters } = await supabase
    .from("character_profiles")
    .select("id, name")
    .eq("project_id", id)
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
      <Link href="/app/projects" className="text-sm text-neutral-500 hover:text-neutral-900">
        {p.backToProjects}
      </Link>

      <Card>
        <h2 className="text-sm font-semibold text-neutral-900">{p.projectDetails}</h2>
        <form action={saveProject} className="mt-4 space-y-4">
          <input type="hidden" name="id" value={project.id} />
          <div>
            <Label htmlFor="name">{p.projectName}</Label>
            <Input id="name" name="name" defaultValue={project.name} required />
          </div>
          <div>
            <Label htmlFor="description">{p.descriptionLabel}</Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={project.description ?? ""}
              placeholder={p.descriptionPlaceholder}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end">
            <SubmitButton pendingLabel={p.savingChanges}>{p.saveChanges}</SubmitButton>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">{p.charactersInProject}</h2>
          <Link href="/app/character/new" className="text-xs text-neutral-500 hover:text-neutral-900">
            {p.newCharacter}
          </Link>
        </div>
        {!characters || characters.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            {p.noCharactersYet}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {characters.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <Link
                  href={`/app/character/${c.id}`}
                  className="block flex-1 rounded-[10px] border border-neutral-100 px-4 py-2.5 text-sm text-neutral-700 transition-colors hover:border-neutral-300"
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
                    className="text-neutral-400 hover:text-red-600"
                  >
                    {p.removeFromProject}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}

        {availableCharacters && availableCharacters.length > 0 ? (
          <form action={assignCharacterToProject} className="mt-4 border-t border-neutral-100 pt-4">
            <input type="hidden" name="project_id" value={project.id} />
            <p className="mb-1.5 block text-[13px] font-medium text-neutral-600">{p.assignCharacter}</p>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-[10px] border border-neutral-200 p-2">
              {availableCharacters.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  <input
                    type="checkbox"
                    name="character_id"
                    value={c.id}
                    className="h-3.5 w-3.5 flex-shrink-0 rounded border-neutral-300"
                  />
                  {c.name}
                </label>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <SubmitButton pendingLabel={p.assigning} size="sm">
                {p.assign}
              </SubmitButton>
            </div>
          </form>
        ) : (
          characters &&
          characters.length > 0 && (
            <p className="mt-4 border-t border-neutral-100 pt-4 text-xs text-neutral-400">
              {p.noAvailableCharacters}
            </p>
          )
        )}
      </Card>

      <DeleteProjectButton id={project.id} name={project.name} />
    </div>
  );
}
