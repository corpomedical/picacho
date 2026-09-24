// Cutting a streaming answer into sentences to speak (2026-09-25). Pure.
//
// The Producer's reply arrives a few words at a time. Waiting for the whole
// answer before speaking adds seconds of silence to every hands-free turn,
// so each sentence is sent to text-to-speech as soon as it is complete, and
// the pieces play in order. A piece is released at a sentence end (. ! ? …
// followed by a space or a line break) once it holds at least MIN_CHARS —
// short fragments ("Sure.") ride with the next sentence rather than making a
// call of their own. flush() hands over whatever is left when the answer ends.

export const MIN_CHARS = 40;
export const MAX_CHARS = 600;

export type Chunker = { push(text: string): string[]; flush(): string[] };

export function sentenceChunker(): Chunker {
  let buffer = "";

  function take(final: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      if (buffer.length === 0) break;
      let cut = -1;
      const re = /[.!?…](?:["')\]]*)(?=\s)|\n+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(buffer))) {
        const end = m.index + m[0].length;
        if (end >= MIN_CHARS) {
          cut = end;
          break;
        }
      }
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
