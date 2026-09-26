import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { fakeDb, type Row } from "../fake-db";
import { checkAuthorizeRequest } from "./authorize";
import { allowedScopesFor, clientTrust, fetchClientDocument, isCimdClientId, redirectMatches, validateCimdDocument, validateDcrRequest, type OAuthClient } from "./clients";
import { canonicalResource, issuerFor, prmUrlFor, resourceFor } from "./config";
import {
  consentFormToken,
  consentFormTokenValid,
  handleAuthorize,
  handleConsentDecision,
  handleRegister,
  handleRevoke,
  handleToken,
  rateBucket,
  type EndpointDeps,
} from "./endpoints";
import { authorizationServerMetadata, protectedResourceMetadata } from "./metadata";
import { OAUTH_MESSAGES } from "./messages";
import { consentPath, oauthResumePath, pendingIdFrom } from "./resume";
import { CLIENT_PRUNE_LIMIT, EXPIRED_KEEP_MS, REVOKED_FAMILY_KEEP_MS, UNUSED_CLIENT_KEEP_MS, pruneOAuthRecords } from "./prune";
import { bindPending, exchangeCode, listGrants, readPending, refreshTokens, revokeFamily, revokeGrant, verifyAccessToken, type TokenAnswer } from "./store";
import { hashSecret, s256, verifyPkce } from "./tokens";

// Picacho's own OAuth 2.1 authorization server for MCP (Press Tour Cut 8).
// Everything that decides anything, driven end to end against an in-memory
// database: registration, the authorization request, the person's answer,
// the code exchange (PKCE S256), refresh rotation with reuse detection,
// audience binding, revocation and Connected apps.

const ORIGIN = "https://picacho.ai";
const RESOURCE = "https://picacho.ai/api/mcp";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-and-more";

type Clock = { now: Date };

function setup(opts: { enabled?: boolean; limited?: boolean; docs?: Record<string, unknown> } = {}) {
  const f = fakeDb();
  const clock: Clock = { now: new Date("2026-09-26T10:00:00.000Z") };
  const limits: string[] = [];
  const deps: EndpointDeps = {
    db: f.db,
    origin: ORIGIN,
    enabled: opts.enabled ?? true,
    rateLimited: async (_key, scope) => {
      limits.push(scope);
      return opts.limited === true;
    },
    hashKey: (v, scope) => `${scope}:${v ?? "?"}`,
    fetchDocument: async (url) => {
      const doc = opts.docs?.[url];
      return doc === undefined ? { status: 404, text: null } : { status: 200, text: typeof doc === "string" ? doc : JSON.stringify(doc) };
    },
    now: () => clock.now,
  };
  return { ...f, deps, clock, limits };
}

async function register(deps: EndpointDeps, redirect = CLAUDE, name = "Claude") {
  const r = await handleRegister({ body: { redirect_uris: [redirect], client_name: name, token_endpoint_auth_method: "none" }, ip: "1.2.3.4" }, deps);
  expect(r.status).toBe(201);
  return r.body as { client_id: string; scope: string };
}

function authorizeParams(clientId: string, over: Record<string, unknown> = {}) {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE,
    code_challenge: s256(VERIFIER),
    code_challenge_method: "S256",
    state: "st-1",
    resource: RESOURCE,
    scope: "read generate brand",
    ...over,
  };
}

/** Register, authorize, sign in as USER, allow: the code in the redirect. */
async function codeFor(s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) {
  const client = await register(s.deps);
  const a = await handleAuthorize({ params: authorizeParams(client.client_id, over), ip: "1.2.3.4" }, s.deps);
  expect(a.status).toBe(303);
  const pendingId = pendingIdFrom(new URL(a.location!, ORIGIN).searchParams.get("pending"))!;
  expect(await bindPending(s.db, pendingId, USER, { now: () => s.clock.now })).toBe("bound");
  const decided = await handleConsentDecision(
    { pendingId, userId: USER, approve: true, formToken: consentFormToken(pendingId, USER, "secret"), secret: "secret", allowed: true },
    s.deps,
  );
  expect(decided.kind).toBe("redirect");
  const back = new URL((decided as { location: string }).location);
  return { clientId: client.client_id, code: back.searchParams.get("code")!, back, pendingId };
}

async function exchange(s: ReturnType<typeof setup>, form: Record<string, string>) {
  return handleToken({ form, ip: "1.2.3.4" }, s.deps);
}

