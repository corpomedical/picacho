// What was said in a live-voice call, sorted into what her brain was asked
// and the small talk the voice handled itself (2026-09-29, operator: "Every
// Aly user, after 3 fixes" — one of them: her small talk is saved in the
// chat). Alias-free and pure, so it can be tested.
//
// GPT-Live's hand-over event carries no words (OpenAI's delegation guide:
// "It does not contain the user's utterance or task text"), so the request
// is worked out from the transcripts: the person's lines since she last
// really spoke (a listening sound — "mm", "uh-huh" — isn't a reply). Her
// line begun just before the hand-over is her "Sure, checking" for it. Her
// brain is also given the recent transcript (`context`), so a question said
// over a TV (whose words the transcript mixes in) is still found.
//
// Times are the call's own timeline (the transcript's start_ms/end_ms and
// the hand-over's offset_ms, "milliseconds from the start of the session").
// The transcript has "no item ID or event that marks a completed
// conversational turn" (OpenAI's session guide), and the two can talk at
// once (she hears while she talks), so each speaker's line runs on until
// THAT speaker pauses for GAP_MS.
//
// Saved as small talk: her lines that weren't about a hand-over or only a
// listening sound, and the person's lines she answered that way. Not saved
// here (the brain's turn saves them): the request, her "checking" while the
// brain works, the answer as she retold it — nor what she never answered
// (a TV, a word to someone else).

export type TalkWho = "person" | "her";
export type TalkLine = {
  who: TalkWho;
  text: string;
  /** When it began and its last piece ended (the call's timeline, ms). */
  at: number;
  end: number;
  /** A person's line handed to the brain as (part of) a request. */
  handed?: boolean;
  /** A line of hers about a hand-over: "checking", or the answer retold. */
  about?: boolean;
};

/** Her line that began this soon before a hand-over is its "checking". */
export const ACK_WINDOW_MS = 700;
/** A pause this long in one speaker's pieces ends their line. */
export const GAP_MS = 1200;
/** Her pause this short inside a retold answer doesn't end being about it. */
export const RETELL_GAP_MS = 3000;
/** At most this much of the request goes to the brain, and of the transcript with it. */
export const MAX_REQUEST_CHARS = 1500;
export const MAX_CONTEXT_CHARS = 3000;

/** Her line sharing this much of its words with the last answer is that answer, retold. */
export const RETOLD_SHARE = 0.5;

function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3 || /\p{N}/u.test(w));
}

/** More than a listening sound ("Mm.", "Uh-huh", "Yeah, okay"). */
export function isReply(text: string): boolean {
  return text.split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w)).length >= 3;
}

const clean = (t: string) => t.replace(/\s+/g, " ").trim();

export class LiveTalk {
  /** Finished lines, in the order they began. */
  readonly lines: TalkLine[] = [];
  private open: Record<TalkWho, TalkLine | null> = { person: null, her: null };
  /** Hand-overs whose answer she hasn't started retelling. */
  private waiting = 0;
  /** Answers sent to her and not yet begun. */
  private toRetell = 0;
  /** Her last line, for a retold answer she pauses in, and when the person last said anything. */
  private lastHer: TalkLine | null = null;
  private lastPersonAt = -Infinity;
  /** Lines before this index are saved (or never will be). */
  private savedUpTo = 0;
  /** Where the transcript given to the brain starts (after the last hand-over's). */
  private contextFrom = 0;
  /** The last answer's words: her line that says them back is the answer retold, pauses or not. */
  private answerWords = new Set<string>();

  /** A piece of what the person is saying, and when (the call's timeline). */
  heard(delta: string, start: number, end = start) {
    this.piece("person", delta, start, end);
  }

  /** A piece of what she is saying. */
  said(delta: string, start: number, end = start) {
    this.piece("her", delta, start, end);
  }

