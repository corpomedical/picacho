import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { MODEL_CAPABILITIES } from "./send-plan";
import { VIDEO_MODELS } from "./providers/video-models";
import { MEDIA_BUCKETS } from "../media/url";
import { USER_STORAGE_BUCKETS } from "../profile/storage-buckets";
import { CANONICAL_ORIGIN, KNOWN_APP_HOSTS, PURCHASE_ORIGIN } from "../domains";
import { MAPPED_SERVER_STRINGS, NOTHING_CHARGED_TAIL } from "../i18n/server-text";

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
    // sitemap fell back to — and, until 2026-09-08, the support-address
    // fallback in the app shell and the settings page. Both now read
    // SUPPORT_EMAIL_FALLBACK from lib/domains.
    for (const file of [
      "../../app/robots.ts",
      "../../app/sitemap.ts",
      "../origin.ts",
      "../client-origin.ts",
      "../../app/app/layout.tsx",
      "../../app/app/settings/page.tsx",
    ]) {
      expect(src(file)).not.toContain("picacho.app");
    }
  });
});

describe("sitemap: every public page registers itself", () => {
  // PUBLIC_ROUTES in app/sitemap.ts is maintained by hand, and twice a public
  // page shipped without joining it — the course on 2026-08-25, the API
  // reference on 2026-09-08 — which for a page that exists to rank is the
  // whole point missed. This walks the app directory instead of trusting the
  // list. Read as text rather than imported: sitemap.ts imports "@/lib/domains"
  // (a contract asserted above) and vitest has no "@/" alias.
  it("lists every page.tsx outside the app, admin, auth and account flows", () => {
    const appDir = new URL("../../app/", import.meta.url);
    const listed = new Set(
      [...src("../../app/sitemap.ts").matchAll(/"(\/[^"]*|)"/g)].map((m) => m[1] || "/"),
    );
    // Not for indexing, on purpose: the account doors and the token-landing
    // pages. Anything else public belongs in the sitemap.
    const deliberatelyUnlisted = new Set([
      "/login",
      "/signup",
      "/forgot-password",
      "/reset-password",
      "/admin-verify",
      "/verify-2fa",
    ]);
    const pages: string[] = [];
    const walk = (dir: URL, route: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const seg = entry.name;
          if (seg.startsWith("(")) walk(new URL(`${seg}/`, dir), route);
          else walk(new URL(`${seg}/`, dir), `${route}/${seg}`);
        } else if (entry.name === "page.tsx") {
          pages.push(route || "/");
        }
      }
    };
    walk(appDir, "");
    const missing = pages.filter(
      (p) =>
        !p.startsWith("/app") &&
        !p.startsWith("/admin") &&
        !p.startsWith("/auth") &&
        !p.includes("[") &&
        !deliberatelyUnlisted.has(p) &&
        !listed.has(p),
    );
    expect(missing, `public pages missing from PUBLIC_ROUTES: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("database functions: every SECURITY DEFINER function is accounted for", () => {
  // A SECURITY DEFINER function runs with its owner's rights, and PostgreSQL
  // grants EXECUTE on every new function to PUBLIC. So each one is either
  // probed by scripts/verify-db.mjs with the anon key (PRIVATE_RPCS — must
  // answer 42501) or named here as callable by design, because its body
  // checks auth.uid() / is_admin() or it is a trigger that PostgREST cannot
  // call with arguments. On 2026-09-09 drip_candidates() was neither, had
  // been revoked from anon and authenticated but never from PUBLIC, and
  // answered the anonymous key with other people's email addresses. A
  // function added tomorrow lands in this test before it lands in
  // production's anon-reachable surface.
  it("is either probed as private or allow-listed as callable", () => {
    const schema = src("../../../supabase/schema.sql");
    const verifyDb = src("../../../scripts/verify-db.mjs");
    const privateList = new Set(
      [...(verifyDb.match(/const PRIVATE_RPCS = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]),
    );
    // Callable by a signed-in user or a visitor on purpose. Each checks its
    // caller inside, or is a trigger function with no RPC surface.
    const callableByDesign = new Set([
      "admin_traffic_daily", // raises unless is_admin()
      "is_admin", // the check itself; reads only the caller's own row
      "record_community_hide", // trigger
      "record_community_view", // auth.uid() scoped
      "record_user_activity", // auth.uid() scoped
      "report_community_post", // auth.uid() scoped
      "share_to_community", // auth.uid() scoped
      "username_available", // signup needs it before sign-in
      "community_hearts_bump", // trigger
      "handle_new_user", // trigger
      "reward_referral_on_success", // trigger
      "sync_profile_email", // trigger
    ]);
    const definers: string[] = [];
    for (const chunk of schema.split(/(?=CREATE OR REPLACE FUNCTION public\.)/).slice(1)) {
      const name = chunk.match(/^CREATE OR REPLACE FUNCTION public\.(\w+)\(/)?.[1];
      const end = chunk.indexOf("$function$;");
      const body = chunk.slice(0, end > 0 ? end : 4000);
      if (name && body.includes("SECURITY DEFINER")) definers.push(name);
    }
    expect(definers.length).toBeGreaterThan(20);
    const unaccounted = [...new Set(definers)].filter((f) => !privateList.has(f) && !callableByDesign.has(f));
    expect(
      unaccounted,
      `SECURITY DEFINER functions neither probed by verify-db nor allow-listed: ${unaccounted.join(", ")}`,
    ).toEqual([]);
    // And the reverse: a probed name that no longer exists is a typo in the
    // probe, which would report a false "ok".
    const stale = [...privateList].filter((f) => !definers.includes(f));
    expect(stale, `PRIVATE_RPCS names functions not in schema.sql: ${stale.join(", ")}`).toEqual([]);
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

describe("the price quoted and the price charged come from the same function", () => {
  // The client composer quotes; the server action charges. Both now go
  // through quoteSend (lib/generations/quote.ts) — the extraction that
  // closed the misquote class behind the 9-quoted-45-charged multi-angle
  // incident and the dialogue surcharge the TOTAL omitted until 2026-09-05.
  // These pins fail the commit that quietly reintroduces a side computing
  // its own price; quote.test.ts pins the amounts themselves against the
  // incident matrix.
  const client = src("../../components/generate-form.tsx");
  const server = src("./actions.ts");
  const quote = src("./quote.ts");

  it("the composer quotes through quoteSend", () => {
    expect(client).toContain("quoteSend(");
  });

  it("the server prices both charge paths (single send AND fan-out) through quoteSend", () => {
    expect(server.match(/quoteSend\(\{/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("every shared pricing helper is consulted by the one quote", () => {
    for (const helper of [
      "fanoutCreditCost(",
      "getDialogueCreditWeight(",
      "storyboardFrameExtraCredits(",
      "continuationExtraCredits(",
      "resolutionCreditWeight(",
      "storyboardCreditCost(",
    ]) {
      expect(quote, `quoteSend no longer calls ${helper}`).toContain(helper);
    }
  });

  it("the storyboard weight formula has one home", () => {
    // It used to be written out twice — costPerSecondUsd/0.28 in actions.ts,
    // a bare *0.5 in the composer. Both now call storyboardCreditCost.
    expect(client).toContain("storyboardCreditCost(");
    expect(server).not.toMatch(/costPerSecondUsd \?\? 0\.14/);
    expect(client).not.toMatch(/storyboardTotalSeconds \* 0\.5/);
  });
});
describe("localized server strings still match what the server says", () => {
  // localizeServerText maps EXACT English wire strings to catalog entries.
  // If a server message is reworded without updating the map, the localized
  // app silently falls back to English for that string — this pin makes the
  // reword loud instead. Source literals wrapped across lines with '+' are
  // reconstituted before matching.
  const serverSource = [
    "./actions.ts",
    "./core.ts",
    "./job-runner.ts",
    "./angle-stage.ts",
    // The image models' safety refusals, thrown by openai-images.ts and
    // fal-image.ts and shown as a render's failure reason.
    "./providers/refusal-messages.ts",
    // Our own content gates' refusals: the prompt gate's refusalMessages and
    // the picture gate's sentences — an action's error, or a render's
    // validate step.
    "./content-policy.ts",
    "./output-policy.ts",
    // Sharing to the community feed, the feed gate's refusals among them —
    // the share button's error line.
    "../community/actions.ts",
    // Sets: every sentence its actions and pages return.
    "../sets/messages.ts",
  ]
    .map((p) => src(p))
    .join("\n")
    .replace(/["'`]\s*\+\s*["'`]/g, "")
    .replace(/\\"/g, '"');

  for (const wire of MAPPED_SERVER_STRINGS) {
    it(`server still says: "${wire.slice(0, 56)}…"`, () => {
      expect(serverSource, `the server no longer produces this exact string — update lib/i18n/server-text.ts (and the four catalogs) in the same commit`).toContain(wire);
    });
  }

  it("the layer-edit lane still ends a failure's reason with the sentence the translator strips", () => {
    // localizeServerText translates `<mapped reason> Nothing was charged.`
    // whole; reword or move the tail and the lane's refusal reads English.
    expect(src("./actions.ts")).toContain(`{ error: \`\${message.slice(0, 160)}${NOTHING_CHARGED_TAIL}\` }`);
  });
});
