import { describe, expect, it } from "vitest";
import { postFrom, renditionsFrom } from "./store";

const SHA = "d".repeat(64);

describe("the cut's files, as the posting side reads them (press-tour/cut-state.ts records)", () => {
  it("takes the signed file's path and sha256, in press-kit", () => {
    const r = renditionsFrom(
      {
        clean: { kind: "clean", path: "u/cuts/c/clean-dddd-c2pa.mp4", sha256: SHA, seconds: 15, bytes: 1234, signed: true, signedAt: "2026-09-26T10:00:00.000Z", reason: null, settled: true },
        tagged: { kind: "tagged", path: "u/cuts/c/tagged-dddd.mp4", sha256: SHA, seconds: 15, bytes: 1234, signed: false, signedAt: null, reason: "Unsigned: no certificate.", settled: true },
      },
      "press-kit",
    );
    expect(r.clean).toEqual({ kind: "clean", bucket: "press-kit", path: "u/cuts/c/clean-dddd-c2pa.mp4", sha256: SHA, sizeBytes: 1234, durationSeconds: 15, posterPath: null, signed: true });
    expect(r.tagged?.signed).toBe(false);
  });

  it("signed without a recorded time is NOT signed; a file without its sha256 is left out", () => {
    const r = renditionsFrom({ clean: { path: "p", sha256: SHA, signed: true }, tagged: { path: "p2", signed: true, signedAt: "2026-09-26T10:00:00.000Z" } }, "press-kit");
    expect(r.clean?.signed).toBe(false);
    expect(r.tagged).toBeUndefined();
    expect(renditionsFrom(null, "press-kit")).toEqual({});
  });
});

describe("a queue row, read back", () => {
  it("needs a known network, stage and file kind", () => {
    const base = { id: "p", user_id: "u", network: "x", stage: "queued", rendition: "tagged", options: { when: "now" }, ai_label: true, hashtags: ["a"] };
    expect(postFrom(base)).toMatchObject({ id: "p", network: "x", stage: "queued", rendition: "tagged", options: { when: "now" }, aiLabel: true, hashtags: ["a"] });
    expect(postFrom({ ...base, network: "myspace" })).toBeNull();
    expect(postFrom({ ...base, stage: "sent" })).toBeNull();
    expect(postFrom({ ...base, rendition: "endcard" })).toBeNull();
    // Anything but an explicit "scheduled" reads as "now".
    expect(postFrom({ ...base, options: { when: "later" } })?.options.when).toBe("now");
  });
});
