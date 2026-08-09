import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProjectRow } from "@/components/project-row";
import { getServerMessages } from "@/lib/i18n/server";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { t } = await getServerMessages();
  const p = t.projects;
  const { view } = await searchParams;
  const showArchived = view === "archived";
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null; // AppLayout already redirects unauthenticated users to /login

  const [{ data: projects, error }, { data: characters }] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .eq("user_id", userData.user.id)
      .eq("is_archived", showArchived)
      .order("is_pinned", { ascending: false })
      .order("is_starred", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("character_profiles")
      .select("id, project_id")
      .eq("user_id", userData.user.id),
  ]);

  if (error) console.error("Failed to load projects:", error);

  const countByProject = new Map<string, number>();
  (characters ?? []).forEach((c) => {
    if (!c.project_id) return;
    countByProject.set(c.project_id, (countByProject.get(c.project_id) ?? 0) + 1);
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">
          {showArchived ? p.archivedTitle : p.title}
        </h1>
        {!showArchived && (
          <Link href="/app/projects/new">
            <Button>{p.newProject}</Button>
          </Link>
        )}
      </div>

      {error ? (
        <Card className="mt-6 text-center">
          <p className="text-sm text-red-600">{p.couldntLoad}</p>
        </Card>
      ) : !projects || projects.length === 0 ? (
        <Card className="mt-6 text-center">
          <p className="text-sm text-neutral-500">
            {showArchived ? p.noArchivedProjects : p.noProjectsYet}
          </p>
        </Card>
      ) : (
        <div className="mt-6 space-y-3">
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              variant="card"
              characterCount={countByProject.get(project.id) ?? 0}
            />
          ))}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-neutral-400">
        {showArchived ? (
          <Link href="/app/projects" className="hover:text-neutral-600">
            {p.backToActive}
          </Link>
        ) : (
          <Link href="/app/projects?view=archived" className="hover:text-neutral-600">
            {p.viewArchived}
          </Link>
        )}
      </p>
    </div>
  );
}
