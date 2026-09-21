import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { listSetReferences } from "@/lib/sets/references";
import { mediaUrl, thumbUrl, toMediaUrl } from "@/lib/media/url";
import { monthlyWindowStart } from "@/lib/generations/core";
import { DEFAULT_IDENTITY_THRESHOLD, resolveIdentityThresholdSetting } from "@/lib/generations/identity-gate";

import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { isPhotoSetsEnabled } from "@/lib/sets/enabled";
import { readPhotoSources } from "@/lib/sets/photo";
import {
  isCurrentSetThumb,
  setEditsMonthlyLimit,
  SETS_LIST_LIMIT,
  SET_EDITS_MONTH_SCOPE,
  SET_RESERVED_BRIEF, setTakesEligible } from "@/lib/sets/set-config";
import { readShotCameras } from "@/lib/sets/shot-camera";
import { readShotWords } from "@/lib/sets/shot-words-store";
import { seesLookObjects } from "@/lib/sets/look-cutout";
import { normaliseSetLayout, normaliseSetSpec, type SetSpec } from "@/lib/sets/set-spec";
import { normaliseSetFilm, type SetFilm } from "@/lib/sets/film";
import { normaliseSetRig, RIG_CHECK_ITEMS, type SetRig } from "@/lib/sets/rig";
import { readShotRigs } from "@/lib/sets/shot-rig";
import { readShotTakes, takeSourceOf } from "@/lib/sets/shot-take";
import { readSetShotIds } from "@/lib/sets/set-shots";
import { SET_NOT_FOUND, setFailureMessage } from "@/lib/sets/messages";
import type { SetCharacter, SetPageData, SetShot, SetsHomeData, SetStatus, SetSummary } from "@/lib/sets/types";

// A photo build's brief column holds the photographer's notes, or this
// placeholder when there were none — never shown.
const RESERVED = SET_RESERVED_BRIEF;

// The Sets pages' reads (2026-09-10). Server-only; every read runs as the
// signed-in person, so row-level security is a second owner check behind
// the explicit user_id filter. A spec read back from the database goes
// through normaliseSetSpec again — the trust boundary holds on every read,
// not only on the write.

const asStatus = (s: unknown): SetStatus => (s === "ready" || s === "failed" ? s : "building");

/**
 * The person's characters that can be shot: only those with a saved photo,
 * since the photo is the identity the image lane scores against, and a set
 * never supplies one. The home's composer and a set's page both read them.
 */
async function shootableCharacters(db: SupabaseClient, userId: string): Promise<SetCharacter[]> {
  const { data: chars } = await db
    .from("character_profiles")
    .select("id, name, reference_image_urls")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (chars ?? [])
    .filter((c) => Array.isArray(c.reference_image_urls) && c.reference_image_urls.length > 0)
    .map((c) => ({
      id: c.id as string,
      name: (c.name as string) ?? "",
      thumbUrl: thumbUrl(mediaUrl("character-references", (c.reference_image_urls as string[])[0]), 320),
    }));
}

/**
 * Builds this billing month: every row that did not fail, DELETED ONES
 * INCLUDED — a deleted build was still paid for, and a count that forgot it
 * would hand the build back. That is why this reads with the service role:
 * the owner's own view hides deleted rows. `upTo` counts only rows created
 * up to that moment, which is how a reservation learns its place in line.
 * Null when the count cannot be read: the cap must fail closed, not read a
 * failed query as "none used".
 */
