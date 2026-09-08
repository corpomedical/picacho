import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "./instrumentation";

// The durable sink has one job — get the next #419's message somewhere that
// outlives Vercel's log retention — and one rule: it can never add a second
// failure to the one being reported. Both are pinned here with a fake fetch.
const ctx = {
  routerKind: "App Router",
  routePath: "/app/generate",
  routeType: "render",
  renderSource: "react-server-components",
  revalidateReason: undefined,
} as const;
const req = { path: "/app/generate", method: "GET", headers: {} };

describe("onRequestError's durable sink", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 201 });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("upserts one row keyed last_server_error, carrying digest, route and message", async () => {
    const err = Object.assign(new Error("JSON object requested, multiple (or no) rows returned"), { digest: "123" });
    await onRequestError(err, req, ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.supabase.co/rest/v1/app_settings?on_conflict=key");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.prefer).toContain("resolution=merge-duplicates");
    const rows = JSON.parse(String(calls[0].init.body)) as { key: string; value: string }[];
    expect(rows.map((r) => r.key)).toEqual(["last_server_error"]);
    expect(rows[0].value).toContain("/app/generate");
    expect(rows[0].value).toContain("digest 123");
    expect(rows[0].value).toContain("JSON object requested");
  });

  it("writes the chased digest to its own key as well, so a later error cannot bury it", async () => {
    const err = Object.assign(new Error("the cause"), { digest: "3184253291" });
    await onRequestError(err, req, ctx);
    const rows = JSON.parse(String(calls[0].init.body)) as { key: string }[];
    expect(rows.map((r) => r.key)).toEqual(["last_server_error", "last_server_error_419"]);
  });

  it("stringifies a plain-object throw, the shape the stable digest points at", async () => {
    await onRequestError({ code: "PGRST116", message: "no rows" }, req, ctx);
    const rows = JSON.parse(String(calls[0].init.body)) as { value: string }[];
    expect(rows[0].value).toContain("no rows");
  });

  it("never throws — not when fetch rejects, not when the env is missing", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    await expect(onRequestError(new Error("x"), req, ctx)).resolves.toBeUndefined();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(onRequestError(new Error("y"), req, ctx)).resolves.toBeUndefined();
  });
});
