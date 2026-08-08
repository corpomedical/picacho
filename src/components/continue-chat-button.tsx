"use client";

import type { MouseEvent, SVGProps } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";

function ContinueIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 5v14l11-7-11-7z" />
    </svg>
  );
}

// Small hover-reveal button for the History list, mirroring
// DeleteGenerationButton's "icon" variant. Nested inside a <Link> card, so
// it navigates imperatively via router.push (a real <Link> can't nest
// inside another <Link>) and stops propagation so it doesn't also trigger
// the card's own navigation to the detail page.
export function ContinueChatButton({
  characterId,
  contentType,
  generationId,
  className,
}: {
  characterId: string;
  contentType: string;
  generationId: string;
  className?: string;
}) {
  const { t } = useLocale();
  const h = t.history;
  const router = useRouter();

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    router.push(
      `/app/generate?character=${encodeURIComponent(characterId)}&type=${contentType}&resume=${encodeURIComponent(generationId)}`,
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={h.continueChat}
      title={h.continueChat}
      className={cn(
        "flex items-center justify-center rounded-[8px] text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-500/15",
        className,
      )}
    >
      <ContinueIcon className="h-3.5 w-3.5" />
    </button>
  );
}
