"use client";

import { useEffect, useRef, useState, type SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  renameProject,
  toggleProjectStar,
  toggleProjectPin,
  toggleProjectArchive,
  removeProject,
} from "@/lib/projects/actions";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";

type Project = {
  id: string;
  name: string;
  description?: string | null;
  is_starred: boolean;
  is_pinned: boolean;
  is_archived: boolean;
};

type ActionResult = { error: string | null };

function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function MoreIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function StarIcon({ filled, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8-6.1-3.6-6.1 3.6 1.5-6.8-5.2-4.7 6.9-.7z" />
    </svg>
  );
}

function PinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 17v5" />
      <path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6Z" />
    </svg>
  );
}

function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function ArchiveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
    </svg>
  );
}

function MenuAction({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: (props: SVGProps<SVGSVGElement>) => React.JSX.Element;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left text-sm transition-colors",
        destructive
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/15"
          : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
      )}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      {label}
    </button>
  );
}

export function ProjectRow({
  project,
  variant = "sidebar",
  characterCount,
}: {
  project: Project;
  variant?: "sidebar" | "card";
  characterCount?: number;
}) {
  const { t } = useLocale();
  const p = t.projects;
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  const [pending, setPending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(project.name);
  }, [project.name]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  async function runAction(action: (fd: FormData) => Promise<ActionResult>, extra: Record<string, string>) {
    setMenuOpen(false);
    setPending(true);
    const fd = new FormData();
    fd.set("id", project.id);
    Object.entries(extra).forEach(([k, v]) => fd.set(k, v));
    await action(fd);
    setPending(false);
  }

  async function submitRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === project.name) {
      setName(project.name);
      setRenaming(false);
      return;
    }
    setPending(true);
    const fd = new FormData();
    fd.set("id", project.id);
    fd.set("name", trimmed);
    const result = await renameProject(fd);
    setPending(false);
    setRenaming(false);
    if (result.error) setName(project.name);
  }

  function handleRemove() {
    setMenuOpen(false);
    const ok = window.confirm(formatMsg(p.removeConfirm, { name: project.name }));
    if (!ok) return;
    runAction(removeProject, {});
  }

  const compact = variant === "sidebar";
  const isActive = pathname === `/app/projects/${project.id}`;

  const menu = !renaming && (
    <div ref={menuRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={p.projectOptions}
        className={cn(
          "flex items-center justify-center rounded-control text-atelier-muted opacity-0 transition-opacity hover:bg-atelier-ink/5 hover:text-atelier-ink group-hover:opacity-100 focus:opacity-100",
          compact ? "h-6 w-6" : "h-7 w-7",
          menuOpen && "bg-atelier-ink/10 opacity-100",
        )}
      >
        <MoreIcon className="h-3.5 w-3.5" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-control border border-atelier-rule bg-atelier-surface p-1 shadow-[0_24px_48px_-12px_rgba(33,29,18,0.28)]">
          <MenuAction
            icon={StarIcon}
            label={project.is_starred ? p.unstar : p.star}
            onClick={() => runAction(toggleProjectStar, { starred: String(project.is_starred) })}
          />
          <MenuAction
            icon={PinIcon}
            label={project.is_pinned ? p.unpin : p.pin}
            onClick={() => runAction(toggleProjectPin, { pinned: String(project.is_pinned) })}
          />
          <MenuAction
            icon={PencilIcon}
            label={p.rename}
            onClick={() => {
              setMenuOpen(false);
              setRenaming(true);
            }}
          />
          <MenuAction
            icon={ArchiveIcon}
            label={project.is_archived ? p.unarchive : p.archive}
            onClick={() => runAction(toggleProjectArchive, { archived: String(project.is_archived) })}
          />
          <div className="my-1 h-px bg-atelier-rule/60" />
          <MenuAction icon={TrashIcon} label={p.remove} destructive onClick={handleRemove} />
        </div>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className={cn("group relative flex items-center gap-1", pending && "opacity-60")}>
        {renaming ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitRename();
              }
              if (e.key === "Escape") {
                setName(project.name);
                setRenaming(false);
              }
            }}
            className="min-w-0 flex-1 rounded-control border border-atelier-rule bg-transparent px-2 py-1 text-xs text-atelier-ink outline-none transition-colors focus:border-atelier-accent"
          />
        ) : (
          <Link
            href={`/app/projects/${project.id}`}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-control px-2.5 py-2 text-xs transition-colors",
              isActive
                ? "bg-atelier-surface text-atelier-ink"
                : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
            )}
          >
            {project.is_pinned && <PinIcon className="h-3 w-3 flex-shrink-0 text-atelier-muted" />}
            <FolderIcon className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{project.name}</span>
            {project.is_starred && (
              <StarIcon filled className="h-3 w-3 flex-shrink-0 text-atelier-accent" />
            )}
          </Link>
        )}
        {menu}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex items-center justify-between gap-4 rounded-control border border-atelier-rule bg-atelier-surface p-5 transition-colors hover:border-atelier-muted/70",
        pending && "opacity-60",
      )}
    >
      {renaming ? (
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={submitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitRename();
            }
            if (e.key === "Escape") {
              setName(project.name);
              setRenaming(false);
            }
          }}
          className="min-w-0 flex-1 rounded-control border border-atelier-rule bg-transparent px-3 py-2 text-sm text-atelier-ink outline-none transition-colors focus:border-atelier-accent"
        />
      ) : (
        <Link href={`/app/projects/${project.id}`} className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-atelier-ink">
            {project.is_pinned && <PinIcon className="h-3.5 w-3.5 flex-shrink-0 text-atelier-muted" />}
            <span className="truncate">{project.name}</span>
            {project.is_starred && (
              <StarIcon filled className="h-3.5 w-3.5 flex-shrink-0 text-atelier-accent" />
            )}
          </p>
          <p className="mt-0.5 truncate text-xs text-atelier-muted">
            {project.description || p.noDescription}
          </p>
        </Link>
      )}

      <div className="flex flex-shrink-0 items-center gap-2">
        {characterCount !== undefined && (
          <span className="rounded-full border border-atelier-rule bg-atelier-paper px-2.5 py-1 text-xs font-medium text-atelier-muted">
            {characterCount === 1 ? p.characterCountOne : formatMsg(p.characterCountOther, { n: characterCount })}
          </span>
        )}
        {menu}
      </div>
    </div>
  );
}
