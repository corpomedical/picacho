import zlib from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Resolver, Transport, TransportRequest } from "./safe-fetch";
import {
  CSS_MAX_BYTES,
  ROBOTS_TTL_MS,
  ROBOTS_UNREACHABLE_TTL_MS,
  clearRobotsCache,
  fetchSiteText,
  parseRobots,
  robotsAllowsPath,
  robotsAllowsUrl,
} from "./site-text";

// robots.txt and one stylesheet, fetched under the safe-fetch rules. No
// real network: DNS and the socket are injected, and every request the
// transport sees is recorded.

const publicDns: Resolver = async () => [{ address: "93.184.216.34", family: 4 }];
const privateDns: Resolver = async () => [{ address: "10.0.0.5", family: 4 }];

type Reply = { status: number; headers?: Record<string, string>; body?: string | Buffer };

function transportOf(replies: Record<string, Reply | ((req: TransportRequest) => Reply)>) {
  const seen: TransportRequest[] = [];
  const transport: Transport = async (req) => {
    seen.push(req);
    const found = replies[req.url.href];
    const reply = typeof found === "function" ? found(req) : found ?? { status: 404, body: "not found" };
    const body = reply.body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(reply.body);
    return {
      status: reply.status,
      headers: reply.headers ?? {},
      body: (async function* () {
        for (let i = 0; i < body.length; i += 1024) yield body.subarray(i, i + 1024);
      })(),
      destroy: () => {},
    };
  };
  return { transport, seen };
}

beforeEach(() => clearRobotsCache());

