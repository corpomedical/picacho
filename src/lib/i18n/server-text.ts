// Relative imports on purpose: the truth-contract test loads this module,
// and vitest has no "@/" alias configured (the repo's standing gotcha).
import type { Messages } from "./messages";
import { formatMsg } from "./format";

// Localizes server-produced strings at DISPLAY time (2026-09-05 audit:
// every generation-action error and stage label reached the localized app
// in English — the one voice in the product that never switched language).
//
// THE DESIGN: the server keeps returning its English strings. They are the
// wire format, the pipeline-log evidence, and what four other consumers
// (logs, admin, tests, the settings KNOWN_ERRORS map) already key on — a
// code migration would touch every return and every consumer at once. The
// client instead maps the known strings to catalog entries at the few
// places they render; anything unmapped passes through unchanged, so
// coverage grows string by string and nothing can break. The truth-contract
// test (truth-contracts.test.ts) pins every mapped English string against
// the server source, so editing either side alone fails the suite.

const EXACT: Record<string, keyof Messages["serverText"]> = {
  // Stage labels (job-runner STAGE_PROGRESS) — shown for the whole render.
  "Rendering your video": "stageVideo",
  "Generating the voice": "stageVoice",
  "Syncing the lips to the dialogue": "stageLipsync",
  "Upscaling the video": "stageUpscale",
  "Splitting into layers": "stageLayers",
  // Action errors, most-seen first.
  "Your session expired — please log in again.": "sessionExpired",
  "Your account is suspended. Contact support if you think this is a mistake.": "suspended",
  "This account is suspended.": "suspendedShort",
  "You're generating a bit fast — wait a few seconds and try again.": "tooFast",
  "You've used all the credits included in your plan this month.": "planCreditsUsedUp",
  "Describe what you want first.": "describeFirst",
  'That didn\'t include anything to generate — describe what you want to see, like "a woman walking through a neon-lit street at night".':
    "nothingToGenerate",
  "Couldn't find that character.": "characterNotFound",
  "Pick a character with a voice assigned to add dialogue, or clear the dialogue field.":
    "needsVoiceForDialogue",
  "This character doesn't have a voice assigned yet — add one in Character settings, or clear the dialogue field.":
    "characterNoVoice",
  "This character's voice couldn't be found — try picking a different one.": "voiceNotFound",
  "Dialogue and longer videos are part of a paid plan — the free trial makes short, silent clips. Pick a plan to unlock them.":
    "trialSilentClips",
  "Multi-image reference and storyboard are available on the Studio and Elite plans. Upgrade to use them, or turn these options off.":
    "advancedNeedsPlan",
  "Multi-image reference and start & end frames need Kling 1.6 as the selected video model — switch models, or turn these options off.":
    "advancedNeedsKling",
  "Using multiple characters together needs Kling 1.6 as the selected video model — switch models, or remove the extra characters.":
    "multiNeedsKling",
  "Storyboards run on Kling O3 Pro — switch the model, or clear the storyboard.": "storyboardNeedsO3",
  "Storyboards and spoken dialogue can't combine yet — remove one.": "storyboardNoDialogue",
  "Storyboards and start/end frames can't combine — remove one.": "storyboardVsFrames",
  "Continuing a clip works with the Seedance models — pick Seedance 2.0 (or 2.5 for illustrated characters), or clear the continuation.":
    "continueNeedsSeedance",
  "Couldn't start this generation — try again.": "couldntStart",
  "Couldn't start these generations — try again.": "couldntStartMulti",
  "Your last multi-shot render is still running — stop it or let it finish before starting another.":
    "fanoutInFlight",
  "That request was already started — try again.": "alreadyStarted",
  "You've used today's free generation — it comes back tomorrow. Pick a plan or top up credits to keep going — your characters and history stay exactly as they are.":
    "freeUsedToday",
  // Angle Stage (lib/generations/angle-stage.ts).
  "That take can't be staged — it must be one of your own finished takes.": "stageNotYours",
  "This video doesn't have its still frame saved yet — it arrives within a day of rendering.":
    "stageNoPoster",
  "The Angle Stage is part of the Studio and Elite plans — upgrade to stage your takes.":
    "stageNeedsPlan",
  "This take already has its stage — reload the page.": "stageAlreadyBuilt",
  "You're staging quickly — give it a minute and try again.": "stageTooFast",
  "The studio couldn't start that — try again in a moment.": "stageCouldntStart",
  "The 3D proxy couldn't be built from this take — try a different one.": "stageProxyFailed",
  "That proxy came out too large to store — try a simpler take.": "stageProxyTooLarge",
  "The 3D proxy couldn't be fetched — try again.": "stageProxyFetchFailed",
  "Couldn't save the proxy — try again.": "stageProxySaveFailed",
  "That angle couldn't be read — try saving it again.": "stageSnapshotUnreadable",
  "That snapshot is too large — try again.": "stageSnapshotTooLarge",
  "That angle couldn't be re-rendered — try a slightly different one.": "stageFrameFailed",
  "That angle couldn't be fetched — try again.": "stageFrameFetchFailed",
  "You're rendering angles quickly — give it a moment.": "stageFramesTooFast",
};

// Parameterized server strings — the numbers ride into the localized copy.
const PATTERNS: {
  re: RegExp;
  key: keyof Messages["serverText"];
  params: (m: RegExpMatchArray) => Record<string, string>;
}[] = [
  {
    re: /^That would use (\d+) credits \(some models cost more than 1 per video\), but you only have (\d+) left\./,
    key: "insufficientDetail",
    params: (m) => ({ need: m[1], have: m[2] }),
  },
  {
    re: /^That would use (\d+) credits \(some models cost more than 1 per video\) — the free trial only covers generations of up to (\d+) credits?\./,
    key: "trialCeiling",
    params: (m) => ({ need: m[1], cap: m[2] }),
  },
  {
    re: /^You've staged (\d+) takes this billing month — the limit on your plan\./,
    key: "stageMonthlyCap",
    params: (m) => ({ used: m[1] }),
  },
  {
    re: /^This take already has its (\d+) full-quality angles — pick your start and end from those\./,
    key: "stageFramesCap",
    params: (m) => ({ limit: m[1] }),
  },
];

export function localizeServerText(text: string, t: Messages): string {
  const exactKey = EXACT[text];
  if (exactKey) return t.serverText[exactKey];
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) return formatMsg(t.serverText[p.key], p.params(m));
  }
  return text;
}

// For the contract test: the English wire strings this module claims the
// server produces, so drift on either side is caught mechanically.
export const MAPPED_SERVER_STRINGS = Object.keys(EXACT);
