import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/mcp as a client meets it (Press Tour cut 0, 2026-09-25).
//
// protocol.test.ts pins the message shapes; this drives the route itself: the
// status line and headers a client acts on, the handshake, the tool list, and
// the four tools against a stand-in database. Written with the cut-0 fixes:
//
// - A key that is missing, wrong or revoked is HTTP 401 with a plain
//   `WWW-Authenticate: Bearer`. It was HTTP 200 carrying a tool error, which
//   told the model (who cannot fix a key) and hid it from the client (who
//   can). No resource_metadata until the OAuth cut builds the document it
//   would point to.
// - get_usage answers exactly what GET /api/v1/usage answers.
// - get_generation re-signs the image link, as the REST route does.
// - generate_image carries an idempotency_key through to the render.
//
// The route imports through "@/", which this suite does not resolve. The
// database, the render, the rate limiter and the origin are stood in for; the
// protocol, the tool list, key checking, usage and media URLs are the real
// modules.

const h = vi.hoisted(() => ({
  generate: vi.fn(),
  rateLimited: vi.fn(),
  monthlyUsage: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // keys.ts stamps last_used_at through after(), which needs a request scope.
  after: () => {},
}));

type Row = Record<string, unknown>;
const db = {
  api_keys: [] as Row[],
  profiles: [] as Row[],
  generations: [] as Row[],
  character_profiles: [] as Row[],
};

/** The service-role client, over the four tables the route and keys.ts read. */
function adminClient() {
  return {
    from(name: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const rows = () => ((db as Record<string, Row[]>)[name] ?? []).filter((r) => filters.every((f) => f(r)));
      const b = {
        select: () => b,
        update: () => b,
        order: () => b,
        eq(col: string, v: unknown) {
          filters.push((r) => r[col] === v);
          return b;
        },
        is(col: string, v: unknown) {
          filters.push((r) => (r[col] ?? null) === v);
          return b;
        },
        async single() {
          const found = rows();
          return found.length === 1 ? { data: { ...found[0] }, error: null } : { data: null, error: { message: "0 rows" } };
        },
        async maybeSingle() {
          return { data: rows()[0] ? { ...rows()[0] } : null, error: null };
        },
        then(resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve({ data: rows().map((r) => ({ ...r })), error: null }).then(resolve, reject);
        },
      };
      return b;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => adminClient() }));
vi.mock("@/lib/api/keys", async () => await import("../api/keys"));
vi.mock("@/lib/rate-limit", () => ({ rateLimited: h.rateLimited }));
vi.mock("@/lib/api/generate", () => ({ runApiImageGeneration: h.generate }));
vi.mock("@/lib/api/idempotency", async () => await import("../api/idempotency"));
vi.mock("@/lib/api/usage", async () => await import("../api/usage"));
vi.mock("@/lib/origin", () => ({ getOrigin: async () => "https://picacho.ai" }));
vi.mock("@/lib/media/url", async () => await import("../media/url"));
vi.mock("@/lib/mcp/protocol", async () => await import("./protocol"));
vi.mock("@/lib/mcp/tools", async () => await import("./tools"));
vi.mock("@/lib/plans", async () => await import("../plans"));
vi.mock("@/lib/generations/core", () => ({ getMonthlyUsageWith: h.monthlyUsage }));

import { DELETE, GET, POST } from "../../app/api/mcp/route";
import { GET as restUsage } from "../../app/api/v1/usage/route";
import { API_ACCESS_OFF, hashApiKey } from "../api/keys";
import { mediaSig } from "../media/url";
import { PLAN_LIMITS } from "../plans";
import { RPC_UNAUTHORIZED, SUPPORTED_PROTOCOL_VERSIONS } from "./protocol";

vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only");

const ELITE_KEY = "pic_live_elite";
const STARTER_KEY = "pic_live_starter";

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://picacho.ai/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}
const call = (name: string, args: Record<string, unknown> = {}, key: string | null = ELITE_KEY, id: number | string = 7) =>
  rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, key ? { authorization: `Bearer ${key}` } : {});

beforeEach(() => {
  db.api_keys = [
    { id: "k-elite", user_id: "user-elite", key_hash: hashApiKey(ELITE_KEY), revoked_at: null },
    { id: "k-starter", user_id: "user-starter", key_hash: hashApiKey(STARTER_KEY), revoked_at: null },
    { id: "k-old", user_id: "user-elite", key_hash: hashApiKey("pic_live_old"), revoked_at: "2026-09-01T00:00:00Z" },
  ];
  db.profiles = [
    {
      id: "user-elite",
      plan: "elite",
      plan_status: "active",
      role: null,
      status: null,
      api_access: false,
      bonus_credits: 25,
      purchased_credits: 10,
      current_period_start: "2026-09-10T00:00:00.000Z",
    },
    { id: "user-starter", plan: "starter", plan_status: "active", role: null, status: null, api_access: false },
  ];
  db.generations = [];
  db.character_profiles = [];
  h.generate.mockReset();
  h.rateLimited.mockReset().mockResolvedValue(false);
  h.monthlyUsage.mockReset().mockResolvedValue(120);
});

