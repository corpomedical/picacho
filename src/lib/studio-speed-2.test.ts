import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JWKS_TTL_MS, forgetSigningKeys, signingKeys, verifiedClaims } from "./supabase/claims";
import { STUDIO_BOOT_HEADER, isStudioBoot } from "./studio-boot";

// 2026-09-30, operator: "Pushed, measure it". Live: studio.access ~1 s and studio.recastgate ~1 s (getUser()
// round trips and reads one after another), layout.auth ~220 ms (the signing keys fetched per cold instance),
// and the cover's first paint ~1.5 s in.

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const KEY = { kid: "k1", kty: "EC", alg: "ES256" };

afterEach(() => {
  vi.unstubAllGlobals();
  forgetSigningKeys();
});

describe("the signing keys, held and shared", () => {
  it("come through the deployment's data cache, are held for 10 minutes, and are fetched afresh for a key not held", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    const fetches: { url: string; init: Record<string, unknown> }[] = [];
    let keys = [KEY];
    vi.stubGlobal("fetch", async (url: string, init: Record<string, unknown>) => (fetches.push({ url, init }), new Response(JSON.stringify({ keys }))));
    const t = 1_000_000;
    expect(await signingKeys("k1", t)).toEqual([KEY]);
    expect(fetches[0].url).toBe("https://x.supabase.co/auth/v1/.well-known/jwks.json");
    expect(fetches[0].init.next).toEqual({ revalidate: JWKS_TTL_MS / 1000 });
    // Held: no fetch within the ten minutes.
    await signingKeys("k1", t + JWKS_TTL_MS - 1);
    expect(fetches).toHaveLength(1);
    // A rotated key: fetched afresh, past every cache, once.
    keys = [KEY, { ...KEY, kid: "k2" }];
    expect((await signingKeys("k2", t + 60_000))?.map((k) => k.kid)).toEqual(["k1", "k2"]);
    expect(fetches[1].init.cache).toBe("no-store");
    await signingKeys("k3", t + 61_000);
    expect(fetches).toHaveLength(2);
    // Stale: fetched again.
    await signingKeys("k1", t + 60_000 + JWKS_TTL_MS + 1);
    expect(fetches).toHaveLength(3);
  });

  it("verify the session's own token with them, and leave anything else to getClaims() as before", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ keys: [KEY] })));
    const header = (h: object) => Buffer.from(JSON.stringify(h)).toString("base64url");
    const calls: unknown[][] = [];
    const client = (token: string | null) =>
      ({
        auth: {
          getSession: async () => ({ data: { session: token ? { access_token: token } : null } }),
          getClaims: async (...a: unknown[]) => (calls.push(a), { data: { claims: { sub: "u1" } }, error: null }),
        },
      }) as never;
    expect(await verifiedClaims(client(`${header({ alg: "ES256", kid: "k1" })}.p.s`))).toEqual({ sub: "u1" });
    expect(calls[0][1]).toEqual({ keys: [KEY] });
    await verifiedClaims(client(`${header({ alg: "HS256" })}.p.s`));
    expect(calls[1]).toHaveLength(1);
    expect(await verifiedClaims(client(null))).toBeNull();
  });
});

describe("the Studio's page and its doors", () => {
  it("sets access: the verified claims, never a getUser() round trip, then the switch and the profile at once", () => {
    const access = read("src/lib/sets/access.ts");
    expect(access).toContain("const claims = await verifiedClaims(supabase);");
    expect(access).not.toMatch(/auth\.getUser\(/);
    expect(access).toContain("const [enabled, { data: profile }] = await Promise.all([");
  });

  it("the page doesn't wait on Recast: its gate and characters are asked when the Video window opens", () => {
    const page = read("src/app/app/sets/[id]/page.tsx");
    expect(page).not.toMatch(/canUseRecast|readRecastCharacters/);
    const actions = read("src/lib/sets/studio-recast-actions.ts");
    expect(actions).toContain('tm.step("gate", () => canUseRecast()),');
    // Every paid door still asks Recast's own gate on the server.
    for (const door of ["reserveRecastUpload", "inspectRecastClip", "startRecastTakes"]) expect(actions).toContain(door);
    expect(read("src/components/studio/studio-engine.ts")).toContain("Promise.resolve().then(() => R.load())");
  });

  it("the cover streams in the first flush: the proxy marks a Studio opening, the root layout draws it as the page's fallback", () => {
    const id = "f0fe7379-0000-4000-8000-000000000001";
    expect(isStudioBoot("GET", `/app/sets/${id}`, new URLSearchParams("studio=1"))).toBe(true);
    expect(isStudioBoot("GET", `/app/sets/${id}`, new URLSearchParams(""))).toBe(false);
    // Its server actions too: a revalidating action re-renders the page, and the layout must draw the same tree,
    // or the Studio is mounted again under its open window (2026-10-01, the video window closed after the send).
    expect(isStudioBoot("POST", `/app/sets/${id}`, new URLSearchParams("studio=1"))).toBe(true);
    expect(isStudioBoot("POST", `/app/sets/${id}`, new URLSearchParams(""))).toBe(false);
    expect(isStudioBoot("OPTIONS", `/app/sets/${id}`, new URLSearchParams("studio=1"))).toBe(false);
    expect(isStudioBoot("GET", "/app/sets/nope", new URLSearchParams("studio=1"))).toBe(false);
    const proxy = read("middleware.ts");
    expect(proxy.indexOf("request.headers.delete(STUDIO_BOOT_HEADER);")).toBeLessThan(proxy.indexOf("request.headers.set(STUDIO_BOOT_HEADER"));
    expect(read("src/app/layout.tsx")).toContain("<Suspense fallback={<StudioOpening words={getMessages(locale).sets.studioOpening} />}>{children}</Suspense>");
    expect(STUDIO_BOOT_HEADER).toMatch(/^x-/);
  });
});