describe("PKCE (S256 only)", () => {
  it("the RFC 7636 example verifies, and a wrong verifier does not", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(s256(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(verifyPkce(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(verifyPkce(`${verifier}x`, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
    expect(verifyPkce("short", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
  });

  it("an authorization request without S256 goes back to the app as invalid_request", () => {
    const client: OAuthClient = { clientId: "c", kind: "dcr", name: "x", redirectUris: [CLAUDE], trust: "verified", disabled: false, fetchedAt: null };
    for (const over of [{ code_challenge_method: "plain" }, { code_challenge_method: undefined }, { code_challenge: undefined }, { code_challenge: "short" }]) {
      const r = checkAuthorizeRequest(authorizeParams("c", over), client, ORIGIN);
      expect(r.kind, JSON.stringify(over)).toBe("redirect_error");
      expect(r.kind === "redirect_error" && r.error).toBe("invalid_request");
    }
  });

  it("the token endpoint refuses a wrong verifier, and the code still works with the right one", async () => {
    const s = setup();
    const { clientId, code } = await codeFor(s);
    const bad = await exchange(s, { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: `${VERIFIER}-x` });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: "invalid_grant" });
    const good = await exchange(s, { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER });
    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "read brand generate" });
    expect(String((good.body as { access_token: string }).access_token)).toMatch(/^pmcp_at_/);
    expect(String((good.body as { refresh_token: string }).refresh_token)).toMatch(/^pmcp_rt_/);
    expect(good.headers["cache-control"]).toBe("no-store");
  });
});

describe("codes: single use, and reuse is an alarm", () => {
  it("SECURITY: a code used twice fails, and the tokens it minted are revoked", async () => {
    const s = setup();
    const { clientId, code } = await codeFor(s);
    const form = { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER };
    const first = await exchange(s, form);
    expect(first.status).toBe(200);
    const access = (first.body as { access_token: string }).access_token;
    expect((await verifyAccessToken(s.db, access, { resource: RESOURCE }, { now: () => s.clock.now })).ok).toBe(true);

    const again = await exchange(s, form);
    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ error: "invalid_grant" });
    expect(await verifyAccessToken(s.db, access, { resource: RESOURCE }, { now: () => s.clock.now })).toEqual({ ok: false, reason: "revoked" });
  });

  it("the code is bound to its client, redirect and resource, and lasts 5 minutes", async () => {
    const s = setup();
    const { clientId, code } = await codeFor(s);
    const base = { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER };
    expect((await exchange(s, { ...base, client_id: "pmcp_c_someoneelse" })).body).toMatchObject({ error: "invalid_grant" });
    expect((await exchange(s, { ...base, redirect_uri: "https://claude.ai/other" })).body).toMatchObject({ error: "invalid_grant" });
    expect((await exchange(s, { ...base, resource: "https://picacho.io/api/mcp" })).body).toMatchObject({ error: "invalid_target" });
    expect((await exchange(s, { ...base, resource: "https://evil.example/api/mcp" })).body).toMatchObject({ error: "invalid_target" });
    s.clock.now = new Date(s.clock.now.getTime() + 6 * 60_000);
    expect((await exchange(s, base)).body).toMatchObject({ error: "invalid_grant", error_description: "That code has expired." });
  });

  it("codes and tokens are stored only as hashes", async () => {
    const s = setup();
    const { clientId, code } = await codeFor(s);
    const r = await exchange(s, { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER });
    const body = r.body as { access_token: string; refresh_token: string };
    const dump = JSON.stringify(s.tables);
    for (const secret of [code, body.access_token, body.refresh_token]) {
      expect(dump).not.toContain(secret);
      expect(dump).toContain(hashSecret(secret));
    }
  });

  it("public clients only: a client secret is refused, not ignored", async () => {
    const s = setup();
    const { clientId, code } = await codeFor(s);
    const r = await exchange(s, { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER, client_secret: "x" });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: "invalid_client" });
  });
});

describe("refresh: rotation and reuse detection", () => {
  async function tokens(s: ReturnType<typeof setup>) {
    const { clientId, code } = await codeFor(s);
    const r = await exchange(s, { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER });
    return { clientId, ...(r.body as { access_token: string; refresh_token: string }) };
  }

  it("a refresh token rotates: the new pair works, the old refresh token is spent", async () => {
    const s = setup();
    const t = await tokens(s);
    const r = await exchange(s, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.clientId });
    expect(r.status).toBe(200);
    const next = r.body as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(t.refresh_token);
    expect((await verifyAccessToken(s.db, next.access_token, { resource: RESOURCE }, { now: () => s.clock.now })).ok).toBe(true);
    const spent = s.tables.oauth_tokens.find((row) => row.token_hash === hashSecret(t.refresh_token))!;
    expect(spent.used_at).toBeTruthy();
    expect(spent.replaced_by).toBe(hashSecret(next.refresh_token));
  });

  it("SECURITY: presenting a rotated refresh token revokes the whole family", async () => {
    const s = setup();
    const t = await tokens(s);
    const rotated = await exchange(s, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.clientId });
    const next = rotated.body as { access_token: string; refresh_token: string };
    const replay = await exchange(s, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.clientId });
    expect(replay.status).toBe(400);
    expect(replay.body).toMatchObject({ error: "invalid_grant" });
    // The thief's copy and the real one are both dead now.
    for (const token of [t.access_token, next.access_token]) {
      expect((await verifyAccessToken(s.db, token, { resource: RESOURCE }, { now: () => s.clock.now })).ok).toBe(false);
    }
    const again = await exchange(s, { grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: t.clientId });
    expect(again.body).toMatchObject({ error: "invalid_grant" });
  });

  it("a refresh can narrow scopes but never widen them, and only for its own client", async () => {
    const s = setup();
    const t = await tokens(s);
    const other = await exchange(s, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: "pmcp_c_nope" });
    expect(other.body).toMatchObject({ error: "invalid_grant" });
    const narrow = await exchange(s, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.clientId, scope: "read" });
    expect(narrow.body).toMatchObject({ scope: "read" });
    const wider = await exchange(s, {
      grant_type: "refresh_token",
      refresh_token: (narrow.body as { refresh_token: string }).refresh_token,
      client_id: t.clientId,
      scope: "read generate",
    });
    expect(wider.body).toMatchObject({ error: "invalid_scope" });
  });

  it("an expired refresh token is refused", async () => {
    const s = setup();
    const t = await tokens(s);
    s.clock.now = new Date(s.clock.now.getTime() + 31 * 24 * 3600_000);
    const r = await exchange(s, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.clientId });
    expect(r.body).toMatchObject({ error: "invalid_grant", error_description: "That refresh token has expired." });
  });
});

