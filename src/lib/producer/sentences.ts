// Cutting a streaming answer into sentences to speak (2026-09-25). Pure.
//
// The Producer's reply arrives a few words at a time. Waiting for the whole
// answer before speaking adds seconds of silence to every hands-free turn,
// so each sentence is sent to text-to-speech as soon as it is complete, and
// the pieces play in order. A piece is released at a sentence end (. ! ? …
// followed by a space or a line break) once it holds at least MIN_CHARS —
// short fragments ("Sure.") ride with the next sentence rather than making a
// call of their own. flush() hands over whatever is left when the answer ends.
//
// THE FIRST PIECE GOES SOONER (2026-09-25, operator: "make it faster at
// responses"). Until it is out, the person hears nothing, so it is released
// at the first sentence end past FIRST_MIN_CHARS ("Oh, nice idea." is enough),
// or, in a long opening sentence, at a clause break (, ; : —) past
// FIRST_CLAUSE_CHARS. The voice carries the words before each piece
// (speech.ts, previous_text), so the early cut doesn't break the intonation.

export const MIN_CHARS = 40;
export const MAX_CHARS = 600;
export const FIRST_MIN_CHARS = 12;
export const FIRST_CLAUSE_CHARS = 32;

export type Chunker = { push(text: string): string[]; flush(): string[] };

const SENTENCE_END = /[.!?…](?:["')\]]*)(?=\s)|\n+/g;
const CLAUSE_END = /[,;:](?=\s)|\s[—–](?=\s)/g;

function firstCut(re: RegExp, text: string, min: number): number {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (end >= min) return end;
  }
  return -1;
}

export function sentenceChunker(): Chunker {
  let buffer = "";
  let released = 0;

  function take(final: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      if (buffer.length === 0) break;
      const first = released === 0 && out.length === 0;
      let cut = firstCut(SENTENCE_END, buffer, first ? FIRST_MIN_CHARS : MIN_CHARS);
      if (cut < 0 && first) cut = firstCut(CLAUSE_END, buffer, FIRST_CLAUSE_CHARS);
      if (cut < 0 && buffer.length > MAX_CHARS) {
        // No sentence end in a long run: break at the last space.
        const sp = buffer.lastIndexOf(" ", MAX_CHARS);
        cut = sp > MIN_CHARS ? sp : MAX_CHARS;
      }
      if (cut < 0) break;
      const piece = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut).replace(/^\s+/, "");
      if (piece) out.push(piece);
    }
    if (final && buffer.trim()) {
      out.push(buffer.trim());
      buffer = "";
    }
    released += out.length;
    return out;
  }

  return {
    push(text: string) {
      buffer += text;
      return take(false);
    },
    flush() {
      return take(true);
    },
  };
}
