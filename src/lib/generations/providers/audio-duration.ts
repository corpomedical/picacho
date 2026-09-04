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