describe("audience binding (RFC 8707)", () => {
  it("a token minted for picacho.ai is refused at picacho.io, and expires after an hour", async () => {
    const s = setup();
    const { clientId, code } = await codeFor(s);
    const r = await exchange(s, { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER });
    const access = (r.body as { access_token: string }).access_token;
    expect(await verifyAccessToken(s.db, access, { resource: "https://picacho.io/api/mcp" }, { now: () => s.clock.now })).toEqual({
      ok: false,
      reason: "wrong_resource",
    });
    const good = await verifyAccessToken(s.db, access, { resource: RESOURCE }, { now: () => s.clock.now });
    expect(good).toMatchObject({ ok: true, token: { userId: USER, scopes: ["read", "brand", "generate"] } });
    s.clock.now = new Date(s.clock.now.getTime() + 61 * 60_000);
    expect(await verifyAccessToken(s.db, access, { resource: RESOURCE }, { now: () => s.clock.now })).toEqual({ ok: false, reason: "expired" });
  });

  it("the resource is required at authorization and must be one of ours", () => {
    const client: OAuthClient = { clientId: "c", kind: "dcr", name: "x", redirectUris: [CLAUDE], trust: "verified", disabled: false, fetchedAt: null };
    for (const resource of [undefined, "", "https://evil.example/api/mcp", "https://picacho.ai/api/other", "https://picacho.ai/api/mcp?x=1"]) {
      const r = checkAuthorizeRequest(authorizeParams("c", { resource }), client, ORIGIN);
      expect(r.kind === "redirect_error" && r.error, String(resource)).toBe("invalid_target");
    }
    expect(canonicalResource("https://picacho.ai/api/mcp/", ORIGIN)).toBe(RESOURCE);
    expect(canonicalResource("https://picacho.io/api/mcp", ORIGIN)).toBe("https://picacho.io/api/mcp");
    expect(canonicalResource("http://localhost:3000/api/mcp", ORIGIN)).toBeNull();
    expect(canonicalResource("http://localhost:3000/api/mcp", "http://localhost:3000")).toBe("http://localhost:3000/api/mcp");
  });

  it("the protected resource echoes the host the request came in on; the issuer is always picacho.ai", () => {
    expect(resourceFor("https://picacho.io")).toBe("https://picacho.io/api/mcp");
    expect(resourceFor("https://evil.example")).toBe(RESOURCE);
    expect(issuerFor("https://picacho.io")).toBe("https://picacho.ai");
    expect(prmUrlFor("https://picacho.ai")).toBe("https://picacho.ai/.well-known/oauth-protected-resource/api/mcp");
    const prm = protectedResourceMetadata("https://picacho.io");
    expect(prm).toMatchObject({ resource: "https://picacho.io/api/mcp", authorization_servers: ["https://picacho.ai"], bearer_methods_supported: ["header"] });
    const as = authorizationServerMetadata("https://picacho.io");
    expect(as).toMatchObject({
      issuer: "https://picacho.ai",
      token_endpoint: "https://picacho.ai/api/oauth/token",
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_methods_supported: ["none"],
    });
    expect(as.scopes_supported).not.toContain("publish");
  });
});

