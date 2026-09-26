import { describe, expect, it } from "vitest";
import trace from "./__fixtures__/barge-trace.json";
import trace2 from "./__fixtures__/barge-trace-2.json";
import {
  BargeIn,
  EnergySegmenter,
  VoiceLevel,
  encodeWav,
  speechLevel,
  toBase64,
  toSixteenK,
  type BargeAction,
  type VoiceFrame,
} from "./voice-engine";

// A reply is simulated frame by frame (32 ms): what she plays (out), what the
// mic hears (mic) and how speech-like it is (p).
function run(barge: BargeIn, frames: Omit<VoiceFrame, "now">[], from = 0, replying = true) {
  const actions: { at: number; action: BargeAction }[] = [];
  frames.forEach((f, i) => {
    const now = from + i * 32;
    const action = barge.step({ ...f, now }, replying);
    if (action) actions.push({ at: now, action });
  });
  return actions;
}
const repeat = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
// Live: her level follows the actions (silent while ducked); stops at the first confirm.
function runLive(barge: BargeIn, mic: (i: number) => { p: number; mic: number }, from: number, n: number) {
  const actions: { at: number; action: BargeAction }[] = [];
  let ducked = false;
  for (let i = 0; i < n; i++) {
    const now = from + i * 32;
    const out = herVoice(i) * (ducked ? 0 : 1);
    const a = barge.step({ ...mic(i), out, now }, true);
    if (a) actions.push({ at: now, action: a });
    if (a === "duck") ducked = true;
    if (a === "unduck") ducked = false;
    if (a === "confirm") break;
  }
  return actions;
}
// Her voice as the speaker plays it: syllables with small gaps.
function herVoice(i: number) {
  return i % 8 === 7 ? 0.01 : 0.15;
}

