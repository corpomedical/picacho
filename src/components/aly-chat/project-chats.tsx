"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { saveProjectInstructions } from "@/lib/aly-chat/actions";

// A project's chats with Aly (2026-09-29, "Projects: merged"). A chat started
// here knows the project: its cast, its latest renders, its files, and the
// instructions below, which every chat in the project follows.

export function ProjectChats({
  projectId,
  name,
  chats,
  instructions,
}: {
  projectId: string;
  name: string;
  chats: { id: string; title: string | null }[];
  instructions: string | null;
}) {
  const { t } = useLocale();
  const c = t.alyChat;
  const [text, setText] = useState(instructions ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");

  return (
    <section className="mt-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{c.projectChats}</h2>
        <Link
          href={`/app/chat?project=${projectId}`}
          className="rounded-full bg-atelier-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
        >
          {c.projectNewChat}
        </Link>
      </div>
      {chats.length === 0 ? (
        <p className="mt-3 text-sm text-atelier-muted">{c.projectNoChats}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {chats.map((chat) => (
            <li key={chat.id}>
              <Link
                href={`/app/chat/${chat.id}`}
                className="block truncate rounded-[12px] border border-atelier-rule bg-atelier-surface px-3.5 py-2.5 text-[13px] text-atelier-ink hover:border-atelier-muted"
              >
                {chat.title || "…"}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-4 max-w-2xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setState("saving");
          const r = await saveProjectInstructions(projectId, text);
          setState("error" in r ? r.error : "saved");
        }}
      >
        <label htmlFor="aly-project-instructions" className="block text-[13px] font-medium text-atelier-ink">
          {formatMsg(c.projectInstructions, { name })}
        </label>
        <p className="mt-0.5 text-xs text-atelier-muted">{c.projectInstructionsHint}</p>
        <textarea
          id="aly-project-instructions"
          value={text}
          maxLength={4000}
          rows={3}
          onChange={(e) => {
            setText(e.target.value);
            if (state !== "idle") setState("idle");
          }}
          className="mt-2 w-full resize-y rounded-[12px] border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink outline-none focus:border-atelier-accent"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={state === "saving"}
            className="rounded-full border border-atelier-rule px-3.5 py-1.5 text-xs font-medium text-atelier-ink hover:bg-atelier-ink/[0.05] disabled:opacity-60"
          >
            {state === "saving" ? c.saving : c.save}
          </button>
          {state === "saved" && <span className="text-xs text-atelier-muted">{c.saved}</span>}
          {state !== "idle" && state !== "saving" && state !== "saved" && <span className="text-xs text-red-500">{state}</span>}
        </div>
      </form>
    </section>
  );
}
