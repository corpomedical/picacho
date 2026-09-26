import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// The token vault (spec §2.4, synthesis Cut 5): every key a network hands us
// for a person's account is sealed IN THE APP with AES-256-GCM before it
// touches the database, under SOCIAL_TOKEN_KEY_V<n> (32 random bytes,
// base64). The database holds ciphertext, iv, tag and the key version only
// (social_connection_secrets: RLS on, zero policies). A leaked table without
// the environment key is useless; the environment key without the table
// names no account.
//
// ASSOCIATED DATA binds each seal to its row and its kind:
// "<connection id>|access", "<connection id>|refresh", or for an owed
// revoke "revocation|<id>|<kind>". A ciphertext copied onto another row, or
// an access key swapped with a refresh key, fails to open.
//
// VERSIONS: new seals use the highest SOCIAL_TOKEN_KEY_V<n> present; every
// older version stays readable while its variable is set, and the posts
// clock re-seals old rows under the current key (worker.ts housekeeping):
// the accounts' keys (social_connection_secrets) and the revokes we still
// owe (social_revocations). Rotation = add V<n+1> in Vercel, deploy, wait
// for the clock to re-seal (a day), and remove V<n> only once no row of
// either table has key_version <= n (.env.example has the two counts). A variable that is present but not 32 bytes
// makes the whole vault unavailable: fail closed, never a half-configured
// keyring.
//
// THE PER-ACCOUNT LOCK (usableAccessToken): X and TikTok hand out a new
// refresh key on every refresh and the old one stops working. Two refreshes
// racing would each spend the same refresh key and one pair would be lost,
// disconnecting the account. So a refresh runs only while holding the
// account's lease (social_connections.refresh_lease_until, a conditional
// UPDATE), re-reads the keys after taking it (someone may have just
// refreshed), and writes the new pair in ONE update of the secrets row
// before anything uses it.
//
// Alias-free (vitest has no '@/').

export const KEY_ENV_PREFIX = "SOCIAL_TOKEN_KEY_V";
export const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_VERSION = 99;

export type Sealed = { ciphertext: string; iv: string; tag: string; keyVersion: number };
export type Keyring = { current: number; keys: ReadonlyMap<number, Buffer> };
export type TokenKind = "access" | "refresh";

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

function decodeKey(raw: string): Buffer | null {
  const s = raw.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return buf.length === KEY_BYTES ? buf : null;
}

/** The environment variables that are set but are not a 32-byte base64 key (for Admin and the logs; never their values). */
export function keyringProblems(env: Record<string, string | undefined>): string[] {
  const bad: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(KEY_ENV_PREFIX) || value === undefined || value === "") continue;
    const version = Number(name.slice(KEY_ENV_PREFIX.length));
    if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION || !decodeKey(value)) bad.push(name);
  }
  return bad.sort();
}

/**
 * Every SOCIAL_TOKEN_KEY_V<n> in the environment; the highest is current.
 * Null (the vault is closed) when none is set or any one is malformed.
 */
export function keyringFromEnv(env: Record<string, string | undefined> = process.env): Keyring | null {
  if (keyringProblems(env).length > 0) return null;
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(KEY_ENV_PREFIX) || !value) continue;
    const version = Number(name.slice(KEY_ENV_PREFIX.length));
    const key = decodeKey(value);
    if (key && Number.isInteger(version)) keys.set(version, key);
  }
  if (keys.size === 0) return null;
  return { current: Math.max(...keys.keys()), keys };
}

/** The associated data of a connection's key. */
export function connectionAad(connectionId: string, kind: TokenKind): string {
  return `${connectionId.toLowerCase()}|${kind}`;
}

/** The associated data of an owed revoke's key. */
export function revocationAad(revocationId: string, kind: TokenKind): string {
  return `revocation|${revocationId.toLowerCase()}|${kind}`;
}

