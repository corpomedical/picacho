// Press Tour's cut, its tag, signing and delivery, and the 24 h rule (Cut 4;
// spec §1.10-§1.12 as changed by v2: synthesis §3.1 items 25, 35, 39; the
// operator's decisions of 2026-09-26).
//
// THE CUT (assembleStep), deterministic, one step per claim so no step nears
// the function's limit:
//   1. a SEGMENT per kept take, in shot order (a cut shot is skipped): the
//      take normalised to the export preset (cut-encode.ts), its own sound
//      replaced by silence (audio off; music off by default: #35), the
//      plan's on-screen words burned in when captions are on, twice — a
//      clean segment and a tagged one carrying the small "AI-generated" tag
//      (about 2% of the frame height, in the bottom corner away from the
//      product, in the language the Film press was made in). Both go to the
//      private press-kit bucket.
//   2. the END CARD, when the ad's brand kit has a confirmed logo: the logo
//      over the brand's first colour and the call to action, 1.5 s.
//   3. the JOIN, a copy with no re-encode, into two renditions:
//        clean   no tag, no end card: every TikTok path (TikTok forbids
//                added watermarks and logos; its own AI label does that job)
//        tagged  the tag on every frame of the film, and the end card
//      each probed (3-90 s, 1080x1920, under the bucket's limit), named
//      after its sha256, kept in press-kit.
// Three failed steps in a row PARK the cut: the ad waits with "We couldn't
// finish the cut, and we're on it", Admin is told, "Make the cut" runs it
// again for free, and the 24 h rule keeps running (we still owe it).
//
// SIGNING (signStep): each rendition through sign.ts after its last encode.
// Until the certificate and a C2PA library are there, each stays unsigned
// with `signed: false` and the reason for Admin; nothing claims otherwise.
//
// DELIVERY: the tagged rendition becomes the finished ad's own History row
// (model_id 'press-tour-cut', 0 credits: the editor-output pattern), the ad
// is `ready`, and the person's phone hears adReady once.
//
// THE 24 h RULE (lateCuts, v2 #39): an ad whose filming was charged and that
// is not delivered within 24 h of the last press that put us to work on it
// closes, and the filming credits go back through the refund authority (the
// ordinary rules: never an uncapped force). The shots stay in History. The
// close is refused, in the same conditional write, while a step holds the
// ad's lease (fixer 2026-09-26, MONEY-6): a claim that lands between the
// first read and the write is seen, never overwritten mid-delivery.
//
// Alias-free (vitest has no "@/"): cut.test.ts runs it against an in-memory
// database and, when ffmpeg-static is there, the real encoder on tiny clips.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeMp4 } from "../media/mp4-probe";
import { closeAttempts, derivedUuid, isTerminal, LEASE_MS, mutateCampaign, readCampaign, releaseTakes, type CampaignRow, type MachineDeps, type StepResult } from "./campaign-machine";
import {
  EXPORT_PRESET,
  JOIN_TIMEOUT_MS,
  MASTER_MAX_BYTES,
  MASTER_MAX_SECONDS,
  MASTER_MIN_SECONDS,
  SEGMENT_TIMEOUT_MS,
  endCardArgs,
  joinArgs,
  joinList,
  overlaySvg,
  rasterise,
  renderEndCard,
  runFfmpeg,
  segmentArgs,
  type ExportPreset,
  type OutlineFont,
  type RunResult,
} from "./cut-encode";
import {
  MAX_CUT_FAILURES,
  RENDITION_KINDS,
  adPath,
  endCardPath,
  parseAssembly,
  parseRenditions,
  renditionPath,
  renditionsComplete,
  segmentPath,
  type AssemblyState,
  type RenditionKind,
  type RenditionRecord,
  type Segment,
} from "./cut-state";
import { AI_TAG_TEXT, CUT_LATE, SIGN_FAILED, cutLateRefunded } from "./film-messages";
import { closeOpenTakes, cutList, filmCreditsHeld, openTakes, withTakesRefunded } from "./shots";
import type { RenditionSigner } from "./sign";

/** The phone's notices about an ad (lib/push PushMessage keys). */
export type AdNoticeKey = "adReady" | "adFailed" | "adFailedRefunded";

