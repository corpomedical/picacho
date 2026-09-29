import { notFound } from "next/navigation";
import { ChatView } from "@/components/aly-chat/chat-view";
import { ChatClosed } from "@/components/aly-chat/chat-closed";
import { chatPageBase } from "@/lib/aly-chat/page-data";
import { getChat, listDocs, loadRows } from "@/lib/aly-chat/store";
import { toView } from "@/lib/aly-chat/view";

export const maxDuration = 300;

/** One of Aly's chats, opened again (2026-09-29). */
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const base = await chatPageBase();
  if (!base.open) return <ChatClosed />;
  // The session's own client: the tables let a person read only their rows.
  const chat = await getChat(base.supabase, base.userId, id);
  if (!chat) notFound();
  const [rows, docs] = await Promise.all([loadRows(base.supabase, id), listDocs(base.supabase, base.userId, id)]);
  const project = chat.projectId ? base.projects.find((p) => p.id === chat.projectId) ?? null : null;
  return (
    <ChatView
      key={id}
      chatId={id}
      title={chat.title}
      initial={toView(rows)}
      docs={docs}
      name={base.name}
      firstName={base.firstName}
      brains={base.brains}
      limited={base.limited}
      project={project}
      projects={base.projects}
      defaults={base.defaults}
      topUpHref={base.topUpHref}
      liveVoice={base.liveVoice}
    />
  );
}
