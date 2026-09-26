import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { FakeStore } from "./fake-store";
import {
  REFRESH_MARGIN_MS,
  VaultError,
  connectionAad,
  keyringFromEnv,
  keyringProblems,
  needsReseal,
  open,
  revocationAad,
  seal,
  usableAccessToken,
  type RefreshAnswer,
} from "./vault";

const K1 = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("base64");
const CONN = "7b0f7c9a-1d2e-4f3a-8b5c-6d7e8f9a0b1c";

describe("the keyring", () => {
  it("is closed with no key, and with any malformed key", () => {
    expect(keyringFromEnv({})).toBeNull();
    expect(keyringFromEnv({ SOCIAL_TOKEN_KEY_V1: "short" })).toBeNull();
    expect(keyringFromEnv({ SOCIAL_TOKEN_KEY_V1: K1, SOCIAL_TOKEN_KEY_V2: randomBytes(16).toString("base64") })).toBeNull();
    expect(keyringProblems({ SOCIAL_TOKEN_KEY_V1: K1, SOCIAL_TOKEN_KEY_V2: "nope" })).toEqual(["SOCIAL_TOKEN_KEY_V2"]);
  });

  it("uses the highest version for new seals and still opens older ones", () => {
    const v1 = keyringFromEnv({ SOCIAL_TOKEN_KEY_V1: K1 })!;
    const both = keyringFromEnv({ SOCIAL_TOKEN_KEY_V1: K1, SOCIAL_TOKEN_KEY_V2: K2 })!;
    expect(v1.current).toBe(1);
    expect(both.current).toBe(2);
    const old = seal("secret-1", connectionAad(CONN, "access"), v1);
    expect(old.keyVersion).toBe(1);
    expect(open(old, connectionAad(CONN, "access"), both)).toBe("secret-1");
    expect(needsReseal(old, both)).toBe(true);
    const fresh = seal("secret-1", connectionAad(CONN, "access"), both);
    expect(fresh.keyVersion).toBe(2);
    expect(needsReseal(fresh, both)).toBe(false);
    // Removing V1 too early makes the old seal unopenable (it fails closed, it never guesses).
    expect(() => open(old, connectionAad(CONN, "access"), keyringFromEnv({ SOCIAL_TOKEN_KEY_V2: K2 })!)).toThrow(VaultError);
  });

  it("accepts url-safe base64 keys", () => {
    const urlSafe = randomBytes(32).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(keyringFromEnv({ SOCIAL_TOKEN_KEY_V1: urlSafe })?.current).toBe(1);
  });
});

