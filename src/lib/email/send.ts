import crypto from "crypto";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { getOrigin } from "@/lib/origin";

// Sending email through Resend (https://resend.com) — the transactional /
// announcement path, used ONLY by the two admin actions in
// lib/admin/email-actions.ts. Nothing in the product sends email on its own,
// and Supabase Auth's own emails (confirmation, password reset) don't go
// through here at all.
//
// A thin fetch client rather than the `resend` npm package, on purpose: deps
// are pinned and every other provider in this app (fal, OpenAI) is already
// called with a plain timed fetch — see fetch-with-timeout.ts. The API is
// two endpoints and a bearer header; a dependency would be bigger than the
// integration.
//
// Server-only module (service-key-derived HMAC + provider secret) — never
// import from a client component.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// 15s: generous for an HTTP POST that just enqueues, short enough that a
// wedged provider fails the admin's request legibly instead of hanging it.
const SEND_TIMEOUT_MS = 15_000;

// Resend caps /emails/batch at 100 messages per request.
const BATCH_CHUNK_SIZE = 100;

// Resend's default rate limit is 2 requests/second. Chunks are sent
// SEQUENTIALLY with this pause between them so a 50-chunk blast paces out at
// well under the limit instead of getting 429s halfway through a send —
// a 5,000-recipient blast is 50 requests ≈ one minute, comfortably inside
// the 300s function ceiling (see maxDuration on admin/emails/page.tsx).
const BATCH_CHUNK_DELAY_MS = 600;

function fromAddress(): string {
  return process.env.EMAIL_FROM || "Picacho <hello@picacho.ai>";
}

// Loud, not silent: unlike push notifications (push/send.ts, called on every
// generation finish), email is only ever sent because an admin explicitly
// asked — so a missing key should warn in the log AND fail the action with a
// clear error, never quietly pretend it sent.
function missingKeyWarning(context: string): string {
  const error = "Email sending is not configured (RESEND_API_KEY is missing).";
  console.warn(`${context}: RESEND_API_KEY is not set — email is disabled, nothing was sent.`);
  return error;
}

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * Sends a single email. Never throws: failures are logged and returned as
 * `{error}` so callers (admin actions that want to redirect with a banner
 * message) don't need try/catch plumbing.
 */
export async function sendEmail(message: EmailMessage): Promise<{ error: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { error: missingKeyWarning("sendEmail") };

  try {
    const res = await fetchWithTimeout(
      RESEND_ENDPOINT,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress(),
          to: [message.to],
          subject: message.subject,
          html: message.html,
          ...(message.text ? { text: message.text } : {}),
        }),
      },
      SEND_TIMEOUT_MS,
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const error = `Resend rejected the send (${res.status}): ${detail.slice(0, 300)}`;
      console.error("sendEmail failed", { to: message.to, subject: message.subject, error });
      return { error };
    }
    return { error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Network error sending email.";
    console.error("sendEmail failed", { to: message.to, subject: message.subject, err });
    return { error };
  }
}

export type BatchResult = {
  /** Recipients in chunks Resend accepted. */
  sent: number;
  /** Recipients in chunks that errored (whole-chunk — Resend's batch API accepts or rejects a request as one). */
  failed: number;
  /** One entry per failed chunk, for the server log / summary message. */
  chunkErrors: string[];
};

/**
 * Sends a blast in chunks of 100 via /emails/batch. One failed chunk never
 * stops the rest — the recipients in the other chunks still deserve their
 * email, and the per-chunk errors come back in the result so the caller can
 * report honestly what went out.
 */
export async function sendBatch(
  messages: { to: string; subject: string; html: string }[],
): Promise<BatchResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: 0, failed: messages.length, chunkErrors: [missingKeyWarning("sendBatch")] };
  }

  let sent = 0;
  let failed = 0;
  const chunkErrors: string[] = [];

  for (let i = 0; i < messages.length; i += BATCH_CHUNK_SIZE) {
    const chunk = messages.slice(i, i + BATCH_CHUNK_SIZE);
    const chunkNumber = i / BATCH_CHUNK_SIZE + 1;
    // Pace BETWEEN requests (not before the first) — see the rate-limit note
    // on BATCH_CHUNK_DELAY_MS.
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, BATCH_CHUNK_DELAY_MS));

    try {
      const res = await fetchWithTimeout(
        `${RESEND_ENDPOINT}/batch`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(
            chunk.map((m) => ({
              from: fromAddress(),
              to: [m.to],
              subject: m.subject,
              html: m.html,
            })),
          ),
        },
        SEND_TIMEOUT_MS,
      );

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const error = `chunk ${chunkNumber} (${chunk.length} recipients): ${res.status} ${detail.slice(0, 200)}`;
        console.error("sendBatch chunk failed", error);
        failed += chunk.length;
        chunkErrors.push(error);
      } else {
        sent += chunk.length;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "network error";
      const error = `chunk ${chunkNumber} (${chunk.length} recipients): ${message}`;
      console.error("sendBatch chunk failed", { error, err });
      failed += chunk.length;
      chunkErrors.push(error);
    }
  }

  return { sent, failed, chunkErrors };
}

// ---------------------------------------------------------------------------
// Unsubscribe links
// ---------------------------------------------------------------------------

// Prefer a dedicated signing secret over the service-role key — same
// rationale as mediaSig in lib/media/url.ts: every unsubscribe link ever
// emailed embeds a signature under this key, and keying them off
// SUPABASE_SERVICE_ROLE_KEY means rotating that credential (routine, and
// exactly what you do after a suspected leak) silently 400s the unsubscribe
// link in every email already sitting in an inbox — the one link that must
// keep working, legally and reputationally. The fallback keeps things
// working with nothing set.
//
// OPERATOR: set EMAIL_UNSUBSCRIBE_SECRET (any long random string) in
// production BEFORE the first real blast, and BEFORE any future
// service-role key rotation. One-time cost: the moment it's first set,
// links signed under the old key stop verifying — set it once, early, not
// during an incident.
function unsubscribeKey(): string {
  const key = process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Neither EMAIL_UNSUBSCRIBE_SECRET nor SUPABASE_SERVICE_ROLE_KEY is set.");
  }
  return key;
}

/** HMAC the unsubscribe route verifies — see app/api/email/unsubscribe. */
export function unsubscribeSig(userId: string): string {
  return crypto
    .createHmac("sha256", unsubscribeKey())
    .update(`unsubscribe:${userId}`)
    .digest("base64url")
    .slice(0, 24);
}

/**
 * Absolute unsubscribe URL for one recipient. Signed rather than sessioned —
 * the person clicking is in their mail client, almost certainly logged out,
 * and an opt-out link that demands a login first doesn't get clicked, it
 * gets reported as spam.
 */
export async function unsubscribeUrl(userId: string): Promise<string> {
  return `${await getOrigin()}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&sig=${unsubscribeSig(userId)}`;
}
