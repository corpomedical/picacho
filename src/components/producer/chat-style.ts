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

/**
 * A phone's subtitle, like a film's (2026-09-30, operator: the subtitles
 * "take more than half the screen" on the Android app → "Lets try B"): at
 * most `max` characters, about two lines. The answer is cut into pieces at
 * sentence ends (and at a comma or a word inside a long sentence). While she
 * speaks (`spokenWords` = words said so far) it is the piece she is saying,
 * with what she hasn't said yet dimmed; otherwise the last piece, all said.
 * `cut` = earlier pieces aren't shown (only when she isn't speaking).
 */
export function phoneSubtitle(
  text: string,
  spokenWords: number | null,
  max = 84,
): { cut: boolean; said: string; rest: string } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { cut: false, said: "", rest: "" };
  const pieces = subtitlePieces(words, max);
  if (spokenWords === null) {
    const last = pieces[pieces.length - 1];
    return { cut: pieces.length > 1, said: words.slice(last.start, last.end).join(" "), rest: "" };
  }
  const at = Math.max(0, Math.min(words.length - 1, spokenWords - 1));
  const piece = pieces.find((p) => at < p.end) ?? pieces[pieces.length - 1];
  const saidEnd = Math.max(piece.start, Math.min(piece.end, spokenWords));
  return {
    cut: false,
    said: words.slice(piece.start, saidEnd).join(" "),
    rest: words.slice(saidEnd, piece.end).join(" "),
  };
}

const SENTENCE_END = /[.!?…]["”’)]?$/;

/** Word ranges [start, end) of at most `max` characters each. */
function subtitlePieces(words: string[], max: number): { start: number; end: number }[] {
  const pieces: { start: number; end: number }[] = [];
  let start = 0;
  while (start < words.length) {
    let end = start + 1;
    let length = words[start].length;
    let clause = -1;
    while (end < words.length && length + 1 + words[end].length <= max) {
      // A sentence ends the piece once it has a few words in it.
      if (SENTENCE_END.test(words[end - 1]) && length >= max * 0.3) break;
      if (/[,;:—–]["”’)]?$/.test(words[end - 1])) clause = end;
      length += 1 + words[end].length;
      end += 1;
    }
    if (end < words.length && !SENTENCE_END.test(words[end - 1])) {
      // Too long for one piece: break after the last comma when that keeps a fair share.
      if (clause > start && words.slice(start, clause).join(" ").length >= max * 0.45) end = clause;
      else {
        // Or, when only a few words of the sentence would be left over, halve
        // it evenly instead of leaving them on their own.
        let stop = end;
        while (stop < words.length && !SENTENCE_END.test(words[stop - 1])) stop += 1;
        const text = (a: number, b: number) => words.slice(a, b).join(" ").length;
        if (text(end, stop) < max * 0.35) {
          let best = end;
          for (let k = start + 1; k < stop; k++) {
            if (text(start, k) > max || text(k, stop) > max) continue;
            if (Math.abs(text(start, k) - text(k, stop)) < Math.abs(text(start, best) - text(best, stop))) best = k;
          }
          end = best;
        }
      }
    }
    pieces.push({ start, end });
    start = end;
  }
  return pieces;
}
