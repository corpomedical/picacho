import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveProject } from "@/lib/projects/actions";
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
              <li key={c.id}>
                <Link
                  href={`/app/character/${c.id}`}
                  className="block rounded-[10px] border border-neutral-100 px-4 py-2.5 text-sm text-neutral-700 transition-colors hover:border-neutral-300"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DeleteProjectButton id={project.id} name={project.name} />
    </div>
  );
}
