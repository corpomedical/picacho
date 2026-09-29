"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { deleteChat, moveChatToProject, renameChat } from "@/lib/aly-chat/actions";

// The chat's ⋯ menu (2026-09-29): rename, move to a project, delete. Delete
// asks on the page itself — a second tap, never a browser dialog.

export function ChatMenu({
  chatId,
  title,
  projectId,
  projects,
  onRenamed,
  onDeleted,
  onMoved,
}: {
  chatId: string;
  title: string;
  projectId: string | null;
  projects: { id: string; name: string }[];
  onRenamed: (title: string) => void;
  onDeleted: () => void;
  onMoved: () => void;
}) {
  const { t } = useLocale();
  const c = t.alyChat;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "rename" | "move" | "delete">("menu");
  const [name, setName] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const close = () => {
    setOpen(false);
    setMode("menu");
    setError(null);
  };

  const run = async (fn: () => Promise<{ ok: true } | { error: string }>, after: () => void) => {
    setWorking(true);
    setError(null);
    const r = await fn();
    setWorking(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    close();
    after();
  };

  const item = "block w-full rounded-xl px-3 py-2 text-left text-sm text-atelier-ink hover:bg-atelier-ink/[0.05]";

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={c.chatMenu}
        title={c.chatMenu}
        onClick={() => {
          setName(title);
          setOpen((v) => !v);
          setMode("menu");
        }}
        className="flex h-8 w-8 items-center justify-center rounded-full text-atelier-muted hover:bg-atelier-ink/[0.06] hover:text-atelier-ink"
      >
        ⋯
      </button>
      {open && (
        <>
          <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={close} />
          <div role="menu" className="absolute right-0 top-10 z-50 w-64 rounded-2xl border border-atelier-rule bg-atelier-paper p-1.5 shadow-xl">
            {mode === "menu" && (
              <>
                <button type="button" role="menuitem" className={item} onClick={() => setMode("rename")}>
                  {c.rename}
                </button>
                <button type="button" role="menuitem" className={item} onClick={() => setMode("move")}>
                  {c.moveTo}
                </button>
                <button type="button" role="menuitem" className={`${item} text-red-500`} onClick={() => setMode("delete")}>
                  {c.delete}
                </button>
              </>
            )}
            {mode === "rename" && (
              <form
                className="space-y-2 p-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => renameChat(chatId, name), () => onRenamed(name.trim()));
                }}
              >
                <label htmlFor="aly-chat-rename" className="sr-only">
                  {c.rename}
                </label>
                <input
                  id="aly-chat-rename"
                  autoFocus
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-atelier-rule bg-transparent px-2.5 py-1.5 text-sm text-atelier-ink outline-none focus:border-atelier-accent"
                />
                <button type="submit" disabled={working || !name.trim()} className="rounded-full bg-atelier-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
                  {c.save}
                </button>
              </form>
            )}
            {mode === "move" && (
              <div className="max-h-72 overflow-y-auto">
                {[{ id: "", name: c.noProject }, ...projects].map((p) => (
                  <button
                    key={p.id || "none"}
                    type="button"
                    role="menuitemradio"
                    aria-checked={(projectId ?? "") === p.id}
                    disabled={working}
                    className={`${item} ${(projectId ?? "") === p.id ? "font-medium" : ""}`}
                    onClick={() => void run(() => moveChatToProject(chatId, p.id || null), onMoved)}
                  >
                    {(projectId ?? "") === p.id ? "✓ " : ""}
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {mode === "delete" && (
              <div className="space-y-2 p-2">
                <p className="text-sm text-atelier-ink">{c.deleteConfirm}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void run(() => deleteChat(chatId), onDeleted)}
                    className="rounded-full bg-red-500 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {c.delete}
                  </button>
                  <button type="button" onClick={() => setMode("menu")} className="rounded-full border border-atelier-rule px-3 py-1 text-xs text-atelier-muted">
                    {c.cancel}
                  </button>
                </div>
              </div>
            )}
            {error && <p className="px-3 py-1 text-xs text-red-500">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
