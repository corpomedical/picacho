// BytePlus OpenAPI request signing (2026-09-19) — the AK/SK plane the face
// verification and asset calls live on, which the Bearer-token inference host
// in providers/byteplus.ts does not reach. Pure and alias-free so it is tested
// on its own.
//
// THE SCHEME, read from BytePlus's own API reference (CreateVisualValidateSession,
// GetVisualValidateResult, CreateAsset, GetAsset, DeleteAssetGroup — all
// 2026-08-31/09-04): every call is
//
//   POST https://ark.ap-southeast-1.byteplusapi.com/?Action=<Action>&Version=2024-01-01
//   Content-Type: application/json
//   X-Date: 20260328T000000Z
//   X-Content-Sha256: <hex sha256 of the body>
//   Authorization: HMAC-SHA256 Credential=<AK>/20260328/ap-southeast-1/ark/request,
//                  SignedHeaders=content-type;host;x-content-sha256;x-date,
//                  Signature=<hex>
//
// which is Volcengine's SignerV4 (the signer their knowledge-base reference
// names, `volcengine.auth.SignerV4`): an AWS-SigV4-shaped canonical request and
// string to sign, with the signing key derived from the raw secret — no
// "AWS4" prefix — through date, region, service and the literal "request".

import { createHash, createHmac } from "node:crypto";

export const OPENAPI_HOST = "ark.ap-southeast-1.byteplusapi.com";
export const OPENAPI_REGION = "ap-southeast-1";
export const OPENAPI_SERVICE = "ark";
export const OPENAPI_VERSION = "2024-01-01";

const SIGNED_HEADERS = "content-type;host;x-content-sha256;x-date";

const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value, "utf8").digest();

/** RFC 3986 encoding, the canonical query's own. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 20260328T000000Z — the X-Date header, and its first eight characters are the scope's date. */
export function openApiDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export type SignedRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

/**
 * Signs one OpenAPI call. Everything the signature covers is returned, so the
 * caller sends exactly what was signed.
 */
export function signOpenApiRequest(input: {
  action: string;
  body: Record<string, unknown>;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
  host?: string;
  region?: string;
  version?: string;
}): SignedRequest {
  const host = input.host ?? OPENAPI_HOST;
  const region = input.region ?? OPENAPI_REGION;
  const version = input.version ?? OPENAPI_VERSION;
  const body = JSON.stringify(input.body);
  const xDate = openApiDate(input.now);
  const shortDate = xDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const contentType = "application/json";

  const query = [
    ["Action", input.action],
    ["Version", version],
  ]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .join("&");

  const canonicalHeaders =
    `content-type:${contentType}\n` + `host:${host}\n` + `x-content-sha256:${payloadHash}\n` + `x-date:${xDate}\n`;
  const canonicalRequest = ["POST", "/", query, canonicalHeaders, SIGNED_HEADERS, payloadHash].join("\n");
  const scope = `${shortDate}/${region}/${OPENAPI_SERVICE}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(input.secretAccessKey, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, OPENAPI_SERVICE);
  const kSigning = hmac(kService, "request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return {
    url: `https://${host}/?${query}`,
    body,
    headers: {
      "Content-Type": contentType,
      Host: host,
      "X-Date": xDate,
      "X-Content-Sha256": payloadHash,
      Authorization: `HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`,
    },
  };
}
