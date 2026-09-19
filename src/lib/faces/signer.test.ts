import { describe, expect, it } from "vitest";
import { OPENAPI_HOST, openApiDate, signOpenApiRequest } from "./signer";

// The signature BytePlus checks every face call against. The golden value was
// produced by a separate Python implementation written from the published
// scheme (hashlib/hmac, not this module), so a slip in either shows here
// before a live call answers "SignatureDoesNotMatch".

describe("the BytePlus OpenAPI signature", () => {
  const signed = signOpenApiRequest({
    action: "CreateVisualValidateSession",
    body: { CallbackURL: "https://picacho.ai/api/face-verification/callback?state=abc" },
    accessKeyId: "AKLTexampleaccesskey",
    secretAccessKey: "exampleSecretKeyForTheGoldenVector==",
    now: new Date("2026-03-28T00:00:00.000Z"),
  });

  it("matches an independent implementation of the scheme", () => {
    expect(signed.headers["X-Content-Sha256"]).toBe("7ed9ef2cf95b5c1bb20d77888a1d73561583aaa1d57bccaafbed935f0ad3a978");
    expect(signed.headers.Authorization).toBe(
      "HMAC-SHA256 Credential=AKLTexampleaccesskey/20260328/ap-southeast-1/ark/request, " +
        "SignedHeaders=content-type;host;x-content-sha256;x-date, " +
        "Signature=27a6a0cf9ad2ca402fae7fde57e38e0ae6755668c3d69c46e726e5fd0889faf4",
    );
  });

  it("sends exactly what it signed, where BytePlus's reference says", () => {
    expect(signed.url).toBe(`https://${OPENAPI_HOST}/?Action=CreateVisualValidateSession&Version=2024-01-01`);
    expect(signed.body).toBe('{"CallbackURL":"https://picacho.ai/api/face-verification/callback?state=abc"}');
    expect(signed.headers["X-Date"]).toBe("20260328T000000Z");
    expect(signed.headers.Host).toBe("ark.ap-southeast-1.byteplusapi.com");
    expect(signed.headers["Content-Type"]).toBe("application/json");
  });

  it("dates the request in the header's own form", () => {
    expect(openApiDate(new Date("2026-09-19T08:05:09.123Z"))).toBe("20260919T080509Z");
  });

  it("changes with every input it covers", () => {
    const base = { action: "GetAsset", body: { Id: "asset-1" }, accessKeyId: "AK", secretAccessKey: "SK", now: new Date("2026-09-19T00:00:00Z") };
    const sig = (over: Partial<typeof base>) => signOpenApiRequest({ ...base, ...over }).headers.Authorization.split("Signature=")[1];
    const plain = sig({});
    expect(sig({ body: { Id: "asset-2" } })).not.toBe(plain);
    expect(sig({ action: "DeleteAsset" })).not.toBe(plain);
    expect(sig({ secretAccessKey: "SK2" })).not.toBe(plain);
    expect(sig({ now: new Date("2026-09-20T00:00:00Z") })).not.toBe(plain);
    expect(sig({})).toBe(plain);
  });
});
