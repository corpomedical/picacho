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
  "You're out of credits — that request couldn't be covered.": "outOfCredits",
  "You've used today's free generation — it comes back tomorrow. Top up credits or pick a plan to keep going.":
    "freeUsedTodayTopUp",
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
  "Multi-image reference needs Kling 1.6 as the selected video model — switch models, or turn it off.":
    "multiRefNeedsKling",
  "Start & end frames need Kling 1.6, Gemini Omni Flash, or Veo as the video model — switch models, or turn them off.":
    "framesNeedFrameModel",
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
  // A send delivered twice follows the first delivery's take
  // (generations/repeat-send.ts, 2026-09-22).
  "This take is still going — it'll appear in History when it lands.": "repeatStillGoing",
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
  "Helios 3D isn't available right now.": "setsUnavailable",
  "Helios 3D is part of the paid plans. Upgrade in Settings → Plan & billing.": "setsNotOpen",
  "That set isn't available.": "setNotFound",
  "This set is still being built.": "setNotReady",
  "Describe the place in a few more words.": "setBriefTooShort",
  "Keep the description under 500 characters.": "setBriefTooLong",
  "You're building sets quickly — give it a minute and try again.": "setBuildTooFast",
  "The set couldn't be started — try again in a moment.": "setBuildCouldntStart",
  "You've built 1 set this billing month — the limit on your plan. It resets with your billing period.":
    "setMonthlyCapOne",
  "You've asked Astra for 1 change this billing month — the limit on your plan. It resets with your billing period; the editor's own tools still work.":
    "setEditMonthlyCapOne",
  "This set has grown too big for Astra to rewrite in one answer — change it with the editor's own tools.": "setEditTooBig",
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
  // The Recce (board K cut 1, 2026-09-17).
  "That clip couldn't be read — try an MP4, MOV or WebM.": "setClipUnreadable",
  "The clip must be between 3 and 30 seconds.": "setClipLength",
  "That clip is too large — try a shorter or smaller one.": "setClipTooLarge",
  "The clip couldn't be read this time — try again in a moment.": "setRecceCouldntRead",
  "This clip can't be used to build a set. Nothing came off your allowance.": "setRecceRefused",
  "Clip sets need a database update first (astra-recce.sql).": "setRecceNeedsDatabase",
  // Recast — the Mystique door (lib/recast/messages.ts, 2026-09-17).
  "Recasting is in private testing.": "recastNotOpen",
  "Recasting isn't available right now.": "recastUnavailable",
  "Recasting needs a database update first (recast.sql).": "recastNeedsDatabase",
  // The expression set (lib/characters/expression-messages.ts, 2026-09-19).
  "That close-up can't be made — refresh and try again.": "expressionBadRequest",
  "Couldn't find that character — refresh and try again.": "expressionNoCharacter",
  "Add a photo of this character first — its close-ups are made from its photos.": "expressionNeedsPhoto",
  "The expression set needs a database update first (character-expression-set.sql).": "expressionNeedsDatabase",
  "Couldn't save that close-up — try again.": "expressionSaveFailed",
  "Couldn't use that photo — upload it again.": "expressionBadUpload",
  "Couldn't remove that close-up — try again.": "expressionRemoveFailed",
  "Confirm the clip is yours to use first.": "recastNeedsRights",
  "You're starting takes quickly — give it a minute and try again.": "recastTooFast",
  "Couldn't read that upload — try again.": "recastUploadUnreadable",
  "That file doesn't read as an MP4 or MOV video.": "recastNotAVideo",
  "That clip is under 3 seconds.": "recastClipTooShort",
  "That clip is over 30 seconds.": "recastClipTooLong",
  "That clip is over 50 MB.": "recastClipTooBig",
  "That clip is under 340 pixels on its short side.": "recastClipTooSmall",
  "That clip is past 3850 pixels on a side.": "recastClipTooLarge",
  "That clip is longer than this job takes — trim it, or choose another job.": "recastSceneTooLong",
  "This clip can't be recast. Nothing was charged.": "recastRefusedBrief",
  "That stretch of the clip can't be used — choose it again.": "recastWindowInvalid",
  "Couldn't cut that stretch of the clip — nothing was charged. Try again.": "recastTrimFailed",
  "That character has no photo yet — add one first.": "recastCharacterNeedsPhoto",
  "That clip couldn't be checked just now — nothing was charged. Try again.": "recastClipUnchecked",
  "Couldn't start this take — nothing was charged. Try again.": "recastCouldntStart",
  "That take was already started.": "recastAlreadyStarted",
  // The long take (lib/generations/chain.ts, 2026-09-19): Mystique's refusal
  // (recast/messages.ts), and the progress line while the parts are joined
  // (chain-run.ts).
  "This stretch can't be split into parts cleanly — choose 15 seconds of it. Nothing was charged.": "recastChainNoPlan",
  // Mystique past characters: words, your own images (2026-09-19).
  "Say what should change, or choose a character.": "recastNeedsWords",
  "Choose a character or add an image to bring to life.": "recastNeedsPicture",
  "That image can't be used — it needs to be at least 340 pixels on each side, and no more than 2.5 times as long one way as the other.": "recastImageUnusable",
  "That image couldn't be checked just now — nothing was charged. Try again.": "recastImageUnchecked",
  "Say in your words who each character plays.": "recastNeedsRoles",
  "A whole group can only be changed in one part — keep the take to 15 seconds, or cast someone in it instead of all of them.": "recastGroupOnePart",
  // A whole group AND somebody else in one take (recast/messages.ts, 2026-09-23).
  "A whole group can only be changed on a take of its own — cast the group by itself, or take it out of this one.": "recastCrowdOwnTake",
  // A long take's cast (recast/messages.ts, 2026-09-22).
  "Over 15 seconds a take carries up to three characters. Trim to 15 seconds for four.": "recastChainTooMany",
  // Face verification, "Verify it's you" (lib/faces/messages.ts, 2026-09-19).
  "Face verification is in private testing.": "faceNotOpen",
  "Face verification isn't available right now.": "faceUnavailable",
  "Face verification needs its BytePlus access keys first.": "faceNotConfigured",
  "Tick the box to agree before the face check.": "faceNeedsConsent",
  "Add a photo of yourself to this character first.": "faceNeedsPhoto",
  "Your face is already verified. Remove it first to verify again.": "faceAlreadyVerified",
  "Verify your face first.": "faceNotVerified",
  "You're starting face checks quickly — give it a minute.": "faceTooFast",
  "Couldn't start the face check — try again.": "faceCouldntStart",
  "Joining the parts": "stageRecastJoin",
  // A long take that gave up (lib/generations/chain-failure.ts CHAIN_GAVE_UP,
  // 2026-09-22): six tries or two hours of a step on our side failing, then
  // the take ends — the last step of its log, which the door and History show.
  "This take couldn't be finished: a step on our side kept failing, so we stopped trying.": "chainGaveUp",
  // The take report's step (lib/generations/face-lock.ts TAKE_REPORT_DETAIL,
  // 2026-09-22) — History lists every step of a take's log with its sentence.
  "Each face was checked at the start, the middle and the end of the take.": "takeReportChecked",
  "Not every face on this take could be checked.": "takeReportPartial",
  "The faces on this take couldn't be checked.": "takeReportUnread",
  "This set couldn't be built from that photo, and the build is back in your allowance. A photo that shows more of the place may work better.":
    "setPhotoBuildFailed",
  // Match this shot (lib/sets/messages.ts, 2026-09-11) — the set page's line
  // under the "Match a shot" chip.
  "This picture can't be used to match a shot.": "setMatchRefused",
  "We couldn't check this picture, so no shot was matched. Try again in a moment.": "setMatchUnchecked",
  "Astra couldn't read a camera from that picture — try another.": "setMatchFailed",
  "The shot's camera couldn't be read this time — try again in a moment.": "setMatchCouldntRead",
  "You're matching shots quickly — try again in a little while.": "setMatchTooFast",
  "Reading that shot's camera took too long — try again in a moment.": "setMatchTimedOut",
  // The Set Editor's Astra edits (lib/sets/messages.ts, 2026-09-14) — the
  // prompt bar's line when a change could not land.
  "Astra couldn't make that change — try saying it differently.": "setEditFailed",
  "That change can't be made here.": "setEditRefused",
  "You're changing the set quickly — give it a moment.": "setEditTooFast",
  "That change took too long — try again in a moment.": "setEditTimedOut",
  // Takes (lib/sets/messages.ts, 2026-09-15) — a clip from one still to a
  // newly shot end frame.
  "That still can't start a take — pick another.": "setTakeBadStart",
  "The end frame is in, but the take couldn't start — try the take again in a moment.": "setTakeFailed",
  "That beat's end frame is gone — render again to shoot a new one.": "setTakeBadEnd",
  "The end frame didn't pass, so the take didn't start.": "setTakeEndFailed",
  "This beat stopped before its end frame was shot: the film's look couldn't be made this time. Nothing was charged — press Render to try again.": "setTakeLookDropped",
  "This beat stopped before its end frame was shot: a photo on one of its things couldn't be drawn this time. Nothing was charged — press Render to try again.": "setTakeElementDropped",
  "Tell us who is in these photos before saving.": "likenessNeedsAnswer",
  "Couldn't record your answer — nothing was saved. Try again.": "likenessCouldntRecord",
  "Tell us who is in this character's photos before shooting: open the person's card on the stage.": "setLikenessNeeded",
  "This beat's end frame scored under your identity bar, so its clip wasn't made and only the frame was charged. Press Render to shoot it again.": "setTakeOffFace",
  "This film opens on a still of someone else, so this beat wasn't shot and nothing was charged. Reload the page: the film is shot with the person in its opening still.": "setTakeOtherPerson",
  "This photo can't be used as a reference.": "setRefRefused",
  "We couldn't check this photo — try again in a moment.": "setRefUnchecked",
  "That's a lot of photos at once — try again in a few minutes.": "setRefTooFast",
  "This thing has 4 photos — remove one to add another.": "setElementFull",
  "That file isn't a 3D model the stage can keep — pick a .glb file.": "thingModelNotAModel",
  "That model is over 40 MB — export it smaller and try again.": "thingModelTooBig",
  "Models on things are for admins while we prove them.": "thingModelAdminsOnly",
  "The model couldn't be kept with the set — it's only on this page for now.": "thingModelSaveFailed",
  "That's a lot of models at once — try again in a few minutes.": "thingModelTooFast",
  "That thing changed on the set — tap it again.": "setElementGone",
  "Photos go on cars and objects — a person comes from their character.": "setElementNotAThing",
  "A set holds 24 photos on its things — remove one to add another.": "setElementsTooMany",
  "Takes and films are part of the paid plans. Upgrade in Settings → Plan & billing.": "setTakeNeedsPlan",
  // The rig check (lib/sets/messages.ts, 2026-09-15, Helios Cinema).
  "The rig check couldn't read this still — the still is kept as it is.": "setRigCheckFailed",
  "You're checking stills quickly — give it a moment.": "setRigCheckTooFast",
  // Settings (lib/profile/actions.ts) — the inline line under a settings
  // form. English on the wire like every other server string; mapped here so
  // the localized app stops answering in English (found 2026-09-18).
  "Usernames are 3-24 characters — lowercase letters, numbers, and underscores only.": "usernameRules",
  "That username is taken.": "usernameTaken",
  "Invalid setting.": "settingInvalid",
  "Enter a valid email address.": "emailInvalid",
  "Password must be at least 8 characters.": "passwordTooShort",
  "Passwords don't match.": "passwordsDontMatch",
  "Enter your current password to confirm this change.": "currentPasswordNeeded",
  "Too many attempts — wait a minute and try again.": "tooManyAttempts",
  "That password isn't right — check it and try again.": "currentPasswordWrong",
  "This reset link session has expired — use the link from your reset email again, or change your password from Settings.": "resetLinkExpired",
  // The community feed's definer functions (supabase/applied/**/community*.sql
  // and the moderation migrations): Postgres raises these sentences, the
  // share and report actions strip the "Exception: " prefix and return them
  // as they are, and the buttons render them through this map.
  "Sign in required.": "shareSignInRequired",
  "Couldn't find that generation.": "shareGenerationMissing",
  "Only finished renders can be shared.": "shareOnlyFinished",
  "This render has no shareable media.": "shareNoMedia",
  "This post was removed by moderation and can't be shared again.": "shareRemovedByModeration",
  "Post not found.": "sharePostNotFound",
  "Pick a reason for the report.": "reportPickReason",
  "You're reporting quickly — give it a moment.": "reportTooFast",
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
  // The allowance check's refusals to a plan's subscriber (core.ts): the
  // plan's name rides as it is, as the catalogs write plan names.
  {
    re: /^That would use (\d+) credits \(some models cost more than 1 per video\), but you only have (\d+) left on your (.+) plan this month\.$/,
    key: "insufficientPlan",
    params: (m) => ({ need: m[1], have: m[2], plan: m[3] }),
  },
  {
    re: /^That would use (\d+) credits \(some models cost more than 1 per video\), but you only have (\d+) left this month\.$/,
    key: "insufficientMonth",
    params: (m) => ({ need: m[1], have: m[2] }),
  },
  {
    re: /^You've used all (\d+) credits included in your (.+) plan this month\.$/,
    key: "planCreditsUsedUpNamed",
    params: (m) => ({ limit: m[1], plan: m[2] }),
  },
  {
    re: /^You've used all (\d+) credits you've been given this month\.$/,
    key: "givenCreditsUsedUp",
    params: (m) => ({ limit: m[1] }),
  },
  {
    re: /^Your last payment for the (.+) plan failed, so its monthly credits are paused — update your payment method in Settings, or top up credits to keep going\.$/,
    key: "planPaymentFailed",
    params: (m) => ({ plan: m[1] }),
  },
  {
    re: /^Your (.+) plan isn't active anymore, so its monthly credits are paused\. Pick a plan or top up credits to keep going\.$/,
    key: "planInactive",
    params: (m) => ({ plan: m[1] }),
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
  {
    re: /^You've asked Astra for (\d+) changes this billing month — the limit on your plan\./,
    key: "setEditMonthlyCap",
    params: (m) => ({ used: m[1] }),
  },
  // A long take's progress while its parts render in turn (chain-run.ts).
  {
    re: /^Rendering part (\d+) of (\d+)$/,
    key: "stageRecastPart",
    params: (m) => ({ part: m[1], of: m[2] }),
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
