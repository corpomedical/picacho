// A leading timing cue on a dialogue line: "(11s) still me." means the line
// starts at second 11 of the clip.
//
// Built 2026-09-05 after the operator wrote exactly that — "(11-13s) \"still
// me.\"" — and the pipeline read it as WORDS: TTS receives the dialogue text
// verbatim, and the lipsync endpoint takes no timing field at all (checked
// against its schema: video_url, audio_url, sync_mode — nothing else). So the
// cue was going to be spoken aloud and the line was landing at second 0.
//
// The cue is honoured by PREPENDING SILENCE to the generated audio before
// lipsync (see padMp3WithSilence) — the audio still starts at t=0 as far as
// the endpoint knows, but t=0 is now quiet until the cue.
//
// SYNTAX, deliberately narrow. A cue is a parenthetical at the VERY START of
// the line whose entire content is a time spec: "(11s)", "(11)", "(11-13s)",
// "(2.5s)". An end time is accepted and IGNORED — the line ends when it ends;
// cutting speech mid-word to honour a closing timestamp is the length bug in
// miniature. Anything else in the parentheses — "(laughs)", "(2 dogs
// barking)" — is not a cue and is left exactly where it was, because stage
// directions are ElevenLabs v3's own vocabulary and not ours to eat.
const CUE = /^\s*\(\s*(\d{1,3}(?:\.\d+)?)\s*(?:[-–—]\s*\d{1,3}(?:\.\d+)?)?\s*s?\s*\)\s*/;

/** Longer than any clip the catalogue sells; a cue past this is a typo. */
export const MAX_CUE_SECONDS = 120;

export function parseDialogueCue(text: string): { startSeconds: number | null; spokenText: string } {
  const m = text.match(CUE);
  if (!m) return { startSeconds: null, spokenText: text };
  const start = Number(m[1]);
  if (!Number.isFinite(start) || start <= 0 || start > MAX_CUE_SECONDS) {
    return { startSeconds: null, spokenText: text };
  }
  return { startSeconds: start, spokenText: text.slice(m[0].length) };
}
