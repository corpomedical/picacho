"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { deleteMemoryNote, saveMemoryNote } from "@/lib/aly-chat/actions";

type Note = { path: string; content: string };

function label(path: string): string {
  return path.replace(/^\/memories\//, "").replace(/\.(md|txt)$/i, "").replace(/[-_]+/g, " ");
}

export function MemoryList({ notes: initial, emptyText }: { notes: Note[]; emptyText: string }) {
  const { t } = useLocale();
  const c = t.alyChat;
  const [notes, setNotes] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  if (notes.length === 0) return <p className="mt-8 rounded-2xl border border-atelier-rule p-5 text-sm text-atelier-muted">{emptyText}</p>;

  return (
    <ul className="mt-6 space-y-3">
      {notes.map((n) => (
        <li key={n.path} className="rounded-2xl border border-atelier-rule p-4">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium capitalize text-atelier-ink">{label(n.path)}</p>
            {editing !== n.path && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(n.path);
                    setDraft(n.content);
                    setError(null);
                  }}
                  className="rounded-full border border-atelier-rule px-3 py-1 text-xs text-atelier-muted hover:text-atelier-ink"
                >
                  {c.edit}
                </button>
                <button
                  type="button"
                  disabled={working}
                  onClick={async () => {
                    setWorking(true);
                    const r = await deleteMemoryNote(n.path);
                    setWorking(false);
                    if ("error" in r) setError(r.error);
                    else setNotes((prev) => prev.filter((x) => x.path !== n.path));
                  }}
                  className="rounded-full border border-atelier-rule px-3 py-1 text-xs text-red-500 hover:bg-red-500/5"
                >
                  {c.delete}
                </button>
              </>
            )}
          </div>
          {editing === n.path ? (
            <div className="mt-2 space-y-2">
              <label htmlFor={`note-${n.path}`} className="sr-only">
                {label(n.path)}
              </label>
              <textarea
                id={`note-${n.path}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(14, Math.max(3, draft.split("\n").length + 1))}
                className="w-full rounded-xl border border-atelier-rule bg-transparent p-3 text-sm text-atelier-ink outline-none focus:border-atelier-accent"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={working}
                  onClick={async () => {
                    setWorking(true);
                    const r = await saveMemoryNote(n.path, draft);
                    setWorking(false);
                    if ("error" in r) {
                      setError(r.error);
                      return;
                    }
                    setNotes((prev) => prev.map((x) => (x.path === n.path ? { ...x, content: draft } : x)));
                    setEditing(null);
                  }}
                  className="rounded-full bg-atelier-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
                >
                  {working ? c.saving : c.save}
                </button>
                <button type="button" onClick={() => setEditing(null)} className="rounded-full border border-atelier-rule px-3 py-1 text-xs text-atelier-muted">
                  {c.cancel}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-atelier-muted">{n.content}</p>
          )}
        </li>
      ))}
      {error && <li className="text-sm text-red-500">{error}</li>}
    </ul>
  );
}
