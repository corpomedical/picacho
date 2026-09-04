import { afterEach, describe, expect, it } from "vitest";
import {
  isByteplusCapable,
  providerFromPayload,
  providerKeyNameFor,
  videoProviderFor,
} from "./video-provider";

// The routing decision is the whole safety story of this lane: get it wrong
// in one direction and customer renders go to an unproven provider the moment
// a key lands in Vercel; wrong in the other and the lane never engages.
const KEY = "BYTEPLUS_ARK_API_KEY";
const FLAG = "BYTEPLUS_SEEDANCE_LANE";

function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    run();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

afterEach(() => {
  delete process.env[KEY];
  delete process.env[FLAG];
});

describe("videoProviderFor", () => {
  it("stays on fal when neither switch is set", () => {
    withEnv({ [KEY]: undefined, [FLAG]: undefined }, () => {
      expect(videoProviderFor("seedance")).toBe("fal");
      expect(videoProviderFor("seedance-2")).toBe("fal");
    });
  });

  // The scenario this guard exists for: the operator adds the key to make ONE
  // proving call, and every customer's Seedance render silently changes
  // provider before anyone has watched the lane work.
  it("stays on fal when the key is present but the lane is not switched on", () => {
    withEnv({ [KEY]: "ark-test", [FLAG]: undefined }, () => {
      expect(videoProviderFor("seedance")).toBe("fal");
    });
  });

  it("stays on fal when the lane is on but no key is configured", () => {
    withEnv({ [KEY]: undefined, [FLAG]: "on" }, () => {
      expect(videoProviderFor("seedance-2")).toBe("fal");
    });
  });

  it("routes the two Seedance rows to BytePlus only when both switches are set", () => {
    withEnv({ [KEY]: "ark-test", [FLAG]: "on" }, () => {
      expect(videoProviderFor("seedance")).toBe("byteplus");
      expect(videoProviderFor("seedance-2")).toBe("byteplus");
    });
  });

  it("never routes a model ModelArk cannot run, however the switches are set", () => {
    withEnv({ [KEY]: "ark-test", [FLAG]: "on" }, () => {
      for (const id of ["kling", "kling-2.5", "kling-o3", "kling-o3-pro", "minimax-h3", "veo", "wan-turbo", "gemini-omni"]) {
        expect(videoProviderFor(id)).toBe("fal");
      }
    });
  });

  it("only accepts the exact flag value", () => {
    for (const value of ["ON", "true", "1", "yes", ""]) {
      withEnv({ [KEY]: "ark-test", [FLAG]: value }, () => {
        expect(videoProviderFor("seedance")).toBe("fal");
      });
    }
  });
});

describe("isByteplusCapable", () => {
  it("covers exactly the two Seedance rows", () => {
    expect(isByteplusCapable("seedance")).toBe(true);
    expect(isByteplusCapable("seedance-2")).toBe(true);
    expect(isByteplusCapable("kling")).toBe(false);
  });

  // ARK_MODELS is a plain object literal, so a model id that collides with an
  // Object.prototype member would otherwise read as "capable" and be sent to
  // ModelArk under a model id of "function toString".
  it("is not fooled by prototype members", () => {
    expect(isByteplusCapable("toString")).toBe(false);
    expect(isByteplusCapable("constructor")).toBe(false);
    expect(isByteplusCapable("hasOwnProperty")).toBe(false);
  });
});

describe("providerFromPayload", () => {
  // The load-bearing case: every job row written before this lane existed has
  // a payload with only a label. Those renders are at fal and must keep being
  // polled at fal, including the ones in flight when this deploys.
  it("reads a row from before the lane existed as fal", () => {
    expect(providerFromPayload({ label: "Seedance 2.0" })).toBe("fal");
    expect(providerFromPayload(null)).toBe("fal");
    expect(providerFromPayload(undefined)).toBe("fal");
    expect(providerFromPayload({})).toBe("fal");
  });

  it("reads back what the submit wrote", () => {
    expect(providerFromPayload({ label: "Seedance 2.0", provider: "byteplus" })).toBe("byteplus");
    expect(providerFromPayload({ label: "Kling 1.6", provider: "fal" })).toBe("fal");
  });

  it("treats anything unrecognised as fal rather than guessing", () => {
    expect(providerFromPayload({ provider: "bytePlus" })).toBe("fal");
    expect(providerFromPayload({ provider: 7 })).toBe("fal");
    expect(providerFromPayload("byteplus")).toBe("fal");
  });
});

describe("providerKeyNameFor", () => {
  it("names the key the pre-credit gate must check", () => {
    withEnv({ [KEY]: "ark-test", [FLAG]: "on" }, () => {
      expect(providerKeyNameFor("seedance")).toBe("BYTEPLUS_ARK_API_KEY");
      expect(providerKeyNameFor("kling")).toBe("FAL_KEY");
    });
    withEnv({ [KEY]: undefined, [FLAG]: undefined }, () => {
      expect(providerKeyNameFor("seedance")).toBe("FAL_KEY");
    });
  });
});
