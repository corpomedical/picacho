// What an admin's voice log is told about a spoken turn (2026-09-28 evening,
// after the operator's first pasted log: her first word came 6-29 s after he
// stopped talking, every answer went "pieces" and no "one sec" was ever
// said, and nothing on the phone could say why). Words for the log, never
// what was said. Alias-free, pure.

export type VoicePathFacts = {
  /** The answer is being read aloud at all. */
  speaking: boolean;
  /** The voice picked for her (null: none could be read). */
  voiceId: string | null;
  /** ELEVENLABS_API_KEY is set on the server. */
  key: boolean;
  /** The server's runtime has WebSocket (the one-take voice needs it). */
  webSocket: boolean;
  /** The sheet asked for one take (its browser can play the stream). */
  asked: boolean;
};

const ELEVENLABS_ID = /^[A-Za-z0-9]{20}$/;

/** Which way her voice goes this turn, and the one-sec acknowledgement: yes, or why not. */
export function voicePathNote(f: VoicePathFacts): string {
  if (!f.speaking) return "voice: not reading aloud";
  const idOk = f.voiceId !== null && ELEVENLABS_ID.test(f.voiceId);
  const whyNot = !f.key
    ? "no ElevenLabs key on the server"
    : f.voiceId === null
      ? "no voice picked could be read"
      : !idOk
        ? "the picked voice has no ElevenLabs id (pick another in Settings)"
        : null;
  const ack = whyNot ? `one-sec: off (${whyNot})` : "one-sec: on";
  const fast = whyNot
    ? `fast voice: off (${whyNot})`
    : !f.webSocket
      ? "fast voice: off (the server has no WebSocket)"
      : !f.asked
        ? "fast voice: off (this browser can't play it)"
        : "fast voice: on";
  return `${fast} · ${ack}`;
}

export type TurnTimes = {
  start: number;
  transcribed?: number | null;
  judged?: number | null;
  opened?: number | null;
  ack?: number | null;
  firstText?: number | null;
  firstSound?: number | null;
};

/** Seconds from the request arriving to each step, the steps that happened. */
export function timingNote(t: TurnTimes): string {
  const s = (at: number | null | undefined) => (typeof at === "number" ? `${((at - t.start) / 1000).toFixed(1)} s` : null);
  const parts: [string, string | null][] = [
    ["transcribed", s(t.transcribed)],
    ["judged", s(t.judged)],
    ["accepted", s(t.opened)],
    ["one-sec", s(t.ack)],
    ["first words", s(t.firstText)],
    ["first sound", s(t.firstSound)],
  ];
  const shown = parts.filter((p): p is [string, string] => p[1] !== null).map(([k, v]) => `${k} ${v}`);
  return shown.length ? `server: ${shown.join(" · ")}` : "server: no steps timed";
}