describe("a seal", () => {
  const ring = keyringFromEnv({ SOCIAL_TOKEN_KEY_V1: K1 })!;

  it("never stores the secret in the clear and opens back to it", () => {
    const s = seal("x-refresh-abc", connectionAad(CONN, "refresh"), ring);
    expect(s.ciphertext).not.toContain("x-refresh-abc");
    expect(Buffer.from(s.ciphertext, "base64").toString("utf8")).not.toContain("x-refresh-abc");
    expect(open(s, connectionAad(CONN, "refresh"), ring)).toBe("x-refresh-abc");
  });

  it("is bound to its row and its kind: moved or swapped, it does not open", () => {
    const s = seal("x-refresh-abc", connectionAad(CONN, "refresh"), ring);
    expect(() => open(s, connectionAad("11111111-2222-4333-8444-555555555555", "refresh"), ring)).toThrow(VaultError);
    expect(() => open(s, connectionAad(CONN, "access"), ring)).toThrow(VaultError);
    expect(() => open(s, revocationAad(CONN, "refresh"), ring)).toThrow(VaultError);
  });

  it("does not open when altered", () => {
    const s = seal("x-refresh-abc", connectionAad(CONN, "refresh"), ring);
    const bytes = Buffer.from(s.ciphertext, "base64");
    bytes[0] ^= 1;
    expect(() => open({ ...s, ciphertext: bytes.toString("base64") }, connectionAad(CONN, "refresh"), ring)).toThrow(VaultError);
    expect(() => open({ ...s, tag: Buffer.alloc(16).toString("base64") }, connectionAad(CONN, "refresh"), ring)).toThrow(VaultError);
  });

  it("uses a fresh iv every time", () => {
    const a = seal("same", connectionAad(CONN, "access"), ring);
    const b = seal("same", connectionAad(CONN, "access"), ring);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

describe("usableAccessToken: the per-account lock for rotating refresh keys", () => {
  const ring = keyringFromEnv({ SOCIAL_TOKEN_KEY_V1: K1 })!;
  const t0 = new Date("2026-09-26T10:00:00.000Z");

  function setup(accessExpiresAt: Date) {
    const store = new FakeStore(() => t0);
    const conn = store.addConnection({
      id: CONN,
      userId: "u1",
      network: "x",
      externalId: "42",
      handle: "brand",
      displayName: "Brand",
      scopes: [],
      status: "connected",
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshExpiresAt: null,
      lastRefreshedAt: null,
    });
    store.secrets.set(conn.id, {
      access: seal("access-1", connectionAad(conn.id, "access"), ring),
      refresh: seal("refresh-1", connectionAad(conn.id, "refresh"), ring),
      keyVersion: 1,
    });
    return store;
  }

  it("uses the stored key while it has more than the margin left, without refreshing", async () => {
    const store = setup(new Date(t0.getTime() + REFRESH_MARGIN_MS + 60_000));
    let refreshed = 0;
    const r = await usableAccessToken({ store, keyring: ring, connectionId: CONN, now: () => t0, refresh: async () => (refreshed++, { ok: false, reason: "unavailable" }) });
    expect(r).toEqual({ ok: true, accessToken: "access-1", refreshed: false });
    expect(refreshed).toBe(0);
  });

  it("refreshes under the lease and keeps the ROTATED refresh key (the old one is spent)", async () => {
    const store = setup(new Date(t0.getTime() + 60_000));
    const seen: (string | null)[] = [];
    const r = await usableAccessToken({
      store,
      keyring: ring,
      connectionId: CONN,
      now: () => t0,
      refresh: async (current): Promise<RefreshAnswer> => {
        seen.push(current.refreshToken);
        return { ok: true, keys: { accessToken: "access-2", refreshToken: "refresh-2", accessExpiresAt: new Date(t0.getTime() + 7_200_000), refreshExpiresAt: null } };
      },
    });
    expect(r).toEqual({ ok: true, accessToken: "access-2", refreshed: true });
    expect(seen).toEqual(["refresh-1"]);
    const stored = await store.readKeys(CONN);
    expect(open(stored!.access, connectionAad(CONN, "access"), ring)).toBe("access-2");
    expect(open(stored!.refresh!, connectionAad(CONN, "refresh"), ring)).toBe("refresh-2");
    expect(store.conns.get(CONN)!.leaseUntil).toBeNull();

    // A second call sees the fresh pair and spends nothing.
    const again = await usableAccessToken({ store, keyring: ring, connectionId: CONN, now: () => t0, refresh: async () => ({ ok: false, reason: "invalid" }) });
    expect(again).toEqual({ ok: true, accessToken: "access-2", refreshed: false });
  });

  it("two racing callers refresh ONCE: the second waits for the first's new pair", async () => {
    const store = setup(new Date(t0.getTime() + 60_000));
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const refresh = async (): Promise<RefreshAnswer> => {
      calls++;
      await gate;
      return { ok: true, keys: { accessToken: "access-2", refreshToken: "refresh-2", accessExpiresAt: new Date(t0.getTime() + 7_200_000), refreshExpiresAt: null } };
    };
    const first = usableAccessToken({ store, keyring: ring, connectionId: CONN, now: () => t0, refresh });
    await new Promise((r) => setTimeout(r, 5));
    const second = usableAccessToken({
      store,
      keyring: ring,
      connectionId: CONN,
      now: () => t0,
      refresh,
      sleep: async () => {
        release();
        await new Promise((r) => setTimeout(r, 5));
      },
    });
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(a.ok && a.accessToken).toBe("access-2");
    expect(b.ok && b.accessToken).toBe("access-2");
  });

  it("a refused refresh key marks the account for reconnecting", async () => {
    const store = setup(new Date(t0.getTime() + 60_000));
    const r = await usableAccessToken({ store, keyring: ring, connectionId: CONN, now: () => t0, refresh: async () => ({ ok: false, reason: "invalid" }) });
    expect(r).toEqual({ ok: false, reason: "reconnect" });
    expect(store.conns.get(CONN)!.status).toBe("needs_reconnect");
    expect(store.conns.get(CONN)!.leaseUntil).toBeNull();
  });

  it("a network that is down: the still-valid key is used, an expired one waits", async () => {
    const soon = setup(new Date(t0.getTime() + 120_000));
    expect(await usableAccessToken({ store: soon, keyring: ring, connectionId: CONN, now: () => t0, refresh: async () => ({ ok: false, reason: "unavailable" }) })).toEqual({
      ok: true,
      accessToken: "access-1",
      refreshed: false,
    });
    const gone = setup(new Date(t0.getTime() - 1000));
    expect(await usableAccessToken({ store: gone, keyring: ring, connectionId: CONN, now: () => t0, refresh: async () => ({ ok: false, reason: "unavailable" }) })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("when the new pair can't be kept, the account reconnects (never a silent loss)", async () => {
    const store = setup(new Date(t0.getTime() + 60_000));
    store.failSecretsWrites = 3;
    const r = await usableAccessToken({
      store,
      keyring: ring,
      connectionId: CONN,
      now: () => t0,
      refresh: async () => ({ ok: true, keys: { accessToken: "a2", refreshToken: "r2", accessExpiresAt: new Date(t0.getTime() + 7_200_000), refreshExpiresAt: null } }),
    });
    expect(r).toEqual({ ok: false, reason: "reconnect" });
    expect(store.conns.get(CONN)!.status).toBe("needs_reconnect");
  });
});
