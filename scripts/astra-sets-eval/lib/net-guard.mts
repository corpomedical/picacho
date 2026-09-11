// The eval runner's network allowlist, installed before any product module
// is imported. Every product call goes through globalThis.fetch (a grep of
// src/lib finds no node:http, https, undici or SDK client), so wrapping fetch
// — and WebSocket, for the Chrome DevTools connection — is the whole fence.
//
//   live      https to api.openai.com, api.anthropic.com, fal.run,
//             queue.fal.run, fal.media and *.fal.media — only in a --spend run.
//             fal.media is download-only (GET/HEAD); POST /v1/files (the one
//             upload, the Batch input) only from the batch module's context.
//   loopback  127.0.0.1 / localhost on the ports the runner registered: its
//             own page server and Chrome's debugging port. Nothing else.
//   local     https://eval.invalid/<key>, served from memory; and
//             GET https://api.openai.com/v1/responses/<id> for a response the
//             batch module stored, so the product's own pollAstraJob can
//             interpret a Batch line without a network call.
//   data:     passes through (Node decodes it; no network).
//   blocked   everything else, *.supabase.co and *.supabase.in included. The
//             error names the host; the guard keeps a list for the summary.
//
// A dry run is "offline": live hosts are blocked too.
//
// THE TAP. JSON answers from OpenAI and Anthropic are cloned and their
// {model, usage} handed to onMeter — except inside a "settled" context (a
// call whose cost the spend guard reserves and settles itself), so no cost
// is counted twice. The prompt sent to /v1/images/edits and to fal's edit
// endpoints is handed to onPromptTap, for the pipeline-parity check.

import { AsyncLocalStorage } from "node:async_hooks";

export type NetMode = "live" | "offline";

export const LIVE_HOSTS = ["api.openai.com", "api.anthropic.com", "fal.run", "queue.fal.run", "fal.media"] as const;
const LIVE_SUFFIX = ".fal.media";
export const LOCAL_HOST = "eval.invalid";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type UrlVerdict =
  | { verdict: "live"; host: string }
  | { verdict: "loopback"; host: string; port: number }
  | { verdict: "local"; key: string }
  | { verdict: "data" }
  | { verdict: "blocked"; host: string; why: string };

