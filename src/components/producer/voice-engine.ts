// The Producer's ears, the pure half (2026-09-25, operator: "I want it to
// work like chatgpt, like while she is talking and i talk she shuts up to
// listen. And doesnt pick up every voice on the background and processes
// it"). No DOM here, so every rule is tested (voice-engine.test.ts);
// use-hands-free.ts wires it to the microphone.
//
// WHAT WAS WRONG (measured in the code, 2026-09-25): speech was "anything
// loud"; talking over her needed the mic to beat 2.4× a running average that
// absorbed the person's own voice, so after about half a second of talking it
// could never trigger; and constant background talk kept one recording open
// for up to 45 s and then sent it.
//
// NOW: a speech model (Silero, run in the browser; EnergySegmenter below is
// the fallback) says, every 32 ms, how likely the sound is speech. Talking
// over her is judged against what she is playing at that moment:
//   - how much of her own voice comes back through the mic (the "leak") is
//     learned while the person is quiet;
//   - a frame counts only if it is clearly speech AND louder than her leaked
//     voice could explain (3×, the classic double-talk margin plus a bit);
//   - two such frames in four → she goes quiet at once (duck, ~40 ms after
//     they start: "she shuts up to listen"). Silence is also the test: with
//     her quiet there is no echo left, so sound that holds up is someone;
//   - three frames of it (from 150 ms after) → she stays stopped and
//     listens (confirm);
//   - nothing within a second → she carries on: a cough or a knock costs a
//     second, not the answer. Three alike in one reply with nothing after is
//     her own voice coming back (a device that doesn't cancel it): the leak
//     is learned and it stops happening.
// Numbers from LiveKit Agents, Pipecat and the double-talk literature (see
// the research notes in the commit).

/** One analysed slice of the microphone, ~32 ms. */
export type VoiceFrame = {
  /** Speech probability, 0..1. */
  p: number;
  /** Microphone loudness (RMS, 0..1). */
  mic: number;
  /** Loudness of what the Producer is playing right now (RMS, 0..1). */
  out: number;
  /** ms, monotonic. */
  now: number;
};

export type BargeAction = "duck" | "unduck" | "confirm" | null;

const FRAME_MS = 32;
const WINDOW_FRAMES = 38; // ~1.2 s: natural speech has pauses between words
const DUCK_FRAMES = 2; // of the last 4 (~130 ms): going quiet is cheap and undone if wrong
const UNDUCK_AFTER_MS = 1000;
const OUT_WINDOW_MS = 250;
/** Echo louder than this share of the playback means the device isn't cancelling it: be stricter. */
const STRICT_LEAK = 0.18;
/** A dip that starts this soon after she came back from the last one "came straight back". */
const QUICK_REDIP_MS = 500;
/** The most of her level the mic can hear of her (the learning's own ceiling, as ratios are read). */
const MAX_LEAK = 1.5;

// TALKING OVER HER ON A COMPUTER (2026-09-26, operator: "I still cant
// interrupt her while she is speaking like GPT works", on a computer). Chrome
// cancels her voice there (Chrome-wide echo cancellation, on by default since
// Chrome 111 on a Mac), and while both talk its suppressor turns the PERSON
// down too — so on a laptop their voice never beat a threshold tied to her
// level, and she never went quiet. Where her echo is known to be cancelled
// (the learned leak is small), speech itself is the trigger, as ChatGPT's and
// LiveKit's are: the speech model sure it hears someone for most of a third
// of a second, however quiet. She goes quiet at once; with her silent the
// suppressor lets go and the usual confirm hears them at full level. A device
// that doesn't cancel her keeps the loudness rule, so her own voice can't
// trip it — and dips that keep coming straight back teach it that.
/** Her echo is cancelled when the mic hears less than this share of her. */
const CANCELLED_LEAK = 0.1;
const SPEECH_P = 0.7;
const SPEECH_WINDOW = 10; // ~320 ms
const SPEECH_FRAMES = 7; // ~225 ms of it sure it's speech