/** A cut the ad owes is due within this long of the press that put us to work (v2 #39). */
export const CUT_DUE_MS = 24 * 60 * 60_000;
/** The finished ad's History row. */
export const CUT_MODEL_ID = "press-tour-cut";

export interface CutDeps {
  /** A kept take's bytes, from its stored link (our media route, or the provider's). Null when it cannot be read. */
  readVideo(video: string): Promise<Buffer | null>;
  /** press-kit, the service role's: read, write (upsert), remove. */
  readKit(path: string): Promise<Buffer | null>;
  writeKit(path: string, bytes: Buffer): Promise<boolean>;
  removeKit(paths: string[]): Promise<void>;
  /** The finished ad copied where History serves videos from; its stored link, or null. */
  keepMaster(input: { userId: string; campaignId: string; sha256: string; bytes: Buffer }): Promise<string | null>;
  signer: RenditionSigner;
  /** The brand kit's confirmed logo and first colour, or null (no kit, no logo, not confirmed). Throws when it can't be read. */
  brand(input: { userId: string; brandKitId: string }): Promise<{ logo: Buffer; background: string | null } | null>;
  /** The drawing font (cut-encode.ts loadCutFont). */
  font(): Promise<OutlineFont | null>;
  /** ffmpeg (cut-encode.ts runFfmpeg); a test may swap it. */
  run?(args: readonly string[], timeoutMs: number): Promise<RunResult>;
  /**
   * The phone: adReady, adFailed (nothing came back) or adFailedRefunded
   * (credits went back: PT-R3-04), in lib/push's four languages. Null until
   * wired: the ad is delivered either way.
   */
  notify: ((input: { userId: string; key: AdNoticeKey; path: string }) => Promise<void>) | null;
  /** job-runner.ts refundGenerationCosts (the 24 h rule: ordinary rules). */
  refund(rowId: string, opts: { force?: boolean }): Promise<boolean>;
  preset?: ExportPreset;
}

const nowOf = (deps: { now?: () => Date }) => (deps.now ? deps.now() : new Date());
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** The finished ad's History row id, made from the campaign: a redone step lands on the same row. */
export function masterRowId(campaignId: string): string {
  return derivedUuid(`press-cut:${campaignId.toLowerCase()}`);
}

// ---------------------------------------------------------------------------
// Failures: count, park after three
// ---------------------------------------------------------------------------

async function cutFailure(deps: MachineDeps, row: CampaignRow, error: string): Promise<StepResult> {
  console.error(`[press-tour] cut ${row.id} step failed: ${error.slice(0, 300)}`);
  const written = await mutateCampaign<boolean>(deps.db, row.id, null, (fresh) => {
    if (fresh.stage !== "assembling" && fresh.stage !== "signing") return { refuse: false };
    const a = parseAssembly(fresh.assembly);
    const failures = a.failures + 1;
    const parked = failures >= MAX_CUT_FAILURES;
    const assembly: AssemblyState = { ...a, failures, parked, lastError: error.slice(0, 400) };
    // Parked: waits for "Make the cut" (free). Not an expiring wait: the 24 h rule's clock keeps running.
    return { patch: parked ? { assembly, stage: "awaiting_approval", expires_at: null } : { assembly }, value: parked };
  });
  if (written.ok && written.value) {
    await deps
      .notifyAdmins({
        title: "Press Tour cut stuck",
        body: `Campaign ${row.id.slice(0, 8)} couldn't be cut ${MAX_CUT_FAILURES} times: ${error.slice(0, 120)}`,
        path: "#system",
      })
      .catch(() => undefined);
    return "waiting";
  }
  return "unavailable";
}

async function run(cut: CutDeps, args: readonly string[], timeoutMs: number): Promise<RunResult> {
  return (cut.run ?? runFfmpeg)(args, timeoutMs);
}

// ---------------------------------------------------------------------------
// The cut
// ---------------------------------------------------------------------------

