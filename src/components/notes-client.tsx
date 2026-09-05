"use client";

import { useEffect, useRef, useState, type SVGProps } from "react";
import { cn } from "@/lib/cn";
import { createNote, saveNote, deleteNote } from "@/lib/notes/actions";
import { useLocale } from "@/lib/i18n/provider";
import { LocalDate } from "@/components/local-date";
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
  // The save the timer would fire, kept reachable so flushPendingSave can run
  // it NOW instead of merely cancelling it — cancelling alone silently threw
  // away everything typed since the last fired save whenever the user
  // switched notes or navigated within the 700ms debounce window.
  const pendingSave = useRef<(() => void) | null>(null);

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
    const fire = async () => {
      pendingSave.current = null;
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
    };
    pendingSave.current = () => void fire();
    saveTimer.current = setTimeout(fire, SAVE_DELAY_MS);
  }

  // FLUSHES, not just cancels: the pending timer holds every change since the
  // last completed save, so cancelling without firing loses real typed text.
  // The save runs fire-and-forget — the note being left keeps its own id in
  // the closure, so it lands on the right row even after selection changes.
  function flushPendingSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (pendingSave.current) pendingSave.current();
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
          className="flex w-full items-center justify-center gap-2 rounded-control border border-dashed border-atelier-rule px-3 py-2 text-sm text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {nt.newNote}
        </button>

        {notes.length === 0 ? (
          <p className="mt-4 px-1 text-xs text-atelier-muted">{nt.noNotesYet}</p>
        ) : (
          <ul className="mt-3 space-y-0.5">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => selectNote(note)}
                  className={cn(
                    "w-full rounded-control px-2.5 py-2 text-left transition-colors",
                    note.id === selectedId
                      ? "bg-atelier-surface shadow-[inset_2px_0_0_var(--color-atelier-accent)]"
                      : "hover:bg-atelier-ink/5",
                  )}
                >
                  <p className="truncate text-sm text-atelier-ink">{note.title}</p>
                  <p className="mt-0.5 truncate text-xs text-atelier-muted">
                    {note.body ? note.body.slice(0, 40) : nt.emptyNote} ·{" "}
                    <LocalDate date={note.updated_at} />
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-h-[60vh] rounded-control border border-atelier-rule bg-atelier-surface p-6">
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
                className="w-full border-none bg-transparent text-lg font-semibold text-atelier-ink outline-none placeholder:text-atelier-muted/50"
              />
              <div className="flex flex-shrink-0 items-center gap-3">
                <span className="whitespace-nowrap text-xs text-atelier-muted">
                  {status === "saving" ? nt.saving : status === "saved" ? nt.saved : ""}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(selected)}
                  title={nt.deleteNote}
                  aria-label={nt.deleteNote}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-control text-atelier-muted transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15 dark:hover:text-red-400"
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
              className="mt-4 w-full resize-none border-none bg-transparent text-sm leading-relaxed text-atelier-ink outline-none placeholder:text-atelier-muted/50"
            />
          </>
        ) : (
          <div className="flex h-full min-h-[50vh] flex-col items-center justify-center text-center">
            <p className="text-sm text-atelier-muted">{nt.noNotesYet}</p>
            <button
              type="button"
              onClick={handleNewNote}
              className="mt-3 rounded-control bg-atelier-ink px-4 py-2 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90"
            >
              {nt.writeFirstNote}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