/** Seal one secret under the current key. */
export function seal(plaintext: string, aad: string, keyring: Keyring, random: (n: number) => Buffer = randomBytes): Sealed {
  if (typeof plaintext !== "string" || plaintext.length === 0) throw new VaultError("nothing to seal");
  const key = keyring.keys.get(keyring.current);
  if (!key) throw new VaultError("no current key");
  const iv = random(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: keyring.current,
  };
}

/** Open one seal. Throws VaultError when its key is gone, or it was altered or moved. */
export function open(sealed: Sealed, aad: string, keyring: Keyring): string {
  const key = keyring.keys.get(sealed.keyVersion);
  if (!key) throw new VaultError(`key version ${sealed.keyVersion} is not in the environment`);
  try {
    const iv = Buffer.from(sealed.iv, "base64");
    const tag = Buffer.from(sealed.tag, "base64");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("bad shape");
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultError("a sealed key did not open");
  }
}

/** True when a seal is under an older key than the current one. */
export function needsReseal(sealed: Pick<Sealed, "keyVersion">, keyring: Keyring): boolean {
  return sealed.keyVersion !== keyring.current;
}

// ---------------------------------------------------------------------
// The per-account lock and the refresh
// ---------------------------------------------------------------------

/** A connection's sealed pair and what the refresh needs to know. */
export type StoredKeys = {
  connectionId: string;
  status: "connected" | "needs_reconnect";
  access: Sealed;
  refresh: Sealed | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  lastRefreshedAt: string | null;
};

export type FreshKeys = {
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
};

export type RefreshAnswer = { ok: true; keys: FreshKeys } | { ok: false; reason: "invalid" | "unavailable" };

/** What the lock needs from the database (store.ts implements it; tests use a fake). */
export interface VaultStore {
  readKeys(connectionId: string): Promise<StoredKeys | null>;
  /** Take the account's refresh lease until `until` if nobody holds it (a conditional update). */
  tryLease(connectionId: string, until: Date, now: Date): Promise<boolean>;
  releaseLease(connectionId: string): Promise<void>;
  /**
   * Write the new pair in ONE update of the secrets row, then the expiry
   * facts on the connection, and release the lease. False when the pair
   * could not be written.
   */
  writeKeys(
    connectionId: string,
    pair: { access: Sealed; refresh: Sealed | null },
    facts: { accessExpiresAt: Date | null; refreshExpiresAt: Date | null; refreshedAt: Date },
  ): Promise<boolean>;
  markNeedsReconnect(connectionId: string): Promise<void>;
}

/** Refresh this long before the access key runs out. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** A refresh lease lasts this long (a refresh call takes seconds). */
export const REFRESH_LEASE_MS = 60 * 1000;

export type UsableKey =
  | { ok: true; accessToken: string; refreshed: boolean }
  | { ok: false; reason: "missing" | "reconnect" | "unavailable" };

/**
 * The account's access key, fresh enough to use now: refreshed under the
 * account's lease when it runs out within REFRESH_MARGIN_MS. `refresh` is
 * the network's own refresh call (it gets both current keys: Instagram and
 * Threads refresh with the access key itself).
 */
