// Does face verification reach BytePlus? One harmless read — how many
// real-person groups exist — signed with the access key pair the feature uses
// (src/lib/faces/). Read-only: nothing is created, nothing is charged.
//
//   npx tsx --env-file=.env.local scripts/check-face-verification.mts
//
// What the answer means:
//   OK, N groups                 keys, signature and entitlement all work
//   SignatureDoesNotMatch        the key pair is wrong (or its secret mistyped)
//   InvalidAccessKey / 401       the access key id is unknown
//   AccessDenied / 403           the key's user lacks ArkFullAccess, or the
//                                Assets API is not enabled on the account
//                                (Advanced Creation Rights, Entry tier)

import { signOpenApiRequest } from "../src/lib/faces/signer.ts";

const accessKeyId = process.env.BYTEPLUS_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.BYTEPLUS_SECRET_ACCESS_KEY?.trim();
if (!accessKeyId || !secretAccessKey) {
  console.log("Missing BYTEPLUS_ACCESS_KEY_ID / BYTEPLUS_SECRET_ACCESS_KEY in the environment.");
  process.exit(1);
}

const signed = signOpenApiRequest({
  action: "ListAssetGroups",
  body: { Filter: { GroupType: "LivenessFace" }, MaxResults: 10 },
  accessKeyId,
  secretAccessKey,
  now: new Date(),
});
const res = await fetch(signed.url, { method: "POST", headers: signed.headers, body: signed.body });
const text = await res.text();
let body: { ResponseMetadata?: { Error?: { Code?: string; Message?: string } }; Result?: { Items?: unknown[]; TotalCount?: number } } = {};
try {
  body = JSON.parse(text);
} catch {
  // leave empty
}
const error = body.ResponseMetadata?.Error;
if (!res.ok || error?.Code) {
  console.log(`NOT OK (${res.status}): ${error?.Code ?? ""} ${error?.Message ?? text.slice(0, 300)}`);
  process.exit(1);
}
const count = body.Result?.TotalCount ?? body.Result?.Items?.length ?? 0;
console.log(`OK, ${count} real-person group${count === 1 ? "" : "s"} on the account.`);
