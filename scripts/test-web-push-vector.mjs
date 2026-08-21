// Verifies src/lib/push/web-push-crypto.ts against the complete worked
// example in RFC 8291 §5 — same receiver keys, same auth secret, same salt,
// same ephemeral sender key, so the output must match the RFC's ciphertext
// byte for byte. Also sanity-checks the VAPID JWT it mints (structure +
// ES256 signature verifies against the public key).
//
// Run:  node scripts/test-web-push-vector.mjs
// (Node 24 executes the .ts import directly via built-in type stripping.)
import { createPublicKey, verify } from "node:crypto";
import { encryptWebPush, loadVapidKeys, vapidAuthHeader } from "../src/lib/push/web-push-crypto.ts";

// --- RFC 8291 §5 vector ---------------------------------------------------
const UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH_SECRET = "BTBZMqHH6r4Tts7J_aSIgg";
const AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const PLAINTEXT = "When I grow up, I want to be a watermelon";
const EXPECTED =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
  "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
  "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

const expectedBytes = Buffer.from(EXPECTED, "base64url");
// The RFC's salt is the first 16 bytes of the message itself.
const salt = expectedBytes.subarray(0, 16);

const out = encryptWebPush(UA_PUBLIC, AUTH_SECRET, Buffer.from(PLAINTEXT), {
  salt: Buffer.from(salt),
  asPrivate: Buffer.from(AS_PRIVATE, "base64url"),
});

let failures = 0;
// §5's prose says "Content-Length: 145", but that's the RFC's own erratum:
// the plaintext is 41 bytes (Appendix A), so header(21) + keyid(65) +
// ciphertext(42) + tag(16) = 144 — which is exactly what the RFC's printed
// base64url body decodes to.
if (out.length !== 144) {
  console.error(`FAIL length: got ${out.length}, expected 144`);
  failures++;
}
if (!out.equals(expectedBytes)) {
  console.error("FAIL ciphertext mismatch with RFC 8291 §5");
  console.error("  got      " + out.toString("base64url"));
  console.error("  expected " + EXPECTED);
  failures++;
} else {
  console.log("ok  RFC 8291 §5 ciphertext matches byte-for-byte (144 bytes)");
}

// --- VAPID JWT sanity -----------------------------------------------------
// Fresh throwaway pair via the same loader the app uses, then verify the
// ES256 signature with the corresponding public key.
import { generateKeyPairSync } from "node:crypto";
const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwkPub = pair.publicKey.export({ format: "jwk" });
const jwkPriv = pair.privateKey.export({ format: "jwk" });
const publicB64u = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(jwkPub.x, "base64url"),
  Buffer.from(jwkPub.y, "base64url"),
]).toString("base64url");

const keys = loadVapidKeys(publicB64u, jwkPriv.d);
if (!keys) {
  console.error("FAIL loadVapidKeys rejected a freshly generated pair");
  failures++;
} else {
  const header = vapidAuthHeader("https://fcm.googleapis.com", keys, "mailto:hello@picacho.ai");
  const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
  if (!m || m[2] !== publicB64u) {
    console.error("FAIL VAPID header structure: " + header.slice(0, 60));
    failures++;
  } else {
    const [h, c, s] = m[1].split(".");
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    const sigOk = verify(
      "sha256",
      Buffer.from(`${h}.${c}`),
      { key: createPublicKey(pair.privateKey), dsaEncoding: "ieee-p1363" },
      Buffer.from(s, "base64url"),
    );
    const claimsOk =
      claims.aud === "https://fcm.googleapis.com" &&
      claims.sub === "mailto:hello@picacho.ai" &&
      claims.exp > Date.now() / 1000 &&
      claims.exp <= Date.now() / 1000 + 24 * 3600;
    if (!sigOk) { console.error("FAIL VAPID ES256 signature does not verify"); failures++; }
    if (!claimsOk) { console.error("FAIL VAPID claims: " + JSON.stringify(claims)); failures++; }
    if (sigOk && claimsOk) console.log("ok  VAPID JWT verifies (ES256, aud/sub/exp sane)");
  }
}

process.exit(failures ? 1 : 0);