  private piece(who: TalkWho, delta: string, start: number, end: number) {
    if (!delta) return;
    const cur = this.open[who];
    if (cur && start - cur.end > GAP_MS) this.close(who);
    if (!this.open[who]) {
      const line: TalkLine = { who, text: "", at: start, end };
      if (who === "her") {
        const prev = this.lastHer;
        if (this.toRetell > 0) {
          // The answer, retold.
          this.toRetell--;
          this.waiting = Math.max(0, this.waiting - 1);
          line.about = true;
        } else if (this.waiting > 0) {
          // "Checking", or filling the wait.
          line.about = true;
        } else if (prev?.about && start - prev.end <= RETELL_GAP_MS && this.lastPersonAt < prev.end) {
          // Still the answer, after a breath (nobody spoke in between).
          line.about = true;
        }
        this.lastHer = line;
      }
      this.open[who] = line;
    }
    if (who === "person") this.lastPersonAt = Math.max(this.lastPersonAt, start);
    const c = this.open[who]!;
    // A piece after a pause may start a new sentence with no space before it.
    if (c.text && start - c.end > 300 && !/\s$/.test(c.text) && !/^\s/.test(delta)) c.text += " ";
    c.text += delta;
    c.end = Math.max(c.end, end);
  }

  private close(who: TalkWho) {
    const c = this.open[who];
    this.open[who] = null;
    if (!c || !clean(c.text)) return;
    c.text = clean(c.text);
    if (who === "her" && !c.about && this.answerWords.size > 0) {
      const words = wordsOf(c.text);
      const shared = words.filter((w) => this.answerWords.has(w)).length;
      if (words.length > 0 && shared / words.length >= RETOLD_SHARE) c.about = true;
    }
    // In the order they began (the other speaker's may have begun later).
    let i = this.lines.length;
    while (i > this.savedUpTo && this.lines[i - 1].at > c.at) i--;
    this.lines.splice(i, 0, c);
  }

  /** Ends the lines of anyone silent for GAP_MS by `now`, or everyone's (the call ended). */
  finish(now?: number) {
    for (const who of ["person", "her"] as const) {
      const c = this.open[who];
      if (c && (now === undefined || now - c.end > GAP_MS)) this.close(who);
    }
  }

  private all(): TalkLine[] {
    const open = [this.open.person, this.open.her].filter((l): l is TalkLine => !!l);
    return [...this.lines, ...open].sort((a, b) => a.at - b.at);
  }

  /**
   * A hand-over (at `now` on the call's timeline): the request's words, the
   * recent transcript for her brain, and the small talk before it that
   * isn't saved yet (the brain's turn saves it first, so the chat keeps the
   * order it was said in).
   */
  handOver(now: number): { words: string; context: string; before: { who: TalkWho; text: string }[] } {
    this.finish(now);
    const all = this.all();
    // Her line just begun is this hand-over's "checking".
    for (const l of all) if (l.who === "her" && !l.about && l.at >= now - ACK_WINDOW_MS) l.about = true;
    let boundary: TalkLine | null = null;
    for (let i = all.length - 1; i >= 0; i--) {
      const l = all[i];
      if (l.who === "her" && l.at < now - ACK_WINDOW_MS && isReply(l.text)) {
        boundary = l;
        break;
      }
    }
    let picked = all.filter((l) => l.who === "person" && !l.handed && (!boundary || l.at > boundary.at));
    if (picked.length === 0) {
      // Nothing since her last reply: the last person line before it, and
      // what she said after it was her "checking" for this.
      const lastPerson = [...all].reverse().find((l) => l.who === "person" && !l.handed);
      if (lastPerson) {
        picked = [lastPerson];
        for (const l of all) if (l.who === "her" && l.at > lastPerson.at) l.about = true;
      }
    }
    for (const l of picked) l.handed = true;
    this.waiting++;
    const words = picked
      .map((l) => clean(l.text))
      .filter(Boolean)
      .join(" … ")
      .slice(-MAX_REQUEST_CHARS);
    // The transcript since the last hand-over's, both of them.
    const window = all.filter((l) => l.end >= this.contextFrom);
    this.contextFrom = now;
    const context = window
      .map((l) => `${l.who === "person" ? "Them" : "You (the voice)"}: ${clean(l.text)}`)
      .join("\n")
      .slice(-MAX_CONTEXT_CHARS);
    // Small talk said before the request, finished and unsaved.
    const first = picked.length ? picked[0].at : Infinity;
    let upTo = this.savedUpTo;
    while (upTo < this.lines.length && this.lines[upTo].at < first) upTo++;
    return { words, context, before: this.take(upTo) };
  }

  /** Her brain's answer was sent to her: the next line of hers retells it (and any that says it back). */
  answered(text = "") {
    this.toRetell++;
    this.answerWords = new Set(wordsOf(text));
  }

