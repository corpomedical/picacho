import { beforeEach, describe, expect, it, vi } from "vitest";

// The phone admin app's door (api-auth.ts): the token must be a live
// session, the account an admin, and — once a factor is enrolled — the
// session must have presented it. CORS answers only the app's own origin.
const state = {
  user: null as null | { id: string; factors?: { status: string }[] },
  role: "admin" as string | null,
};
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: state.user ? null : { message: "bad jwt" } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.role ? { role: state.role } : null }) }) }) }),
  }),
}));

const { corsHeaders, requireAdminFromRequest } = await import("./api-auth");

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (aal: string) => `${b64({ alg: "HS256" })}.${b64({ sub: "admin-1", aal })}.sig`;
const req = (auth?: string, origin = "https://picacho-admin.vercel.app") =>
  new Request("https://picacho.ai/api/admin/today", { headers: { ...(auth ? { authorization: auth } : {}), origin } });

beforeEach(() => {
  state.user = { id: "admin-1", factors: [] };
  state.role = "admin";
});

describe("requireAdminFromRequest", () => {
  it("refuses a request with no token, or a token the auth server rejects", async () => {
    expect(((await requireAdminFromRequest(req())) as Response).status).toBe(401);
    state.user = null;
    expect(((await requireAdminFromRequest(req(`Bearer ${token("aal1")}`))) as Response).status).toBe(401);
  });

  it("refuses an account that isn't an admin", async () => {
    state.role = "user";
    expect(((await requireAdminFromRequest(req(`Bearer ${token("aal1")}`))) as Response).status).toBe(403);
  });

  it("asks for the second factor only once one is enrolled", async () => {
    expect(await requireAdminFromRequest(req(`Bearer ${token("aal1")}`))).toEqual(expect.objectContaining({ userId: "admin-1" }));
    state.user = { id: "admin-1", factors: [{ status: "verified" }] };
    expect(((await requireAdminFromRequest(req(`Bearer ${token("aal1")}`))) as Response).status).toBe(403);
    expect(await requireAdminFromRequest(req(`Bearer ${token("aal2")}`))).toEqual(expect.objectContaining({ userId: "admin-1" }));
  });
});

describe("corsHeaders", () => {
  it("answers the admin app's origin and nobody else", () => {
    expect(corsHeaders(req(undefined, "https://picacho-admin.vercel.app"))["Access-Control-Allow-Origin"]).toBe("https://picacho-admin.vercel.app");
    expect(corsHeaders(req(undefined, "https://evil.example"))["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
