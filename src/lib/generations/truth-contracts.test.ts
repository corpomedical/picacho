import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MODEL_CAPABILITIES } from "./send-plan";
import { VIDEO_MODELS } from "./providers/video-models";
import { MEDIA_BUCKETS } from "../media/url";
import { USER_STORAGE_BUCKETS } from "../profile/storage-buckets";
import { CANONICAL_ORIGIN, KNOWN_APP_HOSTS, PURCHASE_ORIGIN } from "../domains";

// THE DUPLICATED-TRUTH CONTRACTS (2026-09-05 audit).
//
// Several facts in this codebase deliberately live in two layers — a pure
// client-safe copy and a server enforcement — held together, until now, by
// comments saying "update both in the same commit". Every finding in the
// audit's drift cluster traced back to one of these pairs desyncing. These
// tests are the mechanism the comments never were: edit one side alone and
// the suite fails, naming the other side.
//
// Where both sides are importable, the test imports both. Where a side
// lives in a "use server" action or an 8,000-line client component, the
// test pins the SOURCE (the same style provider-url.test.ts established) —
// cruder, but it catches exactly the one-sided edit that has already
// shipped four incidents.

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("bucket roster: served ⊆ erased", () => {
  it("every bucket the media route serves is swept by account deletion", () => {
    // The half-update this pins against already happened: generated-videos
    // existed in one list and not the other for a day, during which deleted
    // accounts left videos of real faces orphaned in storage.
    for (const bucket of MEDIA_BUCKETS) {
      expect(USER_STORAGE_BUCKETS, `media route serves "${bucket}" but deletion never sweeps it`).toContain(
        bucket,
      );
    }
  });
});

describe("domain truth has one home", () => {
  it("the canonical origin's host is a known app host", () => {
    expect(KNOWN_APP_HOSTS).toContain(new URL(CANONICAL_ORIGIN).hostname);
  });

  it("purchase origin is the deliberate sibling domain", () => {
    expect(new URL(PURCHASE_ORIGIN).hostname).toBe("picacho.io");
  });

  it("origin/client-origin/robots/sitemap all consume lib/domains", () => {
    for (const file of ["../origin.ts", "../client-origin.ts", "../../app/robots.ts", "../../app/sitemap.ts"]) {
      expect(src(file), `${file} must import from lib/domains, not re-declare a domain`).toContain(
        'from "@/lib/domains"',
      );
    }
  });

  it("the picacho.app placeholder domain is gone", () => {
    // A THIRD domain the product never shipped on, which robots.txt and the
    // sitemap fell back to.
    for (const file of ["../../app/robots.ts", "../../app/sitemap.ts", "../origin.ts", "../client-origin.ts"]) {
      expect(src(file)).not.toContain("picacho.app");
    }
  });
});

describe("MODEL_CAPABILITIES vs the fal adapter", () => {
  const fal = src("./providers/fal.ts");

  it("every video model in the catalog has a capabilities row", () => {
    for (const m of VIDEO_MODELS) {
      expect(MODEL_CAPABILITIES, `catalog model "${m.id}" missing from MODEL_CAPABILITIES`).toHaveProperty(
        m.id,
      );
    }
  });

  it("fal's identity budget literals agree with the matrix", () => {
    // fal.ts hardcodes `modelId === "minimax-h3" ? 5 : 4` as its slicing
    // budget; the matrix carries the same claim as identity.max. This pin
    // fails the commit that moves either number alone.
    const m = fal.match(/identityBudget = modelId === "minimax-h3" \? (\d+) : (\d+)/);
    expect(m, "fal.ts identityBudget literal moved — update this pin AND the matrix together").not.toBeNull();
    expect(Number(m![1])).toBe(MODEL_CAPABILITIES["minimax-h3"].identity.max);
    // The default budget must cover every multi-photo (citation/elements)
    // video lane and be exceeded only by minimax's deliberate 5.
    for (const [id, caps] of Object.entries(MODEL_CAPABILITIES)) {
      if (caps.kind !== "video" || id === "minimax-h3") continue;
      if (caps.identity.mechanism === "citation" || caps.identity.mechanism === "elements") {
        expect(caps.identity.max, `${id} identity.max exceeds fal's default slicing budget`).toBeLessThanOrEqual(
          Number(m![2]),
        );
      }
    }
  });

  it("multiPerson is claimed exactly where the server accepts it", () => {
    // Server truth (actions.ts): multi-character video needs Kling 1.6. The
    // matrix claiming it elsewhere is how the receipt said "cast: native"
    // on sends the server refused (fixed 2026-09-05; this keeps it fixed).
    const multiPersonVideo = Object.entries(MODEL_CAPABILITIES)
      .filter(([, caps]) => caps.kind === "video" && caps.multiPerson)
      .map(([id]) => id);
    expect(multiPersonVideo).toEqual(["kling"]);
    expect(src("./actions.ts")).toContain("Using multiple characters together needs Kling 1.6");
  });
});

describe("the price quoted is computed from the same helpers as the price charged", () => {
  // The client composer quotes; the server action charges. The AMOUNTS come
  // from shared helpers in video-models.ts — this pins that BOTH sides keep
  // calling every shared helper, so a surcharge added or removed on one
  // side alone fails here instead of shipping as a misquote (the class
  // behind the 9-quoted-45-charged multi-angle incident and the dialogue
  // surcharge the TOTAL omitted until 2026-09-05).
  const client = src("../../components/generate-form.tsx");
  const server = src("./actions.ts");
  const sharedHelpers = [
    "fanoutCreditCost(",
    "getDialogueCreditWeight(",
    "storyboardFrameExtraCredits(",
    "continuationExtraCredits(",
    "resolutionCreditWeight(",
  ];

  for (const helper of sharedHelpers) {
    it(`${helper.slice(0, -1)} is consulted by both the quote and the charge`, () => {
      expect(client, `composer quote no longer calls ${helper}`).toContain(helper);
      expect(server, `server charge no longer calls ${helper}`).toContain(helper);
    });
  }

  it("both sides gate the dialogue surcharge on a dialogue being present", () => {
    expect(server).toMatch(/wantsDialogue \? getDialogueCreditWeight/);
    expect(client).toMatch(/dialogueText\.trim\(\)\.length > 0\s*\? getDialogueCreditWeight/);
  });
});
