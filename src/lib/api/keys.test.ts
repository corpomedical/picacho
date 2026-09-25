import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Revoking a key, and the refusals a key can meet (Press Tour cut 0,
// 2026-09-25; critique #3).
//
// revokeApiKey updated revoked_at through the person's cookie client and read
// only `error`. RLS filters an UPDATE it does not allow down to zero rows,
// which is not an error, so the day the api_keys "Update own" policy is
// dropped every revoke would have answered "done" while the key kept
// working. The write now goes through the service role, filtered to the
// person's own key, and counts the rows it changed.
//
// keys.ts schedules its last_used_at stamp with next/server's after(), which
// needs a request scope; actions.ts reaches the database and the session
// through "@/", which this suite does not resolve. Both are stood in for.

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

type KeyRow = { id: string; user_id: string; key_hash: string; revoked_at: string | null };
type ProfileRow = { id: string; plan: string; role: string | null; status: string | null; api_access: boolean };

const db = {
  keys: [] as KeyRow[],
  profiles: [] as ProfileRow[],
  failWrites: false,
  // What each client was asked to do, so a test can prove which one wrote.
  adminCalls: [] as string[],
  cookieCalls: [] as string[],
};

/**
 * The service-role client, over api_keys and profiles: eq/is filters, an
 * UPDATE that returns the rows it changed when asked to (.select), and the
 * reads keys.ts makes. No RLS — which is the point of the fix: the filter on
 * user_id is the only thing between one account's keys and another's.
 */
function adminClient() {
  return {
    from(table: string) {
      const filters: [string, "eq" | "is", unknown][] = [];
      let patch: Record<string, unknown> | null = null;
      const rows = (): Record<string, unknown>[] =>
        ((table === "api_keys" ? db.keys : db.profiles) as unknown as Record<string, unknown>[]).filter((r) =>
          filters.every(([col, , v]) => (r[col] ?? null) === v),
        );
      const settle = () => {
        if (patch) {
          db.adminCalls.push(`${table}.update(${Object.keys(patch).join(",")})`);
          if (db.failWrites) return { data: null, error: { message: "canceling statement due to statement timeout" } };
          const changed = rows();
          for (const r of changed) Object.assign(r, patch);
          return { data: changed.map((r) => ({ id: r.id })), error: null };
        }
        db.adminCalls.push(`${table}.select`);
        return { data: rows().map((r) => ({ ...r })), error: null };
      };
      const b = {
        select: () => b,
        update(values: Record<string, unknown>) {
          patch = values;
          return b;
        },
        eq(col: string, v: unknown) {
          filters.push([col, "eq", v]);
          return b;
        },
        is(col: string, v: unknown) {
          filters.push([col, "is", v]);
          return b;
        },
        async maybeSingle() {
          const { data, error } = settle();
          return { data: data?.[0] ?? null, error };
        },
        async single() {
          const { data, error } = settle();
          return data?.length === 1 ? { data: data[0], error } : { data: null, error: { message: "0 rows" } };
        },
        then(resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(settle()).then(resolve, reject);
        },
      };
      return b;
    },
  };
}

const session = { userId: "user-a" as string | null };

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => adminClient(),
  // The person's cookie client: it says who they are, and records anything
  // else it is asked to do — a revoke must not write through it.
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: session.userId ? { id: session.userId } : null } }) },
    from: (table: string) => {
      db.cookieCalls.push(table);
      throw new Error(`the cookie client was used for ${table}`);
    },
  }),
}));
vi.mock("@/lib/api/keys", async () => await import("./keys"));

import { revokeApiKey } from "./actions";
import { API_ACCESS_OFF, authenticateApiRequest, hashApiKey, revokeOwnApiKey } from "./keys";

const KEY_A = "0b8f6a52-6a0e-4d51-9c1e-4c1b8f0e2a11";
const KEY_B = "5d0f8c3e-2b7a-4c11-8e9d-0a1b2c3d4e5f";
const REVOKED_AT = "2026-09-01T10:00:00.000Z";
const NOW = new Date("2026-09-25T12:00:00.000Z");

const admin = () => adminClient() as unknown as SupabaseClient;

beforeEach(() => {
  db.keys = [
    { id: KEY_A, user_id: "user-a", key_hash: hashApiKey("pic_live_a"), revoked_at: null },
    { id: KEY_B, user_id: "user-b", key_hash: hashApiKey("pic_live_b"), revoked_at: null },
  ];
  db.profiles = [
    { id: "user-a", plan: "elite", role: null, status: null, api_access: false },
    { id: "user-b", plan: "starter", role: null, status: null, api_access: false },
  ];
  db.failWrites = false;
  db.adminCalls = [];
  db.cookieCalls = [];
  session.userId = "user-a";
});

