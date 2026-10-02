// Clippings' real providers, wired (server-only): the service role, the
// person's own connected accounts and their sealed keys (social/vault.ts),
// the network readers, Whisper + ffmpeg (words.ts), GPT-6 Luna (label.ts),
// the limiter, and next/server after() for the read itself.

import { after } from "next/server";
import { rateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/server";
import { OAUTH } from "@/lib/social/networks";
import { credentialsFor } from "@/lib/social/oauth";
import { supabaseSocialStore, type ConnectionRecord } from "@/lib/social/store";
import { keyringFromEnv, usableAccessToken } from "@/lib/social/vault";
import { readClippingsSwitches } from "./enabled";
import { askLuna } from "./label";
import { readInstagram, readTikTok } from "./network-read";
import type { ClipDeps } from "./service";
import { readWords } from "./words";

export function clipDeps(): ClipDeps {
  const db = createAdminClient();
  const store = supabaseSocialStore(db);
  return {
    db,
    now: () => new Date(),
    switches: () => readClippingsSwitches(db),
    connections: async (userId) => (await store.connections(userId)).filter((c) => c.network === "instagram" || c.network === "tiktok"),
    token: async (conn: ConnectionRecord) => {
      const keyring = keyringFromEnv(process.env);
      const adapter = OAUTH[conn.network];
      const creds = credentialsFor(adapter, process.env);
      if (!keyring || !creds) return { ok: false, reason: "unavailable" };
      const key = await usableAccessToken({
        store,
        keyring,
        connectionId: conn.id,
        now: () => new Date(),
        refresh: (c) => adapter.refresh(fetch, { creds, accessToken: c.accessToken, refreshToken: c.refreshToken, now: new Date() }),
      });
      if (key.ok) return { ok: true, token: key.accessToken };
      return { ok: false, reason: key.reason === "unavailable" ? "unavailable" : "reconnect" };
    },
    readNetwork: (network, token, max) => (network === "instagram" ? readInstagram(fetch, token, max) : readTikTok(fetch, token, max)),
    readWords: (source, cover) => readWords(source, { openaiKey: process.env.OPENAI_API_KEY, cover }),
    luna: (request) => askLuna(request, { key: process.env.OPENAI_API_KEY }),
    rateLimited,
    later: (job) =>
      after(async () => {
        try {
          await job();
        } catch (err) {
          console.error(`[clippings] read failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
  };
}
