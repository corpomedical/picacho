import { describe, expect, it } from "vitest";
import { MAX_CLIPS, MAX_SONG_BYTES, footageProblem, nextStep, phaseOf, planSong, planUploads, songProblem, type ClipRecord, type SessionRecord } from "./job";
import { parseProbe, probeArgs, speechArgs } from "./analyze";
import { agreeingWords, parseTranscript } from "./transcribe";
import { whisperCostUsd } from "./prices";

const rec = (probe: ClipRecord["probe"], analyzed = false): ClipRecord => ({
  path: "p",
  name: "n",
  bytes: 1,
  contentType: "video/mp4",
  probe,
  speech: analyzed ? "speech" : null,
  words: [],
  analyzed,
});
const video = { duration: 600, hasVideo: true, hasAudio: true, width: 1920, height: 1080, fps: 30 };
const session: SessionRecord = { sessionId: "s", startedAt: 0, turn: 1, turnStartedAt: 0, preUsd: 0, lastResultId: null, latest: null };

describe("job rules", () => {
  it("names upload paths the server chose, and refuses what it can't read", () => {
    const ok = planUploads("u1", "e1", [
      { name: "take 1.MOV", size: 1000, type: "video/quicktime" },
      { name: "song.mp3", size: 50, type: "audio/mpeg" },
    ]);
    expect(ok.error).toBeNull();
    if (ok.error === null) {
      expect(ok.clips.map((c) => c.path)).toEqual(["u1/e1/clip-0.mov", "u1/e1/clip-1.mp3"]);
      expect(ok.clips[0]).toMatchObject({ speech: null, analyzed: false });
    }
    expect(planUploads("u1", "e1", [{ name: "x.gif", size: 5, type: "image/gif" }]).error).toContain("isn't a video or audio file");
    expect(planUploads("u1", "e1", [{ name: "big.mp4", size: 2 * 1024 ** 3, type: "video/mp4" }]).error).toContain("over 1 GB");
    expect(planUploads("u1", "e1", []).error).toBe("Add at least one clip.");
  });

  it("needs picture, and no more than 20 minutes of it", () => {
    expect(footageProblem([rec(video)])).toBeNull();
    expect(footageProblem([rec({ ...video, hasVideo: false })])).toContain("at least one clip with picture");
    expect(footageProblem([rec(video), rec(video), rec({ ...video, duration: 30 })])).toContain("20 minutes");
    expect(footageProblem([rec(null)])).toContain("couldn't be read");
  });

  it("walks probe → listen each clip → start the session → watch it", () => {
    expect(nextStep({ stage: "analyzing", clips: [rec(null)], render: null })).toEqual({ kind: "probe" });
    expect(nextStep({ stage: "analyzing", clips: [rec(video, true), rec(video)], render: null })).toEqual({ kind: "listen", clip: 1 });
    expect(nextStep({ stage: "analyzing", clips: [rec(video, true)], render: null })).toEqual({ kind: "start" });
    expect(nextStep({ stage: "directing", clips: [], render: session })).toEqual({ kind: "watch" });
    expect(nextStep({ stage: "done", clips: [], render: session })).toEqual({ kind: "none" });
  });

  it("takes a song sent with a change into the next clip slot (the first live edit asked for music it wasn't given)", () => {
    const five = [rec(video, true), rec(video, true), rec(video, true), rec(video, true), rec(video, true)];
    const ok = planSong("u1", "e1", five, { name: "Epic Score.mp3", size: 4_000_000, type: "audio/mpeg" });
    expect(ok.error).toBeNull();
    if (ok.error === null) {
      expect(ok.clip).toMatchObject({ path: "u1/e1/clip-5.mp3", name: "Epic Score.mp3", speech: "no-speech", analyzed: true, probe: null });
    }
    expect(planSong("u1", "e1", five, { name: "take.mp4", size: 5, type: "video/mp4" }).error).toContain("isn't a song");
    expect(planSong("u1", "e1", five, { name: "huge.wav", size: MAX_SONG_BYTES + 1, type: "audio/wav" }).error).toContain("over 200 MB");
    expect(planSong("u1", "e1", Array.from({ length: MAX_CLIPS }, () => rec(video, true)), { name: "s.mp3", size: 5, type: "audio/mpeg" }).error).toContain(
      "already has",
    );
    const song = { duration: 185, hasVideo: false, hasAudio: true, width: null, height: null, fps: null } as unknown as ClipRecord["probe"];
    expect(songProblem("s.mp3", song)).toBeNull();
    expect(songProblem("s.mp3", null)).toContain("couldn't be read");
    expect(songProblem("s.mp3", { ...song!, hasAudio: false })).toContain("no sound");
    expect(songProblem("s.mp3", { ...song!, duration: 11 * 60 })).toContain("over 10 minutes");
  });

  it("names the step the page shows", () => {
    expect(phaseOf({ stage: "analyzing", clips: [rec(null)] })).toBe("reading");
    expect(phaseOf({ stage: "analyzing", clips: [rec(video)] })).toBe("watching");
    expect(phaseOf({ stage: "directing", clips: [] })).toBe("cutting");
    expect(phaseOf({ stage: "done", clips: [] })).toBe("done");
  });
});

