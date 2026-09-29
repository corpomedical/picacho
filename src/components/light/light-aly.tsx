"use client";

import "./light.css";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { LIGHT_HOME, lightChatHref, LIGHT_DIRECT_HREF } from "@/lib/light/mode";
import { ChatView, type ChatViewProps, type LightChatFrame } from "@/components/aly-chat/chat-view";
import { LightTopBar, PictureGlyph, Ridges, VideoGlyph } from "./light-chat";

/**
 * PICACHO LIGHT with Aly (operator, 2026-09-29: "Add Aly capabilities to
 * Light version" → "Aly IS the Light chat"). One box, like ChatGPT or Gemini:
 * she answers, searches the web, reads files and remembers; a picture or a
 * video comes as her card with its price, and "Make it" renders it right in
 * the chat. Light's own frame stays: the greeting on the ridge, its ideas,
 * its top bar and addresses (/app/light?chat=<id>). Her chats are the same
 * ones as on her own page.
 */
export function LightAly({
  creditsLeft,
  letter,
  ...chat
}: Omit<ChatViewProps, "light"> & { creditsLeft: number; letter: string }) {
  const { t } = useLocale();
  const l = t.light;
  const empty = chat.initial.length === 0;

  const ideas: { text: string; glyph: "video" | "picture" | "chat" }[] = [
    { text: l.idea1, glyph: "video" },
    { text: l.alyIdeaPlan, glyph: "chat" },
    { text: l.idea3, glyph: "picture" },
    { text: formatMsg(l.alyIdeaAsk, { name: chat.name }), glyph: "chat" },
  ];

  const frame: LightChatFrame = {
    chatHref: lightChatHref,
    newHref: () => `${LIGHT_HOME}?n=${Date.now()}`,
    directHref: LIGHT_DIRECT_HREF,
    directLabel: formatMsg(l.withoutAly, { name: chat.name }),
    placeholder: formatMsg(l.askPlaceholder, { name: chat.name }),
    // One box on the page (its refs and label are single), so the phone and
    // the desktop boards share it: on a phone the greeting fills the middle
    // and the ideas and box sit at the bottom; on a desktop all three centre.
    hero: (composer, notice, fill) => (
      <div className="flex min-h-full flex-col md:items-center md:justify-center md:gap-9 md:px-12 md:pb-[72px]">
        <div className="flex flex-grow flex-col justify-center gap-1.5 px-7 pb-10 md:w-full md:max-w-[760px] md:flex-grow-0 md:px-0 md:pb-0">
          <span className="pl-display text-[32px] font-semibold md:text-[40px] md:leading-tight" style={{ color: "var(--pl-accent)" }}>
            {chat.firstName ? formatMsg(l.hiName, { name: chat.firstName }) : l.hiThere}
          </span>
          <span className="pl-display text-[32px] font-medium leading-[1.15] md:text-[40px] md:leading-tight" style={{ color: "var(--pl-soft)" }}>
            {l.whatToday}
          </span>
        </div>
        <div className="order-3 w-full px-3 pb-[max(12px,env(safe-area-inset-bottom))] md:order-2 md:max-w-[760px] md:px-0 md:pb-0">
          {notice}
          {composer}
        </div>
        <div className="order-2 flex gap-2.5 overflow-x-auto px-4 pb-3.5 [scrollbar-width:none] md:order-3 md:grid md:w-full md:max-w-[760px] md:grid-cols-4 md:gap-3 md:overflow-visible md:px-0 md:pb-0">
          {ideas.map((idea) => (
            <button
              key={idea.text}
              type="button"
              className="pl-idea w-[168px] flex-shrink-0 !rounded-2xl !p-3.5 !leading-[1.35] md:flex md:h-32 md:w-auto md:flex-col md:justify-between md:!rounded-[18px] md:!p-4"
              onClick={() => fill(idea.text)}
            >
              <span>{idea.text}</span>
              <span className="hidden md:block">
                {idea.glyph === "video" ? <VideoGlyph /> : idea.glyph === "picture" ? <PictureGlyph /> : <ChatGlyph />}
              </span>
            </button>
          ))}
        </div>
        {chat.limited && (
          <p className="order-4 hidden text-center text-xs md:block" style={{ color: "var(--pl-muted)" }}>
            {t.alyChat.freeNote}
          </p>
        )}
      </div>
    ),
  };

  return (
    <main className="pl-surface pl-aly relative flex h-full min-w-0 flex-col overflow-hidden">
      <div aria-hidden="true" className="pl-sky" />
      <div className="hidden md:block">
        <Ridges height={empty ? 300 : 200} />
      </div>
      <div className="md:hidden">
        <Ridges height={220} />
      </div>
      <LightTopBar creditsLeft={creditsLeft} initial={letter} />
      <div className="relative min-h-0 flex-1">
        <ChatView {...chat} light={frame} />
      </div>
    </main>
  );
}

function ChatGlyph() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="var(--pl-accent)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </svg>
  );
}
