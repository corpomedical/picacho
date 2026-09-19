// How a long take's step fails on our side (chain-run.ts runs the steps).
// Kept apart from chain-run so it can be read and tested without the server's
// imports.

/** A 30 s window at 720p, or a 30 s join at 1080p, encodes in well under this. */
export const ENCODE_TIMEOUT_MS = 180_000;

/**
 * Our side failed in a way another pass can mend — a storage blink, a
 * download that timed out, an encode that died. The runner turns it into its
 * own retry (the job row stays; the webhook, the poll and the reaper come
 * back), never into a failed take: the pieces before it were paid for.
 */
export class ChainRetry extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainRetry";
  }
}

/**
 * Why the encoder failed, in its own words. Not the error's message: that
 * opens with the whole command line, and a join's command filled the log's
 * few hundred characters before ffmpeg's reason began (2026-09-19, two 30 s
 * takes stuck at "Joining the parts" for hours with the reason cut off).
 */
export function encoderFailure(what: string, err: unknown): ChainRetry {
  const e = (err ?? {}) as { code?: unknown; signal?: unknown; killed?: unknown; stderr?: unknown };
  if (typeof e.code === "string") return new ChainRetry(`${what}: the encoder couldn't start (${e.code})`);
  const said = (Buffer.isBuffer(e.stderr) ? e.stderr.toString("utf8") : typeof e.stderr === "string" ? e.stderr : "").trim();
  const how =
    e.killed === true
      ? `stopped after ${ENCODE_TIMEOUT_MS / 1000} s`
      : typeof e.signal === "string"
        ? `killed (${e.signal})`
        : `exit ${typeof e.code === "number" ? e.code : "?"}`;
  return new ChainRetry(`${what}: ffmpeg ${how}${said ? `: ${said.slice(-600)}` : ""}`);
}
