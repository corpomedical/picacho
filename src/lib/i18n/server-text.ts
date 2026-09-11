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
  // An image model's own safety refusal
  // (lib/generations/providers/refusal-messages.ts) — a render's failure
  // reason in the composer and History, and the character-photo and
  // layer-edit errors. Translated here, at display, and nowhere earlier:
  // pipeline.ts's SAFETY_REJECTION and provider-fault.ts read the English
  // "safety" on the wire to stop the retry and spare the model breaker.
  "This request was refused by the image model's safety system, so nothing was generated and nothing was charged.":
    "imageRequestRefused",
  "This image was refused by the image model's safety system, so it can't be shown.": "imageResultRefused",
  // Our own content gates' refusals — the prompt gate's
  // (lib/generations/content-policy.ts refusalMessages) and the picture
  // gate's (output-policy.ts). An action's error in the composer, Prompt
  // Studio, the character-photo generator, the Angle Stage and the layer
  // editor; a render's validate step in the composer and History. Every one
  // is a constant, so they are EXACT: none carries a value to pattern-match.
  "This request asks for sexual or nude content, which Picacho does not generate. Describe a scene instead — what your character is doing, where they are, and the light.":
    "policySexual",
  "Picacho does not generate sexual or suggestive content involving anyone who could be a minor. If that is not what you meant, rewrite the scene without the suggestive element.":
    "policyMinors",
  "This request asks to undress or sexualize a photograph of a real person. Picacho does not do this, whoever is in the photo and whoever is asking.":
    "policyRealPerson",
  "This request asks for content that advertises or solicits sexual services, which Picacho does not generate. Describe a scene instead — what your character is doing, where they are, and the light.":
    "policyServices",
  "Picacho does not generate pictures that present self-harm or suicide as desirable. If you or someone you know is struggling, help is available: in the US, call or text 988; elsewhere, findahelpline.com lists free, confidential lines.":
    "policySelfHarm",
  "This request would place a real, identifiable person in an event that did not happen, presented as real. Picacho does not generate that.":
    "policyDeception",
  "The safety check could not run just now, so nothing was generated and nothing was spent. Please try again in a moment.":
    "policyUnavailable",
  "The picture that came back didn't pass our check, so it wasn't shown. Your request was fine — the credit is back.":
    "outputSexual",
  "The picture that came back didn't pass our check and wasn't shown. The credit is back.": "outputMinors",
  "We couldn't check the picture that came back, so it wasn't shown. The credit is back — please try again in a moment.":
    "outputUnavailable",
  // Sharing to the community feed (lib/community/actions.ts
  // shareToCommunity, unshareFromCommunity) — the share button's error line,
  // and Settings → Privacy's for a removal. The feed gate's two sentences are
  // among them: this post can't go on the feed, and the picture couldn't be
  // checked.
  "That's a lot of sharing at once — give it a minute.": "shareTooFast",
  "This video's preview isn't ready yet — try sharing it again in a few minutes.": "sharePreviewNotReady",
  "We couldn't check this picture, so it wasn't shared. Try again in a moment; if it keeps happening, the file may be missing.":
    "feedUnchecked",
  "This one can't go on the community feed. It stays in your History.": "feedRefused",
  "Couldn't remove this from the community — try again.": "unshareFailed",
  // Sets (lib/sets/messages.ts) — the Sets pages' error lines, and a failed
  // build's card.
  "Sets aren't available right now.": "setsUnavailable",
  "Sets are in private testing and aren't part of any plan yet.": "setsNotOpen",
  "That set isn't available.": "setNotFound",
  "This set is still being built.": "setNotReady",
  "Describe the place in a few more words.": "setBriefTooShort",
  "Keep the description under 500 characters.": "setBriefTooLong",
  "You're building sets quickly — give it a minute and try again.": "setBuildTooFast",
  "The set couldn't be started — try again in a moment.": "setBuildCouldntStart",
  "You've built 1 set this billing month — the limit on your plan. It resets with your billing period.":
    "setMonthlyCapOne",
  "This set couldn't be built, and the build is back in your allowance. Try describing the place differently.":
    "setBuildFailed",
  "This set couldn't be built from that description. The build is back in your allowance.": "setBuildRefused",
  "This build took too long and was lost. The build is back in your allowance — try again.": "setBuildLost",
  "This set couldn't be built this time, and the build is back in your allowance. Try again in a moment.":
    "setBuildFailedRetry",
  "That frame couldn't be read — try again.": "setFrameUnreadable",
  "That frame is too large — try again.": "setFrameTooLarge",
  "Couldn't save the frame — try again.": "setFrameSaveFailed",
  "Pick one of your characters to shoot in this set.": "setPickCharacter",
  "You're shooting quickly — give it a moment.": "setShootTooFast",
  "Couldn't delete this set — try again.": "setDeleteFailed",
  "Couldn't save that — try again.": "setSaveFailed",
  // Sets from a photo (lib/sets/messages.ts, 2026-09-11). The first four are
  // also said by the browser, which reads the photo before it is sent.
  "That photo couldn't be read — try a JPEG, PNG or WebP.": "setPhotoUnreadable",
  "That photo is too large — try a smaller one.": "setPhotoTooLarge",
  "That photo is too small — use one at least 640 pixels on its shorter side.": "setPhotoTooSmall",
  "That photo is too wide or too tall — use an ordinary photo, not a panorama.": "setPhotoBadShape",
  "This photo can't be used to build a set. Nothing came off your allowance.": "setPhotoRefused",
  "We couldn't check this photo, so no set was started. Try again in a moment.": "setPhotoUnchecked",
  "Photo sets need a database update first (astra-photo-sets.sql).": "setPhotoNeedsDatabase",
  "Couldn't save the photo — try again.": "setPhotoSaveFailed",
  "This set couldn't be built from that photo, and the build is back in your allowance. A photo that shows more of the place may work better.":
    "setPhotoBuildFailed",
};

