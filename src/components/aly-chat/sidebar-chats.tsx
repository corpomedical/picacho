"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { listMyChats } from "@/lib/aly-chat/actions";
import { cn } from "@/lib/cn";

// The sidebar's list on Aly's chat page (2026-09-29): New chat, her chats
// newest first, and what she remembers. Read here rather than in the app
// layout so no other page pays for it; refreshed when a chat is started,
// named, renamed, moved or deleted (the page sends "aly-chats-changed").

type Item = { id: string; title: string | null; projectId: string | null };

export function SidebarChats({ pathname }: { pathname: string }) {
  const { t } = useLocale();
  const c = t.alyChat;
  const router = useRouter();
  const [chats, setChats] = useState<Item[] | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      listMyChats()
        .then((rows) => {
          if (live) setChats(rows);
        })
        .catch(() => {});
    load();
    window.addEventListener("aly-chats-changed", load);
    return () => {
      live = false;
      window.removeEventListener("aly-chats-changed", load);
    };
  }, []);

  // A chat started on /app/chat moves the address to /app/chat/<id> without
  // a navigation; the list lights it from the real address.
  const [here, setHere] = useState(pathname);
  useEffect(() => {
    const sync = () => setHere(window.location.pathname);
    sync();
    window.addEventListener("aly-chats-changed", sync);
    return () => window.removeEventListener("aly-chats-changed", sync);
  }, [pathname]);

  const row = "flex items-center gap-2 rounded-control px-2.5 py-2 text-xs transition-colors";
  return (
    <div>
      <Link
        href="/app/chat"
        onClick={(e) => {
          // Always a fresh page: a chat started here moved the address
          // without a navigation, so the router may think it's already here.
          e.preventDefault();
          router.push(`/app/chat?n=${Date.now()}`);
        }}
        className={cn(row, "mb-2 border border-atelier-rule text-atelier-ink hover:bg-atelier-ink/5")}
      >
        <span aria-hidden="true" className="text-sm leading-none">
          +
        </span>
        <span className="flex-1">{c.newChat}</span>
      </Link>
      <p className="px-2.5 text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{c.chats}</p>
      {chats === null ? null : chats.length === 0 ? (
        <p className="mt-2 px-2.5 text-xs text-atelier-muted">{c.noChats}</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {chats.map((chat) => {
            const href = `/app/chat/${chat.id}`;
            return (
              <li key={chat.id}>
                <Link
                  href={href}
                  className={cn(
                    row,
                    here === href ? "bg-atelier-ink/[0.08] text-atelier-ink" : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{chat.title || "…"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Link
        href="/app/chat/memory"
        className={cn(
          row,
          "mt-3",
          here === "/app/chat/memory" ? "bg-atelier-ink/[0.08] text-atelier-ink" : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
        )}
      >
        <span className="flex-1">{c.memory}</span>
      </Link>
    </div>
  );
}