describe("parseRobots / robotsAllowsPath (RFC 9309)", () => {
  it("our own group wins over *, longest match wins, Allow wins a tie", () => {
    const txt = `
User-agent: *
Disallow: /

User-agent: PicachoBot/1.0
Disallow: /checkout
Allow: /checkout/public
Disallow: /p/secret
Allow: /p/secret
`;
    const rules = parseRobots(txt);
    expect(robotsAllowsPath(rules, "/products/mug")).toBe(true);
    expect(robotsAllowsPath(rules, "/checkout/cart")).toBe(false);
    expect(robotsAllowsPath(rules, "/checkout/public/x")).toBe(true);
    expect(robotsAllowsPath(rules, "/p/secret")).toBe(true);
  });

  it("falls back to *, and with no group at all there are no rules", () => {
    const star = parseRobots("User-agent: *\nDisallow: /private\n");
    expect(robotsAllowsPath(star, "/private/a")).toBe(false);
    expect(robotsAllowsPath(star, "/shop")).toBe(true);
    expect(parseRobots("User-agent: Googlebot\nDisallow: /\n")).toBeNull();
    expect(robotsAllowsPath(null, "/anything")).toBe(true);
  });

  it("consecutive user-agent lines share one group; an empty Disallow allows all", () => {
    const rules = parseRobots("User-agent: foo\nUser-agent: picachobot\nDisallow: /a\n\nUser-agent: bar\nDisallow:\n");
    expect(robotsAllowsPath(rules, "/a/b")).toBe(false);
    expect(robotsAllowsPath(parseRobots("User-agent: *\nDisallow:\n"), "/x")).toBe(true);
  });

  it("* matches any run and $ anchors the end", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?session=\nAllow: /files/*.pdf$\n");
    expect(robotsAllowsPath(rules, "/a/b.pdf")).toBe(false);
    expect(robotsAllowsPath(rules, "/a/b.pdf.pdf")).toBe(false);
    expect(robotsAllowsPath(rules, "/a/b.pdfx")).toBe(true);
    expect(robotsAllowsPath(rules, "/p?session=1")).toBe(false);
    expect(robotsAllowsPath(rules, "/files/x.pdf")).toBe(true);
  });

  it("comments are ignored and robots.txt itself is always allowed", () => {
    const rules = parseRobots("User-agent: * # everyone\nDisallow: / # all\n");
    expect(robotsAllowsPath(rules, "/x")).toBe(false);
    expect(robotsAllowsPath(rules, "/robots.txt")).toBe(true);
  });
});

describe("robotsAllowsUrl", () => {
  it("reads the host's robots.txt once, then answers from the day's copy", async () => {
    const { transport, seen } = transportOf({
      "https://shop.example.com/robots.txt": { status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /admin\n" },
    });
    let now = 1_000_000;
    const deps = { resolve: publicDns, transport, now: () => now };
    expect(await robotsAllowsUrl("https://shop.example.com/p/mug", deps)).toBe(true);
    expect(await robotsAllowsUrl("https://shop.example.com/admin/x", deps)).toBe(false);
    expect(seen).toHaveLength(1);
    now += ROBOTS_TTL_MS + 1;
    await robotsAllowsUrl("https://shop.example.com/p/mug", deps);
    expect(seen).toHaveLength(2);
  });

  it("no robots.txt (4xx) allows; a 5xx or no answer disallows, and is asked again within the hour", async () => {
    const none = transportOf({});
    expect(await robotsAllowsUrl("https://none.example.com/p", { resolve: publicDns, transport: none.transport })).toBe(true);
    let now = 5_000;
    const down = transportOf({ "https://down.example.com/robots.txt": { status: 503 } });
    expect(await robotsAllowsUrl("https://down.example.com/p", { resolve: publicDns, transport: down.transport, now: () => now })).toBe(false);
    now += ROBOTS_UNREACHABLE_TTL_MS + 1;
    await robotsAllowsUrl("https://down.example.com/p", { resolve: publicDns, transport: down.transport, now: () => now });
    expect(down.seen).toHaveLength(2);
    const failing: Transport = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await robotsAllowsUrl("https://gone.example.com/p", { resolve: publicDns, transport: failing })).toBe(false);
  });

  it("a URL safe-fetch would refuse is refused here without a request", async () => {
    const { transport, seen } = transportOf({});
    for (const url of ["ftp://shop.example.com/", "https://127.0.0.1/", "https://shop.example.com:8443/", "https://localhost/p"]) {
      expect(await robotsAllowsUrl(url, { resolve: publicDns, transport })).toBe(false);
    }
    expect(seen).toHaveLength(0);
  });
});

describe("fetchSiteText", () => {
  it("never connects to a private address, even for robots.txt", async () => {
    const { transport, seen } = transportOf({});
    const out = await fetchSiteText("https://evil.example.com/robots.txt", "robots", { resolve: privateDns, transport });
    expect(out).toMatchObject({ ok: false, unreachable: true, code: "address_blocked" });
    expect(seen).toHaveLength(0);
  });

  it("pins the socket to the vetted address, sends no cookies or referer, and upgrades http", async () => {
    const { transport, seen } = transportOf({ "https://brand.example.com/a.css": { status: 200, headers: { "content-type": "text/css" }, body: ":root{--brand:#ff0000}" } });
    const out = await fetchSiteText("http://brand.example.com/a.css", "css", { resolve: publicDns, transport });
    expect(out).toMatchObject({ ok: true, text: ":root{--brand:#ff0000}" });
    expect(seen[0].address).toBe("93.184.216.34");
    expect(seen[0].port).toBe(443);
    expect(Object.keys(seen[0].headers).map((k) => k.toLowerCase())).not.toEqual(expect.arrayContaining(["cookie", "referer", "authorization"]));
  });

  it("re-vets every redirect hop, and stops after 3", async () => {
    const hop = transportOf({
      "https://a.example.com/s.css": { status: 302, headers: { location: "https://b.example.com/s.css" } },
      "https://b.example.com/s.css": { status: 200, headers: { "content-type": "text/css" }, body: "x{}" },
    });
    expect(await fetchSiteText("https://a.example.com/s.css", "css", { resolve: publicDns, transport: hop.transport })).toMatchObject({ ok: true });
    const toInternal = transportOf({ "https://a.example.com/s.css": { status: 302, headers: { location: "https://localhost/s.css" } } });
    expect(await fetchSiteText("https://a.example.com/s.css", "css", { resolve: publicDns, transport: toInternal.transport })).toMatchObject({
      ok: false,
      unreachable: true,
      code: "host_not_allowed",
    });
    const loop = transportOf({ "https://a.example.com/s.css": { status: 301, headers: { location: "/s.css" } } });
    expect(await fetchSiteText("https://a.example.com/s.css", "css", { resolve: publicDns, transport: loop.transport })).toMatchObject({
      ok: false,
      code: "too_many_redirects",
    });
    expect(loop.seen).toHaveLength(4);
  });

  it("reads a stylesheet up to 200 KB, inflates gzip under the cap, and refuses what is not CSS", async () => {
    const huge = `:root{--a:#123456}${"x".repeat(CSS_MAX_BYTES * 2)}`;
    const big = transportOf({ "https://c.example.com/s.css": { status: 200, headers: { "content-type": "text/css" }, body: huge } });
    const out = await fetchSiteText("https://c.example.com/s.css", "css", { resolve: publicDns, transport: big.transport });
    expect(out.ok && out.text.length).toBe(CSS_MAX_BYTES);
    const zipped = transportOf({
      "https://c.example.com/z.css": { status: 200, headers: { "content-type": "text/css", "content-encoding": "gzip" }, body: zlib.gzipSync(":root{--b:#abcdef}") },
    });
    expect(await fetchSiteText("https://c.example.com/z.css", "css", { resolve: publicDns, transport: zipped.transport })).toMatchObject({
      ok: true,
      text: ":root{--b:#abcdef}",
    });
    const html = transportOf({ "https://c.example.com/h.css": { status: 200, headers: { "content-type": "text/html" }, body: "<html>" } });
    expect(await fetchSiteText("https://c.example.com/h.css", "css", { resolve: publicDns, transport: html.transport })).toMatchObject({ ok: false });
  });

  it("gives up at the time limit", async () => {
    vi.useFakeTimers();
    try {
      const stuck: Transport = (req) =>
        new Promise((_, reject) => req.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      const pending = fetchSiteText("https://slow.example.com/robots.txt", "robots", { resolve: publicDns, transport: stuck, timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(60);
      expect(await pending).toMatchObject({ ok: false, unreachable: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
