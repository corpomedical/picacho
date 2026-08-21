import { createECDH, createCipheriv, createPrivateKey, hkdfSync, randomBytes, sign as cryptoSign } from "node:crypto";

// The pure protocol half of Web Push: RFC 8291 payload encryption
// (aes128gcm) and RFC 8292 VAPID authorization, on node:crypto alone.
// Deliberately free of app imports so scripts/test-web-push-vector.mjs can
// load this exact module and compare its output byte-for-byte with the
// complete worked example in RFC 8291 §5 — the sender in web-push.ts uses
// the same functions, so what the test proves is what production runs.

function b64u(buf: Buffer | ArrayBuffer): string {
  return Buffer.from(buf as Buffer).toString("base64url");
}

// --- RFC 8291 payload encryption (content coding aes128gcm) --------------
//
// `deterministic` injects a fixed salt and ephemeral key so the test vector
// can be reproduced; production omits it and gets fresh randomness per send.
export function encryptWebPush(
  uaPublicB64u: string,
  authSecretB64u: string,
  plaintext: Buffer,
  deterministic?: { salt: Buffer; asPrivate: Buffer },
): Buffer {
  const uaPublic = Buffer.from(uaPublicB64u, "base64url"); // 65 bytes, 0x04…
  const authSecret = Buffer.from(authSecretB64u, "base64url"); // 16 bytes
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("bad p256dh");
  if (authSecret.length !== 16) throw new Error("bad auth secret");

  const salt = deterministic?.salt ?? randomBytes(16);
  const as = createECDH("prime256v1");
  if (deterministic) as.setPrivateKey(deterministic.asPrivate);
  else as.generateKeys();
  const asPublic = as.getPublicKey(); // 65 bytes uncompressed
  const ecdhSecret = as.computeSecret(uaPublic);

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua || as)
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  // Single record: plaintext + 0x02 last-record delimiter, no extra padding.
  const record = Buffer.concat([plaintext, Buffer.from([2])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  // RFC 8188 header: salt(16) | record size uint32 | keyid length | keyid(=as_public)
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

// --- RFC 8292 VAPID -------------------------------------------------------

export type VapidKeys = { publicB64u: string; privateKey: ReturnType<typeof createPrivateKey> };

export function loadVapidKeys(publicB64u?: string, privateB64u?: string): VapidKeys | null {
  if (!publicB64u || !privateB64u) return null;
  try {
    const pub = Buffer.from(publicB64u, "base64url");
    if (pub.length !== 65 || pub[0] !== 4) return null;
    const privateKey = createPrivateKey({
      key: {
        kty: "EC",
        crv: "P-256",
        d: privateB64u,
        x: b64u(pub.subarray(1, 33)),
        y: b64u(pub.subarray(33, 65)),
      },
      format: "jwk",
    });
    return { publicB64u, privateKey };
  } catch {
    return null;
  }
}

export function vapidAuthHeader(endpointOrigin: string, keys: VapidKeys, subject: string): string {
  const claims = {
    aud: endpointOrigin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  };
  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc(claims)}`;
  // JWS ES256 wants the raw 64-byte r||s form, not DER.
  const signature = cryptoSign("sha256", Buffer.from(unsigned), {
    key: keys.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${unsigned}.${b64u(signature)}, k=${keys.publicB64u}`;
}