describe("reading footage", () => {
  it("reads ffmpeg's banner, including a rotated phone clip", () => {
    const banner = `  Duration: 00:01:02.50, start: 0.000000, bitrate: 5814 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080, 9000 kb/s, 29.97 fps, 30 tbr (default)
    Side data:
      displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s (default)`;
    expect(parseProbe(banner)).toEqual({ duration: 62.5, hasVideo: true, hasAudio: true, width: 1080, height: 1920, fps: 29.97 });
    expect(probeArgs("u")).toEqual(["-hide_banner", "-i", "u"]);
    expect(speechArgs("in", "out.mp3")).toEqual(expect.arrayContaining(["-ac", "1", "-ar", "16000", "-b:a", "32k", "out.mp3"]));
  });

  it("prices transcription from the dated unit", () => {
    expect(whisperCostUsd(300)).toBeCloseTo(0.03, 6);
  });
});

describe("the no-speech guard (the operator's first edit: music heard as 'Thanks for watching')", () => {
  const seg = (start: number, end: number, noSpeech: number, logprob = -0.3, compression = 1.2) => ({
    start,
    end,
    no_speech_prob: noSpeech,
    avg_logprob: logprob,
    compression_ratio: compression,
  });

  it("drops words Whisper itself scores as not speech, and calls the clip no-speech", () => {
    const t = parseTranscript({
      language: "english",
      segments: [seg(12.1, 14.9, 0.86)],
      words: [
        { word: "Thanks", start: 12.2, end: 12.6 },
        { word: "for", start: 12.6, end: 12.8 },
        { word: "watching", start: 12.8, end: 13.4 },
      ],
    });
    expect(t).toMatchObject({ speech: false, words: [], droppedSegments: 1 });
  });

  it("keeps real speech, and drops guessed or looping stretches beside it", () => {
    const t = parseTranscript({
      segments: [seg(0, 3, 0.02), seg(3, 5, 0.1, -1.4), seg(5, 7, 0.05, -0.2, 3.1)],
      words: [
        { word: "Welcome", start: 0.2, end: 0.7 },
        { word: "to", start: 0.7, end: 0.8 },
        { word: "the", start: 0.8, end: 0.9 },
        { word: "show", start: 0.9, end: 1.6 },
        { word: "mumble", start: 3.2, end: 3.8 },
        { word: "la", start: 5.1, end: 5.3 },
      ],
    });
    expect(t.speech).toBe(true);
    expect(t.words.map((w) => w.text)).toEqual(["Welcome", "to", "the", "show"]);
    expect(t.droppedSegments).toBe(2);
  });

  it("keeps only what two hearings agree on (the test clip: nine words once, nothing the next time)", () => {
    const w = (text: string, start: number) => ({ text, start, end: start + 0.3 });
    const real = [w("She", 1), w("came", 1.3), w("for", 1.6), w("the", 1.8), w("ball.", 2.0)];
    // Real speech: the same words, times a hair apart, punctuation different.
    expect(agreeingWords(real, real.map((x) => ({ ...x, text: x.text.replace(".", ""), start: x.start + 0.05 }))).map((x) => x.text)).toEqual([
      "She",
      "came",
      "for",
      "the",
      "ball.",
    ]);
    // A phantom: confident words the first time, different or none the second.
    expect(agreeingWords([w("Bye", 8), w("bye", 8.4)], [])).toEqual([]);
    expect(agreeingWords([w("Thanks", 8), w("for", 8.3), w("watching", 8.6)], [w("Subscribe", 8.1)])).toEqual([]);
    // Same word at a different moment is not agreement.
    expect(agreeingWords([w("go", 1)], [w("go", 5)])).toEqual([]);
  });

  it("vouches for nothing without segment scores, and survives nonsense", () => {
    expect(parseTranscript({ words: [{ word: "Hi", start: 0, end: 1 }] }).speech).toBe(false);
    expect(parseTranscript("nope")).toEqual({ language: null, words: [], speech: false, droppedSegments: 0 });
  });
});