export async function countSetBuildsThisMonth(
  userId: string,
  periodStart: string | null,
  upTo?: string,
): Promise<number | null> {
  const since = monthlyWindowStart(periodStart).toISOString();
  let query = createAdminClient()
    .from("location_sets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("status", "failed")
    .gte("created_at", since);
  if (upTo) query = query.lte("created_at", upTo);
  const { count, error } = await query;
  if (error) {
    console.error("countSetBuildsThisMonth failed:", error.message);
    return null;
  }
  return count ?? 0;
}

/**
 * Astra changes asked for this billing month: the limiter's own record of
 * them (editor-actions.ts counts each in SET_EDITS_MONTH_SCOPE), read with
 * the service role since the person cannot read it. Null when it cannot be
 * read — then nothing is shown, and the action still holds the cap.
 */
export async function countAstraEditsThisMonth(userId: string, periodStart: string | null): Promise<number | null> {
  const { count, error } = await createAdminClient()
    .from("api_rate_hits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("scope", SET_EDITS_MONTH_SCOPE)
    .gte("created_at", monthlyWindowStart(periodStart).toISOString());
  if (error) {
    console.warn("countAstraEditsThisMonth failed:", error.message);
    return null;
  }
  return count ?? 0;
}

/** What the editor shows of the month's Astra changes: how many are left, or null for no cap (admins) or no count. */
export async function astraEditsLeft(access: { userId: string; plan: string; isAdmin: boolean; periodStart: string | null }): Promise<number | null> {
  const cap = setEditsMonthlyLimit(access.plan, access.isAdmin);
  if (cap < 0) return null;
  const used = await countAstraEditsThisMonth(access.userId, access.periodStart);
  return used === null ? null : Math.max(0, cap - used);
}

export async function getSetsHome(): Promise<SetsHomeData> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { data: rows, error } = await access.supabase
    .from("location_sets")
    .select("id, title, brief, status, failure, thumb_path, created_at")
    .eq("user_id", access.userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(SETS_LIST_LIMIT);
  if (error) {
    // The table arrives with supabase/applied/2026-09-10/astra-sets.sql, and
    // the switch that opens this page arrives in the same file — so this is
    // an outage, not an ordering problem.
    console.error("getSetsHome failed:", error.message);
  }
  // Which of them were built from a photo: a read of its own, so the list
  // above never names a column that may not exist yet (photo.ts). A read
  // that fails shows them as text sets for this one load; only the wording
  // of a card depends on it.
  const photos = (
    await readPhotoSources(
      access.supabase,
      (rows ?? []).map((r) => r.id as string),
      access.userId,
    )
  ).sources;
  // The stills shot in these sets, for the dashboard (2026-09-14): how many
  // in each, when the last one was, and how many this billing month. One
  // read of the shot rows' dates, counted here; a read that fails shows
  // zeros for this one load, never an error.
  const shotsBySet = new Map<string, { count: number; last: string | null }>();
  let shotsThisMonth = 0;
  const ids = (rows ?? []).map((r) => r.id as string);
  if (ids.length > 0) {
    const since = monthlyWindowStart(access.periodStart).toISOString();
    const { data: shotRows, error: shotsError } = await access.supabase
      .from("location_set_shots")
      .select("set_id, created_at")
      .eq("user_id", access.userId)
      .in("set_id", ids)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (shotsError) console.error("getSetsHome could not count the stills:", shotsError.message);
    for (const shot of (shotRows ?? []) as { set_id: unknown; created_at: unknown }[]) {
      if (typeof shot.set_id !== "string" || typeof shot.created_at !== "string") continue;
      const so = shotsBySet.get(shot.set_id) ?? { count: 0, last: null };
      so.count += 1;
      // Newest first, so the first seen is the last shot.
      if (!so.last) so.last = shot.created_at;
      shotsBySet.set(shot.set_id, so);
      if (shot.created_at >= since) shotsThisMonth += 1;
    }
  }
  const sets: SetSummary[] = (rows ?? []).map((r) => {
    const status = asStatus(r.status);
    const fromPhoto = photos.has(r.id as string);
    const brief = (r.brief as string) ?? "";
    const shots = shotsBySet.get(r.id as string);
    return {
      id: r.id as string,
      title: (r.title as string) ?? "",
      brief: fromPhoto && brief === RESERVED ? "" : brief,
      status,
      createdAt: r.created_at as string,
      thumbUrl: r.thumb_path ? thumbUrl(mediaUrl("generated-images", r.thumb_path as string), 640) : null,
      failure: status === "failed" ? setFailureMessage(r.failure as string | null, fromPhoto ? "photo" : "text") : null,
      fromPhoto,
      shots: shots?.count ?? 0,
      lastShotAt: shots?.last ?? null,
    };
  });
  return {
    error: null,
    sets,
    usedThisMonth: (await countSetBuildsThisMonth(access.userId, access.periodStart)) ?? 0,
    monthlyLimit: access.monthlyLimit,
    shotsThisMonth,
    photoSetsOn: access.isAdmin && (await isPhotoSetsEnabled(access.supabase)),
    characters: await shootableCharacters(access.supabase, access.userId),
  };
}

export async function getSetPage(setId: string): Promise<SetPageData> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const db = access.supabase;

  const { data: row } = await db
    .from("location_sets")
    .select("id, title, description, brief, status, failure, spec, layout, thumb_path")
    .eq("id", setId)
    .eq("user_id", access.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return { error: SET_NOT_FOUND };

  const status = asStatus(row.status);
  const normalised = status === "ready" && row.spec ? normaliseSetSpec(row.spec) : null;
  const spec = normalised?.ok ? normalised.spec : null;
  // The owner's working copy (the Set Editor, 2026-09-14): read on its own,
  // so the read above never names a column that may not exist yet
  // (supabase/applied/2026-09-14/set-editor.sql, run in production 2026-09-14). A read that fails opens the set as
  // built, for this one load.
  let editedSpec: SetSpec | null = null;
  if (spec) {
    const { data: editedRow, error: editedError } = await db
      .from("location_sets")
      .select("edited_spec")
      .eq("id", setId)
      .eq("user_id", access.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (editedError) console.warn("getSetPage could not read the working copy:", editedError.message);
    else if (editedRow?.edited_spec) {
      const edited = normaliseSetSpec(editedRow.edited_spec);
      if (edited.ok) editedSpec = edited.spec;
    }
  }
  // The saved move (Helios Film, 2026-09-15): its own read for the same
  // reason as the working copy's — supabase/applied/2026-09-15/helios-film.sql
  // (run in production 2026-09-15); a read that fails opens without the move.
  let film: SetFilm | null = null;
  if (spec) {
    const { data: filmRow, error: filmError } = await db
      .from("location_sets")
      .select("film")
      .eq("id", setId)
      .eq("user_id", access.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (filmError) console.warn("getSetPage could not read the film:", filmError.message);
    else if (filmRow?.film) film = normaliseSetFilm(filmRow.film);
  }
  // The saved rig (Helios Cinema, 2026-09-15): its own read, for the same
  // reason as the film's — supabase/applied/2026-09-15/helios-rig.sql (run in
  // production 2026-09-15); a read that fails opens with the default rig.
  let rig: SetRig | null = null;
  if (spec) {
    const { data: rigRow, error: rigError } = await db
      .from("location_sets")
      .select("rig")
      .eq("id", setId)
      .eq("user_id", access.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (rigError) console.warn("getSetPage could not read the rig:", rigError.message);
    else if (rigRow?.rig) rig = normaliseSetRig(rigRow.rig);
  }
  // What the page actually draws — and what the layout and the look are
  // held against.
  const drawn = editedSpec ?? spec;
  const layout = drawn && row.layout ? normaliseSetLayout(row.layout, drawn) : null;
  // Built from a photo? Read on its own, as the person (their SELECT on the
  // table covers every column), so the read above stays exactly as it was.
  // A read that fails shows it as a text set for this one load.
  const photo = (await readPhotoSources(db, [setId], access.userId)).sources.get(setId) ?? null;
  const fromPhoto = photo !== null;
  const brief = (row.brief as string) ?? "";

  const characters = await shootableCharacters(db, access.userId);

  // The newest shots, and the film's own however old (set-shots.ts).
  const ids = await readSetShotIds(db, setId, access.userId, film);
  let shots: SetShot[] = [];
  if (ids.length > 0) {
    const { data: gens } = await db
      .from("generations")
      .select("id, status, result_url, poster_url, content_type, video_duration_seconds, match_score, created_at, character_profile_id")
      .in("id", ids)
      .eq("user_id", access.userId)
      .is("deleted_at", null);
    // Which of them had their frame recorded: a read of its own, so the
    // list above never names a column that may not exist yet
    // (shot-camera.ts). A read that fails shows no still as a possible look
    // for this one load; the contact sheet is otherwise the same.
    const cameras = await readShotCameras(db, setId, access.userId, ids);
    // What each was asked for, in the person's words (shot-words-store.ts):
    // a read of its own for the same reason; a read that fails shows
    // "Shoot" above every still for this one load.
    const words = await readShotWords(db, setId, access.userId, ids);
    // The rig each was shot with and its check (shot-rig.ts): a read of its
    // own again; a read that fails shows every shot square and unchecked.
    const rigs = await readShotRigs(db, setId, access.userId, ids);
    // What each take not yet in was rendered from (shot-take.ts), so a clip
    // that failed on an earlier visit can be rendered again between the
    // same two stills: a read of its own again, and a read that fails
    // offers nothing, as before. Offered only while both stills are still
    // finished and the person can still be shot — takeInSet checks the
    // stills again when asked.
    const takes = await readShotTakes(
      db,
      setId,
      access.userId,
      (gens ?? []).filter((g) => g.content_type === "video" && g.status !== "succeeded").map((g) => g.id as string),
    );
    const frameIds = [...new Set([...takes.values()].filter((tk) => !tk.film).flatMap((tk) => [tk.start, tk.end]))];
    const finished = new Set<string>();
    if (frameIds.length > 0) {
      const { data: stills, error: stillsError } = await db
        .from("generations")
        .select("id")
        .in("id", frameIds)
        .eq("user_id", access.userId)
        .eq("status", "succeeded")
        .eq("content_type", "image")
        .is("deleted_at", null);
      if (stillsError) console.warn("getSetPage could not read the takes' stills:", stillsError.message);
      for (const still of stills ?? []) finished.add(still.id as string);
    }
    const canShoot = (id: string) => characters.some((c) => c.id === id);
    // A still is offered as a look only when there is something to cut out
    // of it clear of its person: a camera that saw only structure, or a
    // figure out of frame, would fail every shot that took it. The answer
    // rests on the set and the camera alone, so it is worked out here, per
    // load (a few milliseconds for a full contact sheet).
    const lendsLook = (id: string) => {
      const camera = cameras.get(id);
      // Against the set as drawn (the working copy where there is one), as
      // the shot itself is: `spec` would offer a look cut from objects the
      // Build editor has moved or removed (2026-09-17).
      return Boolean(drawn && camera && seesLookObjects(drawn, camera));
    };
    const byId = new Map((gens ?? []).map((g) => [g.id as string, g]));
    shots = ids
      .map((id) => byId.get(id))
      .filter((g): g is NonNullable<typeof g> => Boolean(g))
      .map((g) => {
        // A take is a video row among the shots (take.ts): its result is the
        // clip itself, watched raw, with the poster as its picture. Every
        // stored media link is signed again under today's key (toMediaUrl),
        // as every other page does: a stored one carries the key it was
        // written under, and would stop loading once that key is changed.
        const isTake = g.content_type === "video";
        const stored = toMediaUrl(g.result_url as string | null);
        return {
          generationId: g.id as string,
          status: g.status as string,
          resultUrl: isTake ? stored : thumbUrl(stored, 640),
          viewUrl: isTake ? null : thumbUrl(stored, 1600),
          posterUrl: isTake ? thumbUrl(toMediaUrl(g.poster_url as string | null), 640) : null,
          kind: (isTake ? "take" : "still") as "still" | "take",
          // Takes come in engine lengths since the second engine (take.ts),
          // so the caption reads the row rather than assuming one number.
          seconds: isTake && typeof g.video_duration_seconds === "number" ? g.video_duration_seconds : null,
          score: typeof g.match_score === "number" ? g.match_score : null,
          createdAt: g.created_at as string,
          hasLookObjects: lendsLook(g.id as string),
          words: words.get(g.id as string) ?? null,
          format: rigs.get(g.id as string)?.rig?.format ?? "square",
          squeeze: rigs.get(g.id as string)?.rig?.squeeze ?? 1,
          rigAsked: RIG_CHECK_ITEMS.filter((item) => Boolean(rigs.get(g.id as string)?.rig?.words[item])),
          rigCheck: rigs.get(g.id as string)?.check ?? null,
          pose: (() => {
            const c = cameras.get(g.id as string);
            return c ? { position: c.position, target: c.target, fovDeg: c.fovDeg } : null;
          })(),
          takeFrom: isTake ? takeSourceOf(takes.get(g.id as string), g.character_profile_id, canShoot, finished) : null,
          characterId: typeof g.character_profile_id === "string" ? g.character_profile_id : null,
        };
      });
  }

  // The bar the contact sheet flags a still against: the identity gate's
  // live threshold, or its default while the gate is off (0) — a score is
  // worth reading whether or not the gate acts on it.
  const { data: gateSetting } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "identity_gate_threshold")
    .maybeSingle();
  const threshold = resolveIdentityThresholdSetting(gateSetting);
  const identityBar = threshold > 0 ? threshold : DEFAULT_IDENTITY_THRESHOLD;

  return {
    error: null,
    identityBar,
    // Match this shot rides the photo switch (docs 3.2), admins only; the
    // page hides the chip otherwise, and matchSetShot checks both again.
    matchOn: access.isAdmin && (await isPhotoSetsEnabled(access.supabase)),
    // Takes and films: every paid plan since 2026-09-19 ("Open to all
    // plans", set-config.ts); the page says so before a take is framed, and
    // takeInSet checks again.
    takesOn: setTakesEligible(access.plan, access.isAdmin),
    // The month's Astra changes left (set-config.ts SET_EDITS_MONTHLY_LIMITS),
    // shown in the editor's prompt bar; the action holds the cap.
    astraEditsLeft: spec ? await astraEditsLeft(access) : null,
    // The person's reference photos (2026-09-21): the folder is the list, read
    // with the service client inside the person's own folder only.
    references: status === "ready" ? await listSetReferences(createAdminClient(), access.userId, row.id as string) : [],
    set: {
      id: row.id as string,
      title: (row.title as string) ?? "",
      description: (row.description as string) ?? "",
      brief: fromPhoto && brief === RESERVED ? "" : brief,
      status,
      failure: status === "failed" ? setFailureMessage(row.failure as string | null, fromPhoto ? "photo" : "text") : null,
      spec,
      editedSpec,
      film,
      rig,
      layout,
      hasThumb: isCurrentSetThumb(row.thumb_path, access.userId, row.id as string),
      fromPhoto,
      // Only a ready set shows it: a failed build's photo has been removed.
      sourcePhotoUrl: photo && status === "ready" ? thumbUrl(mediaUrl("generated-images", photo.path), 1600) : null,
    },
    shots,
    characters,
  };
}
