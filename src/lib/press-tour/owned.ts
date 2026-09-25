import type { SupabaseClient } from "@supabase/supabase-js";

// Is every id and file a request names the caller's own? (critique #8.)
//
// Press Tour's rows are written by the SERVICE ROLE, which RLS does not
// stop, and its ids arrive from places the caller controls: a form, a
// Producer tool call, an MCP host, a queued job. Another person's
// character_id would be a deepfake ad of a stranger; another person's
// connection_id would post to their account. So every server action, tool
// and worker entry calls assertOwned(userId, refs, db) BEFORE it reads,
// writes or spends, and a posting worker calls it again for connection_id at
// send time (a connection can be removed between scheduling and sending).
//
// One answer for "not there" and "not yours" (NOT_YOURS), so a guessed id
// learns nothing. A failed read is never a yes (OWNERSHIP_UNAVAILABLE).
// Works with the service-role client or the person's own one: the owner
// filter is explicit either way.
//
// Alias-free (vitest has no '@/'): owned.test.ts imports it as it is.

export const NOT_YOURS = "We couldn't find that in your account.";
export const OWNERSHIP_UNAVAILABLE = "We couldn't check that just now. Try again in a moment.";

/**
 * What each kind of id points at. `softDelete`: the table keeps deleted rows
 * with deleted_at set, and a deleted row is no longer anyone's to use.
 * press_campaigns (Cut 2) and social_connections (Cut 5) are named now so
 * every entry point checks through this one list; until their SQL runs, a
 * check that names them fails closed.
 */
export const OWNED_TABLES = {
  product: { table: "products", softDelete: true },
  brandKit: { table: "brand_kits", softDelete: true },
  character: { table: "character_profiles", softDelete: false },
  generation: { table: "generations", softDelete: true },
  campaign: { table: "press_campaigns", softDelete: true },
  connection: { table: "social_connections", softDelete: false },
} as const;
export type OwnedKind = keyof typeof OWNED_TABLES;
const KINDS = Object.keys(OWNED_TABLES) as OwnedKind[];

/** At most this many ids of one kind in one check (a 30 s ad has 6 shots; a request naming more is not one of ours). */
export const MAX_IDS_PER_KIND = 64;

type Ids = string | null | undefined | readonly (string | null | undefined)[];

/**
 * The ids and storage paths a request names. null / undefined means "not
 * given" and is skipped; anything given must be the caller's own.
 */
export type OwnedRefs = Partial<Record<OwnedKind, Ids>> & {
  /** Storage paths (any bucket): each must sit under the caller's own folder. */
  paths?: Ids;
};

export type OwnedCheck =
  | { ok: true; error: null; code: null; kind: null }
  | { ok: false; error: string; code: "notFound" | "unavailable"; kind: OwnedKind | "paths" | "user" };

export class NotOwnedError extends Error {
  readonly code: "notFound" | "unavailable";
  readonly kind: OwnedKind | "paths" | "user";
  constructor(code: "notFound" | "unavailable", kind: OwnedKind | "paths" | "user") {
    super(code === "notFound" ? NOT_YOURS : OWNERSHIP_UNAVAILABLE);
    this.name = "NotOwnedError";
    this.code = code;
    this.kind = kind;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OK: OwnedCheck = { ok: true, error: null, code: null, kind: null };
const notFound = (kind: OwnedKind | "paths" | "user"): OwnedCheck => ({ ok: false, error: NOT_YOURS, code: "notFound", kind });
const unavailable = (kind: OwnedKind): OwnedCheck => ({ ok: false, error: OWNERSHIP_UNAVAILABLE, code: "unavailable", kind });

function listOf(v: Ids): unknown[] {
  if (v === null || v === undefined) return [];
  return typeof v === "string" ? [v] : Array.isArray(v) ? [...v] : [v];
}

/**
 * Pure: a storage path under the owner's own folder, the rule the SQL
 * guards and core.ts assertOwnedPath hold: "<userId>/...", no "..", no
 * backslash, no empty segment, at most 512 characters.
 */
export function pathOwned(userId: string, path: unknown): boolean {
  if (typeof path !== "string" || !UUID_RE.test(userId)) return false;
  const prefix = `${userId.toLowerCase()}/`;
  if (!path.startsWith(prefix) || path.length <= prefix.length || path.length > 512) return false;
  if (path.includes("..") || path.includes("\\") || path.includes("//") || /[\u0000-\u001f]/.test(path)) return false;
  return true;
}

/**
 * The same check without throwing, for server actions that answer
 * `{ error }`. Every id is compared case-blind (Postgres prints uuids in
 * lowercase); ids that are not uuids are refused without a read.
 */
export async function checkOwned(userId: string, refs: OwnedRefs, db: SupabaseClient): Promise<OwnedCheck> {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) return notFound("user");
  const owner = userId.toLowerCase();

  for (const p of listOf(refs.paths)) {
    if (p === null || p === undefined) continue;
    if (!pathOwned(owner, p)) return notFound("paths");
  }

  const wanted: { kind: OwnedKind; ids: string[] }[] = [];
  for (const kind of KINDS) {
    const ids: string[] = [];
    for (const raw of listOf(refs[kind])) {
      if (raw === null || raw === undefined) continue;
      if (typeof raw !== "string" || !UUID_RE.test(raw)) return notFound(kind);
      const id = raw.toLowerCase();
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length > MAX_IDS_PER_KIND) return notFound(kind);
    if (ids.length > 0) wanted.push({ kind, ids });
  }

  const results = await Promise.all(wanted.map(({ kind, ids }) => ownsAll(db, owner, kind, ids)));
  // A definite "not yours" outranks a failed read, in the fixed kind order.
  return results.find((r) => r.code === "notFound") ?? results.find((r) => !r.ok) ?? OK;
}

async function ownsAll(db: SupabaseClient, owner: string, kind: OwnedKind, ids: string[]): Promise<OwnedCheck> {
  const { table, softDelete } = OWNED_TABLES[kind];
  try {
    let query = db.from(table).select("id").eq("user_id", owner).in("id", ids);
    if (softDelete) query = query.is("deleted_at", null);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return unavailable(kind);
    const found = new Set<string>();
    for (const row of data as unknown[]) {
      const id = row && typeof row === "object" ? (row as { id?: unknown }).id : null;
      if (typeof id === "string") found.add(id.toLowerCase());
    }
    return ids.every((id) => found.has(id)) ? OK : notFound(kind);
  } catch {
    return unavailable(kind);
  }
}

/**
 * Throws NotOwnedError (message: NOT_YOURS or OWNERSHIP_UNAVAILABLE, both
 * English constants the surfaces map) unless every id and path in `refs` is
 * the caller's own. Call it before any read, write or spend.
 */
export async function assertOwned(userId: string, refs: OwnedRefs, db: SupabaseClient): Promise<void> {
  const check = await checkOwned(userId, refs, db);
  if (!check.ok) throw new NotOwnedError(check.code, check.kind);
}