describe("talking over her", () => {
  it("stops her when the person talks over her on a device that cancels her echo", () => {
    const b = new BargeIn();
    // 4 s of her talking; the mic hears almost nothing of her (echo cancelled).
    const reply = repeat(125, (i) => ({ p: 0.1, mic: 0.006, out: herVoice(i) }));
    expect(run(b, reply)).toEqual([]);
    expect(b.leak).toBeLessThan(0.1);
    // Then the person talks, at an ordinary level, while she keeps going
    // (silent once she ducks, as the browser plays it).
    const acts = runLive(b, () => ({ p: 0.95, mic: 0.12 }), 125 * 32, 40);
    expect(acts.map((a) => a.action)).toEqual(["duck", "confirm"]);
    // She goes quiet within ~100 ms and stays stopped within ~450 ms.
    expect(acts[0].at - 125 * 32).toBeLessThanOrEqual(96);
    expect(acts[1].at - 125 * 32).toBeLessThanOrEqual(450);
  });

  it("never stops for her own voice coming back on a device that doesn't cancel it, and turns strict", () => {
    const b = new BargeIn();
    // No echo cancelling: the mic hears her at her own level, speech-like;
    // silenced, her echo is gone with her.
    let ducked = false;
    const actions: BargeAction[] = [];
    for (let i = 0; i < 250; i++) {
      const out = herVoice(i) * (ducked ? 0 : 1);
      const p = out > 0.02 ? 0.9 : 0.1;
      const a = b.step({ p, mic: out, out, now: i * 32 }, true);
      if (a) actions.push(a);
      if (a === "duck") ducked = true;
      if (a === "unduck" || a === "confirm") ducked = false;
    }
    expect(actions).not.toContain("confirm");
    expect(b.strict).toBe(true);
  });

  it("dips for a cough or a word from the TV, then comes back without stopping", () => {
    const b = new BargeIn();
    run(b, repeat(125, (i) => ({ p: 0.1, mic: 0.006, out: herVoice(i) })));
    const cough = [
      ...repeat(4, (i) => ({ p: 0.85, mic: 0.1, out: herVoice(i) })),
      ...repeat(40, (i) => ({ p: 0.05, mic: 0.006, out: herVoice(i) })),
    ];
    const acts = run(b, cough, 125 * 32).map((a) => a.action);
    expect(acts).toEqual(["duck", "unduck"]);
    // One cough doesn't teach it that the room echoes.
    expect(b.strict).toBe(false);
    // Nor do three of different strengths in the same reply (a person, not her echo).
    let t = 125 * 32 + 44 * 32;
    for (const loud of [0.06, 0.3, 0.12]) {
      run(b, [...repeat(4, (i) => ({ p: 0.85, mic: loud, out: herVoice(i) })), ...repeat(40, (i) => ({ p: 0.05, mic: 0.006, out: herVoice(i) }))], t);
      t += 44 * 32;
    }
    expect(b.strict).toBe(false);
  });

  it("three \"mm-hm\"s at one level don't teach it to stop listening: the next real interruption still stops her", () => {
    const b = new BargeIn();
    run(b, repeat(125, (i) => ({ p: 0.1, mic: 0.006, out: herVoice(i) })));
    // Short sounds at the same level, a few seconds apart, in one reply.
    let t = 125 * 32;
    for (let k = 0; k < 3; k++) {
      const mm = [
        ...repeat(4, (i) => ({ p: 0.85, mic: 0.12, out: herVoice(i) })),
        ...repeat(90, (i) => ({ p: 0.05, mic: 0.006, out: herVoice(i) })),
      ];
      expect(run(b, mm, t).map((a) => a.action)).toEqual(["duck", "unduck"]);
      t += mm.length * 32;
    }
    expect(b.strict).toBe(false);
    const acts = runLive(b, () => ({ p: 0.95, mic: 0.12 }), t, 40);
    expect(acts.map((a) => a.action)).toEqual(["duck", "confirm"]);
    expect(acts[1].at - t).toBeLessThanOrEqual(450);
  });

  it("on a laptop that cancels her voice, stops her even though the canceller turns the person down while both talk", () => {
    // 2026-09-26, operator on a computer: "I still cant interrupt her". Chrome
    // cancels her (the mic hears ~3% of her), but while both talk it also turns
    // the person down: their voice reaches the page at 0.012, under any
    // loudness bar tied to her level. With her quiet, the canceller lets go.
    const b = new BargeIn();
    run(b, repeat(125, (i) => ({ p: 0.1, mic: herVoice(i) * 0.03, out: herVoice(i) })));
    expect(b.echoCancelled).toBe(true);
    let ducked = false;
    const acts: { at: number; action: BargeAction }[] = [];
    const t0 = 125 * 32;
    for (let i = 0; i < 40; i++) {
      const now = t0 + i * 32;
      const a = b.step({ p: 0.9, mic: ducked ? 0.09 : 0.012, out: ducked ? 0 : herVoice(i), now }, true);
      if (a) acts.push({ at: now - t0, action: a });
      if (a === "duck") ducked = true;
      if (a === "confirm") break;
    }
    expect(acts.map((a) => a.action)).toEqual(["duck", "confirm"]);
    // Quiet within ~a quarter second of them starting, held within ~0.6 s.
    expect(acts[0].at).toBeLessThanOrEqual(260);
    expect(acts[1].at).toBeLessThanOrEqual(640);
  });

  it("on that laptop, a flicker of 'speech' in what's left of her echo doesn't stop her", () => {
    const b = new BargeIn();
    run(b, repeat(125, (i) => ({ p: 0.1, mic: herVoice(i) * 0.03, out: herVoice(i) })));
    // Three frames in ten where the model half-hears a voice in the residue.
    const flicker = repeat(60, (i) => ({ p: i % 10 < 3 ? 0.8 : 0.1, mic: herVoice(i) * 0.03, out: herVoice(i) }));
    expect(run(b, flicker, 125 * 32)).toEqual([]);
  });

  it("where her voice isn't cancelled, speech alone never stops her (her own voice is speech)", () => {
    const b = new BargeIn();
    // The mic hears her at 60% of her level, and it sounds like speech; when
    // she dips, her echo goes with her.
    let ducked = false;
    const acts: BargeAction[] = [];
    for (let i = 0; i < 250; i++) {
      const out = herVoice(i) * (ducked ? 0 : 1);
      const a = b.step({ p: out > 0.02 ? 0.9 : 0.1, mic: out * 0.6, out, now: i * 32 }, true);
      if (a) acts.push(a);
      if (a === "duck") ducked = true;
      if (a === "unduck" || a === "confirm") ducked = false;
    }
    expect(b.echoCancelled).toBe(false);
    expect(acts).not.toContain("confirm");
  });

  it("stops her even before it has learned the room (the dip test needs no history)", () => {
    const b = new BargeIn();
    const acts = runLive(b, () => ({ p: 0.95, mic: 0.2 }), 0, 40);
    const confirm = acts.find((a) => a.action === "confirm");
    expect(confirm).toBeDefined();
    expect(confirm!.at).toBeLessThanOrEqual(480);
  });

  it("reads natural speech (loud and soft syllables) as a person, not as echo", () => {
    const b = new BargeIn();
    run(b, repeat(125, (i) => ({ p: 0.1, mic: 0.006, out: herVoice(i) })));
    const all = runLive(b, (i) => ({ p: 0.92, mic: [0.2, 0.07, 0.12, 0.05, 0.16][i % 5] }), 125 * 32, 40);
    expect(all.map((a) => a.action)).toEqual(["duck", "confirm"]);
    expect(all[1].at - 125 * 32).toBeLessThanOrEqual(480);
  });

  it("does nothing while she isn't replying, and lifts a dip when she stops", () => {
    const b = new BargeIn();
    expect(run(b, repeat(10, () => ({ p: 0.95, mic: 0.2, out: 0 })), 0, false)).toEqual([]);
    run(b, repeat(125, (i) => ({ p: 0.1, mic: 0.006, out: herVoice(i) })));
    const acts = run(b, repeat(3, () => ({ p: 0.95, mic: 0.12, out: 0.15 })), 125 * 32);
    expect(acts.map((a) => a.action)).toEqual(["duck"]);
    expect(b.step({ p: 0.95, mic: 0.12, out: 0, now: 130 * 32 }, false)).toBe("unduck");
  });
});