/** ONE step of an ad in `assembling`: a segment, the end card, or the join. */
export async function assembleStep(deps: MachineDeps, row: CampaignRow): Promise<StepResult> {
  const cut = deps.cut;
  if (!cut || !row.plan) return "idle";
  const list = cutList(row.shots);
  if (list.length === 0) return cutFailure(deps, row, "nothing to cut: no shot has a kept take");
  const a = parseAssembly(row.assembly);
  const dir = await mkdtemp(join(tmpdir(), "press-cut-"));
  try {
    const missing = list.find((i) => !a.segments.some((s) => s.rowId === i.take.rowId));
    if (missing) return await makeSegment(deps, cut, row, a, missing, dir);
    if (!a.endCardDone) return await makeEndCard(deps, cut, row, dir);
    return await joinRenditions(deps, cut, row, a, list, dir);
  } catch (err) {
    return cutFailure(deps, row, err instanceof Error ? err.message : "the cut step failed");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function makeSegment(
  deps: MachineDeps,
  cut: CutDeps,
  row: CampaignRow,
  a: AssemblyState,
  item: ReturnType<typeof cutList>[number],
  dir: string,
): Promise<StepResult> {
  const preset = cut.preset ?? EXPORT_PRESET;
  const planned = row.plan!.shots.find((s) => s.shot === item.shot);
  if (!planned || !item.take.video) return cutFailure(deps, row, `shot ${item.shot} has no kept take to cut`);
  const bytes = await cut.readVideo(item.take.video);
  if (!bytes) return cutFailure(deps, row, `shot ${item.shot}'s take couldn't be read`);
  const source = join(dir, "take.mp4");
  await writeFile(source, bytes);

  const font = await cut.font().catch(() => null);
  const caption = a.captions && planned.onScreenText ? planned.onScreenText : null;
  const overlays = {
    clean: overlaySvg({ font, preset, caption, tag: null }),
    tagged: overlaySvg({ font, preset, caption, tag: { text: AI_TAG_TEXT[a.locale], corner: item.take.corner ?? "left" } }),
  };
  const out: Partial<Record<"clean" | "tagged", Buffer>> = {};
  for (const variant of ["clean", "tagged"] as const) {
    const svg = overlays[variant];
    let overlay: string | null = null;
    if (svg) {
      overlay = join(dir, `${variant}.png`);
      await writeFile(overlay, await rasterise(svg));
    }
    const output = join(dir, `${variant}.mp4`);
    const done = await run(cut, segmentArgs({ source, output, seconds: planned.seconds, overlay, preset }), SEGMENT_TIMEOUT_MS);
    if (!done.ok) return cutFailure(deps, row, `segment ${item.shot} (${variant}): ${done.error}`);
    out[variant] = await readFile(output);
  }
  const paths = {
    clean: segmentPath(row.userId, row.id, item.take.rowId, "clean"),
    tagged: segmentPath(row.userId, row.id, item.take.rowId, "tagged"),
  };
  for (const variant of ["clean", "tagged"] as const) {
    if (!(await cut.writeKit(paths[variant], out[variant]!))) return cutFailure(deps, row, `segment ${item.shot} (${variant}) couldn't be kept`);
  }
  const segment: Segment = { shot: item.shot, take: item.take.n, rowId: item.take.rowId, clean: paths.clean, tagged: paths.tagged, seconds: planned.seconds };
  const written = await mutateCampaign(deps.db, row.id, null, (fresh) => {
    if (fresh.stage !== "assembling") return { refuse: null };
    const now = parseAssembly(fresh.assembly);
    const assembly: AssemblyState = { ...now, segments: [...now.segments.filter((s) => s.rowId !== segment.rowId), segment], failures: 0, lastError: null };
    return { patch: { assembly }, value: null };
  });
  return written.ok ? "cut" : "busy";
}

async function makeEndCard(deps: MachineDeps, cut: CutDeps, row: CampaignRow, dir: string): Promise<StepResult> {
  const preset = cut.preset ?? EXPORT_PRESET;
  let path: string | null = null;
  if (row.brandKitId) {
    const brand = await cut.brand({ userId: row.userId, brandKitId: row.brandKitId });
    if (brand) {
      const font = await cut.font().catch(() => null);
      const png = await renderEndCard({ font, preset, logo: brand.logo, background: brand.background, cta: row.plan?.cta ?? null });
      const image = join(dir, "card.png");
      const output = join(dir, "card.mp4");
      await writeFile(image, png);
      const done = await run(cut, endCardArgs({ image, output, preset }), SEGMENT_TIMEOUT_MS);
      if (!done.ok) return cutFailure(deps, row, `end card: ${done.error}`);
      path = endCardPath(row.userId, row.id);
      if (!(await cut.writeKit(path, await readFile(output)))) return cutFailure(deps, row, "the end card couldn't be kept");
    }
  }
  const written = await mutateCampaign(deps.db, row.id, null, (fresh) =>
    fresh.stage !== "assembling"
      ? { refuse: null }
      : { patch: { assembly: { ...parseAssembly(fresh.assembly), endCard: path, endCardDone: true, failures: 0, lastError: null } }, value: null },
  );
  return written.ok ? "cut" : "busy";
}

/** A finished file's own check: long enough, short enough, the preset's frame, under the bucket's limit. */
export function renditionProblem(bytes: Buffer, preset: Pick<ExportPreset, "width" | "height"> = EXPORT_PRESET): string | null {
  if (bytes.length > MASTER_MAX_BYTES) return `the file is ${bytes.length} bytes, over ${MASTER_MAX_BYTES}`;
  const probe = probeMp4(bytes);
  if (!probe) return "the file couldn't be read back";
  if (probe.width !== preset.width || probe.height !== preset.height) return `the frame is ${probe.width}x${probe.height}, not ${preset.width}x${preset.height}`;
  if (!(probe.seconds >= MASTER_MIN_SECONDS && probe.seconds <= MASTER_MAX_SECONDS)) return `the ad is ${probe.seconds.toFixed(2)} s, outside ${MASTER_MIN_SECONDS}-${MASTER_MAX_SECONDS} s`;
  return null;
}

async function joinRenditions(
  deps: MachineDeps,
  cut: CutDeps,
  row: CampaignRow,
  a: AssemblyState,
  list: ReturnType<typeof cutList>,
  dir: string,
): Promise<StepResult> {
  const preset = cut.preset ?? EXPORT_PRESET;
  const ordered = list.map((i) => a.segments.find((s) => s.rowId === i.take.rowId)!);
  const files: Record<"clean" | "tagged", string[]> = { clean: [], tagged: [] };
  for (const [i, seg] of ordered.entries()) {
    for (const variant of ["clean", "tagged"] as const) {
      const bytes = await cut.readKit(seg[variant]);
      if (!bytes) return cutFailure(deps, row, `segment ${seg.shot} (${variant}) is missing`);
      const file = join(dir, `${i}-${variant}.mp4`);
      await writeFile(file, bytes);
      files[variant].push(file);
    }
  }
  if (a.endCard) {
    const card = await cut.readKit(a.endCard);
    if (!card) return cutFailure(deps, row, "the end card is missing");
    const file = join(dir, "end-card.mp4");
    await writeFile(file, card);
    files.tagged.push(file);
  }

  const records: Partial<Record<RenditionKind, RenditionRecord>> = {};
  for (const kind of RENDITION_KINDS) {
    const listFile = join(dir, `${kind}.txt`);
    const output = join(dir, `${kind}-out.mp4`);
    await writeFile(listFile, joinList(files[kind]));
    const done = await run(cut, joinArgs(listFile, output), JOIN_TIMEOUT_MS);
    if (!done.ok) return cutFailure(deps, row, `join (${kind}): ${done.error}`);
    const bytes = await readFile(output);
    const problem = renditionProblem(bytes, preset);
    if (problem) return cutFailure(deps, row, `${kind}: ${problem}`);
    const sum = sha256(bytes);
    const path = renditionPath(row.userId, row.id, kind, sum);
    if (!(await cut.writeKit(path, bytes))) return cutFailure(deps, row, `the ${kind} file couldn't be kept`);
    records[kind] = { kind, path, sha256: sum, seconds: probeMp4(bytes)?.seconds ?? 0, bytes: bytes.length, signed: false, signedAt: null, reason: null, settled: false };
  }
  const written = await mutateCampaign(deps.db, row.id, null, (fresh) =>
    fresh.stage !== "assembling"
      ? { refuse: null }
      : { patch: { renditions: records, stage: "signing", assembly: { ...parseAssembly(fresh.assembly), failures: 0, lastError: null } }, value: null },
  );
  return written.ok ? "cut" : "busy";
}

// ---------------------------------------------------------------------------
// Signing and delivery
// ---------------------------------------------------------------------------

/** ONE step of an ad in `signing`: one file through the signer, else delivery. */
export async function signStep(deps: MachineDeps, row: CampaignRow): Promise<StepResult> {
  const cut = deps.cut;
  if (!cut || !row.plan) return "idle";
  const recs = parseRenditions(row.renditions);
  if (!renditionsComplete(recs)) return cutFailure(deps, row, "the finished files are missing");
  const now = nowOf(deps);

  const pending = RENDITION_KINDS.find((k) => !recs[k].settled);
  if (pending) {
    const rec = recs[pending];
    const bytes = await cut.readKit(rec.path);
    if (!bytes) return cutFailure(deps, row, `the ${pending} file couldn't be read for signing`);
    const signed = await cut.signer.sign(bytes, { title: `Press Tour · ${row.plan.angle}`, kind: pending }).catch(() => ({ signed: false as const, bytes, reason: SIGN_FAILED }));
    let next: RenditionRecord;
    if (signed.signed) {
      const sum = sha256(signed.bytes);
      const path = renditionPath(row.userId, row.id, pending, sum, true);
      if (!(await cut.writeKit(path, signed.bytes))) return cutFailure(deps, row, `the signed ${pending} file couldn't be kept`);
      next = { ...rec, path, sha256: sum, bytes: signed.bytes.length, signed: true, signedAt: now.toISOString(), reason: null, settled: true };
    } else {
      next = { ...rec, signed: false, signedAt: null, reason: signed.reason, settled: true };
      console.warn(`[press-tour] ${row.id} ${pending} rendition delivered unsigned: ${signed.reason}`);
    }
    const written = await mutateCampaign(deps.db, row.id, null, (fresh) => {
      if (fresh.stage !== "signing") return { refuse: null };
      return { patch: { renditions: { ...parseRenditions(fresh.renditions), [pending]: next } }, value: null };
    });
    return written.ok ? "cut" : "busy";
  }
  return deliver(deps, cut, row, recs);
}

async function deliver(deps: MachineDeps, cut: CutDeps, row: CampaignRow, recs: Record<RenditionKind, RenditionRecord>): Promise<StepResult> {
  const now = nowOf(deps);
  const tagged = recs.tagged;
  const masterId = masterRowId(row.id);
  // The finished ad's History row (once): the tagged rendition, 0 credits.
  let exists = false;
  try {
    const { data } = await deps.db.from("generations").select("id").eq("id", masterId).eq("user_id", row.userId).maybeSingle();
    exists = Boolean(data);
  } catch {
    return "unavailable";
  }
  if (!exists) {
    const bytes = await cut.readKit(tagged.path);
    if (!bytes) return cutFailure(deps, row, "the finished ad couldn't be read");
    const url = await cut.keepMaster({ userId: row.userId, campaignId: row.id, sha256: tagged.sha256, bytes });
    if (!url) return cutFailure(deps, row, "the finished ad couldn't be added to History");
    const { error } = await deps.db.from("generations").insert({
      id: masterId,
      user_id: row.userId,
      prompt_input: `Press Tour · ${row.plan?.angle ?? "Ad"}`.slice(0, 200),
      status: "succeeded",
      content_type: "video",
      model_id: CUT_MODEL_ID,
      character_profile_id: row.characterIds[0] ?? null,
      character_profile_ids: row.characterIds,
      result_url: url,
      credits_used: 0,
      free_generation_used: false,
      video_duration_seconds: Math.round(tagged.seconds) || null,
      video_aspect_ratio: "9:16",
      pipeline_log: [],
      press_tour: { campaign_id: row.id, kind: "cut", house: true, trial_id: row.trialId },
    });
    if (error) return cutFailure(deps, row, `the finished ad's History row couldn't be written: ${error.message}`);
  }
  const written = await mutateCampaign(deps.db, row.id, null, (fresh) =>
    fresh.stage !== "signing"
      ? { refuse: null }
      : {
          patch: {
            stage: "ready",
            delivered_at: now.toISOString(),
            cut_due_at: null,
            expires_at: null,
            master_generation_id: masterId,
          },
          value: null,
        },
  );
  if (!written.ok) return "busy";
  if (cut.notify) await cut.notify({ userId: row.userId, key: "adReady", path: adPath(row.id) }).catch(() => undefined);
  // The segments are working files: gone once the ad is delivered (the renditions stay).
  const a = parseAssembly(written.row.assembly);
  const working = [...a.segments.flatMap((s) => [s.clean, s.tagged]), ...(a.endCard ? [a.endCard] : [])];
  if (working.length > 0) {
    await cut.removeKit(working).catch(() => undefined);
    await mutateCampaign(deps.db, row.id, null, (fresh) => ({ patch: { assembly: { ...parseAssembly(fresh.assembly), cleaned: true } }, value: null }));
  }
  return "delivered";
}

// ---------------------------------------------------------------------------
// The 24 h rule
// ---------------------------------------------------------------------------

/**
 * Close every ad whose cut we owed for 24 h: open takes stopped and settled
 * (never sent: forced; held by the lane: the ordinary rules), every other
 * filming charge refunded through the authority by the ordinary rules, the
 * shots left in History, the person told what came back. An ad being
 * worked on right now (a live lease) is left for the next minute.
 */
export async function lateCuts(deps: MachineDeps): Promise<number> {
  const cut = deps.cut;
  const now = nowOf(deps);
  let ids: string[] = [];
  try {
    const { data } = await deps.db
      .from("press_campaigns")
      .select("id")
      .lt("cut_due_at", now.toISOString())
      .in("stage", ["animating", "checking_shots", "assembling", "signing", "awaiting_approval"])
      .is("deleted_at", null)
      .limit(10);
    ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  } catch {
    return 0;
  }
  let closedCount = 0;
  for (const id of ids) {
    const row = await readCampaign(deps.db, id, null);
    if (!row || row === "unavailable" || isTerminal(row.stage) || row.stage === "ready") continue;
    if (row.lockedAt && now.getTime() - Date.parse(row.lockedAt) < LEASE_MS) continue;
    const nowIso = now.toISOString();
    const closed = await mutateCampaign(deps.db, id, null, (fresh) => {
      if (isTerminal(fresh.stage) || fresh.stage === "ready" || !fresh.cutDueAt || fresh.cutDueAt >= nowIso) return { refuse: null };
      // Claimed since the read above (a step is delivering or collecting right now): the next minute decides (MONEY-6).
      if (fresh.lockedAt && now.getTime() - Date.parse(fresh.lockedAt) < LEASE_MS) return { refuse: null };
      const open = openTakes(fresh.shots).map((t) => t.take);
      const openIds = new Set(open.map((t) => t.rowId));
      return {
        patch: {
          stage: "failed",
          error: CUT_LATE,
          stills: closeAttempts(fresh.stills, CUT_LATE, nowIso),
          shots: closeOpenTakes(fresh.shots, CUT_LATE, nowIso),
          cut_due_at: null,
          locked_at: null,
        },
        value: { open, held: filmCreditsHeld(fresh.shots).filter((h) => !openIds.has(h.rowId)) },
      };
    });
    if (!closed.ok || !closed.value) continue;
    closedCount += 1;
    const reason = "The ad wasn't finished within a day.";
    const released = await releaseTakes(deps, row.userId, closed.value.open, reason);
    let back = released.credits;
    const rowIds = [...released.rowIds];
    for (const held of closed.value.held) {
      const ok = cut ? await cut.refund(held.rowId, {}).catch(() => false) : false;
      if (ok) {
        back += held.credits;
        rowIds.push(held.rowId);
      }
    }
    await mutateCampaign(deps.db, id, null, (fresh) => ({
      patch: {
        credits_refunded: fresh.creditsRefunded + back,
        shots: withTakesRefunded(fresh.shots, rowIds),
        error: back > 0 ? cutLateRefunded(back) : CUT_LATE,
      },
      value: null,
    }));
    await deps
      .notifyAdmins({ title: "Press Tour ad late", body: `Campaign ${id.slice(0, 8)} wasn't delivered within 24 h; ${back} filming credits went back.`, path: "#system" })
      .catch(() => undefined);
    // "What came back" only when something did (PT-R3-04).
    if (cut?.notify) await cut.notify({ userId: row.userId, key: back > 0 ? "adFailedRefunded" : "adFailed", path: adPath(id) }).catch(() => undefined);
  }
  return closedCount;
}