describe("authentication failures are HTTP, not tool results", () => {
  it("no key: 401 with a plain WWW-Authenticate: Bearer, and the reason in a JSON-RPC error", async () => {
    const res = await call("get_usage", {}, null);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    const body = await res.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", id: 7, error: { code: RPC_UNAUTHORIZED } });
    expect(body.error.message).toContain("Missing API key");
    expect(body.error.message).toContain("Settings → Security → API keys");
    expect(body.result).toBeUndefined();
  });

  it("REGRESSION #40: the 401 names no resource_metadata — that document does not exist until the OAuth cut", async () => {
    // A client that is pointed at metadata tries OAuth discovery against it
    // and fails, instead of just showing the reason.
    for (const key of [null, "pic_live_wrong", "pic_live_old"]) {
      const res = await call("list_characters", {}, key);
      expect(res.status, String(key)).toBe(401);
      expect(res.headers.get("www-authenticate"), String(key)).toBe("Bearer");
    }
  });

  it("a revoked key is 401 too", async () => {
    const res = await call("get_usage", {}, "pic_live_old");
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toContain("revoked");
  });

  it("a good key without API access is 403, says so plainly, and does not ask for a new key", async () => {
    const res = await call("get_usage", {}, STARTER_KEY);
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toBeNull();
    const body = await res.json();
    expect(body.error.message).toBe(API_ACCESS_OFF);
    expect(body.error.message).not.toMatch(/elite|upgrade|plan|contact us/i);
  });

  it("MONEY: a refused key never reaches a spending tool", async () => {
    await call("generate_image", { prompt: "anything" }, null);
    await call("generate_image", { prompt: "anything" }, STARTER_KEY);
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("the handshake still needs no key, so a client can connect and show why a key failed", async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(init.status).toBe(200);
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list.status).toBe(200);
  });
});

describe("protocol versions", () => {
  it("speaks 2025-11-25, 2025-06-18 and 2025-03-26: each is echoed by initialize and accepted on the header", async () => {
    expect([...SUPPORTED_PROTOCOL_VERSIONS]).toEqual(["2025-11-25", "2025-06-18", "2025-03-26"]);
    for (const v of SUPPORTED_PROTOCOL_VERSIONS) {
      const res = await rpc(
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v } },
        { "mcp-protocol-version": v },
      );
      expect(res.status, v).toBe(200);
      expect((await res.json()).result.protocolVersion, v).toBe(v);
    }
  });

  it("an unknown version in initialize negotiates to our newest", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } });
    expect((await res.json()).result.protocolVersion).toBe("2025-11-25");
  });

  it("an unknown version on the HEADER is the spec's hard 400", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "2099-01-01" });
    expect(res.status).toBe(400);
  });

  it("a notification gets 202 and no body; GET and DELETE are 405", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
    expect((await GET()).status).toBe(405);
    expect((await DELETE()).status).toBe(405);
  });

  it("SECURITY: another site's Origin is refused", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("tools/list", () => {
  it("lists the four tools, and generate_image takes an optional idempotency_key", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const { tools } = (await res.json()).result as { tools: { name: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown> }[] };
    expect(tools.map((t) => t.name).sort()).toEqual(["generate_image", "get_generation", "get_usage", "list_characters"]);
    const gen = tools.find((t) => t.name === "generate_image")!;
    expect((gen.inputSchema.properties as Record<string, unknown>).idempotency_key).toMatchObject({ type: "string" });
    expect(gen.inputSchema.required).toEqual(["prompt"]);
    // MONEY: exactly one tool is not read-only, and it is the one that spends.
    expect(tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name)).toEqual(["generate_image"]);
  });
});

describe("get_usage answers what GET /api/v1/usage answers", () => {
  async function both() {
    const mcp = (await (await call("get_usage")).json()).result.structuredContent;
    const rest = await (
      await restUsage(new Request("https://picacho.ai/api/v1/usage", { headers: { authorization: `Bearer ${ELITE_KEY}` } }))
    ).json();
    return { mcp, rest };
  }

  it("MONEY: bonus credits are a balance beside the plan's remainder, not inside it", async () => {
    const { mcp, rest } = await both();
    expect(mcp).toEqual(rest);
    expect(mcp.remaining_this_period).toBe(PLAN_LIMITS.elite - 120);
    expect(mcp.bonus_credits).toBe(25);
  });

  it("MONEY: a lapsed subscription reports no plan allowance, on both doors", async () => {
    db.profiles[0].plan_status = "past_due";
    const { mcp, rest } = await both();
    expect(mcp).toEqual(rest);
    expect(mcp.included_this_period).toBe(0);
    expect(mcp.remaining_this_period).toBe(0);
    expect(mcp.purchased_credits).toBe(10);
  });
});