export class BargeIn {
  /** How much of the playback's loudness reaches the mic (learned). */
  leak = 0.3;
  leakSamples = 0;
  private ratios: number[] = [];
  /** The least the leak can be: learned from her own voice stopping her (false starts). */
  private minLeak = 0;
  /** The room's own level with her silent and nobody talking. */
  private floor = 0.005;
  private outs: { t: number; out: number }[] = [];
  private window: { candidate: boolean; mic: number }[] = [];
  private duckedAt: number | null = null;
  // While she is silenced: what the mic heard before, against her level then;
  // how many frames since sounded like someone; false starts this reply.
  private preMic = 0;
  private preOut = 0;
  private user = 0;
  /** This reply's false starts: the mic-to-her ratio each was heard at, and whether it came straight back. */
  private falseStarts: { ratio: number; quick: boolean }[] = [];
  /** When she last came back from a dip (this reply). */
  private releasedAt: number | null = null;
  /** Whether the current dip began straight after the last one ended. */
  private quickDip = false;
  /** The last frames while she spoke: was the speech model sure someone was talking? */
  private speechWin: boolean[] = [];

  /** True once the device is known to send much of her voice back (the sheet then suggests Stop). */
  get strict(): boolean {
    return this.leakSamples >= 20 && this.leak > STRICT_LEAK;
  }

  /** True once the mic is known to hear almost none of her: speech alone may stop her. */
  get echoCancelled(): boolean {
    return this.leakSamples >= 10 && this.leak < CANCELLED_LEAK;
  }

  /** The mic frame while she is replying (playing, or with speech queued). */
  step(f: VoiceFrame, replying: boolean): BargeAction {
    if (!replying) {
      this.window = [];
      this.speechWin = [];
      this.outs = [];
      this.falseStarts = [];
      this.releasedAt = null;
      if (this.duckedAt !== null) {
        this.duckedAt = null;
        return "unduck";
      }
      return null;
    }
    this.outs.push({ t: f.now, out: f.out });
    while (this.outs.length > 1 && f.now - this.outs[0].t > OUT_WINDOW_MS) this.outs.shift();
    const outMax = Math.max(...this.outs.map((o) => o.out));

    // Learn the leak while the person seems quiet and she is audible. The
    // median of recent readings: the first syllables of a person talking
    // (before the model is sure it's speech) mustn't raise it.
    if (this.duckedAt === null && f.p < 0.3 && outMax > 0.02) {
      this.ratios.push(Math.min(1.5, f.mic / outMax));
      if (this.ratios.length > 60) this.ratios.shift();
      const sorted = [...this.ratios].sort((a, b) => a - b);
      this.leak = Math.max(sorted[Math.floor(sorted.length / 2)], this.minLeak);
      this.leakSamples++;
    }
    // And the room, when she is silent and nobody talks.
    if (f.p < 0.1 && outMax < 0.01) this.floor = this.floor * 0.95 + f.mic * 0.05;

    const margin = this.strict ? 5 : 3;
    const threshold = Math.max(0.02, 3 * this.floor, margin * this.leak * outMax);
    // Louder than her echo could explain, and speech-like. The model is slow
    // on a word's first frames — browser traces on 2026-09-25 read 0.03-0.43
    // on "Wait," in one run and 0.00 for 600 ms of "Wait, make it four" in
    // another — so a frame well above what her echo could make counts on
    // loudness alone. Silencing her is the test (two such frames in four,
    // so a click can't do it).
    const candidate = f.mic > threshold && (f.p >= 0.6 || f.mic > 2 * threshold);

    if (this.duckedAt === null) {
      this.window.push({ candidate, mic: f.mic });
      if (this.window.length > WINDOW_FRAMES) this.window.shift();
      this.speechWin.push(f.p >= SPEECH_P && f.mic > Math.max(0.001, this.floor));
      if (this.speechWin.length > SPEECH_WINDOW) this.speechWin.shift();
      const recent = this.window.slice(-4).filter((w) => w.candidate);
      const spoken = this.echoCancelled && this.speechWin.filter(Boolean).length >= SPEECH_FRAMES;
      if (recent.length >= DUCK_FRAMES || spoken) {
        // She goes quiet at once. With her silent there is no echo left, so
        // whatever the mic still hears is someone else — or it was her.
        this.duckedAt = f.now;
        this.quickDip = this.releasedAt !== null && f.now - this.releasedAt <= QUICK_REDIP_MS;
        const heard = recent.length ? recent.map((w) => w.mic) : this.window.slice(-SPEECH_WINDOW).map((w) => w.mic);
        this.preMic = Math.max(...heard);
        this.preOut = outMax;
        this.user = 0;
        this.speechWin = [];
        return "duck";
      }
      return null;
    }

    const since = f.now - this.duckedAt;
    // Her voice takes a moment to leave the room (and the echo canceller).
    // Where her echo is cancelled, someone the model is sure of counts even
    // quietly (a laptop's mic across the desk).
    const person =
      f.mic > Math.max(0.02, 3 * this.floor) && (f.p >= 0.3 || f.mic > 0.04)
        ? true
        : this.echoCancelled && f.p >= 0.5 && f.mic > Math.max(0.004, 2 * this.floor);
    if (since >= 150 && person) this.user++;
    if (this.user >= 3) {
      this.falseStarts = [];
      return this.confirm();
    }
    if (since > UNDUCK_AFTER_MS) {
      // Nothing held up with her silent: a cough, a knock, an "mm" — or her
      // own voice. Her own voice does it again the moment she comes back, at
      // the same strength against her playback; a person's sounds don't land
      // straight after each dip (an "mm-hm" now and then, even three at one
      // level, must never teach it to stop listening). Three alike, the last
      // two straight after the dip before: her voice. Learn how loud it
      // comes back here, so it stops happening.
      if (this.user === 0) {
        const ratio = this.preMic / Math.max(this.preOut, 1e-4);
        this.falseStarts.push({ ratio, quick: this.quickDip });
        const recent = this.falseStarts.slice(-3);
        const ratios = recent.map((r) => r.ratio);
        const alike =
          recent.length === 3 &&
          Math.max(...ratios) <= 2 * Math.min(...ratios) &&
          recent[1].quick &&
          recent[2].quick;
        if (alike) {
          this.minLeak = Math.min(MAX_LEAK, Math.max(this.minLeak, Math.max(...ratios) * 1.25));
          this.leak = Math.max(this.leak, this.minLeak);
          this.leakSamples = Math.max(this.leakSamples, 20);
        }
      }
      return this.release();
    }
    return null;
  }

