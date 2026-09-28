// How Aly's chat shows itself (2026-09-27, operator: "Add the subtitles too
// as an option in settings", after the floating card and the Filament /
// Blossom wheels were built). Pure, so the layout and the settings action can
// read it on the server.
//
// Card: the conversation in a floating card that rises out of the lamp's
// corner. Subtitles: her words across the bottom of the screen like a film's,
// the part not yet spoken dimmed, your last words above them, a slim box to
// type in; the whole conversation and Notes still open as the card. Saved on
// the account (producer_prefs.chat_style). Subtitles are the default since
// 2026-09-28 (operator: "Make the subtitles the default"); anyone who saved
// the card keeps it.

export const CHAT_STYLES = ["card", "subtitles"] as const;
export type ChatStyle = (typeof CHAT_STYLES)[number];
export const DEFAULT_CHAT_STYLE: ChatStyle = "subtitles";

export const CHAT_STYLE_LABELS: Record<ChatStyle, { name: string; line: string }> = {
  card: { name: "Floating card", line: "The conversation in a card that rises from the lamp." },
  subtitles: { name: "Subtitles", line: "Her words across the bottom of the screen, like a film." },
};

/** A stored style, or the default when there is none or it isn't one of ours. */
export function parseChatStyle(value: unknown): ChatStyle {
  return (CHAT_STYLES as readonly unknown[]).includes(value) ? (value as ChatStyle) : DEFAULT_CHAT_STYLE;
}

/** How many words there are in what she has said aloud. */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * One subtitle: the end of `text` when it is long (from the start of a
 * sentence where one begins close enough, else a word), split into what she
 * has already said and what is still to come. `spokenWords` null = all said
 * (she isn't speaking it). `cut` = the start was left out.
 */
export function subtitleView(
  text: string,
  spokenWords: number | null,
  max = 240,
): { cut: boolean; said: string; rest: string } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let start = 0;
  let length = words.join(" ").length;
  while (length > max && start < words.length - 1) {
    length -= words[start].length + 1;
    start += 1;
  }
  if (start > 0) {
    // Prefer to begin at a sentence within the next few words.
    for (let i = start; i < Math.min(words.length - 1, start + 12); i++) {
      if (/[.!?…]["”’)]?$/.test(words[i])) {
        start = i + 1;
        break;
      }
    }
  }
  const shown = words.slice(start);
  const saidCount = spokenWords === null ? shown.length : Math.max(0, Math.min(shown.length, spokenWords - start));
  return { cut: start > 0, said: shown.slice(0, saidCount).join(" "), rest: shown.slice(saidCount).join(" ") };
}