// The prompt gate's answers (content-policy.ts refusalMessages). The composer
// holds these in a strip on its top edge until they are dismissed, instead of
// its timed toast (operator's pick, 2026-09-10): the toast left after 4.2 s
// whatever it said, and the self-harm refusal carries helplines. Keys rather
// than sentences, so this follows the EXACT map and the contract pinning it.
const PROMPT_GATE_KEYS: ReadonlySet<keyof Messages["serverText"]> = new Set([
  "policySexual",
  "policyMinors",
  "policyRealPerson",
  "policyServices",
  "policySelfHarm",
  "policyDeception",
  "policyUnavailable",
] as const);

/** Whether a server string (the English wire form) is a prompt-gate refusal. */
export function isPolicyRefusal(text: string): boolean {
  const key = EXACT[text];
  return key !== undefined && PROMPT_GATE_KEYS.has(key);
}

// The layer-edit lane force-refunds every failure and says so after the
// reason (actions.ts editLayer: `${message.slice(0, 160)} Nothing was
// charged.`), so a mapped reason reaches the screen with this on its tail.
// Translated whole only when the reason before it is mapped — anything else
// stays all English rather than half-translated.
export const NOTHING_CHARGED_TAIL = " Nothing was charged.";

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
  {
    re: /^You've built (\d+) sets this billing month — the limit on your plan\./,
    key: "setMonthlyCap",
    params: (m) => ({ used: m[1] }),
  },
];

export function localizeServerText(text: string, t: Messages): string {
  const exactKey = EXACT[text];
  if (exactKey) return t.serverText[exactKey];
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) return formatMsg(t.serverText[p.key], p.params(m));
  }
  if (text.endsWith(NOTHING_CHARGED_TAIL)) {
    const reasonKey = EXACT[text.slice(0, -NOTHING_CHARGED_TAIL.length)];
    if (reasonKey) return `${t.serverText[reasonKey]} ${t.serverText.nothingCharged}`;
  }
  return text;
}

// For the contract test: the English wire strings this module claims the
// server produces, so drift on either side is caught mechanically.
export const MAPPED_SERVER_STRINGS = Object.keys(EXACT);
