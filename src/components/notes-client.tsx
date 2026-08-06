"use client";

import { useEffect, useRef, useState, type SVGProps } from "react";
import { cn } from "@/lib/cn";
import { createNote, saveNote, deleteNote } from "@/lib/notes/actions";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";

type Note = {
  id: string;
  title: string;
  body: string;
  updated_at: string;
};

function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
    </svg>
  );
}

// Debounces title/body edits into a save call so this feels like a live
// notepad instead of a form you have to remember to submit.
const SAVE_DELAY_MS = 700;

export function NotesClient({ initialNotes }: { initialNotes: Note[] }) {
  const { t } = useLocale();
  const nt = t.notes;
  const [notes, setNotes] = useState(initialNotes);
  const [selectedId, setSelectedId] = useState<string | null>(initialNotes[0]?.id ?? null);
  const [title, setTitle] = useState(initialNotes[0]?.title ?? "");
  const [body, setBody] = useState(initialNotes[0]?.body ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  function selectNote(note: Note) {
    flushPendingSave();
    setSelectedId(note.id);
    setTitle(note.title);
    setBody(note.body);
    setStatus("idle");
  }

  function scheduleSave(nextTitle: string, nextBody: string) {
    if (!selectedId) return;
    setStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const formData = new FormData();
      formData.set("id", selectedId);
      formData.set("title", nextTitle);
      formData.set("body", nextBody);
      const result = await saveNote(formData);
      if (result.error !== null) {
        setStatus("idle");
        return;
      }
      setStatus("saved");
      setNotes((prev) =>
        prev
          .map((note) =>
            note.id === selectedId
              ? { ...note, title: nextTitle.trim() || nt.untitledNote, body: nextBody, updated_at: new Date().toISOString() }
              : note,
          )
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
      );
    }, SAVE_DELAY_MS);
  }

  function flushPendingSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }

  useEffect(() => () => flushPendingSave(), []);

  async function handleNewNote() {
    const result = await createNote();
    if (result.error !== null || !result.id) return;
    const fresh: Note = { id: result.id, title: nt.untitledNote, body: "", updated_at: new Date().toISOString() };
    setNotes((prev) => [fresh, ...prev]);
    selectNote(fresh);
  }

  async function handleDelete(note: Note) {
    if (!window.confirm(formatMsg(nt.deleteConfirm, { title: note.title }))) return;
    const formData = new FormData();
    formData.set("id", note.id);
    const result = await deleteNote(formData);
    if (result.error !== null) return;

    const remaining = notes.filter((note2) => note2.id !== note.id);
    setNotes(remaining);
    if (selectedId === note.id) {
      const next = remaining[0] ?? null;
      setSelectedId(next?.id ?? null);
      setTitle(next?.title ?? "");
      setBody(next?.body ?? "");
    }
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
      <div>
        <button
          type="button"
          onClick={handleNewNote}
          className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-900"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {nt.newNote}
        </button>

        {notes.length === 0 ? (
          <p className="mt-4 px-1 text-xs text-neutral-400">{nt.noNotesYet}</p>
        ) : (
          <ul className="mt-3 space-y-0.5">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => selectNote(note)}
                  className={cn(
                    "w-full rounded-[10px] px-2.5 py-2 text-left transition-colors",
                    note.id === selectedId ? "bg-neutral-100" : "hover:bg-neutral-50",
                  )}
                >
                  <p className="truncate text-sm text-neutral-900">{note.title}</p>
                  <p className="mt-0.5 truncate text-xs text-neutral-400">
                    {note.body ? note.body.slice(0, 40) : nt.emptyNote} ·{" "}
                    {new Date(note.updated_at).toLocaleDateString()}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-h-[60vh] rounded-[18px] border border-neutral-200/70 bg-white p-6">
        {selected ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  scheduleSave(e.target.value, body);
                }}
                placeholder={nt.untitledNote}
                className="w-full border-none bg-transparent text-lg font-semibold text-neutral-900 outline-none placeholder:text-neutral-300"
              />
              <div className="flex flex-shrink-0 items-center gap-3">
                <span className="whitespace-nowrap text-xs text-neutral-400">
                  {status === "saving" ? nt.saving : status === "saved" ? nt.saved : ""}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(selected)}
                  title={nt.deleteNote}
                  aria-label={nt.deleteNote}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15 dark:hover:text-red-400"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                scheduleSave(title, e.target.value);
              }}
              placeholder={nt.startTyping}
              rows={20}
              className="mt-4 w-full resize-none border-none bg-transparent text-sm leading-relaxed text-neutral-700 outline-none placeholder:text-neutral-300"
            />
          </>
        ) : (
          <div className="flex h-full min-h-[50vh] flex-col items-center justify-center text-center">
            <p className="text-sm text-neutral-500">{nt.noNotesYet}</p>
            <button
              type="button"
              onClick={handleNewNote}
              className="mt-3 rounded-[10px] bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              {nt.writeFirstNote}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