describe("a real recording (headless Chrome, Silero v5, 2026-09-25)", () => {
  it("dips her voice within ~200 ms of the person starting", () => {
    const b = new BargeIn();
    const acts: { t: number; action: BargeAction }[] = [];
    for (const f of trace.frames) {
      const a = b.step({ p: f.p, mic: f.mic, out: f.out, now: f.t }, f.r === 1);
      if (a) acts.push({ t: f.t, action: a });
    }
    // Nothing before they spoke: her own voice (and the room) never stopped her.
    expect(acts.filter((a) => a.t < trace.speechAt)).toEqual([]);
    // (Only the frames up to the dip are faithful: after it the recording
    // still has her undipped voice.)
    const duck = acts.find((a) => a.action === "duck");
    expect(duck!.t - trace.speechAt).toBeLessThanOrEqual(220);
  });

  it("goes quiet within ~100 ms even when the speech model is slow to notice (it read 0.00)", () => {
    const b = new BargeIn();
    const acts: { t: number; action: BargeAction }[] = [];
    for (const f of trace2.frames) {
      const a = b.step({ p: f.p, mic: f.mic, out: f.out, now: f.t }, f.r === 1);
      if (a) acts.push({ t: f.t, action: a });
    }
    expect(acts.filter((a) => a.t < trace2.speechAt)).toEqual([]);
    const duck = acts.find((a) => a.action === "duck");
    expect(duck!.t - trace2.speechAt).toBeLessThanOrEqual(100);
  });
});

describe("the person's own level", () => {
  it("is learned from accepted recordings and compared, never guessed", () => {
    const v = new VoiceLevel();
    expect(v.nearness(0.1)).toBeNull();
    expect(v.isFarAway(0.001)).toBe(false);
    v.accept(0.1);
    v.accept(0.12);
    v.accept(0.08);
    expect(v.usual).toBe(0.1);
    expect(v.nearness(0.05)).toBe(0.5);
    expect(v.isFarAway(0.02)).toBe(false);
    expect(v.isFarAway(0.01)).toBe(true);
  });

  it("reads a recording by its loudest half, so padding and pauses don't dilute it", () => {
    const quiet = new Float32Array(16000);
    const speech = new Float32Array(16000).map((_, i) => 0.2 * Math.sin(i / 5));
    const padded = new Float32Array(32000);
    padded.set(speech, 8000);
    expect(speechLevel(padded)).toBeCloseTo(speechLevel(speech), 2);
    expect(speechLevel(quiet)).toBe(0);
  });
});

describe("a recording as uploaded", () => {
  it("is 16 kHz mono 16-bit WAV", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -1, 1]));
    const text = (a: number, n: number) => String.fromCharCode(...wav.subarray(a, a + n));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(16383);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(Buffer.from(toBase64(wav), "base64").equals(Buffer.from(wav))).toBe(true);
  });

  it("down-samples to 16 kHz", () => {
    expect(toSixteenK(new Float32Array(48000), 48000).length).toBe(16000);
    expect(toSixteenK(new Float32Array(44100), 44100).length).toBe(16000);
  });
});

describe("the fallback ears", () => {
  const frame = new Float32Array(512);
  it("stays quiet in a quiet room and learns its floor", () => {
    const s = new EnergySegmenter();
    for (let i = 0; i < 60; i++) expect(s.push(frame, 0.006).event).toBeNull();
  });

  it("cuts out a spoken sentence with a little padding before it", () => {
    const s = new EnergySegmenter();
    for (let i = 0; i < 30; i++) s.push(frame, 0.006);
    const events: string[] = [];
    let audio: Float32Array | null = null;
    for (let i = 0; i < 40; i++) {
      const e = s.push(frame, 0.08).event;
      if (e) events.push(e.kind);
    }
    for (let i = 0; i < 30; i++) {
      const e = s.push(frame, 0.006).event;
      if (e) {
        events.push(e.kind);
        if (e.kind === "end") audio = e.audio;
      }
    }
    expect(events).toEqual(["start", "end"]);
    // 10 frames of padding + 40 of speech + 22 of trailing quiet.
    expect(audio!.length).toBe((10 + 40 + 22 - 1) * 512);
  });

  it("drops a knock as a misfire, and cuts endless noise at the cap", () => {
    const s = new EnergySegmenter();
    for (let i = 0; i < 30; i++) s.push(frame, 0.006);
    const kinds: string[] = [];
    for (let i = 0; i < 3; i++) s.push(frame, 0.08);
    for (let i = 0; i < 30; i++) {
      const e = s.push(frame, 0.006).event;
      if (e) kinds.push(e.kind);
    }
    expect(kinds).toEqual(["misfire"]);
    const t = new EnergySegmenter({ padFrames: 2, redemptionFrames: 22, minSpeechFrames: 8, maxFrames: 50 });
    for (let i = 0; i < 30; i++) t.push(frame, 0.006);
    const ends: number[] = [];
    for (let i = 0; i < 200; i++) {
      const e = t.push(frame, 0.08).event;
      if (e?.kind === "end") ends.push(i);
    }
    expect(ends.length).toBeGreaterThan(2);
  });
});
