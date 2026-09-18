"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, stepIndex, type Command, type CommandGroup } from "@/lib/sets/commands";

// The command palette (the studio, cut 4, 2026-09-17): ⌘K, a field, the
// commands that match, ↑↓ Enter Esc. It filters and steps (commands.ts);
// the page owns the commands and what they do.

export type PaletteWords = {
  title: string;
  placeholder: string;
  empty: string;
  hint: string;
  groups: Record<CommandGroup, string>;
};

export function CommandPalette({ open, onClose, commands, words }: { open: boolean; onClose: () => void; commands: readonly Command[]; words: PaletteWords }) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => filterCommands(query, commands, words.groups), [query, commands, words.groups]);
  // A fresh field each time it opens, with the keyboard in it.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setAt(0);
    }
  }
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const el = listRef.current?.children[at] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [at, shown]);
  if (!open) return null;
  const run = (c: Command) => {
    onClose();
    c.run();
  };
  const pick = at < shown.length ? at : 0;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 px-4 pt-[12vh]" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-label={words.title}
        className="w-full max-w-[560px] overflow-hidden rounded-[14px] border border-white/10 bg-[#191a20] shadow-[0_24px_56px_-16px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((i) => stepIndex(i, 1, shown.length));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((i) => stepIndex(i, -1, shown.length));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const c = shown[pick];
              if (c) run(c);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder={words.placeholder}
          aria-label={words.title}
          className="h-12 w-full border-b border-white/[0.07] bg-transparent px-4 text-[14px] text-[#ecedf1] outline-none placeholder:text-[#9aa0ad]"
        />
        <div ref={listRef} role="listbox" aria-label={words.title} className="max-h-[52vh] overflow-y-auto p-1.5">
          {shown.length === 0 && <p className="px-3 py-4 text-[12.5px] text-[#9aa0ad]">{words.empty}</p>}
          {shown.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === pick}
              onMouseEnter={() => setAt(i)}
              onClick={() => run(c)}
              className={`flex h-9 w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 text-left text-[13px] ${i === pick ? "bg-[rgba(224,164,104,0.13)] text-[#f0cda6]" : "text-[#d6d9e0]"}`}
            >
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              <span className="whitespace-nowrap text-[10.5px] uppercase tracking-[0.06em] text-[#9aa0ad]">{words.groups[c.group]}</span>
              {c.keys && <kbd className="rounded-[4px] bg-white/[0.06] px-1.5 py-0.5 font-sans text-[10px] font-semibold text-[#c6c9d1]">{c.keys}</kbd>}
            </button>
          ))}
        </div>
        <div className="border-t border-white/[0.07] px-4 py-2 text-[11px] text-[#9aa0ad]">{words.hint}</div>
      </div>
    </div>
  );
}
