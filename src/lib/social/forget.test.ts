import { describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FORGET_BUDGET_MS, forgetAccounts } from "./forget";
import { USER, bench } from "./test-harness";
import { json } from "./test-fetch";
import { TIKTOK_REVOKE_URL } from "./tiktok";
import { X_REVOKE_URL } from "./x";

// Account deletion's social step (integration, 2026-09-26): the Disconnect
// key's own path for every connected account, bounded, never throwing, and
// called by BOTH deletion flows before the auth delete.

const deps = (b: ReturnType<typeof bench>) => {
  const s = b.service();
  return { store: s.store, keyring: s.keyring, env: s.env, fetch: s.fetch };
};

describe("forgetAccounts", () => {
  it("every account is forgotten: X and TikTok revoked, a failed revoke owed, the keys gone either way", async () => {
    const b = bench();
    const x = b.connect("x");
    const tiktok = b.connect("tiktok");
    b.routes = [
      { method: "POST", url: X_REVOKE_URL, reply: () => json(200, {}) },
      { method: "POST", url: TIKTOK_REVOKE_URL, reply: () => json(503, {}) },
    ];
    expect(await forgetAccounts(deps(b), USER)).toBe("done");
    expect(b.store.conns.has(x)).toBe(false);
    expect(b.store.conns.has(tiktok)).toBe(false);
    expect(b.store.secrets.size).toBe(0);
    expect(b.calls.map((c) => c.url).sort()).toEqual([TIKTOK_REVOKE_URL, X_REVOKE_URL, X_REVOKE_URL].sort());
    const owed = [...b.store.revocations.values()];
    expect(owed.map((r) => `${r.network}:${r.kind}`)).toEqual(["tiktok:access"]);
    expect(JSON.stringify(owed)).not.toContain("tiktok-access-1");
  });

  it("nobody connected: nothing is called", async () => {
    const b = bench();
    expect(await forgetAccounts(deps(b), USER)).toBe("done");
    expect(b.calls).toEqual([]);
  });

  it("the table can't be read (04 not run yet): 'unavailable', never a throw", async () => {
    const b = bench();
    b.connect("x");
    const d = deps(b);
    d.store.connections = async () => {
      throw new Error("connections unavailable");
    };
    expect(await forgetAccounts(d, USER)).toBe("unavailable");
    expect(b.calls).toEqual([]);
  });

  it("a network that never answers can't hold the deletion past the budget", async () => {
    vi.useFakeTimers();
    try {
      const b = bench();
      b.connect("x");
      const d = { ...deps(b), fetch: () => new Promise<Response>(() => undefined) };
      const outcome = forgetAccounts(d, USER, 50);
      await vi.advanceTimersByTimeAsync(60);
      expect(await outcome).toBe("timed_out");
    } finally {
      vi.useRealTimers();
    }
    expect(FORGET_BUDGET_MS).toBeLessThanOrEqual(15_000);
  });
});

describe("both deletion flows forget the social accounts", () => {
  const lib = join(__dirname, "..");

  it("after the face withdrawal and before the auth delete, in the person's own and Admin's", () => {
    for (const file of ["profile/actions.ts", "admin/actions.ts"]) {
      const source = readFileSync(join(lib, file), "utf8");
      const faces = source.indexOf("await deleteUserFaces(admin, userId);");
      const social = source.indexOf("await forgetSocialAccountsOnDelete(admin, userId);");
      const authDelete = source.indexOf("const { error } = await admin.auth.admin.deleteUser(userId);");
      expect(faces, file).toBeGreaterThan(-1);
      expect(social, file).toBeGreaterThan(faces);
      expect(authDelete, file).toBeGreaterThan(social);
      expect(source, file).toContain('import { forgetSocialAccountsOnDelete } from "@/lib/social/forget";');
    }
  });

  it("the owed revokes outlive the account: social_revocations has no foreign key", () => {
    const root = join(lib, "..", "..", "supabase");
    const name = "press-tour-04-social.sql";
    const found = [join(root, "pending", name), ...readdirSync(join(root, "applied")).map((d) => join(root, "applied", d, name))].find((p) => existsSync(p))!;
    const sql = readFileSync(found, "utf8");
    const table = sql.slice(sql.indexOf("create table if not exists public.social_revocations ("), sql.indexOf("\n);", sql.indexOf("create table if not exists public.social_revocations (")));
    expect(table).toContain("user_id            uuid,");
    expect(table).not.toContain("references");
  });

  it("forget.ts stays light: no machine, no provider clients, no '@/' imports", () => {
    const source = readFileSync(join(__dirname, "forget.ts"), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./http", "./publish-service", "./store", "./vault", "@supabase/supabase-js"].sort());
  });
});
