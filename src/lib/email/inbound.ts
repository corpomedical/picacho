// Emails sent and received (2026-10-03) — the pure parts of Resend's
// webhooks: checking a webhook really came from Resend, finding which note a
// reply answers, and turning a reply into readable text.
//
// Alias-free and node-only (crypto), unit-tested.
import { createHmac, timingSafeEqual } from "node:crypto";

/** A webhook older or newer than this (seconds) is refused: a replay, or a wrong clock. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/**
 * Resend signs webhooks the Svix way: HMAC-SHA256 over
 * "<svix-id>.<svix-timestamp>.<raw body>", keyed with the base64 part of the
 * "whsec_…" secret; svix-signature lists one or more "v1,<base64>" values.
 */
export function verifyWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The address a note's replies go to: reply+<note id>@<domain>. */
export function replyAddress(noteId: string, domain: string): string {
  return `reply+${noteId}@${domain}`;
}

/** The note a reply answers, from any of its To addresses ("Name <reply+id@domain>" too). */
export function noteIdFromRecipients(to: readonly string[] | string | null | undefined, domain: string): string | null {
  const list = Array.isArray(to) ? to : to ? [to] : [];
  for (const raw of list) {
    const addr = (/<([^>]+)>/.exec(raw)?.[1] ?? raw).trim().toLowerCase();
    const m = /^reply\+([^@]+)@(.+)$/.exec(addr);
    if (m && m[2] === domain.toLowerCase() && UUID.test(m[1])) return m[1];
  }
  return null;
}

/** The bare address from "Name <addr>". */
export function bareAddress(raw: string): string {
  return (/<([^>]+)>/.exec(raw)?.[1] ?? raw).trim();
}

/** A display name from "Name <addr>", else the address. */
export function senderName(raw: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(raw);
  return m ? m[1].trim() : bareAddress(raw);
}

/** Plain text from an HTML email: tags out, breaks kept, entities decoded. */
export function textFromHtml(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * What they wrote, without the quoted note underneath: everything before the
 * first "On … wrote:" line, a line of "> " quotes, or the "--" signature cut.
 * Falls back to the whole text when the cut would leave nothing.
 */
export function replyOnly(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex(
    (l, i) =>
      /^\s*On .{3,200}wrote:\s*$/i.test(l) ||
      /^\s*El .{3,200}escribió:\s*$/i.test(l) ||
      (/^\s*>/.test(l) && i > 0) ||
      /^-{2,}\s*Original Message\s*-{2,}/i.test(l) ||
      /^\s*From: .+/i.test(l),
  );
  const keptLines = cut > 0 ? lines.slice(0, cut) : lines;
  // Nothing of their own above the cut (all quotes): show everything.
  if (!keptLines.some((l) => l.trim() && !/^\s*>/.test(l))) return text.trim();
  return keptLines.join("\n").trim();
}
