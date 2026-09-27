"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setProducerChat } from "@/lib/producer/actions";
import { CHAT_STYLES, CHAT_STYLE_LABELS, type ChatStyle } from "@/components/producer/chat-style";

// How the chat shows itself (2026-09-27, operator: "Add the subtitles too as
// an option in settings"). Each choice is a small picture of a corner of the
// screen with the chat open that way. Saved on the account. English only
// while the assistant is, like its sheet.

export function ProducerChatForm({ current }: { current: ChatStyle }) {
  const router = useRouter();
  const [choice, setChoice] = useState<ChatStyle>(current);
  const [saved, setSaved] = useState<ChatStyle>(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    const r = await setProducerChat(choice);
    setBusy(false);
    if (r.error) return setMessage(r.error);
    setSaved(choice);
    setMessage("Saved. The chat opens its new way.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Its chat" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CHAT_STYLES.map((style) => {
          const on = choice === style;
          return (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setChoice(style)}
              className={
                "flex flex-col gap-2 rounded-control border p-2 text-left transition-colors " +
                (on ? "border-atelier-accent bg-atelier-accent/10" : "border-atelier-rule hover:border-atelier-ink/30")
              }
            >
              <span aria-hidden="true" className="relative block aspect-[3/2] w-full max-w-[240px] overflow-hidden rounded-[10px] bg-[#0b0a08]">
                {style === "card" ? <CardPicture /> : <SubtitlesPicture />}
                <span
                  className="absolute bottom-[8px] right-[8px] block h-[14px] w-[14px] rounded-full"
                  style={{
                    background: "radial-gradient(circle at 50% 40%, #ffd9a8 0 20%, #e0a468 52%, #7a4d23 100%)",
                    boxShadow: "0 0 10px 2px rgba(255,205,140,0.45)",
                  }}
                />
              </span>
              <span className="min-w-0 px-1 pb-1">
                <span className="block text-sm font-medium text-atelier-ink">{CHAT_STYLE_LABELS[style].name}</span>
                <span className="mt-0.5 block text-xs text-atelier-muted">{CHAT_STYLE_LABELS[style].line}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={choice === saved || busy}
          className="rounded-full bg-atelier-accent px-4 py-1.5 text-sm font-semibold text-[#1a120a] disabled:opacity-40"
        >
          Save
        </button>
        <span role="status" aria-live="polite" className="text-xs text-atelier-muted">
          {message}
        </span>
      </div>
    </div>
  );
}

// A card rising from the lamp's corner, three lines of conversation in it.
function CardPicture() {
  return (
    <span className="absolute bottom-[30px] right-[8px] flex w-[58%] flex-col gap-[5px] rounded-[9px] border border-[rgba(243,237,228,0.10)] bg-[#1e1a15] p-[7px]">
      <span className="ml-auto block h-[7px] w-[62%] rounded-full bg-[rgba(243,237,228,0.30)]" />
      <span className="block h-[5px] w-[92%] rounded-full bg-[rgba(243,237,228,0.50)]" />
      <span className="block h-[5px] w-[74%] rounded-full bg-[rgba(243,237,228,0.50)]" />
      <span className="ml-auto block h-[7px] w-[50%] rounded-full bg-[rgba(243,237,228,0.30)]" />
      <span className="mt-[2px] block h-[10px] w-full rounded-full border border-[rgba(243,237,228,0.35)]" />
    </span>
  );
}

// Her words across the bottom, the end not yet spoken dimmed.
function SubtitlesPicture() {
  return (
    <span className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-[4px] bg-gradient-to-t from-[#080705] via-[rgba(8,7,5,0.92)] to-[rgba(8,7,5,0)] px-[14%] pb-[10px] pt-[28px] text-center">
      <span className="font-mono text-[6.5px] uppercase tracking-[0.12em] text-[#a89f92]">
        <span className="text-[#e0a468]">You</span> · a close-up of her eyes
      </span>
      <span className="text-[10.5px] leading-[1.25] text-[#f3ede4]" style={{ fontFamily: "var(--font-numeral-face, Georgia), Georgia, serif" }}>
        Love that. Her eyes in the mirror, <span className="text-[rgba(243,237,228,0.35)]">sun flaring across them.</span>
      </span>
      <span className="mt-[2px] block h-[9px] w-[70%] rounded-full border border-[rgba(243,237,228,0.35)]" />
    </span>
  );
}
