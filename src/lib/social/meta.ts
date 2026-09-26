// What Instagram and Threads share: Meta's error shape and how to read it,
// and the container life (create at SEND time → poll → publish once).
//
// Meta answers an error as {error: {message, type, code, error_subcode}}.
//   190 (and 102, 463, 467)            the account's key is no good → reconnect
//   4, 17, 32, 613, 80001-80008        rate limits → busy (nothing posted)
//   9 / subcode 2207042                the account's posting limit → busy
//   9007 / subcode 2207027             the container isn't ready yet → look again
// Anything else a network answered is a definite refusal of that call.
//
// Alias-free (vitest has no '@/').

import { obj, num } from "./http";

export type MetaErrorKind = "reconnect" | "busy" | "limit" | "not_ready" | "refused";

export function metaError(status: number, body: unknown): { kind: MetaErrorKind; code: number | null; subcode: number | null } {
  const e = obj(obj(body).error);
  const code = num(e.code);
  const subcode = num(e.error_subcode);
  if (code === 190 || code === 102 || code === 463 || code === 467 || status === 401) return { kind: "reconnect", code, subcode };
  if (subcode === 2207042 || (code === 9 && subcode !== 2207027)) return { kind: "limit", code, subcode };
  if (code === 9007 || subcode === 2207027) return { kind: "not_ready", code, subcode };
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code !== null && code >= 80001 && code <= 80008) || status === 429) {
    return { kind: "busy", code, subcode };
  }
  return { kind: "refused", code, subcode };
}

/** The container's state, from Instagram's status_code or Threads' status. */
export type ContainerState = "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED" | "UNKNOWN";

export function containerState(body: unknown): ContainerState {
  const b = obj(body);
  const raw = String(b.status_code ?? b.status ?? "").toUpperCase();
  return (["FINISHED", "IN_PROGRESS", "ERROR", "EXPIRED", "PUBLISHED"] as const).find((s) => s === raw) ?? "UNKNOWN";
}

/** How long a container may take before we make a new one (Meta: poll once a minute; Reels can take longer than 5). */
export const CONTAINER_PATIENCE_MS = 20 * 60 * 1000;
/** Upload attempts (container creations) before 'failed'. */
export const META_MAX_UPLOAD_ATTEMPTS = 3;
/** How long the link Meta fetches the file from stays valid. */
export const META_MEDIA_URL_SECONDS = 3 * 60 * 60;
