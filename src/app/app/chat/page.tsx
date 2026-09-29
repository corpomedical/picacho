import { ChatView } from "@/components/aly-chat/chat-view";
import { ChatClosed } from "@/components/aly-chat/chat-closed";
import { chatPageBase } from "@/lib/aly-chat/page-data";

// A render card's "Make it" runs runGeneration, a server action of this page:
// the generate page's ceiling.
export const maxDuration = 300;

/**
 * ALY'S OWN PAGE, a new chat (2026-09-29, operator: "a chat version where it
 * works exactly as chatgpt and anthropic" → layout A). ?project=<id> starts
 * the chat inside that project.
 */
export default async function NewChatPage({ searchParams }: { searchParams: Promise<{ project?: string; n?: string }> }) {
  const base = await chatPageBase();
  if (!base.open) return <ChatClosed />;
  const { project: projectId, n } = await searchParams;
  const project = projectId ? base.projects.find((p) => p.id === projectId) ?? null : null;
  return (
    <ChatView
      // "New chat" adds ?n=<time>, so a fresh one is always a fresh page.
      key={`${project?.id ?? "new"}-${n ?? ""}`}
      chatId={null}
      title={null}
      initial={[]}
      docs={[]}
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
