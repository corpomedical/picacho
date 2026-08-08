"use client";

import { useState, type SVGProps } from "react";
import { useRouter } from "next/navigation";
import { deleteGeneration } from "@/lib/generations/actions";
import { useLocale } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";

function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
    </svg>
  );
}

// Two looks sharing one delete flow: "icon" is a small hover-reveal trash
// button for rows nested inside a <Link> (History list, sidebar Recent) —
// preventDefault/stopPropagation keep the click from also triggering the
// row's navigation. "full" is an always-visible labeled button for the
// History detail page, styled like DeleteProjectButton for consistency.
export function DeleteGenerationButton({
  id,
  variant = "icon",
  redirectAfter,
  className,
}: {
  id: string;
  variant?: "icon" | "full";
  redirectAfter?: string;
  className?: string;
}) {
  const { t } = useLocale();
  const h = t.history;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(h.deleteConfirm)) return;
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    const result = await deleteGeneration(fd);
    if (result.error) {
      setPending(false);
      setError(result.error);
      return;
    }
    if (redirectAfter) {
      router.push(redirectAfter);
    } else {
      router.refresh();
    }
  }

  if (variant === "full") {
    return (
      <div className="text-right">
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className={cn("text-sm text-red-500 hover:text-red-700 disabled:opacity-50", className)}
        >
          {h.deleteGeneration}
        </button>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={pending}
      aria-label={h.deleteGeneration}
      title={h.deleteGeneration}
      className={cn(
        "flex items-center justify-center rounded-[8px] text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/15",
        className,
      )}
    >
      <TrashIcon className="h-3.5 w-3.5" />
    </button>
  );
}
