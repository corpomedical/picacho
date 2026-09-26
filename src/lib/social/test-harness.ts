// The publishing test bench: an in-memory store with a person, a finished
// campaign cut (both files, signed), sealed connections, switches, and the
// service's and the worker's dependencies wired to a scripted fetch that each
// test swaps. Test-only; not used by the app. Alias-free.

import { createHash, randomBytes } from "node:crypto";
import type { Network } from "../press-tour/publish-types";
import type { PostingSwitches } from "./access";
import { FakeStore } from "./fake-store";
import type { FetchLike } from "./http";
import type { PublishDeps } from "./publish-service";
import { scriptedFetch, type Route } from "./test-fetch";
import { connectionAad, keyringFromEnv, seal, type Keyring } from "./vault";
import type { AccessFacts, WorkerDeps } from "./worker";

export const USER = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
export const T0 = new Date("2026-09-26T10:00:00.000Z");

export const KEY_V1 = randomBytes(32).toString("base64");
export const KEY_V2 = randomBytes(32).toString("base64");

export const ENV: Record<string, string> = {
  NEXT_PUBLIC_SITE_URL: "https://picacho.ai",
  SOCIAL_TOKEN_KEY_V1: KEY_V1,
  X_CLIENT_ID: "x-cid",
  X_CLIENT_SECRET: "x-secret",
  TIKTOK_CLIENT_KEY: "tt-key",
  TIKTOK_CLIENT_SECRET: "tt-secret",
  INSTAGRAM_APP_ID: "ig-app",
  INSTAGRAM_APP_SECRET: "ig-secret",
  THREADS_APP_ID: "th-app",
  THREADS_APP_SECRET: "th-secret",
};

export const CUT = {
  clean: Buffer.alloc(3 * 1024 * 1024, 5),
  tagged: Buffer.alloc(3 * 1024 * 1024, 6),
};
export const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export type Bench = {
  now: { t: Date };
  store: FakeStore;
  keyring: Keyring;
  access: AccessFacts;
  xCap: number;
  xSlots: number;
  kicks: string[];
  gateCalls: string[];
  gateAnswer: { ok: true } | { ok: false; error: string };
  limited: Set<string>;
  reconnectHooks: string[];
  routes: Route[];
  calls: ReturnType<typeof scriptedFetch>["calls"];
  fetch: FetchLike;
  native: boolean;
  sameSite: boolean;
  service(): PublishDeps;
  worker(): WorkerDeps;
  connect(network: Network, over?: { externalId?: string; handle?: string; accessExpiresAt?: string | null; access?: string; refresh?: string | null }): string;
};

export function bench(): Bench {
  const now = { t: new Date(T0) };
  const store = new FakeStore(() => now.t);
  const keyring = keyringFromEnv(ENV)!;
  const switches: PostingSwitches = { press_tour_posting: true, press_post_x: false, press_post_tiktok_direct: true, press_post_meta: true };
  let script = scriptedFetch([]);
  const b: Bench = {
    now,
    store,
    keyring,
    access: { pressTourOk: true, isAdmin: true, testerNetworks: [], switches },
    xCap: 200,
    xSlots: 0,
    kicks: [],
    gateCalls: [],
    gateAnswer: { ok: true },
    limited: new Set(),
    reconnectHooks: [],
    get routes() {
      return [];
    },
    set routes(r: Route[]) {
      script = scriptedFetch(r);
    },
    get calls() {
      return script.calls;
    },
    fetch: (input, init) => script.fetch(input, init),
    native: false,
    sameSite: true,
    service(): PublishDeps {
      return {
        store,
        keyring,
        env: ENV,
        fetch: b.fetch,
        now: () => now.t,
        native: b.native,
        sameSite: b.sameSite,
        readAccess: async () => b.access,
        readXCap: async () => b.xCap,
        rateLimited: async (_u, scope) => b.limited.has(scope),
        gateCaption: async (_u, text) => {
          b.gateCalls.push(text);
          return b.gateAnswer;
        },
        kick: (id) => b.kicks.push(id),
        ipHash: "ip-hash",
        tiktokAudited: false,
      };
    },
    worker(): WorkerDeps {
      return {
        store,
        keyring,
        env: ENV,
        fetch: b.fetch,
        now: () => now.t,
        sleep: async () => undefined,
        readAccess: async () => b.access,
        readXCap: async () => b.xCap,
        takeXSlot: async (cap) => {
          if (b.xSlots >= cap) return false;
          b.xSlots++;
          return true;
        },
        tiktokAudited: false,
        onNeedsReconnect: async (u, n) => {
          b.reconnectHooks.push(`${u}:${n}`);
        },
      };
    },
    connect(network, over = {}) {
      const externalId = over.externalId ?? (network === "x" ? "42" : network === "tiktok" ? "open-1" : "1784");
      const conn = store.addConnection({
        userId: USER,
        network,
        externalId,
        handle: over.handle ?? "brand",
        displayName: "Brand Co",
        scopes: [],
        status: "connected",
        accessExpiresAt: over.accessExpiresAt === undefined ? new Date(T0.getTime() + 2 * 3600_000).toISOString() : over.accessExpiresAt,
        refreshExpiresAt: null,
        lastRefreshedAt: T0.toISOString(),
      });
      const refresh = over.refresh === undefined ? `${network}-refresh-1` : over.refresh;
      store.secrets.set(conn.id, {
        access: seal(over.access ?? `${network}-access-1`, connectionAad(conn.id, "access"), keyring),
        refresh: refresh ? seal(refresh, connectionAad(conn.id, "refresh"), keyring) : null,
        keyVersion: keyring.current,
      });
      return conn.id;
    },
  };
  store.profiles.set(USER, { role: "admin", plan: "elite", plan_status: "active", status: null });
  // Unsigned, as every file is while C2PA signing is off (PT-R3-01: posting doesn't wait on it).
  store.campaigns.set(CAMPAIGN, {
    id: CAMPAIGN,
    userId: USER,
    stage: "ready",
    masterGenerationId: null,
    productVerdict: "match",
    renditions: {
      clean: { kind: "clean", bucket: "press-kit", path: `${USER}/cuts/${CAMPAIGN}/clean.mp4`, sha256: sha(CUT.clean), sizeBytes: CUT.clean.length, durationSeconds: 15, posterPath: null, signed: false },
      tagged: { kind: "tagged", bucket: "press-kit", path: `${USER}/cuts/${CAMPAIGN}/tagged.mp4`, sha256: sha(CUT.tagged), sizeBytes: CUT.tagged.length, durationSeconds: 15, posterPath: null, signed: false },
    },
  });
  store.files.set(`press-kit/${USER}/cuts/${CAMPAIGN}/clean.mp4`, CUT.clean);
  store.files.set(`press-kit/${USER}/cuts/${CAMPAIGN}/tagged.mp4`, CUT.tagged);
  return b;
}