describe("revokeOwnApiKey", () => {
  it("revokes the person's own live key, and says so only because a row changed", async () => {
    expect(await revokeOwnApiKey(admin(), "user-a", KEY_A, NOW)).toBe("revoked");
    expect(db.keys[0].revoked_at).toBe(NOW.toISOString());
  });

  it("SECURITY: never touches another person's key, and says it isn't theirs", async () => {
    expect(await revokeOwnApiKey(admin(), "user-a", KEY_B, NOW)).toBe("not_found");
    expect(db.keys[1].revoked_at).toBeNull();
  });

  it("a key already revoked is done, and keeps the time it was first revoked", async () => {
    // Revoked, not deleted: "which key did that, and since when?" stays answerable.
    db.keys[0].revoked_at = REVOKED_AT;
    expect(await revokeOwnApiKey(admin(), "user-a", KEY_A, NOW)).toBe("already_revoked");
    expect(db.keys[0].revoked_at).toBe(REVOKED_AT);
  });

  it("REGRESSION: a write that errors is a failure, not a quiet 'done'", async () => {
    db.failWrites = true;
    expect(await revokeOwnApiKey(admin(), "user-a", KEY_A, NOW)).toBe("failed");
    expect(db.keys[0].revoked_at).toBeNull();
  });

  it("REGRESSION: zero rows changed on a key that is still live is a failure", async () => {
    // What RLS does to an UPDATE it does not allow: no error, no rows. The
    // old action answered { error: null } here and the key kept working.
    const blind = {
      from: (table: string) => {
        const real = adminClient().from(table);
        return {
          ...real,
          update: () => ({
            eq: () => ({ eq: () => ({ is: () => ({ select: async () => ({ data: [], error: null }) }) }) }),
          }),
        };
      },
    } as unknown as SupabaseClient;
    expect(await revokeOwnApiKey(blind, "user-a", KEY_A, NOW)).toBe("failed");
  });

  it("an id that is not a uuid is nobody's key, without asking the database", async () => {
    expect(await revokeOwnApiKey(admin(), "user-a", "not-a-uuid", NOW)).toBe("not_found");
    expect(db.adminCalls).toEqual([]);
  });
});

describe("revokeApiKey (the Settings action)", () => {
  const form = (id: string) => {
    const f = new FormData();
    f.set("id", id);
    return f;
  };

  it("writes through the service role, never the cookie client", async () => {
    expect(await revokeApiKey(form(KEY_A))).toEqual({ error: null });
    expect(db.keys[0].revoked_at).not.toBeNull();
    expect(db.adminCalls[0]).toBe("api_keys.update(revoked_at)");
    expect(db.cookieCalls).toEqual([]);
  });

  it("SECURITY: another person's key id is refused and left alive", async () => {
    expect(await revokeApiKey(form(KEY_B))).toEqual({ error: "That key isn't on this account." });
    expect(db.keys[1].revoked_at).toBeNull();
  });

  it("a failed write says so, instead of the old silent success", async () => {
    db.failWrites = true;
    expect(await revokeApiKey(form(KEY_A))).toEqual({ error: "Couldn't revoke that key — try again." });
  });

  it("no session, no write", async () => {
    session.userId = null;
    expect((await revokeApiKey(form(KEY_A))).error).toMatch(/session expired/);
    expect(db.adminCalls).toEqual([]);
  });

  it("a double press is fine: the second finds it already revoked", async () => {
    await revokeApiKey(form(KEY_A));
    expect(await revokeApiKey(form(KEY_A))).toEqual({ error: null });
  });
});

describe("authenticateApiRequest", () => {
  it("a missing, unknown or revoked key is 401", async () => {
    expect((await authenticateApiRequest(admin(), null)).error).toMatchObject({ status: 401, code: "missing_key" });
    expect((await authenticateApiRequest(admin(), "Bearer pic_live_nope")).error).toMatchObject({
      status: 401,
      code: "invalid_key",
    });
    db.keys[0].revoked_at = REVOKED_AT;
    expect((await authenticateApiRequest(admin(), "Bearer pic_live_a")).error).toMatchObject({
      status: 401,
      code: "revoked_key",
    });
  });

  it("a revoked key stops working: revoke, then the next request is 401", async () => {
    expect((await authenticateApiRequest(admin(), "Bearer pic_live_a")).caller).toMatchObject({ userId: "user-a" });
    await revokeOwnApiKey(admin(), "user-a", KEY_A, NOW);
    expect((await authenticateApiRequest(admin(), "Bearer pic_live_a")).error).toMatchObject({ status: 401 });
  });

  it("no API access is 403 and says so plainly — no plan, no price, no pitch", async () => {
    const { error } = await authenticateApiRequest(admin(), "Bearer pic_live_b");
    expect(error).toMatchObject({ status: 403, code: "no_api_access", message: API_ACCESS_OFF });
    expect(error?.message).not.toMatch(/elite|plan|upgrade|contact us|pricing/i);
  });
});