  private confirm(): BargeAction {
    this.window = [];
    this.duckedAt = null;
    return "confirm";
  }

  private release(): BargeAction {
    this.window = [];
    this.releasedAt = this.duckedAt === null ? null : this.duckedAt + UNDUCK_AFTER_MS;
    this.duckedAt = null;
    return "unduck";
  }

  /** A new session: the leak is per device and room, so it starts over. */
  reset() {
    this.leak = 0.3;
    this.leakSamples = 0;
    this.ratios = [];
    this.minLeak = 0;
    this.floor = 0.005;
    this.outs = [];
    this.window = [];
    this.duckedAt = null;
    this.falseStarts = [];
    this.releasedAt = null;
    this.quickDip = false;
    this.speechWin = [];
  }
}

/** Frames per second the engine expects (for callers that slice audio themselves). */
export const VOICE_FRAME_MS = FRAME_MS;

// ---------------------------------------------------------------------------
// The person's own voice level: a near/far signal (a TV across the room is
// much quieter at the mic than someone at the device). Learned from the
// recordings the server accepted as said to the Producer; sent with each
// recording so the server's judge can weigh it. Never a hard gate on its own,
// except at the extreme (see isFarAway).

/** A recording's speech level: the RMS of its loudest half (padding and pauses don't dilute it). */
export function speechLevel(samples: Float32Array, sampleRate = 16000): number {
  const win = Math.max(1, Math.round(sampleRate * 0.03));
  const levels: number[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += samples[j] * samples[j];
    levels.push(Math.sqrt(sum / win));
  }
  if (levels.length === 0) return 0;
  levels.sort((a, b) => b - a);
  const top = levels.slice(0, Math.max(1, Math.ceil(levels.length / 2)));
  return top.reduce((a, b) => a + b, 0) / top.length;
}

