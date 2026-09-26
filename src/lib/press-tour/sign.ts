// C2PA provenance on every Press Tour rendition (Cut 4; spec §1.10 step 10,
// synthesis v2 #25; docs/AI_ACT_MARKING.md option B; EU AI Act Art. 50,
// applying since 2 Aug 2026).
//
// THE SEAM, NOT A SIGNER. Signing needs two things this server does not have
// yet: the signing certificate and its key (PRESS_C2PA_CERT /
// PRESS_C2PA_KEY, applied for in Cut 0) and a maintained C2PA library
// (package.json has none, and packages are not installed from here). So:
//   - with neither, every rendition is delivered UNSIGNED, with
//     `signed: false` and an Admin-visible reason (film-messages.ts
//     SIGN_*), never a word to the customer that it was signed;
//   - when a library is wired (C2paLibrary below, one adapter in
//     campaign-runtime.ts) and both are set, each rendition is signed
//     AFTER its last encode (a re-encode strips a manifest) with a
//     trainedAlgorithmicMedia assertion, and counted as signed only when
//     the manifest is read back from the very bytes that are delivered:
//     the structural probe (media/c2pa-probe.ts) AND the library's own
//     validator.
// NEVER CLAIM SIGNING THAT DIDN'T HAPPEN: every path that is not a verified
// signature answers `signed: false` with the original bytes.
//
// Alias-free (vitest has no "@/"): sign.test.ts imports it as it is.

import { hasC2paManifest } from "../media/c2pa-probe";
import { SIGN_FAILED, SIGN_NO_LIBRARY, SIGN_NOT_CONFIGURED, SIGN_NOT_VERIFIED } from "./film-messages";

/** IPTC's term for media made by a trained model (the assertion every rendition carries). */
export const TRAINED_ALGORITHMIC_MEDIA = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

/** The manifest a rendition is signed with: made by Picacho Press Tour, created by a trained model. */
export function pressManifest(input: { title: string; kind: "clean" | "tagged" }) {
  return {
    claim_generator: "Picacho Press Tour",
    title: input.title.slice(0, 120),
    format: "video/mp4",
    assertions: [
      {
        label: "c2pa.actions",
        data: { actions: [{ action: "c2pa.created", digitalSourceType: TRAINED_ALGORITHMIC_MEDIA }] },
      },
      { label: "picacho.rendition", data: { kind: input.kind } },
    ],
  };
}

/** What a maintained C2PA library must offer to be wired in (one adapter, in campaign-runtime.ts). */
export interface C2paLibrary {
  sign(input: { bytes: Buffer; mime: "video/mp4"; certPem: string; keyPem: string; manifest: ReturnType<typeof pressManifest> }): Promise<Buffer>;
  /** The library's own validator on the signed bytes: true only for a valid manifest. */
  verify(bytes: Buffer): Promise<boolean>;
}

export type SignOutcome = { signed: true; bytes: Buffer; reason: null } | { signed: false; bytes: Buffer; reason: string };

export interface RenditionSigner {
  /** Both the certificate and a library are there. */
  configured: boolean;
  /** Why not, for Admin (English), or null. */
  reason: string | null;
  sign(bytes: Buffer, meta: { title: string; kind: "clean" | "tagged" }): Promise<SignOutcome>;
}

/** The signer this environment can build. `library` is null until a maintained C2PA package is installed and adapted. */
export function c2paSigner(env: Record<string, string | undefined>, library: C2paLibrary | null): RenditionSigner {
  const certPem = env.PRESS_C2PA_CERT?.trim() ?? "";
  const keyPem = env.PRESS_C2PA_KEY?.trim() ?? "";
  const reason = !certPem || !keyPem ? SIGN_NOT_CONFIGURED : !library ? SIGN_NO_LIBRARY : null;
  if (reason !== null || !library) {
    return {
      configured: false,
      reason: reason ?? SIGN_NO_LIBRARY,
      sign: async (bytes) => ({ signed: false, bytes, reason: reason ?? SIGN_NO_LIBRARY }),
    };
  }
  return {
    configured: true,
    reason: null,
    sign: async (bytes, meta) => {
      let out: Buffer;
      try {
        out = await library.sign({ bytes, mime: "video/mp4", certPem, keyPem, manifest: pressManifest(meta) });
      } catch {
        return { signed: false, bytes, reason: SIGN_FAILED };
      }
      // Counted as signed only when BOTH readers find the manifest in these very bytes.
      const verified = Buffer.isBuffer(out) && out.length > 0 && hasC2paManifest(out) && (await library.verify(out).catch(() => false));
      return verified ? { signed: true, bytes: out, reason: null } : { signed: false, bytes, reason: SIGN_NOT_VERIFIED };
    },
  };
}
