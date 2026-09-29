import { getServerMessages } from "@/lib/i18n/server";

/** Before aly-chat.sql runs, or with the flag off. */
export async function ChatClosed() {
  const { t } = await getServerMessages();
  return <p className="px-4 py-24 text-center text-sm text-atelier-muted">{t.alyChat.closed}</p>;
}