export class VoiceLevel {
  private accepted: number[] = [];
  /** The person's usual level, or null until three recordings were accepted. */
  get usual(): number | null {
    if (this.accepted.length < 3) return null;
    const s = [...this.accepted].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
  accept(level: number) {
    if (!(level > 0)) return;
    this.accepted.push(level);
    if (this.accepted.length > 7) this.accepted.shift();
  }
  /** This recording's level against theirs (1 = as loud as they usually are), or null. */
  nearness(level: number): number | null {
    const u = this.usual;
    return u ? Math.round((level / u) * 100) / 100 : null;
  }
  /**
   * So much quieter than the person that it can't be them at the device
   * (≈ −18 dB): dropped before it is sent. Everything else goes to the judge.
   */
  isFarAway(level: number): boolean {
    const n = this.nearness(level);
    return n !== null && n < 0.125;
  }
}

// ---------------------------------------------------------------------------
// A recording, as uploaded: 16 kHz mono 16-bit WAV (every transcriber takes
// it; 10 s is 320 KB).

export function encodeWav(samples: Float32Array, sampleRate = 16000): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

// ---------------------------------------------------------------------------
// The fallback ears, where the speech model can't load (an old browser, a
// blocked download): the same segmenting rules as the model's, with a
// loudness-based stand-in for "speech probability". Coarser — it can't tell
// a door from a word — so the server's judge matters more then.

export type SegmentEvent =
  | { kind: "start" }
  | { kind: "misfire" }
  | { kind: "end"; audio: Float32Array };

export class EnergySegmenter {
  private floor = 0.008;
  private speaking = false;
  private speechFrames = 0;
  private silentFrames = 0;
  private buf: Float32Array[] = [];
  private pre: Float32Array[] = [];
  private recent: number[] = [];
  constructor(
    private opts = { padFrames: 10, redemptionFrames: 22, minSpeechFrames: 8, maxFrames: 30 * 31 },
  ) {}

  /** Speech probability stand-in for a frame of this loudness (the room floor is learned while quiet). */
  pOf(mic: number): number {
    const ratio = mic / Math.max(0.004, this.floor);
    return Math.max(0, Math.min(1, (ratio - 2) / 3));
  }

  push(frame: Float32Array, mic: number): { p: number; event: SegmentEvent | null } {
    let p = this.pOf(mic);
    if (!this.speaking && p < 0.3) this.floor = this.floor * 0.97 + mic * 0.03;
    // Speech has pauses; a room that got louder (an air conditioner coming
    // on) doesn't. After 3 s of "speech", the quietest tenth of the last two
    // seconds is taken as the room, so steady noise stops counting.
    this.recent.push(mic);
    if (this.recent.length > 62) this.recent.shift();
    if (this.speaking && this.buf.length > 94) {
      const sorted = [...this.recent].sort((a, b) => a - b);
      const quiet = sorted[Math.floor(sorted.length / 10)] * 0.8;
      if (quiet > this.floor) {
        this.floor = quiet;
        p = this.pOf(mic);
      }
    }
    let event: SegmentEvent | null = null;
    if (!this.speaking) {
      this.pre.push(frame);
      if (this.pre.length > this.opts.padFrames) this.pre.shift();
      if (p >= 0.5) {
        this.speaking = true;
        this.speechFrames = 1;
        this.silentFrames = 0;
        this.buf = [...this.pre];
        this.pre = [];
        event = { kind: "start" };
      }
      return { p, event };
    }
    this.buf.push(frame);
    if (p >= 0.5) {
      this.speechFrames++;
      this.silentFrames = 0;
    } else if (p < 0.35) {
      this.silentFrames++;
    }
    const tooLong = this.buf.length >= this.opts.maxFrames;
    if (this.silentFrames >= this.opts.redemptionFrames || tooLong) {
      this.speaking = false;
      const enough = this.speechFrames >= this.opts.minSpeechFrames;
      const audio = concat(this.buf);
      this.buf = [];
      event = enough ? { kind: "end", audio } : { kind: "misfire" };
    }
    return { p, event };
  }
}

export function concat(parts: Float32Array[]): Float32Array {
  const n = parts.reduce((a, b) => a + b.length, 0);
  const out = new Float32Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Down-samples 48/44.1 kHz audio to 16 kHz by averaging (enough for speech detection and transcription). */
export function toSixteenK(input: Float32Array, rate: number): Float32Array {
  if (rate === 16000) return input;
  const ratio = rate / 16000;
  const n = Math.floor(input.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += input[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}
