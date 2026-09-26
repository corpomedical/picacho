import { describe, expect, it, vi } from "vitest";
import { SIGN_FAILED, SIGN_NO_LIBRARY, SIGN_NOT_CONFIGURED, SIGN_NOT_VERIFIED } from "./film-messages";
import { TRAINED_ALGORITHMIC_MEDIA, c2paSigner, pressManifest, type C2paLibrary } from "./sign";

// The C2PA seam (Cut 4; spec §1.10 step 10, v2 #25): never claim signing
// that didn't happen. No library is installed today, so every rendition is
// delivered unsigned with an Admin-visible reason.

const VIDEO = Buffer.from("....ftypisom....mdat....");
const CERT = { PRESS_C2PA_CERT: "-----BEGIN CERTIFICATE-----x", PRESS_C2PA_KEY: "-----BEGIN PRIVATE KEY-----y" };
/** A fake library's output that really carries a manifest store label. */
const SIGNED = Buffer.concat([VIDEO, Buffer.from("uuid....jumbjumdc2pa....")]);

describe("the signing seam", () => {
  it("no certificate: unsigned, the bytes untouched, and why (for Admin)", async () => {
    const signer = c2paSigner({}, null);
    expect(signer).toMatchObject({ configured: false, reason: SIGN_NOT_CONFIGURED });
    const out = await signer.sign(VIDEO, { title: "Ad", kind: "tagged" });
    expect(out).toEqual({ signed: false, bytes: VIDEO, reason: SIGN_NOT_CONFIGURED });
  });

  it("a certificate but no library (today): unsigned, and why", async () => {
    const signer = c2paSigner(CERT, null);
    expect(signer).toMatchObject({ configured: false, reason: SIGN_NO_LIBRARY });
    expect((await signer.sign(VIDEO, { title: "Ad", kind: "clean" })).signed).toBe(false);
  });

  it("a library with no certificate never runs", async () => {
    const lib: C2paLibrary = { sign: vi.fn(async () => SIGNED), verify: vi.fn(async () => true) };
    const out = await c2paSigner({ PRESS_C2PA_CERT: "x" }, lib).sign(VIDEO, { title: "Ad", kind: "clean" });
    expect(out.signed).toBe(false);
    expect(lib.sign).not.toHaveBeenCalled();
  });

  it("signed only when the manifest is read back from the very bytes, by BOTH readers", async () => {
    const good: C2paLibrary = { sign: vi.fn(async () => SIGNED), verify: vi.fn(async () => true) };
    const out = await c2paSigner(CERT, good).sign(VIDEO, { title: "Morning ritual", kind: "tagged" });
    expect(out).toEqual({ signed: true, bytes: SIGNED, reason: null });
    expect(good.sign).toHaveBeenCalledWith(expect.objectContaining({ mime: "video/mp4", manifest: pressManifest({ title: "Morning ritual", kind: "tagged" }) }));

    // The library says it signed, but no manifest is in the file: unsigned.
    const liar: C2paLibrary = { sign: vi.fn(async () => VIDEO), verify: vi.fn(async () => true) };
    expect(await c2paSigner(CERT, liar).sign(VIDEO, { title: "Ad", kind: "clean" })).toEqual({ signed: false, bytes: VIDEO, reason: SIGN_NOT_VERIFIED });

    // The manifest is there, but the validator refuses it: unsigned, the ORIGINAL bytes delivered.
    const invalid: C2paLibrary = { sign: vi.fn(async () => SIGNED), verify: vi.fn(async () => false) };
    expect(await c2paSigner(CERT, invalid).sign(VIDEO, { title: "Ad", kind: "clean" })).toEqual({ signed: false, bytes: VIDEO, reason: SIGN_NOT_VERIFIED });

    // The signer throws: unsigned.
    const broken: C2paLibrary = { sign: vi.fn(async () => Promise.reject(new Error("boom"))), verify: vi.fn(async () => true) };
    expect(await c2paSigner(CERT, broken).sign(VIDEO, { title: "Ad", kind: "clean" })).toEqual({ signed: false, bytes: VIDEO, reason: SIGN_FAILED });
  });

  it("the manifest says a trained model made it (IPTC trainedAlgorithmicMedia)", () => {
    const m = pressManifest({ title: "x".repeat(300), kind: "clean" });
    expect(JSON.stringify(m)).toContain(TRAINED_ALGORITHMIC_MEDIA);
    expect(m.title.length).toBe(120);
    expect(m.format).toBe("video/mp4");
  });
});
