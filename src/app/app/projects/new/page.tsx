import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveProject } from "@/lib/projects/actions";
import { Card } from "@/components/ui/card";
import { Label, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerMessages } from "@/lib/i18n/server";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { t } = await getServerMessages();
  const p = t.projects;
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">{p.newProject}</h1>
      <Card>
        <form action={saveProject} className="space-y-4">
          <div>
            <Label htmlFor="name">{p.projectName}</Label>
            <Input id="name" name="name" required placeholder={p.namePlaceholder} />
          </div>
          <div>
            <Label htmlFor="description">{p.descriptionOptional}</Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              placeholder={p.descriptionPlaceholder}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center justify-between">
            <Link href="/app/projects" className="text-sm text-neutral-500 hover:text-neutral-700">
              {p.cancel}
            </Link>
            <SubmitButton pendingLabel={p.creatingProject}>{p.createProject}</SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}
