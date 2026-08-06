"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { removeProject } from "@/lib/projects/actions";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";

// The project detail page's own delete button previously submitted straight
// to the server with no confirmation at all — a single misclick permanently
// deleted the project. This mirrors the confirm-then-call pattern already
// used correctly in the sidebar's project "..." menu (project-row.tsx),
// instead of introducing a second, inconsistent way to do the same thing.
export function DeleteProjectButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const p = t.projects;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm(formatMsg(p.removeConfirm, { name }))) return;
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    const result = await removeProject(fd);
    if (result.error) {
      setPending(false);
      setError(result.error);
      return;
    }
    router.push("/app/projects");
  }

  return (
    <div className="border-t border-neutral-100 pt-4 text-center">
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
      >
        {p.deleteProject}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
