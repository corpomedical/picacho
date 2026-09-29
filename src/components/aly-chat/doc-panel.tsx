"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { downloadName, type Doc } from "@/lib/aly-chat/docs";
import { saveChatDoc } from "@/lib/aly-chat/actions";
import { Markdown } from "./markdown";
import { DocGlyph } from "./glyphs";
import styles from "./aly-chat.module.css";

// The side panel (2026-09-29): a document Aly wrote, beside the chat. Read
// it, copy it, download it, or edit it yourself; Aly's own changes arrive
// here as a new version while it's open.

export function DocPanel({
  doc,
  docs,
  onPick,
  onClose,
  onSaved,
}: {
  doc: Doc;
  docs: Doc[];
  onPick: (id: string) => void;
  onClose: () => void;
  onSaved: (d: Doc) => void;
}) {
  const { t } = useLocale();
  const c = t.alyChat;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(doc.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const download = () => {
    const blob = new Blob([doc.content], { type: doc.kind === "document" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName(doc);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const r = await saveChatDoc(doc.id, draft, doc.version);
    setSaving(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    onSaved({ ...doc, content: draft, version: r.version });
    setEditing(false);
  };

  return (
    <aside className={styles.panel} aria-label={doc.title}>
      <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-atelier-rule px-3">
        <DocGlyph />
        {docs.length > 1 ? (
          <select
            aria-label={c.document}
            value={doc.id}
            onChange={(e) => onPick(e.target.value)}
            className="min-w-0 flex-1 truncate rounded-md bg-transparent py-1 text-sm font-medium text-atelier-ink outline-none"
          >
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        ) : (
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-atelier-ink">{doc.title}</p>
        )}
        <span className="text-xs text-atelier-muted">{formatMsg(c.version, { n: doc.version })}</span>
        <button type="button" onClick={onClose} aria-label={c.closePanel} title={c.closePanel} className="flex h-8 w-8 items-center justify-center rounded-full text-atelier-muted hover:bg-atelier-ink/[0.06] hover:text-atelier-ink">
          ×
        </button>
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-atelier-rule px-3 py-2">
        {editing ? (
          <>
            <button type="button" disabled={saving} onClick={() => void save()} className="rounded-full bg-atelier-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-60">
              {saving ? c.saving : c.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(doc.content);
                setError(null);
              }}
              className="rounded-full border border-atelier-rule px-3 py-1 text-xs text-atelier-muted hover:text-atelier-ink"
            >
              {c.cancel}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setDraft(doc.content);
                setEditing(true);
              }}
              className="rounded-full border border-atelier-rule px-3 py-1 text-xs text-atelier-ink hover:bg-atelier-ink/[0.05]"
            >
              {c.edit}
            </button>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard
                  ?.writeText(doc.content)
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                  .catch(() => {})
              }
              className="rounded-full border border-atelier-rule px-3 py-1 text-xs text-atelier-ink hover:bg-atelier-ink/[0.05]"
            >
              {copied ? c.copied : c.copy}
            </button>
            <button type="button" onClick={download} className="rounded-full border border-atelier-rule px-3 py-1 text-xs text-atelier-ink hover:bg-atelier-ink/[0.05]">
              {c.download}
            </button>
          </>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {editing ? (
          <textarea
            aria-label={doc.title}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={doc.kind === "document"}
            className="block h-full min-h-[60vh] w-full resize-none bg-transparent p-5 font-mono text-[13px] leading-6 text-atelier-ink outline-none"
          />
        ) : doc.kind === "code" ? (
          <pre className="overflow-x-auto p-5 text-[13px] leading-6 text-atelier-ink">
            <code className="font-mono">{doc.content}</code>
          </pre>
        ) : (
          <div className="mx-auto max-w-[68ch] px-6 py-6">
            <Markdown text={doc.content} copyLabel={c.copy} copiedLabel={c.copied} />
          </div>
        )}
      </div>
    </aside>
  );
}
