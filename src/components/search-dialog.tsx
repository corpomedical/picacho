"use client";

import { useEffect, useRef, useState, useTransition, type SVGProps } from "react";
import { useRouter } from "next/navigation";
import { searchAll, type SearchResults } from "@/lib/search/actions";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";

const EMPTY: SearchResults = { projects: [], characters: [], generations: [] };

function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</p>
      {children}
    </div>
  );
}

function ResultItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full truncate rounded-[10px] px-3 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100"
    >
      {label}
    </button>
  );
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale();
  const se = t.search;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults(EMPTY);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Basic focus trap — previously Tab could escape the dialog into the page
  // behind it while the dialog was still visually "open" and modal-like.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults(EMPTY);
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => {
        const r = await searchAll(query);
        setResults(r);
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  if (!open) return null;

  function go(href: string) {
    onClose();
    router.push(href);
  }

  const hasResults =
    results.projects.length + results.characters.length + results.generations.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-950/40 pt-[12vh]"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={se.placeholder}
        className="w-full max-w-lg rounded-[16px] border border-neutral-200 bg-white shadow-[0_24px_48px_-12px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
          <SearchIcon className="h-4 w-4 flex-shrink-0 text-neutral-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={se.placeholder}
            className="flex-1 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={se.close}
            className="rounded-[6px] border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-50"
          >
            Esc
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {!query.trim() ? (
            <p className="px-3 py-6 text-center text-sm text-neutral-400">{se.startTyping}</p>
          ) : !hasResults && !isPending ? (
            <p className="px-3 py-6 text-center text-sm text-neutral-400">
              {formatMsg(se.noMatches, { query })}
            </p>
          ) : (
            <>
              {results.projects.length > 0 && (
                <ResultGroup label={se.projects}>
                  {results.projects.map((p) => (
                    <ResultItem key={p.id} label={p.name} onClick={() => go(`/app/projects/${p.id}`)} />
                  ))}
                </ResultGroup>
              )}
              {results.characters.length > 0 && (
                <ResultGroup label={se.characters}>
                  {results.characters.map((c) => (
                    <ResultItem key={c.id} label={c.name} onClick={() => go(`/app/character/${c.id}`)} />
                  ))}
                </ResultGroup>
              )}
              {results.generations.length > 0 && (
                <ResultGroup label={se.history}>
                  {results.generations.map((g) => (
                    <ResultItem
                      key={g.id}
                      label={g.prompt_input}
                      onClick={() => go(`/app/history/${g.id}`)}
                    />
                  ))}
                </ResultGroup>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