describe("dynamic registration and trust", () => {
  it("unverified clients get read only, whatever they ask for", async () => {
    const s = setup();
    const evil = await register(s.deps, "https://evil.example/cb", "Claude");
    expect(evil.scope).toBe("read");
    const a = await handleAuthorize(
      { params: { ...authorizeParams(evil.client_id), redirect_uri: "https://evil.example/cb", scope: "read generate" }, ip: "1" },
      s.deps,
    );
    const pending = await readPending(s.db, pendingIdFrom(new URL(a.location!, ORIGIN).searchParams.get("pending"))!);
    expect(pending && pending !== "unavailable" && pending.scopes).toEqual(["read"]);
    const only = await handleAuthorize({ params: { ...authorizeParams(evil.client_id), redirect_uri: "https://evil.example/cb", scope: "generate" }, ip: "1" }, s.deps);
    expect(new URL(only.location!).searchParams.get("error")).toBe("invalid_scope");
  });

  it("verified = the hosts' exact callbacks; loopback = this computer; anything else unverified", () => {
    expect(clientTrust([CLAUDE])).toBe("verified");
    expect(clientTrust(["https://chatgpt.com/connector_platform_oauth_redirect"])).toBe("verified");
    expect(clientTrust(["https://chatgpt.com/connector/oauth/abc_123"])).toBe("verified");
    expect(clientTrust(["https://chatgpt.com/connector/oauth/abc/../../x"])).toBe("unverified");
    expect(clientTrust(["https://claude.ai.evil.example/api/mcp/auth_callback"])).toBe("unverified");
    expect(clientTrust(["https://claude.ai/api/mcp/auth_callback/extra"])).toBe("unverified");
    expect(clientTrust(["http://127.0.0.1:33418/callback"])).toBe("loopback");
    expect(clientTrust([CLAUDE, "https://evil.example/cb"])).toBe("unverified");
    expect(allowedScopesFor("unverified")).toEqual(["read"]);
    expect(allowedScopesFor("loopback")).toEqual(["read", "brand", "generate"]);
  });

  it("redirects: https or loopback only; a loopback's port may change, nothing else may", () => {
    expect(validateDcrRequest({ redirect_uris: ["http://evil.example/cb"] }).ok).toBe(false);
    expect(validateDcrRequest({ redirect_uris: ["https://a.example/cb#frag"] }).ok).toBe(false);
    expect(validateDcrRequest({ redirect_uris: ["myapp://cb"] }).ok).toBe(false);
    expect(validateDcrRequest({ redirect_uris: [] }).ok).toBe(false);
    expect(validateDcrRequest({ redirect_uris: [CLAUDE], grant_types: ["client_credentials"] }).ok).toBe(false);
    expect(validateDcrRequest({ redirect_uris: [CLAUDE], scope: "read publish" }).ok).toBe(false);
    expect(redirectMatches(["http://127.0.0.1:1000/callback"], "http://127.0.0.1:55555/callback")).toBe(true);
    expect(redirectMatches(["http://127.0.0.1:1000/callback"], "http://127.0.0.1:55555/other")).toBe(false);
    expect(redirectMatches([CLAUDE], "https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
  });

  it("registration is rate-limited per address and answers the public-client shape", async () => {
    const s = setup({ limited: true });
    const r = await handleRegister({ body: { redirect_uris: [CLAUDE] }, ip: "9.9.9.9" }, s.deps);
    expect(r.status).toBe(429);
    expect(s.limits).toContain("oauth-register");
    const ok = setup();
    const reg = await handleRegister({ body: { redirect_uris: [CLAUDE], client_name: "Claude‮ evil", token_endpoint_auth_method: "client_secret_basic" }, ip: "1" }, ok.deps);
    expect(reg.body).toMatchObject({ token_endpoint_auth_method: "none", client_name: "Claude evil" });
    expect(reg.body).not.toHaveProperty("client_secret");
  });

  it("an unknown client or an unregistered redirect never gets a redirect: our own page instead", async () => {
    const s = setup();
    const unknown = await handleAuthorize({ params: authorizeParams("pmcp_c_nobody"), ip: "1" }, s.deps);
    expect(unknown.location).toBe("/oauth/authorize?error=unknown_client");
    const client = await register(s.deps);
    const bad = await handleAuthorize({ params: authorizeParams(client.client_id, { redirect_uri: "https://evil.example/cb" }), ip: "1" }, s.deps);
    expect(bad.location).toBe("/oauth/authorize?error=bad_redirect");
    // Once both are good, every error goes back to the app with state and iss (RFC 9207).
    const bounced = await handleAuthorize({ params: authorizeParams(client.client_id, { response_type: "token" }), ip: "1" }, s.deps);
    const u = new URL(bounced.location!);
    expect(`${u.origin}${u.pathname}`).toBe(CLAUDE);
    expect(u.searchParams.get("error")).toBe("unsupported_response_type");
    expect(u.searchParams.get("state")).toBe("st-1");
    expect(u.searchParams.get("iss")).toBe("https://picacho.ai");
  });
});

describe("client metadata documents", () => {
  const URL_ID = "https://chatgpt.com/oauth/client.json";
  const doc = {
    client_id: URL_ID,
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  };

  it("the document's client_id must be its own address, and it must allow a public client", () => {
    expect(isCimdClientId(URL_ID)).toBe(true);
    expect(isCimdClientId("https://chatgpt.com/")).toBe(false);
    expect(isCimdClientId("http://chatgpt.com/oauth/client.json")).toBe(false);
    expect(validateCimdDocument(doc, URL_ID).ok).toBe(true);
    expect(validateCimdDocument({ ...doc, client_id: "https://evil.example/c.json" }, URL_ID).ok).toBe(false);
    expect(validateCimdDocument({ ...doc, token_endpoint_auth_methods_supported: ["private_key_jwt"] }, URL_ID).ok).toBe(false);
  });

  it("a CIMD client connects end to end, read through the fetcher once and kept a day", async () => {
    const s = setup({ docs: { [URL_ID]: doc } });
    let reads = 0;
    const counting = s.deps.fetchDocument;
    s.deps.fetchDocument = async (u, o) => {
      reads++;
      return counting(u, o);
    };
    const params = { ...authorizeParams(URL_ID), redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect" };
    const a = await handleAuthorize({ params, ip: "1" }, s.deps);
    expect(a.location).toMatch(/^\/oauth\/authorize\?pending=/);
    await handleAuthorize({ params, ip: "1" }, s.deps);
    expect(reads).toBe(1);
    expect(s.tables.oauth_clients[0]).toMatchObject({ client_id: URL_ID, kind: "cimd", trust: "verified" });
    s.clock.now = new Date(s.clock.now.getTime() + 25 * 3600_000);
    await handleAuthorize({ params, ip: "1" }, s.deps);
    expect(reads).toBe(2);
  });

  it("a document that isn't JSON, is not 200, or lies about itself is an unknown client", async () => {
    for (const bad of ["not json", { ...doc, client_id: "https://evil.example/x" }]) {
      expect(await fetchClientDocument(URL_ID, async () => ({ status: 200, text: typeof bad === "string" ? bad : JSON.stringify(bad) }))).toBeNull();
    }
    expect(await fetchClientDocument(URL_ID, async () => ({ status: 404, text: JSON.stringify(doc) }))).toBeNull();
  });
});

describe("the pending authorization and the person's answer", () => {
  it("only its id travels through sign-in, and the resume path accepts that exact shape only", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(oauthResumePath(consentPath(id))).toBe(consentPath(id));
    for (const bad of [
      "/app",
      "//evil.example",
      "https://evil.example/oauth/authorize?pending=" + id,
      `/oauth/authorize?pending=${id}&x=1`,
      "/oauth/authorize?pending=nope",
      `/oauth/authorize/../x?pending=${id}`,
      null,
    ]) {
      expect(oauthResumePath(bad), String(bad)).toBeNull();
    }
  });

  it("SECURITY: the first signed-in account holds the request; another account cannot answer it", async () => {
    const s = setup();
    const client = await register(s.deps);
    const a = await handleAuthorize({ params: authorizeParams(client.client_id), ip: "1" }, s.deps);
    const pendingId = pendingIdFrom(new URL(a.location!, ORIGIN).searchParams.get("pending"))!;
    expect(await bindPending(s.db, pendingId, USER, { now: () => s.clock.now })).toBe("bound");
    expect(await bindPending(s.db, pendingId, OTHER, { now: () => s.clock.now })).toBe("other_user");
    const stolen = await handleConsentDecision(
      { pendingId, userId: OTHER, approve: true, formToken: consentFormToken(pendingId, OTHER, "k"), secret: "k", allowed: true },
      s.deps,
    );
    expect(stolen).toEqual({ kind: "page_error", code: "other_account" });
  });

  it("SECURITY: the form's anti-forgery value is bound to the request AND the account", () => {
    const t = consentFormToken("p1", USER, "k");
    expect(consentFormTokenValid(t, "p1", USER, "k")).toBe(true);
    expect(consentFormTokenValid(t, "p2", USER, "k")).toBe(false);
    expect(consentFormTokenValid(t, "p1", OTHER, "k")).toBe(false);
    expect(consentFormTokenValid(t, "p1", USER, "")).toBe(false);
  });

  it("answered once: a second Allow is expired; Don't allow goes back as access_denied with state and iss", async () => {
    const s = setup();
    const { pendingId, back } = await codeFor(s);
    expect(back.searchParams.get("state")).toBe("st-1");
    expect(back.searchParams.get("iss")).toBe("https://picacho.ai");
    const again = await handleConsentDecision(
      { pendingId, userId: USER, approve: true, formToken: consentFormToken(pendingId, USER, "secret"), secret: "secret", allowed: true },
      s.deps,
    );
    expect(again).toEqual({ kind: "page_error", code: "expired" });

    const client = await register(s.deps);
    const a = await handleAuthorize({ params: authorizeParams(client.client_id), ip: "1" }, s.deps);
    const id2 = pendingIdFrom(new URL(a.location!, ORIGIN).searchParams.get("pending"))!;
    await bindPending(s.db, id2, USER, { now: () => s.clock.now });
    const no = await handleConsentDecision(
      { pendingId: id2, userId: USER, approve: false, formToken: consentFormToken(id2, USER, "secret"), secret: "secret", allowed: false },
      s.deps,
    );
    const u = new URL((no as { location: string }).location);
    expect(u.searchParams.get("error")).toBe("access_denied");
    expect(u.searchParams.get("iss")).toBe("https://picacho.ai");
  });

  it("an account that may not connect apps cannot allow", async () => {
    const s = setup();
    const client = await register(s.deps);
    const a = await handleAuthorize({ params: authorizeParams(client.client_id), ip: "1" }, s.deps);
    const id = pendingIdFrom(new URL(a.location!, ORIGIN).searchParams.get("pending"))!;
    await bindPending(s.db, id, USER, { now: () => s.clock.now });
    const r = await handleConsentDecision(
      { pendingId: id, userId: USER, approve: true, formToken: consentFormToken(id, USER, "k"), secret: "k", allowed: false },
      s.deps,
    );
    expect(r).toEqual({ kind: "page_error", code: "not_open" });
  });

  it("a request waits 15 minutes for its answer", async () => {
    const s = setup();
    const client = await register(s.deps);
    const a = await handleAuthorize({ params: authorizeParams(client.client_id), ip: "1" }, s.deps);
    const id = pendingIdFrom(new URL(a.location!, ORIGIN).searchParams.get("pending"))!;
    s.clock.now = new Date(s.clock.now.getTime() + 16 * 60_000);
    expect(await bindPending(s.db, id, USER, { now: () => s.clock.now })).toBe("gone");
  });
});

describe("revocation and Connected apps", () => {
  it("revoking a token revokes its family; revoking the connection revokes every token under it", async () => {
    const s = setup();
    const { clientId, code } = await codeFor(s);
    const r = await exchange(s, { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER });
    const t = r.body as { access_token: string; refresh_token: string };
    const rev = await handleRevoke({ form: { token: t.refresh_token, client_id: clientId } }, s.deps);
    expect(rev.status).toBe(200);
    expect((await verifyAccessToken(s.db, t.access_token, { resource: RESOURCE })).ok).toBe(false);

    const s2 = setup();
    const c2 = await codeFor(s2);
    const r2 = await exchange(s2, { grant_type: "authorization_code", code: c2.code, client_id: c2.clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER });
    const t2 = r2.body as { access_token: string; refresh_token: string };
    const listed = await listGrants(s2.db, USER);
    expect(listed).toMatchObject([{ appName: "Claude", host: "claude.ai", verified: true, scopes: ["read", "brand", "generate"] }]);
    const grantId = (listed as { id: string }[])[0].id;
    expect(await revokeGrant(s2.db, OTHER, grantId)).toBe("not_found");
    expect(await revokeGrant(s2.db, USER, grantId)).toBe("revoked");
    expect(await revokeGrant(s2.db, USER, grantId)).toBe("already_revoked");
    expect((await verifyAccessToken(s2.db, t2.access_token, { resource: RESOURCE })).ok).toBe(false);
    const refresh = await exchange(s2, { grant_type: "refresh_token", refresh_token: t2.refresh_token, client_id: c2.clientId });
    expect(refresh.body).toMatchObject({ error: "invalid_grant" });
    expect(await listGrants(s2.db, USER)).toEqual([]);
  });

  it("revocation works with the switch off; everything else is 404", async () => {
    const s = setup({ enabled: false });
    expect((await handleRevoke({ form: { token: "pmcp_rt_x" } }, s.deps)).status).toBe(200);
    expect((await handleRegister({ body: { redirect_uris: [CLAUDE] }, ip: "1" }, s.deps)).status).toBe(404);
    expect((await handleToken({ form: { grant_type: "refresh_token" }, ip: "1" }, s.deps)).status).toBe(404);
    expect((await handleAuthorize({ params: {}, ip: "1" }, s.deps)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Fixer 2026-09-26: SEC-2 (a revoked family stays revoked, even mid-race) and
// SEC-1 (nothing is kept for good; rate limits count an IPv6 /64 as one).
// ---------------------------------------------------------------------------

/**
 * The same database, except that the next write of new tokens first lets
 * `before` run to the end: the loser of a race acting between the winner's
 * spend (one statement) and its new pair (the next).
 */
function raceOnTokenInsert(db: SupabaseClient, before: () => Promise<unknown>): SupabaseClient {
  let armed = true;
  const real = db as unknown as { from: (t: string) => Record<string, unknown>; rpc: unknown };
  const from = (table: string) => {
    const b = real.from(table) as Record<string, (...a: unknown[]) => unknown>;
    if (table !== "oauth_tokens") return b;
    let inserting = false;
    const insert = b.insert;
    const then = b.then;
    b.insert = (...a: unknown[]) => {
      inserting = true;
      insert(...a);
      return b;
    };
    b.then = (ok: unknown, bad: unknown) => {
      if (inserting && armed) {
        armed = false;
        return before().then(() => then.call(b, ok, bad));
      }
      return then.call(b, ok, bad);
    };
    return b;
  };
  return { from, rpc: real.rpc } as unknown as SupabaseClient;
}

describe("SEC-2: a revoked family stays revoked, even mid-race", () => {
  async function pair(s: ReturnType<typeof setup>) {
    const { clientId, code } = await codeFor(s);
    const r = await exchange(s, { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER });
    return { clientId, ...(r.body as { access_token: string; refresh_token: string }) };
  }
  const live = (s: ReturnType<typeof setup>, family: unknown) => s.tables.oauth_tokens.filter((r) => r.family_id === family && !r.revoked_at);

  it("SECURITY: a stolen refresh token racing the real one: the loser revokes the family between the winner's spend and its new pair, and that pair never lands live", async () => {
    const s = setup();
    const t = await pair(s);
    const family = s.tables.oauth_tokens.find((r) => r.token_hash === hashSecret(t.refresh_token))!.family_id;
    const input = { refreshToken: t.refresh_token, clientId: t.clientId, scope: undefined, resource: null };
    let loser: TokenAnswer | null = null;
    const racing = raceOnTokenInsert(s.db, async () => {
      loser = await refreshTokens(s.db, input, { now: () => s.clock.now });
    });
    const winner = await refreshTokens(racing, input, { now: () => s.clock.now, newRefreshToken: () => "pmcp_rt_winner_000000000000000000000000000", newAccessToken: () => "pmcp_at_winner_000000000000000000000000000" });
    expect(loser).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(winner).toMatchObject({ ok: false, error: "invalid_grant", error_description: "That refresh token was already used." });
    // Nothing in the family is live: not the old pair, not the winner's.
    expect(live(s, family)).toEqual([]);
    expect(s.tables.oauth_revoked_families.map((r) => r.family_id)).toContain(family);
    expect((await verifyAccessToken(s.db, "pmcp_at_winner_000000000000000000000000000", { resource: RESOURCE }, { now: () => s.clock.now })).ok).toBe(false);
    const again = await refreshTokens(s.db, { ...input, refreshToken: "pmcp_rt_winner_000000000000000000000000000" }, { now: () => s.clock.now });
    expect(again).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("SECURITY: a code exchanged twice at once: the family the winner is about to fill is marked, and the winner's pair is taken back", async () => {
    const s = setup();
    const { clientId, code } = await codeFor(s);
    const input = { code, clientId, redirectUri: CLAUDE, codeVerifier: VERIFIER, resource: null };
    let loser: TokenAnswer | null = null;
    const racing = raceOnTokenInsert(s.db, async () => {
      loser = await exchangeCode(s.db, input, { now: () => s.clock.now });
    });
    const winner = await exchangeCode(racing, input, { now: () => s.clock.now });
    expect(loser).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(winner).toMatchObject({ ok: false, error: "invalid_grant", error_description: "That code was already used." });
    const family = s.tables.oauth_codes[0].family_id;
    expect(family).toBeTruthy();
    expect(live(s, family)).toEqual([]);
  });

  it("a token written into a marked family some other way is refused on its first use, and revoked", async () => {
    const s = setup();
    const t = await pair(s);
    const row = s.tables.oauth_tokens.find((r) => r.token_hash === hashSecret(t.access_token))!;
    const family = row.family_id as string;
    s.tables.oauth_revoked_families = [{ family_id: family, revoked_at: s.clock.now.toISOString() }];
    expect(await verifyAccessToken(s.db, t.access_token, { resource: RESOURCE }, { now: () => s.clock.now })).toEqual({ ok: false, reason: "revoked" });
    expect(live(s, family)).toEqual([]);
    const s2 = setup();
    const t2 = await pair(s2);
    const family2 = s2.tables.oauth_tokens.find((r) => r.token_hash === hashSecret(t2.refresh_token))!.family_id as string;
    s2.tables.oauth_revoked_families = [{ family_id: family2, revoked_at: s2.clock.now.toISOString() }];
    const r = await exchange(s2, { grant_type: "refresh_token", refresh_token: t2.refresh_token, client_id: t2.clientId });
    expect(r.body).toMatchObject({ error: "invalid_grant", error_description: "That refresh token was revoked." });
  });

  it("a revoke that can't be written is logged by the family's id, never a token", async () => {
    const s = setup();
    const t = await pair(s);
    const family = s.tables.oauth_tokens.find((r) => r.token_hash === hashSecret(t.refresh_token))!.family_id as string;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    s.failNext("oauth_revoked_families");
    expect(await revokeFamily(s.db, family, { now: () => s.clock.now })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const said = String(warn.mock.calls[0][0]);
    expect(said).toContain(family);
    expect(said).not.toContain(t.refresh_token);
    expect(said).not.toContain(t.access_token);
    warn.mockRestore();
    // The rows were still revoked.
    expect(live(s, family)).toEqual([]);
  });

  it("the database refuses a new token in a revoked family (press-tour-07-mcp-oauth.sql's guard)", () => {
    const sql = readFileSync(join(__dirname, "..", "..", "..", "..", "supabase", "applied", "2026-09-26", "press-tour-07-mcp-oauth.sql"), "utf8");
    const guard = sql.slice(sql.indexOf("create or replace function public.oauth_tokens_guard()"), sql.indexOf("create or replace function public.mcp_ui_nonces_guard()"));
    const insertBranch = guard.slice(guard.indexOf("if tg_op = 'INSERT' then"), guard.indexOf("return new;"));
    expect(insertBranch).toContain("from public.oauth_revoked_families f where f.family_id = new.family_id");
    expect(insertBranch).toMatch(/t\.family_id = new\.family_id and t\.revoked_at is not null/);
    expect(sql).toMatch(/create table if not exists public\.oauth_revoked_families/);
    expect(sql).toContain("alter table public.oauth_revoked_families enable row level security;");
    expect(sql).toContain("revoke all on public.oauth_revoked_families from public, anon, authenticated;");
    expect(sql).not.toMatch(/create policy[^;]*oauth_revoked_families/i);
  });
});

describe("SEC-1: nothing is kept for good", () => {
  const DAY = 24 * 3600_000;

  it("a day after they expire, pending authorizations, codes, tokens and card codes go; marks after 32 days; fresh rows stay", async () => {
    const now = new Date("2026-10-30T04:45:00.000Z");
    const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
    const calls: Record<string, unknown>[] = [];
    const f = fakeDb(
      {
        oauth_pending_authorizations: [
          { id: "p-old", expires_at: at(-EXPIRED_KEEP_MS - 60_000) },
          { id: "p-recent", expires_at: at(-3600_000) },
          { id: "p-open", expires_at: at(10 * 60_000) },
        ],
        oauth_codes: [
          { code_hash: "c-old", expires_at: at(-2 * DAY) },
          { code_hash: "c-new", expires_at: at(5 * 60_000) },
        ],
        oauth_tokens: [
          { token_hash: "t-old", expires_at: at(-2 * DAY), revoked_at: at(-20 * DAY) },
          { token_hash: "t-spent", expires_at: at(-DAY - 1), used_at: at(-31 * DAY) },
          { token_hash: "t-live", expires_at: at(29 * DAY) },
        ],
        mcp_ui_nonces: [
          { nonce_hash: "n-old", expires_at: at(-2 * DAY) },
          { nonce_hash: "n-new", expires_at: at(60_000) },
        ],
        oauth_revoked_families: [
          { family_id: "f-old", revoked_at: at(-REVOKED_FAMILY_KEEP_MS - 60_000) },
          { family_id: "f-new", revoked_at: at(-20 * DAY) },
        ],
      },
      {
        rpc: {
          prune_oauth_clients: (args) => {
            calls.push(args);
            return { data: 3, error: null };
          },
        },
      },
    );
    const report = await pruneOAuthRecords(f.db, { now: () => now });
    const ids = (t: string, k: string) => (f.tables[t] as Row[]).map((r) => r[k]);
    expect(ids("oauth_pending_authorizations", "id")).toEqual(["p-recent", "p-open"]);
    expect(ids("oauth_codes", "code_hash")).toEqual(["c-new"]);
    expect(ids("oauth_tokens", "token_hash")).toEqual(["t-live"]);
    expect(ids("mcp_ui_nonces", "nonce_hash")).toEqual(["n-new"]);
    expect(ids("oauth_revoked_families", "family_id")).toEqual(["f-new"]);
    // Apps: one statement in the database, for apps unused 30 days.
    expect(calls).toEqual([{ p_before: new Date(now.getTime() - UNUSED_CLIENT_KEEP_MS).toISOString(), p_limit: CLIENT_PRUNE_LIMIT }]);
    expect(report).toMatchObject({ clients: 3, errors: [] });
    // A family's mark outlives any token written into it.
    expect(REVOKED_FAMILY_KEEP_MS).toBeGreaterThan(30 * DAY);
  });

  it("one table's error is reported and the others still run", async () => {
    const now = new Date("2026-10-30T04:45:00.000Z");
    const f = fakeDb({ oauth_codes: [{ code_hash: "c-old", expires_at: "2026-10-01T00:00:00.000Z" }] });
    f.failNext("oauth_pending_authorizations");
    const report = await pruneOAuthRecords(f.db, { now: () => now });
    expect(report.errors).toEqual(expect.arrayContaining([expect.stringContaining("oauth_pending_authorizations"), expect.stringContaining("oauth_clients")]));
    expect(f.tables.oauth_codes).toEqual([]);
  });

  it("the app prune keeps any app with a connection, one being authorized, or one disabled by hand, in the same statement", () => {
    const sql = readFileSync(join(__dirname, "..", "..", "..", "..", "supabase", "applied", "2026-09-26", "press-tour-07-mcp-oauth.sql"), "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function public.prune_oauth_clients"), sql.indexOf("$function$;", sql.indexOf("create or replace function public.prune_oauth_clients")));
    expect(fn).toContain("security invoker");
    expect(fn).not.toMatch(/security definer/i);
    expect(fn).toContain("x.disabled_at is null");
    expect(fn).toContain("not exists (select 1 from public.oauth_grants g where g.client_id = x.client_id)");
    expect(fn).toMatch(/not exists \(\s*select 1 from public\.oauth_pending_authorizations p\s*where p\.client_id = x\.client_id and p\.expires_at > now\(\)/);
    expect(fn).toContain("x.updated_at < p_before");
    expect(sql).toContain("revoke all on function public.prune_oauth_clients(timestamptz, integer) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.prune_oauth_clients(timestamptz, integer) to service_role;");
    // The daily prune calls it.
    const route = readFileSync(join(__dirname, "..", "..", "..", "app", "api", "cron", "prune", "route.ts"), "utf8");
    expect(route).toContain("pruneOAuthRecords(admin)");
  });

  it("a registered app's use is stamped (at most daily), so an app in use is never 'unused'", async () => {
    const s = setup();
    const client = await register(s.deps);
    const row = s.tables.oauth_clients.find((c) => c.client_id === client.client_id)!;
    expect(row.updated_at).toBe(s.clock.now.toISOString());
    s.clock.now = new Date(s.clock.now.getTime() + 40 * DAY);
    await handleAuthorize({ params: authorizeParams(client.client_id), ip: "1.2.3.4" }, s.deps);
    expect(row.updated_at).toBe(s.clock.now.toISOString());
  });

  it("rate limits count an IPv6 /64 as one address (an IPv4-mapped address as its IPv4)", async () => {
    expect(rateBucket("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(rateBucket("2001:0db8:0001:0002:ffff:0001:0002:0003")).toBe("2001:db8:1:2::/64");
    expect(rateBucket("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(rateBucket("[2001:db8:1:2::9]")).toBe("2001:db8:1:2::/64");
    expect(rateBucket("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(rateBucket("1.2.3.4")).toBe("1.2.3.4");
    expect(rateBucket("not an address")).toBe("not an address");
    expect(rateBucket(null)).toBeNull();

    const s = setup();
    const keys: string[] = [];
    s.deps.rateLimited = async (key) => {
      keys.push(key);
      return false;
    };
    for (const ip of ["2001:db8:1:2::1", "2001:db8:1:2:ffff:ffff:ffff:fffe"]) {
      await handleAuthorize({ params: authorizeParams("pmcp_c_nobody"), ip }, s.deps);
      await handleRegister({ body: { redirect_uris: [CLAUDE] }, ip }, s.deps);
      await handleToken({ form: { grant_type: "refresh_token" }, ip }, s.deps);
    }
    expect(new Set(keys)).toEqual(new Set(["oauth-authorize:2001:db8:1:2::/64", "oauth-register:2001:db8:1:2::/64", "oauth-token:2001:db8:1:2::/64"]));
  });
});

describe("customer copy", () => {
  it("no machinery words, nothing sold", () => {
    for (const text of OAUTH_MESSAGES) {
      expect(text).not.toMatch(/\b(oauth|token|scope|client|server|pkce)\b/i);
      expect(text).not.toMatch(/upgrade|pricing|\$\d|plan\b|checkout|subscribe/i);
      expect(text).not.toMatch(/\blocked\b/i);
    }
  });

  it("the test-only database is imported by no app code", () => {
    const src = join(__dirname, "..", "..", "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.endsWith("fake-db.ts")) {
          if (/from ["'][^"']*fake-db["']/.test(readFileSync(p, "utf8"))) offenders.push(p);
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
