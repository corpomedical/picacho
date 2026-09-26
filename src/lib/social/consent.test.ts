import { describe, expect, it } from "vitest";
import { buildConsent, canonicalJson, consentFromRow, consentHash, minuteIso, optionsFor } from "./consent";

const SHA = "a".repeat(64);

const tiktokConsent = () =>
  buildConsent({
    network: "tiktok",
    accountExternalId: "open-id-1",
    rendition: "clean",
    renditionSha256: SHA,
    caption: "Morning ritual.",
    hashtags: ["coffee"],
    tiktok: { privacy: "SELF_ONLY", allowComment: true, allowDuet: false, allowStitch: false, yourBrand: true, brandedContent: false },
    x: null,
    scheduledFor: null,
  });

describe("the canonical consent object (v2 #14)", () => {
  it("is one text whatever order it was built in", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: true, c: null }] })).toBe('{"a":[2,{"c":null,"d":true}],"b":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("covers the file, the words, the network, the account, privacy, toggles, the AI label, commercial flags and the time", () => {
    const base = tiktokConsent();
    const h = consentHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(base.ai_label).toBe(true);
    const changed = [
      { ...base, rendition_sha256: "b".repeat(64) },
      { ...base, caption: "Evening ritual." },
      { ...base, hashtags: ["tea"] },
      { ...base, text: base.text + " " },
      { ...base, account: "open-id-2" },
      { ...base, privacy: "FOLLOWER_OF_CREATOR" as const },
      { ...base, interactions: { comment: false, duet: false, stitch: false } },
      { ...base, commercial: { ...base.commercial, branded_content: true } },
      { ...base, scheduled_for: "2026-09-30T08:30:00.000Z" },
      { ...base, network: "x" as const },
    ];
    for (const c of changed) expect(consentHash(c)).not.toBe(h);
  });

  it("rebuilds from the stored row to the same hash (the worker's side)", () => {
    const c = tiktokConsent();
    const row = {
      network: c.network,
      accountExternalId: c.account,
      rendition: c.rendition,
      renditionSha256: c.rendition_sha256,
      caption: c.caption,
      hashtags: c.hashtags,
      options: optionsFor(c),
      scheduledFor: "2026-09-26T10:00:12.345Z",
    };
    expect(consentHash(consentFromRow(row))).toBe(consentHash(c));
    // A privacy changed on the row after consent no longer matches.
    expect(consentHash(consentFromRow({ ...row, options: { ...row.options, privacy: "PUBLIC_TO_EVERYONE" } }))).not.toBe(consentHash(c));
  });

  it("a scheduled post's time is part of it, to the minute", () => {
    const x = buildConsent({
      network: "x",
      accountExternalId: "42",
      rendition: "tagged",
      renditionSha256: SHA,
      caption: "Hi",
      hashtags: [],
      tiktok: null,
      x: { paidPartnership: false },
      scheduledFor: minuteIso("2026-09-30T08:30:59.999Z"),
    });
    expect(x.scheduled_for).toBe("2026-09-30T08:30:00.000Z");
    const row = {
      network: "x" as const,
      accountExternalId: "42",
      rendition: "tagged" as const,
      renditionSha256: SHA,
      caption: "Hi",
      hashtags: [],
      options: optionsFor(x),
      scheduledFor: "2026-09-30T08:30:00+00:00",
    };
    expect(consentHash(consentFromRow(row))).toBe(consentHash(x));
    expect(consentHash(consentFromRow({ ...row, scheduledFor: "2026-09-30T09:30:00+00:00" }))).not.toBe(consentHash(x));
  });

  it("choices that don't belong to a network never enter it", () => {
    const x = buildConsent({
      network: "x",
      accountExternalId: "42",
      rendition: "tagged",
      renditionSha256: SHA,
      caption: "Hi",
      hashtags: [],
      tiktok: { privacy: "SELF_ONLY", allowComment: true, allowDuet: true, allowStitch: true, yourBrand: true, brandedContent: true },
      x: { paidPartnership: true },
      scheduledFor: null,
    });
    expect(x.privacy).toBeNull();
    expect(x.interactions).toBeNull();
    expect(x.commercial).toEqual({ your_brand: false, branded_content: false, paid_partnership: true });
  });
});