export function classifyUrl(raw: string, o: { mode: NetMode; loopbackPorts: ReadonlySet<number> }): UrlVerdict {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { verdict: "blocked", host: "(unparseable url)", why: "unparseable" };
  }
  if (u.protocol === "data:") return { verdict: "data" };
  if (!["https:", "http:", "ws:", "wss:"].includes(u.protocol)) {
    return { verdict: "blocked", host: u.protocol, why: "scheme not allowed" };
  }
  const host = u.hostname.toLowerCase();
  if (host === LOCAL_HOST) {
    return u.protocol === "https:"
      ? { verdict: "local", key: decodeURIComponent(u.pathname.replace(/^\//, "")) }
      : { verdict: "blocked", host, why: "local routes are https only" };
  }
  if (LOOPBACK.has(host)) {
    const port = Number(u.port || (u.protocol === "https:" || u.protocol === "wss:" ? 443 : 80));
    return o.loopbackPorts.has(port)
      ? { verdict: "loopback", host, port }
      : { verdict: "blocked", host: `${host}:${port}`, why: "loopback port not registered by the runner" };
  }
  const allowed = (LIVE_HOSTS as readonly string[]).includes(host) || host.endsWith(LIVE_SUFFIX);
  if (!allowed) return { verdict: "blocked", host, why: "not on the eval allowlist" };
  if (u.protocol !== "https:") return { verdict: "blocked", host, why: "live hosts are https only" };
  if (o.mode !== "live") return { verdict: "blocked", host, why: "dry run: no live calls" };
  return { verdict: "live", host };
}

export type NetContext = {
  settled?: boolean;
  tag?: string;
  ref?: string;
  /** Filled with the status of the last live call made in this context (-1: no answer). */
  observe?: { status: number | null };
};
export const netContext = new AsyncLocalStorage<NetContext>();

/** Runs fn with ctx merged over the current context. */
export function withNetContext<T>(ctx: NetContext, fn: () => Promise<T>): Promise<T> {
  return netContext.run({ ...(netContext.getStore() ?? {}), ...ctx }, fn);
}

export type MeterRecord = { host: string; model: string; usage: Record<string, unknown>; ctx: NetContext };
export type PromptTap = { url: string; prompt: string; ctx: NetContext };
export type LiveResponse = { host: string; path: string; method: string; status: number; ctx: NetContext };
export type LocalRoute = { body: Uint8Array | string; contentType: string; status?: number };

type FetchFn = typeof fetch;

export class NetGuardBlocked extends TypeError {
  constructor(host: string, why: string) {
    super(`eval net guard blocked ${host}: ${why}`);
    this.name = "NetGuardBlocked";
  }
}

export class NetGuard {
  readonly mode: NetMode;
  readonly loopbackPorts = new Set<number>();
  readonly blocked: { host: string; why: string; at: string }[] = [];
  liveCalls = 0;
  onMeter: ((m: MeterRecord) => void) | null = null;
  onPromptTap: ((t: PromptTap) => void) | null = null;
  onLiveResponse: ((r: LiveResponse) => void) | null = null;
  private readonly realFetch: FetchFn;
  private readonly local = new Map<string, LocalRoute>();
  private readonly responses = new Map<string, unknown>();

  constructor(o: { mode: NetMode; realFetch: FetchFn }) {
    this.mode = o.mode;
    this.realFetch = o.realFetch;
  }

  registerLoopbackPort(port: number): void {
    this.loopbackPorts.add(port);
  }
  unregisterLoopbackPort(port: number): void {
    this.loopbackPorts.delete(port);
  }
  /** Served at https://eval.invalid/<key>. */
  setLocalRoute(key: string, route: LocalRoute): string {
    this.local.set(key, route);
    return `https://${LOCAL_HOST}/${key}`;
  }
  /** Served at GET https://api.openai.com/v1/responses/<id>, in any mode. */
  setOpenAiResponse(id: string, body: unknown): void {
    this.responses.set(id, body);
  }
  deleteOpenAiResponse(id: string): void {
    this.responses.delete(id);
  }

  private block(host: string, why: string): never {
    this.blocked.push({ host, why, at: new Date().toISOString() });
    throw new NetGuardBlocked(host, why);
  }

  check(url: string): UrlVerdict {
    return classifyUrl(url, { mode: this.mode, loopbackPorts: this.loopbackPorts });
  }

  readonly fetch: FetchFn = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    const stored = /^https:\/\/api\.openai\.com\/v1\/responses\/(resp_[A-Za-z0-9]+)$/.exec(url);
    if (stored && method === "GET" && this.responses.has(stored[1])) {
      return new Response(JSON.stringify(this.responses.get(stored[1])), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const v = this.check(url);
    switch (v.verdict) {
      case "data":
      case "loopback":
        return this.realFetch(input, init);
      case "local": {
        const route = this.local.get(v.key);
        if (!route) return new Response("not found", { status: 404 });
        const body = typeof route.body === "string" ? route.body : new Uint8Array(route.body);
        return new Response(body, { status: route.status ?? 200, headers: { "content-type": route.contentType } });
      }
      case "blocked":
        return this.block(v.host, v.why);
      case "live":
        break;
    }

    const ctx = netContext.getStore() ?? {};
    const path = new URL(url).pathname;
    if ((v.host === "fal.media" || v.host.endsWith(LIVE_SUFFIX)) && method !== "GET" && method !== "HEAD") {
      return this.block(v.host, `${method} to a download host (fal.media is download-only)`);
    }
    if (v.host === "api.openai.com" && path.startsWith("/v1/files") && method === "POST" && ctx.tag !== "batch-upload") {
      return this.block(v.host, "file upload outside the Batch input step");
    }

    this.tapPrompt(url, v.host, path, init?.body, ctx);
    this.liveCalls += 1;
    let res: Response;
    try {
      res = await this.realFetch(input, init);
    } catch (err) {
      if (ctx.observe) ctx.observe.status = -1;
      throw err;
    }
    if (ctx.observe) ctx.observe.status = res.status;
    this.onLiveResponse?.({ host: v.host, path, method, status: res.status, ctx });
    if ((v.host === "api.openai.com" || v.host === "api.anthropic.com") && !ctx.settled && this.onMeter) {
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("application/json")) {
        try {
          const body = (await res.clone().json()) as { model?: unknown; usage?: unknown } | null;
          if (body && typeof body === "object" && body.usage && typeof body.usage === "object") {
            this.onMeter({
              host: v.host,
              model: typeof body.model === "string" ? body.model : "(unknown)",
              usage: body.usage as Record<string, unknown>,
              ctx,
            });
          }
        } catch {
          // An unreadable body carries no usage to meter.
        }
      }
    }
    return res;
  };

  private tapPrompt(url: string, host: string, path: string, body: unknown, ctx: NetContext): void {
    if (!this.onPromptTap) return;
    let prompt: unknown = null;
    if (host === "api.openai.com" && path === "/v1/images/edits" && body instanceof FormData) {
      prompt = body.get("prompt");
    } else if ((host === "fal.run" || host === "queue.fal.run") && typeof body === "string") {
      try {
        prompt = (JSON.parse(body) as { prompt?: unknown }).prompt;
      } catch {
        prompt = null;
      }
    }
    if (typeof prompt === "string") this.onPromptTap({ url, prompt, ctx });
  }

  /** A WebSocket class that only opens to a registered loopback port. */
  guardedWebSocket(Real: typeof WebSocket): typeof WebSocket {
    const check = (u: string | URL) => this.check(String(u));
    const block = (host: string, why: string) => this.block(host, why);
    return class GuardedWebSocket extends Real {
      constructor(url: string | URL, protocols?: string | string[]) {
        const v = check(url);
        if (v.verdict !== "loopback") {
          if (v.verdict === "blocked") block(v.host, v.why);
          block(String(url), "WebSocket only to a registered loopback port");
        }
        super(url, protocols);
      }
    };
  }
}

let installed: NetGuard | null = null;

/** Replaces globalThis.fetch and WebSocket for the rest of the process. */
export function installNetGuard(mode: NetMode): NetGuard {
  if (installed) throw new Error("net guard already installed");
  const guard = new NetGuard({ mode, realFetch: globalThis.fetch.bind(globalThis) });
  globalThis.fetch = guard.fetch;
  if (typeof globalThis.WebSocket === "function") globalThis.WebSocket = guard.guardedWebSocket(globalThis.WebSocket);
  installed = guard;
  return guard;
}

export function currentNetGuard(): NetGuard {
  if (!installed) throw new Error("net guard not installed");
  return installed;
}