  /**
   * Small talk not yet saved. Mid-call (`now` on the call's timeline) it
   * stops at her last finished reply — a person's line she hasn't answered
   * may still become a request; at the end (no `now`) every line finishes.
   */
  flush(now?: number): { who: TalkWho; text: string }[] {
    this.finish(now);
    let end = this.lines.length;
    while (end > this.savedUpTo && !(this.lines[end - 1].who === "her" && isReply(this.lines[end - 1].text))) end--;
    if (now === undefined) end = this.lines.length;
    return this.take(end);
  }

  private take(upTo: number): { who: TalkWho; text: string }[] {
    const out: { who: TalkWho; text: string }[] = [];
    for (let i = this.savedUpTo; i < upTo; i++) {
      const l = this.lines[i];
      if (l.who === "her") {
        if (!l.about && isReply(l.text)) out.push({ who: "her", text: l.text });
        continue;
      }
      if (l.handed) continue;
      // The person's line, when her next real reply was small talk: she answered it.
      let reply: TalkLine | null = null;
      for (let j = i + 1; j < this.lines.length && !reply; j++) {
        const n = this.lines[j];
        if (n.who === "her" && isReply(n.text)) reply = n;
      }
      if (reply && !reply.about) out.push({ who: "person", text: l.text });
    }
    this.savedUpTo = Math.max(this.savedUpTo, upTo);
    return mergeTalk(out);
  }
}

/** Consecutive lines by the same speaker become one. */
export function mergeTalk(lines: { who: TalkWho; text: string }[]): { who: TalkWho; text: string }[] {
  const out: { who: TalkWho; text: string }[] = [];
  for (const l of lines) {
    const text = clean(l.text);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.who === l.who) last.text = `${last.text} ${text}`;
    else out.push({ who: l.who, text });
  }
  return out;
}

/** At most this many lines, and characters in all, saved at once. */
export const MAX_TALK_LINES = 16;
export const MAX_TALK_CHARS = 6000;
const MAX_LINE_CHARS = 1200;

/** Small talk as sent by the page, checked: only well-formed lines, within the limits. */
export function parseTalk(raw: unknown): { who: TalkWho; text: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { who: TalkWho; text: string }[] = [];
  let chars = 0;
  for (const r of raw.slice(0, MAX_TALK_LINES)) {
    const who = (r as { who?: unknown } | null)?.who;
    const text = (r as { text?: unknown } | null)?.text;
    if ((who !== "person" && who !== "her") || typeof text !== "string") continue;
    const tidy = clean(text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ")).slice(0, MAX_LINE_CHARS);
    if (!tidy) continue;
    if (chars + tidy.length > MAX_TALK_CHARS) break;
    chars += tidy.length;
    out.push({ who, text: tidy });
  }
  return mergeTalk(out);
}

/** The transcript sent with a hand-over, checked and capped (it goes into her brain's note). */
export function parseLiveContext(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tidy = raw
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(-MAX_CONTEXT_CHARS);
  return tidy || null;
}

/** Small talk as stored messages: the person's lines as theirs, hers as her answers. */
export function talkMessages(lines: { who: TalkWho; text: string }[]) {
  return mergeTalk(lines).map((l) =>
    l.who === "person"
      ? { role: "user" as const, content: [{ type: "text", text: l.text }], display: { text: l.text, live: true } }
      : { role: "assistant" as const, content: [{ type: "text", text: l.text }], display: { text: l.text, cards: [], live: true } },
  );
}

// A goodbye (2026-09-30, operator: "when telling Aly bye or shut down, she
// keeps the mic on"): her brain chose to end the call (end_voice). The call
// closes once her goodbye has been said: nothing new from her for
// GOODBYE_QUIET_MS and the call's clock past the end of what she said —
// or GOODBYE_MAX_MS after it was told, whatever she's doing.
export const GOODBYE_QUIET_MS = 1200;
export const GOODBYE_MAX_MS = 12_000;

/**
 * `now`, `told` and `herAt` (when she last said something) are the page's
 * clock; `callMs` and `herUntil` (where what she said ends) the call's.
 */
export function goodbyeSaid(a: { now: number; told: number; herAt: number; callMs: number; herUntil: number }): boolean {
  if (a.now - a.told >= GOODBYE_MAX_MS) return true;
  return a.now - a.herAt >= GOODBYE_QUIET_MS && a.callMs >= a.herUntil + 300;
}

/** The voice says its own goodbye as it hands over; only if it said nothing since is the brain's said for it. */
export function sayBrainGoodbye(text: string, herAt: number, handedAt: number): boolean {
  return text.trim() !== "" && herAt < handedAt;
}
