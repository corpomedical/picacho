import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveProject } from "@/lib/projects/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerMessages } from "@/lib/i18n/server";

// Atelier form idiom (settings-popover, extended): paper sheet, caps label
// over an ink-hairline field at the control radius; accent only marks focus.
const SHEET = "rounded-control border border-atelier-rule bg-atelier-surface p-8";
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const FIELD =
  "w-full rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink placeholder:text-atelier-muted/80 outline-none transition-colors focus:border-atelier-accent";

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
      <h1 className="mb-6 text-lg font-semibold text-atelier-ink">{p.newProject}</h1>
      <div className={SHEET}>
        <form action={saveProject} className="space-y-4">
          <div>
            <label htmlFor="name" className={LABEL}>{p.projectName}</label>
            <input id="name" className={FIELD} name="name" required placeholder={p.namePlaceholder} />
          </div>
          <div>
            <label htmlFor="description" className={LABEL}>{p.descriptionOptional}</label>
            <textarea
              id="description"
              className={`resize-none ${FIELD}`}
              name="description"
              rows={3}
              placeholder={p.descriptionPlaceholder}
            />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex items-center justify-between">
            <Link href="/app/projects" className="text-sm text-atelier-muted hover:text-atelier-ink">
              {p.cancel}
            </Link>
            <SubmitButton
              className="rounded-control! bg-atelier-ink! text-atelier-paper! shadow-none! hover:bg-atelier-ink/90!"
              pendingLabel={p.creatingProject}
            >
              {p.createProject}
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
