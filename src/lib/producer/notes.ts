// The Producer's notes: Anthropic's memory tool (memory_20250818), backed by
// our own table instead of a filesystem (2026-09-24).
//
// The model sends file commands — view, create, str_replace, insert, delete,
// rename — against paths under /memories. This module runs them against a
// NotesStore, so the logic is pure and testable and the route supplies the
// database-backed store. Alias-free for the same reason as prices.ts.
//
// THE PERSON SEES ALL OF IT. Every note appears in the sheet's Notes list,
// where they can edit or delete it; nothing here is a hidden profile. That is
// also why the limits are small: notes are meant to be read by a person.

export const NOTES_ROOT = "/memories";
export const MAX_NOTES = 50;
export const MAX_NOTE_CHARS = 20000;

// Mirrors the table's CHECK (producer.sql), so a bad path is refused here
// with a message the model can act on rather than as a database error.
const PATH_RE = /^\/memories\/[A-Za-z0-9._/ -]{1,120}$/;

export type Note = { path: string; content: string; updated_at?: string };

export interface NotesStore {
  list(): Promise<Note[]>;
  put(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export type NotesResult = { text: string; isError: boolean; changed: boolean };

const ok = (text: string, changed = false): NotesResult => ({ text, isError: false, changed });
const fail = (text: string): NotesResult => ({ text, isError: true, changed: false });

/** A note path the table will accept, or null. */
export function normalizeNotePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim().replace(/\/+$/, "");
  if (path.includes("..") || path.includes("//")) return null;
  return PATH_RE.test(path) ? path : null;
}

function isDir(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const p = raw.trim().replace(/\/+$/, "");
  return p === NOTES_ROOT;
}

function numbered(content: string, range?: unknown): string {
  const lines = content.split("\n");
  let start = 1;
  let end = lines.length;
  if (Array.isArray(range) && range.length === 2) {
    const [a, b] = range.map((n) => Number(n));
    if (Number.isInteger(a) && a >= 1) start = a;
    if (Number.isInteger(b) && b >= start) end = Math.min(b, lines.length);
    if (b === -1) end = lines.length;
  }
  return lines
    .slice(start - 1, end)
    .map((line, i) => `${String(start + i).padStart(6, " ")}\t${line}`)
    .join("\n");
}

/** Runs one memory-tool command. Never throws on bad input — the model gets an error text instead. */
export async function runNotesCommand(store: NotesStore, input: Record<string, unknown>): Promise<NotesResult> {
  const command = input.command;

  if (command === "view") {
    const notes = await store.list();
    if (isDir(input.path)) {
      if (notes.length === 0) return ok(`${NOTES_ROOT} is empty. No notes yet.`);
      const rows = notes
        .slice()
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((n) => `${n.content.length}\t${n.path}`);
      return ok(`Notes in ${NOTES_ROOT} (characters, path):\n${rows.join("\n")}`);
    }
    const path = normalizeNotePath(input.path);
    if (!path) return fail(`That path isn't allowed. Notes live under ${NOTES_ROOT}/, e.g. ${NOTES_ROOT}/brand.md`);
    const note = notes.find((n) => n.path === path);
    if (!note) return fail(`${path} does not exist.`);
    return ok(numbered(note.content, input.view_range));
  }

  if (command === "create") {
    const path = normalizeNotePath(input.path);
    if (!path) return fail(`That path isn't allowed. Notes live under ${NOTES_ROOT}/, e.g. ${NOTES_ROOT}/brand.md`);
    const text = typeof input.file_text === "string" ? input.file_text : "";
    if (text.length > MAX_NOTE_CHARS) return fail(`A note can hold at most ${MAX_NOTE_CHARS} characters. Keep notes short.`);
    const notes = await store.list();
    if (!notes.some((n) => n.path === path) && notes.length >= MAX_NOTES) {
      return fail(`There are already ${MAX_NOTES} notes. Merge or delete some first.`);
    }
    await store.put(path, text);
    return ok(`Saved ${path}.`, true);
  }

  if (command === "str_replace") {
    const path = normalizeNotePath(input.path);
    if (!path) return fail("That path isn't allowed.");
    const note = (await store.list()).find((n) => n.path === path);
    if (!note) return fail(`${path} does not exist.`);
    const oldStr = typeof input.old_str === "string" ? input.old_str : "";
    const newStr = typeof input.new_str === "string" ? input.new_str : "";
    if (!oldStr) return fail("old_str is empty.");
    const count = note.content.split(oldStr).length - 1;
    if (count === 0) return fail(`The text to replace wasn't found in ${path}.`);
    if (count > 1) return fail(`The text to replace appears ${count} times in ${path}; include more of it so it's unique.`);
    const next = note.content.replace(oldStr, newStr);
    if (next.length > MAX_NOTE_CHARS) return fail(`That would make ${path} longer than ${MAX_NOTE_CHARS} characters.`);
    await store.put(path, next);
    return ok(`Updated ${path}.`, true);
  }

  if (command === "insert") {
    const path = normalizeNotePath(input.path);
    if (!path) return fail("That path isn't allowed.");
    const note = (await store.list()).find((n) => n.path === path);
    if (!note) return fail(`${path} does not exist.`);
    const lines = note.content.split("\n");
    const at = Number(input.insert_line);
    if (!Number.isInteger(at) || at < 0 || at > lines.length) {
      return fail(`insert_line must be between 0 and ${lines.length}.`);
    }
    const text = typeof input.insert_text === "string" ? input.insert_text : "";
    lines.splice(at, 0, ...text.replace(/\n$/, "").split("\n"));
    const next = lines.join("\n");
    if (next.length > MAX_NOTE_CHARS) return fail(`That would make ${path} longer than ${MAX_NOTE_CHARS} characters.`);
    await store.put(path, next);
    return ok(`Inserted into ${path}.`, true);
  }

  if (command === "delete") {
    const notes = await store.list();
    if (isDir(input.path)) {
      // Clearing every note at once is the person's call, from the sheet —
      // never the model's, whatever a conversation talked it into.
      return fail("Deleting every note at once isn't allowed. Delete notes one at a time.");
    }
    const path = normalizeNotePath(input.path);
    if (!path) return fail("That path isn't allowed.");
    const under = notes.filter((n) => n.path === path || n.path.startsWith(`${path}/`));
    if (under.length === 0) return fail(`${path} does not exist.`);
    for (const n of under) await store.remove(n.path);
    return ok(`Deleted ${path}.`, true);
  }

  if (command === "rename") {
    const from = normalizeNotePath(input.old_path);
    const to = normalizeNotePath(input.new_path);
    if (!from || !to) return fail("Both paths must live under /memories/.");
    const notes = await store.list();
    const note = notes.find((n) => n.path === from);
    if (!note) return fail(`${from} does not exist.`);
    if (notes.some((n) => n.path === to)) return fail(`${to} already exists.`);
    await store.put(to, note.content);
    await store.remove(from);
    return ok(`Renamed ${from} to ${to}.`, true);
  }

  return fail(`Unknown command ${String(command)}.`);
}