describe("get_generation", () => {
  it("re-signs the image link, as GET /api/v1/generations/{id} does", async () => {
    // An old row: a Supabase signed URL whose token expired long ago.
    db.generations = [
      {
        id: "g1",
        user_id: "user-elite",
        status: "succeeded",
        content_type: "image",
        deleted_at: null,
        match_score: 91,
        credits_used: 1,
        result_url: "https://x.supabase.co/storage/v1/object/sign/generated-images/user-elite/a.png?token=expired",
      },
      {
        id: "g2",
        user_id: "user-elite",
        status: "succeeded",
        content_type: "image",
        deleted_at: null,
        match_score: 80,
        credits_used: 1,
        result_url: "/api/media/generated-images/user-elite/b.png?v=signed-under-an-old-key",
      },
    ];
    const one = (await (await call("get_generation", { id: "g1" })).json()).result.structuredContent;
    expect(one.image_url).toBe(
      `https://picacho.ai/api/media/generated-images/user-elite/a.png?v=${mediaSig("generated-images", "user-elite/a.png")}`,
    );
    const two = (await (await call("get_generation", { id: "g2" })).json()).result.structuredContent;
    expect(two.image_url).toBe(
      `https://picacho.ai/api/media/generated-images/user-elite/b.png?v=${mediaSig("generated-images", "user-elite/b.png")}`,
    );
  });

  it("SECURITY: another account's generation, or a deleted one, is not there", async () => {
    db.generations = [
      { id: "g3", user_id: "user-starter", status: "succeeded", deleted_at: null, result_url: null },
      { id: "g4", user_id: "user-elite", status: "succeeded", deleted_at: "2026-09-20T00:00:00Z", result_url: null },
    ];
    for (const id of ["g3", "g4"]) {
      const res = (await (await call("get_generation", { id })).json()).result;
      expect(res.isError, id).toBe(true);
    }
  });
});

describe("generate_image", () => {
  const ok = { error: null, id: "g9", status: "succeeded", prompt: "drafted", imageUrl: "https://picacho.ai/api/media/x", matchScore: 72, creditsUsed: 1 };

  it("carries the idempotency_key through to the render", async () => {
    h.generate.mockResolvedValue(ok);
    await call("generate_image", { prompt: "  Eva on a rooftop ", idempotency_key: " img-1 " });
    expect(h.generate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-elite", prompt: "Eva on a rooftop", idempotencyKey: "img-1" }),
    );
  });

  it("no key is no key — every call a new image, as before", async () => {
    h.generate.mockResolvedValue(ok);
    await call("generate_image", { prompt: "Eva" });
    expect(h.generate).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: null }));
  });

  it("MONEY: an unusable key is refused before anything runs", async () => {
    const res = (await (await call("generate_image", { prompt: "Eva", idempotency_key: 42 })).json()).result;
    expect(res.isError).toBe(true);
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("a low score is reported, with nothing that asks the model to render again", async () => {
    h.generate.mockResolvedValue(ok);
    const res = (await (await call("generate_image", { prompt: "Eva" })).json()).result;
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toMatchObject({ id: "g9", match_score: 72, credits_used: 1 });
    expect(JSON.stringify(res)).not.toMatch(/again|re-?roll|adjust/i);
  });

  it("a repeat whose image is still rendering is a result to fetch later, not an error", async () => {
    h.generate.mockResolvedValue({ ...ok, status: "generating", prompt: "", imageUrl: null, matchScore: null });
    const res = (await (await call("generate_image", { prompt: "Eva", idempotency_key: "img-1" })).json()).result;
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toMatchObject({ id: "g9", status: "generating", image_url: null });
  });

  it("a failed image says whether it cost anything, and never to try again", async () => {
    h.generate.mockResolvedValue({ ...ok, status: "failed", imageUrl: null, creditsUsed: 0 });
    const res = (await (await call("generate_image", { prompt: "Eva" })).json()).result;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("That image didn't come out. Nothing was charged.");
  });

  it("a refusal's words reach the model as they are", async () => {
    h.generate.mockResolvedValue({ error: "You've used today's free generation. It comes back tomorrow.", status: 402 });
    const res = (await (await call("generate_image", { prompt: "Eva" })).json()).result;
    expect(res).toEqual({
      content: [{ type: "text", text: "You've used today's free generation. It comes back tomorrow." }],
      isError: true,
    });
  });

  it("MONEY: an unexpected failure does not tell the model to simply try again", async () => {
    h.generate.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = (await (await call("generate_image", { prompt: "Eva" })).json()).result;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Ask the person before trying again/);
  });
});
