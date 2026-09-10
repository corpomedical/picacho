import { createAdminClient } from "@/lib/supabase/server";
import { mediaUrl, thumbUrl } from "@/lib/media/url";
import { monthlyWindowStart } from "@/lib/generations/core";
import { DEFAULT_IDENTITY_THRESHOLD, resolveIdentityThresholdSetting } from "@/lib/generations/identity-gate";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { SETS_LIST_LIMIT, SET_SHOTS_LIMIT } from "@/lib/sets/set-config";
import { normaliseSetLayout, normaliseSetSpec } from "@/lib/sets/set-spec";
import { SET_NOT_FOUND, setFailureMessage } from "@/lib/sets/messages";
import type { SetCharacter, SetPageData, SetShot, SetsHomeData, SetStatus, SetSummary } from "@/lib/sets/types";

// The Sets pages' reads (2026-09-10). Server-only; every read runs as the
// signed-in person, so row-level security is a second owner check behind
// the explicit user_id filter. A spec read back from the database goes
// through normaliseSetSpec again — the trust boundary holds on every read,
// not only on the write.

const asStatus = (s: unknown): SetStatus => (s === "ready" || s === "failed" ? s : "building");

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
  const sets: SetSummary[] = (rows ?? []).map((r) => {
    const status = asStatus(r.status);
    return {
      id: r.id as string,
      title: (r.title as string) ?? "",
      brief: (r.brief as string) ?? "",
      status,
      createdAt: r.created_at as string,
      thumbUrl: r.thumb_path ? thumbUrl(mediaUrl("generated-images", r.thumb_path as string), 640) : null,
      failure: status === "failed" ? setFailureMessage(r.failure as string | null) : null,
    };
  });
  return {
    error: null,
    sets,
    usedThisMonth: (await countSetBuildsThisMonth(access.userId, access.periodStart)) ?? 0,
    monthlyLimit: access.monthlyLimit,
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
  const layout = spec && row.layout ? normaliseSetLayout(row.layout, spec) : null;

  const { data: shotRows } = await db
    .from("location_set_shots")
    .select("generation_id, created_at")
    .eq("set_id", setId)
    .eq("user_id", access.userId)
    .order("created_at", { ascending: false })
    .limit(SET_SHOTS_LIMIT);
  const ids = (shotRows ?? []).map((s) => s.generation_id as string);
  let shots: SetShot[] = [];
  if (ids.length > 0) {
    const { data: gens } = await db
      .from("generations")
      .select("id, status, result_url, match_score, created_at")
      .in("id", ids)
      .eq("user_id", access.userId)
      .is("deleted_at", null);
    const byId = new Map((gens ?? []).map((g) => [g.id as string, g]));
    shots = ids
      .map((id) => byId.get(id))
      .filter((g): g is NonNullable<typeof g> => Boolean(g))
      .map((g) => ({
        generationId: g.id as string,
        status: g.status as string,
        resultUrl: thumbUrl(g.result_url as string | null, 640),
        score: typeof g.match_score === "number" ? g.match_score : null,
        createdAt: g.created_at as string,
      }));
  }

  // Only characters with a saved photo can be shot: the photo is the
  // identity the image lane scores against, and the set never supplies one.
  const { data: chars } = await db
    .from("character_profiles")
    .select("id, name, reference_image_urls")
    .eq("user_id", access.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  const characters: SetCharacter[] = (chars ?? [])
    .filter((c) => Array.isArray(c.reference_image_urls) && c.reference_image_urls.length > 0)
    .map((c) => ({
      id: c.id as string,
      name: (c.name as string) ?? "",
      thumbUrl: thumbUrl(mediaUrl("character-references", (c.reference_image_urls as string[])[0]), 320),
    }));

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
    set: {
      id: row.id as string,
      title: (row.title as string) ?? "",
      description: (row.description as string) ?? "",
      brief: (row.brief as string) ?? "",
      status,
      failure: status === "failed" ? setFailureMessage(row.failure as string | null) : null,
      spec,
      layout,
      hasThumb: Boolean(row.thumb_path),
    },
    shots,
    characters,
  };
}
