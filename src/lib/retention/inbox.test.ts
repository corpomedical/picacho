import { describe, expect, it, vi } from "vitest";

vi.mock("./load", () => ({ loadRetention: vi.fn() }));
const { writeDraft, inboxItemFor } = await import("./inbox");

const base = { name: "Nadia K.", email: "nadia@example.com", optedOut: false };

describe("writeDraft", () => {
  it("opens each note in the team's voice, by first name", () => {
    expect(writeDraft({ ...base, kind: "paying" })).toMatchObject({ to: "nadia@example.com", subject: "Checking in from Picacho" });
    expect(writeDraft({ ...base, kind: "paying" })!.message.startsWith("Hi Nadia,\n\nWe noticed")).toBe(true);
    expect(writeDraft({ ...base, kind: "cancelled" })!.subject).toBe("A quick question from Picacho");
    expect(writeDraft({ ...base, kind: "stalled" })!.message).toContain("we'll help you get it working");
    for (const kind of ["paying", "cancelled", "stalled"] as const) {
      expect(writeDraft({ ...base, kind })!.message).not.toMatch(/\bI\b|founder/i);
    }
  });

  it("offers nothing for someone who opted out or has no email", () => {
    expect(writeDraft({ ...base, kind: "paying", optedOut: true })).toBeNull();
    expect(writeDraft({ ...base, kind: "paying", email: null })).toBeNull();
  });

  it("puts a Write to them pop-up, not a mail link, on the inbox row", () => {
    const item = inboxItemFor({ ...base, id: "u1", kind: "paying", title: "t", sub: "s", at: "2026-10-01T00:00:00Z" });
    expect(item.actions[0]).toMatchObject({ type: "write", label: "Write to them", userId: "u1", to: "nadia@example.com" });
    expect(JSON.stringify(item)).not.toContain("mailto:");
  });
});
