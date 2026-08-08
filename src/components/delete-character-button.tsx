"use client";

import { useState, type SVGProps } from "react";
import { useRouter } from "next/navigation";
import { removeCharacterProfile } from "@/lib/characters/actions";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
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

// Small hover-reveal trash button for the sidebar's Characters rail — always
// nested inside a <Link>, so the click needs to stop that row's own
// navigation. Reuses the same confirm copy as the character edit page's
// delete button (character.deleteConfirm) for consistency.
export function DeleteCharacterButton({ id, name, className }: { id: string; name: string; className?: string }) {
  const { t } = useLocale();
  const c = t.character;
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(formatMsg(c.deleteConfirm, { name }))) return;
    setPending(true);
    const fd = new FormData();
    fd.set("id", id);
    const result = await removeCharacterProfile(fd);
    setPending(false);
    if (result.error) {
      window.alert(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={pending}
      aria-label={c.deleteCharacter}
      title={c.deleteCharacter}
      className={cn(
        "flex items-center justify-center rounded-[8px] text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/15",
        className,
      )}
    >
      <TrashIcon className="h-3.5 w-3.5" />
    </button>
  );
}