export async function usableAccessToken(input: {
  store: VaultStore;
  keyring: Keyring;
  connectionId: string;
  now: () => Date;
  refresh: (current: { accessToken: string; refreshToken: string | null }) => Promise<RefreshAnswer>;
  sleep?: (ms: number) => Promise<void>;
  /** When another worker holds the lease: how many times to look again (every 750 ms). */
  waitTries?: number;
}): Promise<UsableKey> {
  const { store, keyring, connectionId } = input;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const readOpen = async (): Promise<
    { ok: true; stored: StoredKeys; access: string; refresh: string | null } | { ok: false; reason: "missing" | "reconnect" | "unavailable" }
  > => {
    let stored: StoredKeys | null;
    try {
      stored = await store.readKeys(connectionId);
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (!stored) return { ok: false, reason: "missing" };
    if (stored.status === "needs_reconnect") return { ok: false, reason: "reconnect" };
    try {
      const access = open(stored.access, connectionAad(connectionId, "access"), keyring);
      const refresh = stored.refresh ? open(stored.refresh, connectionAad(connectionId, "refresh"), keyring) : null;
      return { ok: true, stored, access, refresh };
    } catch {
      // A seal that doesn't open (a key removed too early, a moved row) is
      // an account we can no longer use: the person connects again.
      return { ok: false, reason: "reconnect" };
    }
  };

  const fresh = (stored: StoredKeys, at: Date): boolean => {
    if (!stored.accessExpiresAt) return true;
    const exp = Date.parse(stored.accessExpiresAt);
    return Number.isFinite(exp) && exp - at.getTime() > REFRESH_MARGIN_MS;
  };
  const stillValid = (stored: StoredKeys, at: Date): boolean => {
    if (!stored.accessExpiresAt) return true;
    const exp = Date.parse(stored.accessExpiresAt);
    return Number.isFinite(exp) && exp - at.getTime() > 30_000;
  };

  const first = await readOpen();
  if (!first.ok) return first;
  if (fresh(first.stored, input.now())) return { ok: true, accessToken: first.access, refreshed: false };

  // It runs out soon: refresh under the account's lease.
  const leased = await store.tryLease(connectionId, new Date(input.now().getTime() + REFRESH_LEASE_MS), input.now()).catch(() => false);
  if (!leased) {
    // Someone else is refreshing: wait for their new pair.
    for (let i = 0; i < (input.waitTries ?? 8); i++) {
      await sleep(750);
      const again = await readOpen();
      if (!again.ok) return again;
      if (fresh(again.stored, input.now())) return { ok: true, accessToken: again.access, refreshed: false };
    }
    const last = await readOpen();
    if (last.ok && stillValid(last.stored, input.now())) return { ok: true, accessToken: last.access, refreshed: false };
    return { ok: false, reason: "unavailable" };
  }

  let released = false;
  try {
    // Re-read under the lease: a refresh that finished between our read and
    // our lease already spent the refresh key we read.
    const current = await readOpen();
    if (!current.ok) return current;
    if (fresh(current.stored, input.now())) return { ok: true, accessToken: current.access, refreshed: false };

    let answer: RefreshAnswer;
    try {
      answer = await input.refresh({ accessToken: current.access, refreshToken: current.refresh });
    } catch {
      answer = { ok: false, reason: "unavailable" };
    }
    if (!answer.ok) {
      if (answer.reason === "invalid") {
        await store.markNeedsReconnect(connectionId).catch(() => undefined);
        return { ok: false, reason: "reconnect" };
      }
      return stillValid(current.stored, input.now())
        ? { ok: true, accessToken: current.access, refreshed: false }
        : { ok: false, reason: "unavailable" };
    }

    const keys = answer.keys;
    // A network that doesn't rotate hands no new refresh key: keep the one we have.
    const refreshPlain = keys.refreshToken ?? current.refresh;
    const pair = {
      access: seal(keys.accessToken, connectionAad(connectionId, "access"), keyring),
      refresh: refreshPlain ? seal(refreshPlain, connectionAad(connectionId, "refresh"), keyring) : null,
    };
    const facts = {
      accessExpiresAt: keys.accessExpiresAt,
      refreshExpiresAt: keys.refreshExpiresAt ?? (current.stored.refreshExpiresAt ? new Date(current.stored.refreshExpiresAt) : null),
      refreshedAt: input.now(),
    };
    // The old refresh key is spent the moment the network answered: the new
    // pair MUST land. Three tries before giving up.
    for (let i = 0; i < 3; i++) {
      const ok = await store.writeKeys(connectionId, pair, facts).catch(() => false);
      if (ok) {
        released = true;
        return { ok: true, accessToken: keys.accessToken, refreshed: true };
      }
    }
    // The network rotated but we could not keep the new pair: this account
    // has to be connected again.
    await store.markNeedsReconnect(connectionId).catch(() => undefined);
    return { ok: false, reason: "reconnect" };
  } finally {
    if (!released) await store.releaseLease(connectionId).catch(() => undefined);
  }
}
