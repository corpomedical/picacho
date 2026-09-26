// A SendContext for the adapter tests: the consented object, a file, a
// scripted fetch, and a save() that records every patch and applies it to
// the post the way the worker does. Test-only; not used by the app.
// Alias-free.

import { createHash } from "node:crypto";
import type { Network } from "../press-tour/publish-types";
import { RENDITION_FOR } from "../press-tour/publish-types";
import type { SendContext, StepPatch } from "./adapter";
import { buildConsent, type ConsentObject } from "./consent";
import type { FetchLike } from "./http";

export const T0 = new Date("2026-09-26T10:00:00.000Z");

export function consentFor(network: Network, over: Partial<Parameters<typeof buildConsent>[0]> = {}): ConsentObject {
  return buildConsent({
    network,
    accountExternalId: network === "x" ? "42" : network === "tiktok" ? "open-id-1" : "1784",
    rendition: RENDITION_FOR[network],
    renditionSha256: "a".repeat(64),
    caption: "Morning ritual.",
    hashtags: ["coffee"],
    tiktok:
      network === "tiktok"
        ? { privacy: "SELF_ONLY", allowComment: false, allowDuet: false, allowStitch: false, yourBrand: true, brandedContent: false }
        : null,
    x: network === "x" ? { paidPartnership: false } : null,
    scheduledFor: null,
    ...over,
  });
}

export function sendContext(input: {
  network: Network;
  fetch: FetchLike;
  consent?: ConsentObject;
  bytes?: Buffer;
  durationSeconds?: number | null;
  stage?: SendContext["post"]["stage"];
  externalIds?: Record<string, unknown>;
  uploadAttempts?: number;
  now?: () => Date;
  deadlineMs?: number;
  handle?: string | null;
  tiktokAudited?: boolean;
}): { ctx: SendContext; saves: StepPatch[]; cost: () => number; slept: number[] } {
  const saves: StepPatch[] = [];
  const slept: number[] = [];
  let cost = 0;
  const bytes = input.bytes ?? Buffer.alloc(1024, 7);
  const now = input.now ?? (() => T0);
  const consent = input.consent ?? consentFor(input.network, { renditionSha256: createHash("sha256").update(bytes).digest("hex") });
  const ctx: SendContext = {
    post: {
      id: "post-1",
      stage: input.stage ?? "claimed",
      externalIds: input.externalIds ?? {},
      uploadAttempts: input.uploadAttempts ?? 0,
      createdAt: T0.toISOString(),
    },
    consent,
    account: { externalId: consent.account, handle: input.handle === undefined ? "brand" : input.handle },
    accessToken: "ACCESS",
    creds: { clientId: "cid", clientSecret: "csecret" },
    media: {
      sizeBytes: bytes.length,
      durationSeconds: input.durationSeconds === undefined ? 15 : input.durationSeconds,
      bytes: async () => bytes,
      publicUrl: async (seconds) => `https://files.test/press-kit/cut.mp4?ttl=${seconds}`,
    },
    fetch: input.fetch,
    now,
    sleep: async (ms) => {
      slept.push(ms);
    },
    deadline: now().getTime() + (input.deadlineMs ?? 240_000),
    save: async (patch) => {
      saves.push(structuredClone(patch));
      if (patch.stage) ctx.post.stage = patch.stage;
      if (patch.externalIds) ctx.post.externalIds = { ...patch.externalIds };
      if (patch.uploadAttempts !== undefined) ctx.post.uploadAttempts = patch.uploadAttempts;
      if (patch.costUsd) cost += patch.costUsd;
    },
    tiktokAudited: input.tiktokAudited ?? false,
  };
  return { ctx, saves, cost: () => Math.round(cost * 10_000) / 10_000, slept };
}
