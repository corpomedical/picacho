"use client";

import { useEffect, useRef, useState, useTransition, type SVGProps } from "react";
import { useRouter } from "next/navigation";
import { searchAll, type SearchResults } from "@/lib/search/actions";
import { useBackCloser } from "@/lib/native/back-stack";
import { useModalFocus } from "@/lib/use-modal-focus";
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
      <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{label}</p>
      {children}
    </div>
  );
}

function ResultItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full truncate border-b border-atelier-rule/50 px-3 py-2 text-left text-sm text-atelier-ink transition-colors last:border-0 hover:bg-atelier-ink/5"
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
  // Monotonic id for the most recently ISSUED search. Server-action round
  // trips aren't guaranteed to come back in order — with fast typing, the
  // response for "no" could land after the response for "nova" and overwrite
  // the fresher results with stale ones. Each request captures its own id and
  // only the one that still matches at resolution time may write results.
  const searchSeqRef = useRef(0);
  const router = useRouter();
  // Android hardware back closes the dialog instead of navigating under it.
  useBackCloser(open, onClose);

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

  // The shared aria-modal focus contract — trap AND restore-on-close (the
  // hand-rolled trap this replaced never handed focus back, so closing the
  // dialog dropped a keyboard user at the top of the page).
  useModalFocus(open, dialogRef);

  useEffect(() => {
    if (!query.trim()) {
      // Bump the sequence so any still-in-flight search can't repopulate
      // results the person just cleared.
      searchSeqRef.current += 1;
      setResults(EMPTY);
      return;
    }
    const handle = setTimeout(() => {
      const seq = ++searchSeqRef.current;
      startTransition(async () => {
        const r = await searchAll(query);
        // Stale-response guard: a newer query has been issued (or the box was
        // cleared) since this request went out — drop it instead of letting
        // an out-of-order response overwrite the newer results.
        if (seq === searchSeqRef.current) setResults(r);
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={se.placeholder}
        className="w-full max-w-lg rounded-control border border-atelier-rule bg-atelier-surface shadow-[0_24px_48px_-12px_rgba(33,29,18,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-atelier-rule/60 px-4 py-3">
          <SearchIcon className="h-4 w-4 flex-shrink-0 text-atelier-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={se.placeholder}
            className="flex-1 bg-transparent text-sm text-atelier-ink outline-none placeholder:text-atelier-muted/80"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={se.close}
            className="rounded-control border border-atelier-rule px-1.5 py-0.5 text-[10px] text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
          >
            Esc
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {!query.trim() ? (
            <p className="px-3 py-6 text-center text-sm text-atelier-muted">{se.startTyping}</p>
          ) : !hasResults && !isPending ? (
            <p className="px-3 py-6 text-center text-sm text-atelier-muted">
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
