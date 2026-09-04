// How long an MP3 will play, from its bytes — no decoder, no dependency.
//
// Exists for exactly one decision (2026-09-05): the dialogue audio must never
// change the length of the video it is synced onto. The lipsync endpoint's
// two useful modes are cut_off (output = the SHORTER input) and silence
// (output = the LONGER input) — both measured against the real endpoint, a
// 5.04s clip with 11.55s of speech coming back 5.04s under cut_off and 11.58s
// under silence. So the caller picks the mode by comparing durations, and
// this is the audio half of that comparison.
//
// CBR only, deliberately. ElevenLabs TTS returns constant-bitrate MP3 (both
// probes measured 128kbps/44.1kHz), where duration is just payload bytes × 8
// / bitrate. If the first two frames disagree on bitrate — a VBR stream —
// this returns null rather than a guess, and the caller falls back to
// "silence", which is yesterday's behaviour: worst case a longer video, never
// a truncated one by mistake.
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const SAMPLE_RATES_V1 = [44100, 48000, 32000, 0];

function frameHeaderAt(b: Uint8Array, i: number): { bitrateKbps: number; frameBytes: number } | null {
  if (i + 4 > b.length) return null;
  // MPEG1 Layer III sync: 11 set bits, version 11, layer 01.
  if (b[i] !== 0xff || (b[i + 1] & 0xfe) !== 0xfa) return null;
  const bitrateKbps = BITRATES_V1_L3[(b[i + 2] >> 4) & 0xf];
  const sampleRate = SAMPLE_RATES_V1[(b[i + 2] >> 2) & 0x3];
  if (!bitrateKbps || !sampleRate) return null;
  const padding = (b[i + 2] >> 1) & 0x1;
  const frameBytes = Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding;
  return { bitrateKbps, frameBytes };
}

export function mp3DurationSeconds(bytes: Uint8Array): number | null {
  let start = 0;
  // Skip an ID3v2 container if present: 10-byte header, syncsafe size.
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    start =
      10 +
      (((bytes[6] & 0x7f) << 21) |
        ((bytes[7] & 0x7f) << 14) |
        ((bytes[8] & 0x7f) << 7) |
        (bytes[9] & 0x7f));
  }
  // Find the first frame within a bounded window — garbage in, null out.
  let first: ReturnType<typeof frameHeaderAt> = null;
  let at = start;
  for (; at < Math.min(bytes.length, start + 4096); at++) {
    first = frameHeaderAt(bytes, at);
    if (first) break;
  }
  if (!first) return null;
  // CBR check: the next frame must exist and agree on bitrate.
  const second = frameHeaderAt(bytes, at + first.frameBytes);
  if (!second || second.bitrateKbps !== first.bitrateKbps) return null;
  return ((bytes.length - at) * 8) / (first.bitrateKbps * 1000);
}

// One genuinely encoded SILENT frame — mono, 128kbps, 44.1kHz, 417 bytes,
// main_data_begin = 0 — lifted from the lead-in of a real ElevenLabs clip on
// 2026-09-05, i.e. produced by the exact encoder whose output it will be
// spliced onto. Self-contained (it references no bit-reservoir data), so any
// number of copies in a row decode as silence, and the original stream's own
// first frame (always main_data_begin 0) decodes unchanged after them.
const SILENT_FRAME_MONO_128_44100 = Uint8Array.from(atob("//uQxAACECj/Ike8wYqysqIRp425AidgFsG+S801EEMAgBgEsLmaZpmmaaHoeh6vAAACCBAgQIECZMmTJ20RfaCEREXd3d3dwQIECBAgQQJk07u7u4iIiIiLu7uyd2hEREREXd3d3dxEREREXd3d3doAAAAAAeHh4eGAAAAAAeHh4eGAAAACA8PDw8MAAAAAA8PDw8MAASAVRhp4Bw3Bq1Bx/h+1xiThILEIBc6mpbVYrXX9VLpiZYzEplUfzNvDE4tS2QAMInV20nRChvDqQpXMzExVevVKjZ6KFkpGhRnJmxaetdRVAQFUY4xnIYVVUKAq+rRpvD6dKFWy29jb+9v7/mZFDnNmYraXe7Mx84qrVUqpxjhyNVVVqqrMzBmZgIKAiQoKCgwUFBQUCgoKCgwUFBQUCgoKCgwUFBQUCgoKCgwAQBhaUYJqAJgK2TAMc4dTByKHYcPDh16LqkcPe6nns/YXkFWvFEpWE7k4QWpomsk2tPHiDZYlSr1yxxYVGRJtZ8rg5ltAsaEpxTHWXlpOrKJVDWA00IZQGyMRLSFx"), (c) => c.charCodeAt(0));
const SILENT_FRAME_SECONDS = 1152 / 44100; // samples per MPEG1 Layer III frame

/**
 * Prepend `seconds` of silence to a CBR MP3, for the dialogue timing cue.
 *
 * Returns null rather than guessing whenever the stream is not the one shape
 * the embedded frame matches — mono 128kbps/44.1kHz, which is what ElevenLabs
 * returns (both probes measured it) — or is not parseable at all. The caller
 * treats null as "no cue": the line plays from the start, and a log step says
 * so. A wrongly spliced file handed to the lipsync provider would fail a paid
 * job; a cue quietly not applied costs a re-render at worst.
 */
export function padMp3WithSilence(bytes: Uint8Array, seconds: number): Uint8Array | null {
  if (!(seconds > 0)) return null;
  let start = 0;
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    start =
      10 +
      (((bytes[6] & 0x7f) << 21) |
        ((bytes[7] & 0x7f) << 14) |
        ((bytes[8] & 0x7f) << 7) |
        (bytes[9] & 0x7f));
  }
  // The stream must match the silent frame exactly: same sync, bitrate index
  // (128k), sample rate index (44.1k) and channel mode nibble.
  if (start + 4 > bytes.length) return null;
  if (
    bytes[start] !== 0xff ||
    (bytes[start + 1] & 0xfe) !== 0xfa ||
    (bytes[start + 2] & 0xfc) !== (SILENT_FRAME_MONO_128_44100[2] & 0xfc) ||
    (bytes[start + 3] & 0xc0) !== (SILENT_FRAME_MONO_128_44100[3] & 0xc0)
  ) {
    return null;
  }
  const frames = Math.round(seconds / SILENT_FRAME_SECONDS);
  const audio = bytes.subarray(start); // drop the ID3 tag; pure frames splice cleanly
  const out = new Uint8Array(frames * SILENT_FRAME_MONO_128_44100.length + audio.length);
  for (let i = 0; i < frames; i++) out.set(SILENT_FRAME_MONO_128_44100, i * SILENT_FRAME_MONO_128_44100.length);
  out.set(audio, frames * SILENT_FRAME_MONO_128_44100.length);
  return out;
}
