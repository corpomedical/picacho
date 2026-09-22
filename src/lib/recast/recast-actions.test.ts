import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The take's order, pinned as source — the money and the gates are in the
// ORDER, and a test that imported the action would drag Supabase and every
// provider in (the repo's standing reason for source pins).

const source = readFileSync(join(__dirname, "actions.ts"), "utf8");
const start = source.slice(source.indexOf("export async function startRecastTakes"), source.indexOf("export async function getRecastTakeMedia"));
const inspect = source.slice(source.indexOf("export async function inspectRecastClip"), source.indexOf("export async function discardRecastUpload"));
const at = (needle: string, body = start) => {
  const i = body.indexOf(needle);
  expect(i, `no longer contains: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("every action", () => {
  it("is admins only, behind the switch, before anything else", () => {
    const access = source.slice(source.indexOf("async function recastAccess"), source.indexOf("type Admin"));
    expect(access).toContain('profile?.role === "admin"');
    expect(access).toContain("if (!isAdmin) return { error: RECAST_NOT_OPEN }");
    expect(access).toContain("isRecastEnabled");
    for (const fn of ["reserveRecastUpload", "inspectRecastClip", "discardRecastUpload", "startRecastTakes", "getRecastTakeMedia", "getRecastTakeBriefs"]) {
      const body = source.slice(source.indexOf(`export async function ${fn}`));
      expect(body.indexOf("await recastAccess()"), fn).toBeGreaterThan(-1);
      expect(body.indexOf("await recastAccess()"), fn).toBe(body.indexOf("await "));
    }
  });

  it("only ever touches the caller's own clips, takes and characters", () => {
    expect(start).toContain("parsed.userId !== userId");
    expect(inspect).toContain("parsed.userId !== access.userId");
    expect(start).toContain('.eq("user_id", userId)');
    // A take used as the performance must be the caller's own, finished, undeleted.
    const own = source.slice(source.indexOf("async function readOwnTake"), source.indexOf("export async function reserveRecastUpload"));
    expect(own).toContain('.eq("user_id", userId)');
    expect(own).toContain('.eq("status", "succeeded")');
    expect(own).toContain('.is("deleted_at", null)');
  });
});

describe("startRecastTakes", () => {
  it("wants the rights tick before it reads a byte", () => {
    expect(at("input?.rights !== true")).toBeLessThan(at("readUpload(admin, uploadPath)"));
    expect(at("input?.rights !== true")).toBeLessThan(at("readOwnTake(supabase, userId, input.takeId)"));
  });

  it("prices from the file and the window, never from the form and never from the read", () => {
    expect(start).toContain("const perTake = recastWindowCredits(engine, clip, window, referenceCount)");
    expect(start).not.toMatch(/input\??\.(seconds|frames|credits|price|quotes)/);
    expect(at("readUpload(admin, uploadPath)")).toBeLessThan(at("const perTake = recastWindowCredits"));
    // The window is checked against the FILE's length before it prices anything.
    expect(at("recastWindowProblem(window, clip.seconds, spec.job)")).toBeLessThan(at("const perTake = recastWindowCredits"));
    // The read makes a round trip through a browser, so it is re-bounded and
    // may only shape the BRIEF — never the money or the cast.
    expect(start).toContain("reboundRecastRead(input?.read, clip.seconds)");
    const readLine = at("const read = reboundRecastRead");
    // The price is set before the read is even bounded, and nothing the read
    // shapes (the group check, the names, the brief) touches the money or the cast.
    expect(at("const perTake = recastWindowCredits")).toBeLessThan(readLine);
    expect(start.slice(readLine, at("return { error: RECAST_GROUP_ONE_PART }"))).not.toMatch(/credit|allowance|characterIds/);
    expect(start.slice(at("const namesFor = "), at("await gatePrompt({"))).not.toMatch(/credit|allowance|characterIds/);
  });

  it("charges what the door quoted: both call the same price", () => {
    const door = readFileSync(join(__dirname, "..", "..", "components", "mystique", "mystique-door.tsx"), "utf8");
    expect(door).toContain("recastWindowCredits(e, { seconds: seen.seconds, frames: seen.frames }, clipWindow, referenceCount(e))");
    expect(start).toContain("recastWindowCredits(engine, clip, window, referenceCount)");
    // And the frame count the door uses is the file's, handed back by inspect.
    expect(inspect).toContain("frames: clip.frames");
  });

  it("never moves a person to a job they did not choose", () => {
    // The operator's first real take: a 28 s clip, quietly moved to the one
    // job that took 28 s, which builds the picture from the photo.
    const door = readFileSync(join(__dirname, "..", "..", "components", "mystique", "mystique-door.tsx"), "utf8");
    expect(door).not.toContain("settleJob");
    expect(door).not.toMatch(/setJob\(\(current\)/);
    // The job stays; the window is fitted to it (door-truth.ts recastFitWindow:
    // trim.ts's clamp, and never under the job's shortest take — 2026-09-22).
    expect(door).toContain("recastFitWindow(clipWindow, seen.seconds, next)");
  });

  it("cuts after the words and before the picture check, and judges what it sends", () => {
    const cut = at("await cutRecastWindow(");
    expect(at("await gatePrompt({")).toBeLessThan(cut);
    expect(cut).toBeLessThan(at("await judgeRender({"));
    // The URL judged is the URL sent — the cut's, when there is one.
    expect(start.slice(cut, at("await judgeRender({"))).toContain("clipUrl = signedCut.signedUrl");
    // A refused cut goes with the refusal.
    expect(start.slice(at("await judgeRender({"), at("const seconds = Math.max(1, Math.round(windowSeconds))"))).toContain(
      "if (cutPath) await removeSource(admin, cutPath)",
    );
    // And the original is named in the recipe, so the take can be recut —
    // a long take's too, whose window is a cut like any other.
    expect(start).toContain("fromClipId: preparing || chaining ? fromClipId : null");
  });

  it("plans a long take before anything is spent, and judges the window it will send", () => {
    // lib/generations/chain.ts: past the engine's own 15 s the take is
    // rendered in chained parts. The plan — the window at 24 fps, its
    // stillness, the switches — is made after the words and before the
    // picture check, so a clip with no clean split costs nothing.
    const prep = at("await prepareChain(admin, {");
    expect(at("await gatePrompt({")).toBeLessThan(prep);
    expect(prep).toBeLessThan(at("await judgeRender({"));
    expect(prep).toBeLessThan(at('admin.rpc("reserve_generations"'));
    expect(start.slice(prep, at("await judgeRender({"))).toContain("clipUrl = signedWindow.signedUrl");
    expect(start).toContain('prep.error === "no-plan" ? RECAST_CHAIN_NO_PLAN : RECAST_TRIM_FAILED');
    // Every piece's request is composed whole here, the clip left as the
    // placeholder the runner fills — the runner never learns the engine.
    expect(start).toContain("clipUrl: CHAIN_CLIP_PLACEHOLDER");
    expect(start).toContain("chainRequestOf(");
    // Each take stores its own first piece, and a take that fails to start
    // leaves no working files behind.
    expect(start).toContain("await storeFirstPiece(admin, RECAST_BUCKET, folder, chainPrep.firstPiece)");
    expect(start).toContain("if (chainPrep) await cleanupChain(admin, { bucket: RECAST_BUCKET, folder: chainFolder(userId, generationId) })");
  });

  it("brings a clip inside the engine's limits before sending it, windowed or not", () => {
    // The operator's source was 324 px tall at 61 fps: Kling O3 Edit takes
    // 720–3840 px and 24–60 fps, and would have refused it at submit.
    expect(start).toContain("const fit = recastFitFor(clip, spec.accepts)");
    expect(start).toContain("const preparing = cutting || fit !== null");
    expect(at("const fit = recastFitFor")).toBeLessThan(at("await cutRecastWindow("));
  });

  it("judges the words and the clip BEFORE any credit moves", () => {
    const words = at("await gatePrompt({");
    const picture = at("await judgeRender({");
    for (const spend of ['admin.rpc("reserve_generations"', "consumePurchasedCredits(", "submitRecastJob("]) {
      expect(words, spend).toBeLessThan(at(spend));
      expect(picture, spend).toBeLessThan(at(spend));
    }
    expect(start.slice(picture, picture + 220)).toContain("strictLane: true");
  });

  it("tells someone short of credits in seconds — before the words are judged and before any cut", () => {
    // 2026-09-22 (moved from C5): the allowance was asked last, after a long
    // take's window was prepared at 24 fps and every picture was checked.
    const allowance = at("checkGenerationAllowance(supabase, userId, total)");
    for (const slow of ["await gatePrompt({", "await prepareChain(admin, {", "await cutRecastWindow(", "await sendAddedImage(admin, userId, image)", "await judgeRender({"]) {
      expect(allowance, slow).toBeLessThan(at(slow));
    }
    // After the price is set and the refusals that cost nothing have spoken.
    expect(at("const perTake = recastWindowCredits(")).toBeLessThan(allowance);
    expect(at("return { error: RECAST_CHAIN_TOO_MANY }")).toBeLessThan(allowance);
    expect(at("return { error: RECAST_GROUP_ONE_PART }")).toBeLessThan(allowance);
    // The very total the reserve spends: the rows are charged perTake each,
    // one row per take, and the monthly portion comes from the same total.
    expect(start.match(/const total = /g)).toHaveLength(1);
    expect(start).toContain("const total = perTake * takes.length;\n  const allowance = await checkGenerationAllowance(supabase, userId, total)");
    expect(start).toContain("credits_used: perTake,");
    expect(start).toContain("const rows = takes.map((chars, i) => {");
    expect(start).toContain("const monthlyPortion = allowance.isAdmin ? 0 : Math.max(0, total - consumePurchased)");
    expect(start).toContain("p_monthly_portion: monthlyPortion");
    // It moves nothing, so nothing has to be undone when a later gate refuses.
    expect(start.slice(allowance, at("await gatePrompt({"))).not.toMatch(/consumePurchasedCredits|reserve_generations|refund/);
  });

  it("re-judges an upload but not one of our own finished takes", () => {
    // Our own render met the output gate on the way out; judging it again on
    // the way in would be paying twice to learn the same thing.
    const guard = start.slice(at("if (uploadPath) {\n    try {"), at("const seconds = Math.max(1, Math.round(windowSeconds))"));
    expect(guard).toContain("judgeRender");
    expect(guard).toContain("recordPolicyRefusal");
    expect(guard.indexOf('err.reason === "unavailable"')).toBeLessThan(guard.indexOf("removeSource(admin, uploadPath)"));
  });

  it("asks for the whole press at once, then reserves it in one transaction", () => {
    expect(start).toContain("const total = perTake * takes.length");
    expect(at("checkGenerationAllowance(supabase, userId, total)")).toBeLessThan(at('admin.rpc("reserve_generations"'));
    expect(at('admin.rpc("reserve_generations"')).toBeLessThan(at("consumePurchasedCredits("));
    expect(at("consumePurchasedCredits(")).toBeLessThan(at("submitRecastJob("));
    expect(at("submitRecastJob(")).toBeLessThan(at("saveVideoJob({"));
  });

  it("groups its variants in its own column, never in the composer's", () => {
    // angle_group_id would have been free, and would have locked the
    // composer out of fan-out for two minutes at a time.
    expect(start).not.toContain("angle_group_id");
    expect(start).toContain("groupId,");
  });

  it("refunds by force when a submit fails, one variant at a time", () => {
    const rescue = start.slice(at("} catch (err) {\n        if (pendingJob)"));
    expect(rescue).toContain("cancelQueuedJob(pendingJob)");
    expect(rescue).toContain("refundGenerationCosts(generationId, { force: true })");
    // One bad variant must not take the others down.
    expect(start).toContain("if (started.length === 0) return { error: RECAST_COULDNT_START }");
  });

  it("is an ordinary video render from the job row on, in the strict lane", () => {
    const save = start.slice(at("saveVideoJob({"), at("saveVideoJob({") + 600);
    expect(save).toContain("strictLane: true");
    expect(save).toContain('provider: "fal"');
    expect(start).toContain('content_type: "video"');
    // The free daily slot never covers a recast.
    expect(start).toContain("free_generation_used: false");
    expect(start).not.toContain("consumeFreeGeneration");
  });

  it("asks for the lock through the payload, and only where a face is cast", () => {
    // Every take with a character is read whole, against the photos actually
    // sent; the switch decides only the refund (face-lock.ts recastTakeLock).
    expect(start).toContain("identityLock: recastTakeLock({");
    expect(start).toContain("threshold: RECAST_LOCK_THRESHOLD,");
    expect(start).toContain("lockOn,");
    const runner = readFileSync(join(__dirname, "..", "generations", "job-runner.ts"), "utf8");
    // The runner grew the capability, not the lane.
    expect(runner).not.toMatch(/recast/i);
    expect(runner).toContain("identityLock");
    expect(runner).toContain('extractVideoFrame(providerDownloadUrl(outcome.resultUrl), "first")');
    expect(runner).toContain("Math.min(...lockScores)");
  });
});

// NOT LOCKED TO CHARACTERS (2026-09-19, the operator: "make it that the user
// can upload an image and that they can only use prompt to change whatever
// they want. Do not lock it just on characters").
describe("a take with images of the person's own, or with words alone", () => {
  const images = source.slice(source.indexOf("async function readAddedImage"), source.indexOf("/** Step 1: a place for the clip"));

  it("asks what the take is short of before it reads anything", () => {
    expect(start).toContain("recastMissing(spec.job, { characters: ids.length, images: askedImages.length, words: direction.trim().length > 0 })");
    expect(at('if (missing === "words") return { error: RECAST_NEEDS_WORDS }')).toBeLessThan(at('.from("character_profiles")'));
    expect(at('if (missing === "picture") return { error: RECAST_NEEDS_PICTURE }')).toBeLessThan(at("readUpload(admin, uploadPath)"));
    // The old rule — a character or nothing — is gone.
    expect(source).not.toContain("RECAST_NEEDS_CAST");
  });

  it("only ever uses images in the caller's own folder, read for what they really are", () => {
    expect(images).toContain("if (!path.startsWith(`${userId}/`) || path.includes(\"..\")) return { error: RECAST_IMAGE_UNUSABLE }");
    expect(images).toContain("sharp(bytes).metadata()");
    expect(images).toContain("recastImageUsable({ width, height })");
    // The rights tick comes first, as for the clip.
    expect(at("input?.rights !== true")).toBeLessThan(at("await readAddedImage(admin, userId, path)"));
  });

  it("judges each image as it will be sent, in the strict lane, before any credit moves", () => {
    const judged = at('await judgeRender({ url: sent.url, kind: "image", strictLane: true');
    expect(at("await sendAddedImage(admin, userId, image)")).toBeLessThan(judged);
    expect(judged).toBeLessThan(at('admin.rpc("reserve_generations"'));
    expect(judged).toBeLessThan(at("consumePurchasedCredits("));
    expect(judged).toBeLessThan(at("submitRecastJob("));
    // A refused image leaves nothing of the press behind.
    expect(start.slice(judged, at("const seconds = Math.max(1, Math.round(windowSeconds))"))).toContain("await dropPrepared()");
    expect(start).toContain('provider: "recast-image"');
  });

  it("brings one picture to life in Photo to life, and carries every image into the clip", () => {
    expect(start).toContain("askedImages.slice(0, recastImageRoom(together ? ordered.length : Math.min(1, ordered.length)))");
    expect(start).toContain(": askedImages.slice(0, 1)");
    expect(start).toContain('const picture = photos.first ?? (spec.job === "motion" ? (sentImages[0]?.url ?? null) : null)');
    // Restage too: its brief names them "Image n" after the cast's photos, so
    // a take that named them without sending them (2026-09-21) cannot recur.
    expect(start).toContain('const imageUrls = spec.job === "scene" || spec.restages ? sentImages.map((image) => image.url) : []');
    // Every part of a long take carries them too.
    expect(start.slice(at("clipUrl: CHAIN_CLIP_PLACEHOLDER"), at("clipUrl: CHAIN_CLIP_PLACEHOLDER") + 460)).toContain("...imageUrls, CHAIN_LOOK_PLACEHOLDER");
  });

  it("records the images it sent, and asks for the lock only where a face is cast", () => {
    expect(start).toContain("images: sentImages.map((image) => image.path)");
    expect(start).toContain("identityLock: recastTakeLock({");
  });
});

// TOGETHER (2026-09-19, "Selecting two characters still makes two videos
// separately").
describe("several characters in one take", () => {
  it("puts them together in Into the clip and Restage, and only when asked", () => {
    // Restage since 2026-09-21: "Still when selecting two characters in Restage it gives me 2 takes".
    expect(start).toContain("const together = recastCastsTogether(spec.job) && input?.together === true && ordered.length > 1");
    expect(start).toContain("const takes: Character[][] = together ? [ordered] : ordered.length > 0 ? ordered.map((c) => [c]) : [[]]");
  });

  it("lets each person in the clip be played once, and wants words for anyone without one", () => {
    expect(start).toContain("playedBy.has(tag)) return null");
    expect(start).toContain("if (together && castTags.some((tag) => tag === null) && !direction.trim()) return { error: RECAST_NEEDS_ROLES }");
    // Before a byte of the clip is read.
    expect(at("return { error: RECAST_NEEDS_ROLES }")).toBeLessThan(at("readUpload(admin, uploadPath)"));
  });

  it("charges ONE take for everyone in it, and binds each to their own photos", () => {
    expect(start).toContain("const total = perTake * takes.length");
    expect(start).toContain("const ensemble = chars.length > 1 ? signed.map((p) => ({ front: p.first!, more: p.more })) : undefined");
    expect(start).toContain("character_profile_ids: chars.map((c) => c.id)");
    // Every part of a long take carries them all.
    expect(start.slice(at("clipUrl: CHAIN_CLIP_PLACEHOLDER"), at("clipUrl: CHAIN_CLIP_PLACEHOLDER") + 560)).toContain("...(ensemble ? { ensemble } : {})");
  });

  it("keeps a whole group to ONE part — a later part is handed the footage and follows it", () => {
    // 2026-09-20: two takes of the same crowd came back as the operator's own
    // students at the second join, still or no still.
    expect(start).toContain("const groupTags = new Set((read?.people ?? []).filter((p) => p.many).map((p) => p.tag))");
    expect(start).toContain("if (castOverGroup && chaining) return { error: RECAST_GROUP_ONE_PART }");
    // Before a credit moves, and before the window is cut.
    expect(at("if (castOverGroup && chaining) return { error: RECAST_GROUP_ONE_PART }")).toBeLessThan(at("await prepareChain(admin, {"));
    expect(at("if (castOverGroup && chaining) return { error: RECAST_GROUP_ONE_PART }")).toBeLessThan(at("checkGenerationAllowance("));
    const door = readFileSync(join(__dirname, "..", "..", "components", "mystique", "mystique-door.tsx"), "utf8");
    expect(door).toContain("const groupNeedsOnePart = castOverGroup && parts > 1;");
    // Take stays grey on it, and says why (door-truth.ts recastBlocker, 2026-09-22).
    expect(door).toMatch(/recastBlocker\(\{[\s\S]*?\n    groupNeedsOnePart,\n[\s\S]*?\}\);\n  const canTake = blocker === null;/);
  });

  it("names the place the take must keep, from the read's own words", () => {
    const brief = readFileSync(join(__dirname, "recast-brief.ts"), "utf8");
    // Said in full and in the short form a brief too long for its engine takes (2026-09-22).
    expect(brief).toContain("The place it happens in, unchanged: ${world}");
    expect(brief).toContain("castKeepLines({ video, world: input.read?.world,");
  });

  it("promises the face lock only where ONE face is cast", () => {
    expect(start).toContain("identityLock: recastTakeLock({");
  });

  it("prices a Restage take at the photos it actually carries, and the images that actually ride", () => {
    // Together, everyone's; apart, the dearest single character's — every take
    // of the press is charged the same.
    expect(start).toContain(
      "const photosPerTake = together ? ordered.map(photosOfRow) : ordered.length > 0 ? [Math.max(...ordered.map(photosOfRow))] : []",
    );
    expect(start).toContain("askedImages.slice(0, recastRestageImageRoom(photosPerTake))");
    expect(start).toContain("const referenceCount = spec.restages ? photosPerTake.reduce((n, count) => n + count, 0) + added.length : 0");
    // The door counts the same.
    const door = readFileSync(join(__dirname, "..", "..", "components", "mystique", "mystique-door.tsx"), "utf8");
    expect(door).toContain("const photosPerTake = ensemble ? cast.map(photosOf) : cast.length > 0 ? [Math.max(...cast.map(photosOf))] : []");
    expect(door).toContain("RECAST_ENGINES[e].restages ? photosPerTake.reduce((n, count) => n + count, 0) + usedImages.length : 0");
    expect(door).toContain("? recastRestageImageRoom(photosPerTake)");
  });

  it("offers the choice on the door wherever the server honours it", () => {
    const door = readFileSync(join(__dirname, "..", "..", "components", "mystique", "mystique-door.tsx"), "utf8");
    expect(door).toContain("const ensemble = recastCastsTogether(job) && together && cast.length > 1");
    expect(door).toContain("{recastCastsTogether(job) && cast.length > 1 && (");
    expect(door).toContain("...(ensemble ? { together: true, castTags } : {})");
  });
});

// THE ANUBIS TAKE (2026-09-20): parts 1–2 built an Egyptian field, part 3
// came back as the school. A later part sees one second of the part before
// it and then the footage, so the take's own look has to ride as a picture.
describe("what keeps a later part on the take's look", () => {
  it("keeps every part's still where images are allowed to live", () => {
    expect(start).toContain("look: { bucket: RECAST_IMAGE_BUCKET, prefix: `${userId}/recast-look-${generationId}` }");
  });

  it("leaves the still a place in every part after the first", () => {
    expect(start).toContain('imageUrls: k > 0 && spec.job === "scene" ? [...imageUrls, CHAIN_LOOK_PLACEHOLDER] : imageUrls');
    // And names it in that part's brief, after the added images.
    expect(start).toContain("...(look ? { look } : {})");
  });

  it("leaves the still room among the four references a take carries", () => {
    expect(start).toContain("const charactersInTake = together ? ordered.length : Math.min(1, ordered.length)");
    expect(start).toContain("recastImageRoom(charactersInTake, chaining)");
  });

  it("turns away a long take's cast that leaves the still no room, before a credit moves", () => {
    // 2026-09-22: four characters past 15 s left the still no place, and the
    // request silently dropped the picture that part's own words point at.
    const refuse = at("if (chaining && !recastChainFits(charactersInTake)) return { error: RECAST_CHAIN_TOO_MANY }");
    for (const later of ["await gatePrompt({", "await prepareChain(admin, {", "await cutRecastWindow(", "checkGenerationAllowance(", 'admin.rpc("reserve_generations"', "consumePurchasedCredits(", "submitRecastJob("]) {
      expect(refuse, later).toBeLessThan(at(later));
    }
    // The line is the person's, in every language.
    const messages = readFileSync(join(__dirname, "messages.ts"), "utf8");
    expect(messages).toContain('export const RECAST_CHAIN_TOO_MANY = "Over 15 seconds a take carries up to three characters. Trim to 15 seconds for four."');
    const serverText = readFileSync(join(__dirname, "..", "i18n", "server-text.ts"), "utf8");
    expect(serverText).toContain('"Over 15 seconds a take carries up to three characters. Trim to 15 seconds for four.": "recastChainTooMany"');
    for (const lang of ["en", "es", "it", "pt"]) {
      expect(readFileSync(join(__dirname, "..", "i18n", "messages", `${lang}.ts`), "utf8"), lang).toMatch(/\n    recastChainTooMany: "[^"]+",/);
    }
  });

  it("asks whether a whole group is cast of the tags each take really casts — variants included", () => {
    // Variants (one take per character) each play the person the door named;
    // until 2026-09-22 they were asked about tags no take of theirs used.
    expect(start).toContain("const castOverGroup = (together ? castTags : [castTag]).some((tag) => tag !== null && groupTags.has(tag))");
    // The same tags the brief casts each take with.
    expect(start).toContain("const tag = chars.length > 1 ? castTags[ids.indexOf(c.id)] : castTag");
  });

  it("says a group is a group, from the read's own judgement", () => {
    expect(start).toContain('read?.people.find((p) => p.tag === tag)?.many === true');
    const reader = readFileSync(join(__dirname, "recast-read.ts"), "utf8");
    expect(reader).toContain('"many": boolean }   // true when this line is SEVERAL people (a crowd, a row, a class), not one');
    expect(reader).toContain("many: o.many === true");
  });
});

// EVERY WORD YOU WRITE REACHES THE TAKE (2026-09-22). The submit read its
// brief back out of the recipe, which store.ts cut at 2,000 characters from
// the end — where the direction stands — and the door composed what it
// showed from the whole clip, not the stretch that is sent.
describe("the words a take is sent", () => {
  const door = readFileSync(join(__dirname, "..", "..", "components", "mystique", "mystique-door.tsx"), "utf8");
  /** The keys of the first composeRecastBrief({ … }) call after `from`, in order. */
  const keysOfCall = (text: string, from: string) => {
    const open = text.indexOf("composeRecastBrief({", text.indexOf(from));
    const body = text.slice(open, text.indexOf("})", open));
    return [...body.matchAll(/\n\s+(\w+)(?=[,:])/g)].map((m) => m[1]);
  };

  it("sends the words it composed, never the recipe's kept copy", () => {
    expect(start).not.toMatch(/rows\[i\]\.recast/);
    expect(start).toContain("const takeBriefs = takes.map((chars) => (chainPrep ? pieceBriefsFor(chainPrep.plan, chars) : [briefFor(chars)]))");
    expect(start).toContain("brief: takeBriefs[i][0]");
    expect(start).toContain("const briefs = takeBriefs[i] ?? []");
    // Composed once, before the rows are reserved; sent from the same list.
    expect(at("const takeBriefs = takes.map(")).toBeLessThan(at('admin.rpc("reserve_generations"'));
    const store = readFileSync(join(__dirname, "store.ts"), "utf8");
    expect(store).toContain("brief: recastFitPrompt(input.brief, RECAST_PROMPT_MAX_CHARS)");
    expect(store).not.toContain("input.brief.slice(0, 2000)");
  });

  it("composes for the window with the whole read, the door's own way, inside the engine's own limit", () => {
    const server = keysOfCall(start, "const briefFor = (chars: Character[]) =>");
    const shown = keysOfCall(door, "const brief = briefWindow");
    expect(server).toEqual(["job", "engine", "read", "window", "casting", "keeps", "direction", "images", "longTake"]);
    expect(shown).toEqual(server);
    // The read handed to both is the WHOLE clip's; the window cuts it.
    expect(start).toContain("const read = reboundRecastRead(input?.read, clip.seconds)");
    expect(start).not.toContain("cutsInWindow(");
    expect(door).toContain("window: briefWindow,");
    expect(door).toContain("const briefWindow = seen ? (clipWindow ?? { start: 0, end: seen.seconds }) : null");
    // Every part of a long take, on its own stretch of the window.
    const parts = keysOfCall(start, "const pieceBriefsFor = (plan");
    expect(parts.slice(0, 4)).toEqual(["job", "engine", "read", "window"]);
    expect(start).toContain("window: { start: window.start + from / CHAIN_FPS, end: window.start + (from + frames) / CHAIN_FPS }");
  });

  it("lets the direction change the keep list on a take of one piece, and never on a long take's parts", () => {
    // recast-brief.ts YOUR WORDS WIN (2026-09-22): a long take's later parts
    // are handed the footage again, so every part keeps today's lines.
    const one = start.slice(at("const briefFor = (chars: Character[]) =>"), at("const pieceBriefsFor = (plan"));
    expect(one).toContain("longTake: chaining,");
    const parts = start.slice(at("const pieceBriefsFor = (plan"), at("await gatePrompt({"));
    expect(parts).toContain("longTake: true,");
    expect(parts).not.toContain("longTake: chaining");
    // Every part of a long take is composed by pieceBriefsFor, never by briefFor.
    expect(start).toContain("chainPrep ? pieceBriefsFor(chainPrep.plan, chars) : [briefFor(chars)]");
    // The door shows the same.
    expect(door).toContain("longTake: briefInParts,");
  });

  it("names everything the one way the request binds it", () => {
    expect(start).toContain("recastBriefNames({ job: spec.job, engine, photos: chars.map(photosOfRow), images: sendImages.length })");
    expect(start).toContain("const look = k > 0 && names.look ? names.look : undefined");
    // And the door names only the images the take will carry: a long take
    // keeps one of its four places for the still.
    expect(door).toContain("recastImageRoom(briefCast.length, briefInParts)");
    expect(door).toContain(
      "RECAST_ENGINES[engine].chains === true && briefWindow !== null && chainPieceCount(briefWindow.end - briefWindow.start) > 1",
    );
  });

  it("keeps every part's words on the take's log, where they outlive the job row", () => {
    expect(start).toContain("const partBriefs = chainPrep ? { partBriefs: briefs } : {}");
    const save = start.slice(at("saveVideoJob({"), at("started.push(generationId)"));
    expect(save).toContain("compiledPrompt: brief,\n              ...partBriefs,");
    // A take that fails to start keeps them too.
    const rescue = start.slice(at("} catch (err) {\n        if (pendingJob)"));
    expect(rescue).toContain("compiledPrompt: brief, ...partBriefs,");
    // And they are read back for the take's own card, the caller's own takes only.
    const reader = source.slice(source.indexOf("export async function getRecastTakeBriefs"));
    expect(reader).toContain('.select("id, pipeline_log")');
    expect(reader).toContain('.eq("user_id", access.userId)');
    expect(reader).toContain('.is("deleted_at", null)');
    expect(reader).toContain(".in(\"model_id\", RECAST_MODEL_IDS)");
    expect(reader).toContain("recastSentBriefs(take.pipeline_log)");
  });
});

describe("inspectRecastClip", () => {
  it("reads the file for the numbers and the frames for the meaning", () => {
    expect(inspect).toContain("readUpload(admin, input.path!)");
    expect(inspect).toContain("askRecastRead(");
    expect(inspect).toContain("parseRecastRead(");
    expect(inspect).toContain("recastCreditCost(engine, clip)");
  });

  it("brakes the read, and a clip it cannot read can still be taken", () => {
    expect(inspect).toContain('rateLimited(access.userId, "recast-read"');
    expect(inspect).toContain("let read: RecastRead | null = null");
    // No branch turns a failed read into a refusal.
    expect(inspect.slice(inspect.indexOf("let read"))).not.toMatch(/return \{ error: [A-Z_]*READ/);
  });
});

describe("the lane's own housekeeping", () => {
  it("traces the encoder into the route whose action cuts", () => {
    const config = readFileSync(join(__dirname, "..", "..", "..", "next.config.ts"), "utf8");
    expect(config).toContain('"/app/mystique": ["./node_modules/ffmpeg-static/ffmpeg"]');
  });

  it("keeps the upload a window was cut from", () => {
    const data = readFileSync(join(__dirname, "data.ts"), "utf8");
    expect(data).toContain("if (recipe?.fromClipId) spokenFor.add(recipe.fromClipId)");
  });

  it("sweeps a bucket that account deletion also sweeps", () => {
    const buckets = readFileSync(join(__dirname, "..", "profile", "storage-buckets.ts"), "utf8");
    expect(buckets).toContain('"recast-sources"');
    const data = readFileSync(join(__dirname, "data.ts"), "utf8");
    expect(data).toContain("sweepRecastOrphans");
    // A failed read of what is spoken for must never be read as "nothing is".
    expect(data).toContain("if (rowsError || !rows) return;");
  });

  it("ships the database the code needs, with both switches off", () => {
    const supabaseDir = join(__dirname, "..", "..", "..", "supabase");
    const sqlPath = [join(supabaseDir, "pending"), ...readdirSync(join(supabaseDir, "applied")).map((d) => join(supabaseDir, "applied", d))]
      .map((dir) => join(dir, "recast.sql"))
      .find((p) => existsSync(p));
    expect(sqlPath, "recast.sql is in neither supabase/pending nor supabase/applied/*").toBeDefined();
    const sql = readFileSync(sqlPath!, "utf8");
    expect(sql).toContain("'recast-sources'");
    expect(sql).toContain("array['video/mp4', 'video/quicktime']");
    expect(sql).toContain("add column if not exists recast jsonb");
    expect(sql).toMatch(/'recast',\s+false,/);
    expect(sql).toMatch(/'recast_lock',\s+false,/);
  });

  it("names the recast column in exactly one module", () => {
    const dir = __dirname;
    for (const file of readdirSync(dir)) {
      if (file === "store.ts" || file.endsWith(".test.ts")) continue;
      const text = readFileSync(join(dir, file), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      // The actions may WRITE the column through recastRow and read it back
      // through readRecastRecipe; neither spells its shape out.
      expect(text, file).not.toMatch(/recast:\s*\{\s*v:/);
    }
  });
});

// What the door shows when the column its recipes live in is not there yet
// ("I tried mystic, uploaded video generated and it looks like nothing has
// happened", 2026-09-18). `recast` arrives with a migration the operator
// runs by hand; PostgREST fails a WHOLE statement that names a column the
// database does not have. It was named in the door's list of takes, so with
// the bucket and the flag in place — the upload working, the take started
// and charged — the page had nothing on it at all. Verified against
// production the same day: the flag and the bucket were there, the column
// was not.
describe("the door survives a migration that has not run", () => {
  const data = readFileSync(join(__dirname, "data.ts"), "utf8");
  const store = readFileSync(join(__dirname, "store.ts"), "utf8");
  const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");

  it("never names the recipe's column in a query that carries anything else", () => {
    const columns = data.slice(data.indexOf("const TAKE_COLUMNS ="), data.indexOf(";", data.indexOf("const TAKE_COLUMNS =")));
    expect(columns).not.toContain("recast");
    // Everywhere it IS named, it is the only thing that query asks for, so a
    // missing column costs that one answer and nothing else.
    for (const m of [...data.matchAll(/\.select\("([^"]*)"\)/g), ...actions.matchAll(/\.select\("([^"]*)"\)/g), ...store.matchAll(/\.select\("([^"]*)"\)/g)]) {
      if (!m[1].includes("recast")) continue;
      // Only the recipe, and at most the id to hang it on.
      expect(m[1].replace(/\s/g, "").split(",").sort().filter((c) => c !== "id")).toEqual(["recast"]);
    }
    expect(store).toContain("export async function readRecastRecipes(");
  });

  it("lists a take that failed, instead of hiding it", () => {
    const home = data.slice(data.indexOf("export async function getRecastHome("), data.indexOf("const ORPHAN_AFTER_MS"));
    expect(home).not.toContain('.neq("status", "failed")');
    // A failed take can still never be offered as a performance to recast.
    expect(home).toContain('.filter((g) => g.status === "succeeded")');
  });
});
