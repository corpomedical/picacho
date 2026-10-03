import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  bareAddress,
  noteIdFromRecipients,
  replyAddress,
  replyOnly,
  senderName,
  textFromHtml,
  verifyWebhook,
} from "./inbound";
import { nextStatus } from "./threads";

const SECRET = "whsec_" + Buffer.from("a test signing key, 32 bytes!!!!").toString("base64");
function sign(id: string, ts: number, body: string, secret = SECRET) {
  const key = Buffer.from(secret.slice(6), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
}

describe("verifyWebhook", () => {
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "e1" } });
  const now = 1_790_000_000;

  it("accepts Resend's signature, even listed beside an old one", () => {
    expect(verifyWebhook(SECRET, { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) }, body, now)).toBe(true);
    expect(
      verifyWebhook(SECRET, { id: "msg_1", timestamp: String(now), signature: `v1,b2xk ${sign("msg_1", now, body)}` }, body, now),
    ).toBe(true);
  });

  it("refuses a changed body, another secret, a stale timestamp and missing headers", () => {
    const sig = sign("msg_1", now, body);
    expect(verifyWebhook(SECRET, { id: "msg_1", timestamp: String(now), signature: sig }, body + " ", now)).toBe(false);
    const other = "whsec_" + Buffer.from("another key entirely, 32 bytes!!").toString("base64");
    expect(verifyWebhook(other, { id: "msg_1", timestamp: String(now), signature: sig }, body, now)).toBe(false);
    expect(verifyWebhook(SECRET, { id: "msg_1", timestamp: String(now), signature: sig }, body, now + 301)).toBe(false);
    expect(verifyWebhook(SECRET, { id: null, timestamp: String(now), signature: sig }, body, now)).toBe(false);
    expect(verifyWebhook("", { id: "msg_1", timestamp: String(now), signature: sig }, body, now)).toBe(false);
  });
});

describe("threading a reply", () => {
  const id = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  it("finds the note from its reply address, however it's written", () => {
    expect(replyAddress(id, "replies.picacho.ai")).toBe(`reply+${id}@replies.picacho.ai`);
    expect(noteIdFromRecipients([`reply+${id}@replies.picacho.ai`], "replies.picacho.ai")).toBe(id);
    expect(noteIdFromRecipients([`"Picacho" <REPLY+${id.toUpperCase()}@Replies.Picacho.ai>`], "replies.picacho.ai")).toBe(id);
    expect(noteIdFromRecipients(["hello@picacho.ai"], "replies.picacho.ai")).toBeNull();
    expect(noteIdFromRecipients([`reply+${id}@evil.example`], "replies.picacho.ai")).toBeNull();
    expect(noteIdFromRecipients(["reply+not-a-uuid@replies.picacho.ai"], "replies.picacho.ai")).toBeNull();
  });

  it("reads names and addresses", () => {
    expect(bareAddress("Nadia K. <nadia@example.com>")).toBe("nadia@example.com");
    expect(senderName('"Nadia K." <nadia@example.com>')).toBe("Nadia K.");
    expect(senderName("nadia@example.com")).toBe("nadia@example.com");
  });
});

describe("a reply as text", () => {
  it("keeps what they wrote and drops the quoted note", () => {
    const text = "Thanks! I got busy, I'll be back next week.\n\nOn Sat, 3 Oct 2026 at 04:13, Picacho <hello@picacho.ai> wrote:\n> Hi Nadia,\n> We noticed…";
    expect(replyOnly(text)).toBe("Thanks! I got busy, I'll be back next week.");
    expect(replyOnly("> only quotes\n> here")).toBe("> only quotes\n> here");
  });

  it("turns an HTML email into readable text", () => {
    expect(textFromHtml("<html><head><style>p{}</style></head><body><p>Hi&nbsp;there</p><div>Line<br>two &amp; more</div></body></html>")).toBe(
      "Hi there\nLine\ntwo & more",
    );
  });
});

describe("nextStatus", () => {
  it("moves forward and never back", () => {
    expect(nextStatus("sending", "email.sent")).toBe("sent");
    expect(nextStatus("sent", "email.delivered")).toBe("delivered");
    expect(nextStatus("delivered", "email.sent")).toBe("delivered");
    expect(nextStatus("delivered", "email.complained")).toBe("complained");
    expect(nextStatus("sent", "email.bounced")).toBe("bounced");
    expect(nextStatus("delivered", "email.opened")).toBe("delivered");
  });
});
