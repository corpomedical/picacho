import net from "node:net";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  MAX_BYTES,
  PAGE_UNREADABLE,
  SAFE_FETCH_USER_AGENT,
  SVG_LOGO_REFUSED,
  SafeFetchError,
  customerMessageFor,
  decodeText,
  httpsTransport,
  isPublicAddress,
  pinnedLookup,
  resolvePinned,
  safeFetch,
  sniffImageType,
  vetUrl,
  type Resolver,
  type SafeFetchErrorCode,
  type Transport,
  type TransportRequest,
} from "./safe-fetch";

// No real network anywhere in this file: DNS is a table, and the "fetch
// function" is a fake transport that records what it was asked to connect
// to. The one socket test (the pin) talks to a server on 127.0.0.1 that this
// file opens itself.

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function fakeResolver(table: Record<string, string[] | (() => string[])>) {
  const calls: string[] = [];
  const resolve: Resolver = async (hostname) => {
    calls.push(hostname);
    const entry = table[hostname];
    if (!entry) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    const list = typeof entry === "function" ? entry() : entry;
    return list.map((address) => ({ address, family: net.isIP(address) }));
  };
  return { resolve, calls };
}

interface Reply {
  status?: number;
  headers?: Record<string, string | string[]>;
  body?: Buffer | string | Array<Buffer | string> | (() => AsyncIterable<Uint8Array | string>);
}

function fakeTransport(routes: Record<string, Reply | ((req: TransportRequest) => Reply)>) {
  const calls: TransportRequest[] = [];
  let destroyed = 0;
  let bodyReads = 0;
  const transport: Transport = async (req) => {
    calls.push(req);
    const route = routes[req.url.href];
    if (!route) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const reply = typeof route === "function" ? route(req) : route;
    const body = reply.body ?? "";
    const iterable: AsyncIterable<Uint8Array | string> =
      typeof body === "function"
        ? body()
        : (async function* () {
            bodyReads++;
            const parts = Array.isArray(body) ? body : [body];
            for (const part of parts) yield part;
          })();
    return {
      status: reply.status ?? 200,
      headers: reply.headers ?? {},
      body: iterable,
      destroy: () => {
        destroyed++;
      },
    };
  };
  return {
    transport,
    calls,
    get destroyed() {
      return destroyed;
    },
    get bodyReads() {
      return bodyReads;
    },
  };
}

async function codeOf(p: Promise<unknown>): Promise<SafeFetchErrorCode | "resolved"> {
  try {
    await p;
    return "resolved";
  } catch (err) {
    if (err instanceof SafeFetchError) return err.code;
    throw err;
  }
}

const HTML = { "content-type": "text/html; charset=utf-8" };
const shopDns = () => fakeResolver({ "shop.example.com": ["93.184.216.34"], "cdn.example.net": ["151.101.1.1"] });

describe("isPublicAddress", () => {
  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.1",
    "127.8.9.10",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
  ])("refuses IPv4 %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.255.255", "100.128.0.1", "192.169.0.1", "11.0.0.1"])(
    "allows public IPv4 %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
    ["::ffff:7f00:1", "IPv4-mapped loopback, hex"],
    ["::ffff:10.0.0.1", "IPv4-mapped private"],
    ["::ffff:8.8.8.8", "IPv4-mapped, even of a public address"],
    ["0:0:0:0:0:ffff:a9fe:a9fe", "IPv4-mapped metadata, long form"],
    ["::127.0.0.1", "IPv4-compatible"],
    ["::a9fe:a9fe", "IPv4-compatible metadata"],
    ["64:ff9b::7f00:1", "NAT64 of loopback"],
    ["64:ff9b::a9fe:a9fe", "NAT64 of metadata"],
    ["64:ff9b::808:808", "NAT64, even of a public address"],
    ["64:ff9b:1::1", "NAT64 local-use"],
    ["2002:7f00:1::1", "6to4 of loopback"],
    ["2002:a9fe:a9fe::1", "6to4 of metadata"],
    ["2002:808:808::1", "6to4, even of a public address"],
    ["2001::1", "Teredo"],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "Teredo, real shape"],
    ["2001:db8::1", "documentation"],
    ["3fff::1", "documentation (RFC 9637)"],
    ["fc00::1", "ULA"],
    ["fd12:3456::1", "ULA"],
    ["fe80::1", "link-local"],
    ["fe80::1%en0", "scoped link-local"],
    ["fec0::1", "site-local"],
    ["ff02::1", "multicast"],
    ["100::1", "discard"],
  ])("refuses IPv6 %s (%s)", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "2001:4860:4860::8888", "2620:fe::fe"])(
    "allows global IPv6 %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each(["", "localhost", "nope", "1.2.3", "999.1.1.1", "::g", "8.8.8.8 ", " 8.8.8.8"])(
    "refuses anything that is not an address: %j",
    (address) => {
      expect(isPublicAddress(address)).toBe(false);
    },
  );
});

describe("vetUrl", () => {
  it("keeps an https URL and drops its fragment", () => {
    expect(vetUrl("https://shop.example.com/p/mug?variant=2#reviews").href).toBe("https://shop.example.com/p/mug?variant=2");
  });

  it("upgrades http to https on port 443 (documented choice: upgrade, not refuse)", () => {
    expect(vetUrl("http://shop.example.com/p").href).toBe("https://shop.example.com/p");
    expect(vetUrl("http://shop.example.com:80/p").href).toBe("https://shop.example.com/p");
    expect(vetUrl("HTTP://Shop.Example.COM/p").href).toBe("https://shop.example.com/p");
  });

  it("allows an explicit :443 and refuses every other port", () => {
    expect(vetUrl("https://shop.example.com:443/p").href).toBe("https://shop.example.com/p");
    expect(() => vetUrl("https://shop.example.com:8443/p")).toThrow(expect.objectContaining({ code: "port_not_allowed" }));
    expect(() => vetUrl("http://shop.example.com:8080/p")).toThrow(expect.objectContaining({ code: "port_not_allowed" }));
    expect(() => vetUrl("https://shop.example.com:22/")).toThrow(expect.objectContaining({ code: "port_not_allowed" }));
  });

  it.each(["file:///etc/passwd", "ftp://shop.example.com/x", "data:text/html,hi", "javascript:alert(1)", "gopher://shop.example.com/", "ws://shop.example.com/"])(
    "refuses the scheme of %s",
    (url) => {
      expect(() => vetUrl(url)).toThrow(expect.objectContaining({ code: "scheme_not_allowed" }));
    },
  );

  it("refuses credentials in the URL", () => {
    expect(() => vetUrl("https://user:pass@shop.example.com/")).toThrow(expect.objectContaining({ code: "credentials_in_url" }));
    expect(() => vetUrl("https://user@shop.example.com/")).toThrow(expect.objectContaining({ code: "credentials_in_url" }));
  });

  it.each([
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://0x7f.1/",
    "https://127.1/",
    "https://8.8.8.8/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[2606:4700:4700::1111]/",
    "https://localhost/",
    "https://LOCALHOST./",
    "https://app.localhost/",
    "https://printer.local/",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://router.home.arpa/",
    "https://1.0.0.127.in-addr.arpa/",
    "https://intranet/",
    "https://nas.lan/",
  ])("refuses the host of %s", (url) => {
    expect(() => vetUrl(url)).toThrow(expect.objectContaining({ code: "host_not_allowed" }));
  });

  it("refuses junk", () => {
    expect(() => vetUrl("not a url")).toThrow(expect.objectContaining({ code: "invalid_url" }));
    expect(() => vetUrl("")).toThrow(expect.objectContaining({ code: "invalid_url" }));
    expect(() => vetUrl(`https://shop.example.com/${"a".repeat(2100)}`)).toThrow(expect.objectContaining({ code: "invalid_url" }));
  });
});

describe("resolvePinned", () => {
  it("refuses when ANY answer is private, even behind a public one", async () => {
    const { resolve } = fakeResolver({ "mixed.example.com": ["93.184.216.34", "10.0.0.5"] });
    expect(await codeOf(resolvePinned("mixed.example.com", resolve))).toBe("address_blocked");
  });

  it("prefers IPv4 and reports the family from the address itself", async () => {
    const resolve: Resolver = async () => [
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "93.184.216.34", family: 6 /* a lying resolver */ },
    ];
    expect(await resolvePinned("dual.example.com", resolve)).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("pins IPv6 when that is all there is", async () => {
    const resolve: Resolver = async () => [{ address: "2606:4700:4700::1111", family: 6 }];
    expect(await resolvePinned("v6.example.com", resolve)).toEqual({ address: "2606:4700:4700::1111", family: 6 });
  });

  it("turns resolver failures and empty answers into dns_failed", async () => {
    expect(await codeOf(resolvePinned("gone.example.com", fakeResolver({}).resolve))).toBe("dns_failed");
    expect(await codeOf(resolvePinned("empty.example.com", async () => []))).toBe("dns_failed");
  });
});

describe("safeFetch: the happy path", () => {
  it("fetches an HTML page, pinned to the vetted address, with only our own headers", async () => {
    const dns = shopDns();
    const fake = fakeTransport({
      "https://shop.example.com/p/mug": { headers: HTML, body: ["<html><title>Mug", "</title></html>"] },
    });
    const res = await safeFetch("http://shop.example.com/p/mug#top", { kind: "html", resolve: dns.resolve, transport: fake.transport });
    expect(res.url).toBe("https://shop.example.com/p/mug");
    expect(res.text).toBe("<html><title>Mug</title></html>");
    expect(res.contentType).toBe("text/html");
    expect(res.address).toBe("93.184.216.34");
    expect(res.redirects).toEqual([]);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call.address).toBe("93.184.216.34");
    expect(call.family).toBe(4);
    expect(call.port).toBe(443);
    expect(call.url.protocol).toBe("https:");
    expect(call.headers["user-agent"]).toBe(SAFE_FETCH_USER_AGENT);
    const names = Object.keys(call.headers).map((h) => h.toLowerCase());
    expect(names).not.toContain("cookie");
    expect(names).not.toContain("authorization");
    expect(names).not.toContain("referer");
  });

  it("fetches JSON (an MCP client document) under a lowered cap", async () => {
    const fake = fakeTransport({
      "https://shop.example.com/client.json": { headers: { "content-type": "application/json" }, body: '{"client_id":"x"}' },
    });
    const res = await safeFetch("https://shop.example.com/client.json", {
      kind: "json",
      maxBytes: 5 * 1024,
      resolve: shopDns().resolve,
      transport: fake.transport,
    });
    expect(JSON.parse(res.text ?? "")).toEqual({ client_id: "x" });
  });

  it("fetches an image, typed by its bytes, not its header", async () => {
    const png = Buffer.concat([PNG_MAGIC, Buffer.alloc(100)]);
    const fake = fakeTransport({
      "https://cdn.example.net/a.png": { headers: { "content-type": "application/octet-stream" }, body: png },
      "https://cdn.example.net/b": { headers: { "content-type": "text/plain" }, body: Buffer.concat([JPEG_MAGIC, Buffer.alloc(50)]) },
    });
    const a = await safeFetch("https://cdn.example.net/a.png", { kind: "image", resolve: shopDns().resolve, transport: fake.transport });
    expect(a.contentType).toBe("image/png");
    expect(a.text).toBeNull();
    expect(a.body.equals(png)).toBe(true);
    const b = await safeFetch("https://cdn.example.net/b", { kind: "image", resolve: shopDns().resolve, transport: fake.transport });
    expect(b.contentType).toBe("image/jpeg");
  });

  it("decodes gzip, deflate (both shapes) and brotli", async () => {
    const page = "<html><body>" + "ceramic mug ".repeat(200) + "</body></html>";
    const fake = fakeTransport({
      "https://shop.example.com/gz": { headers: { ...HTML, "content-encoding": "gzip" }, body: zlib.gzipSync(page) },
      "https://shop.example.com/df": { headers: { ...HTML, "content-encoding": "deflate" }, body: zlib.deflateSync(page) },
      "https://shop.example.com/raw": { headers: { ...HTML, "content-encoding": "deflate" }, body: zlib.deflateRawSync(page) },
      "https://shop.example.com/br": { headers: { ...HTML, "content-encoding": "br" }, body: zlib.brotliCompressSync(page) },
    });
    for (const path of ["gz", "df", "raw", "br"]) {
      const res = await safeFetch(`https://shop.example.com/${path}`, { kind: "html", resolve: shopDns().resolve, transport: fake.transport });
      expect(res.text).toBe(page);
    }
  });
});

describe("safeFetch: DNS and rebinding", () => {
  it("never calls the transport when the name resolves to a private address", async () => {
    const dns = fakeResolver({ "evil.example.com": ["169.254.169.254"] });
    const fake = fakeTransport({});
    expect(await codeOf(safeFetch("https://evil.example.com/", { kind: "html", resolve: dns.resolve, transport: fake.transport }))).toBe(
      "address_blocked",
    );
    expect(fake.calls).toHaveLength(0);
  });

  it.each(["::1", "::ffff:127.0.0.1", "64:ff9b::a9fe:a9fe", "2002:a00:1::1", "fd00::1"])(
    "refuses a name whose AAAA is %s",
    async (address) => {
      const dns = fakeResolver({ "v6.example.com": [address] });
      const fake = fakeTransport({});
      expect(await codeOf(safeFetch("https://v6.example.com/", { kind: "html", resolve: dns.resolve, transport: fake.transport }))).toBe(
        "address_blocked",
      );
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("connects to the address it checked, even if DNS changes its answer afterwards (rebinding)", async () => {
    let lookups = 0;
    const dns = fakeResolver({
      "rebind.example.com": () => (++lookups === 1 ? ["93.184.216.34"] : ["127.0.0.1"]),
    });
    const fake = fakeTransport({ "https://rebind.example.com/": { headers: HTML, body: "<html></html>" } });
    const res = await safeFetch("https://rebind.example.com/", { kind: "html", resolve: dns.resolve, transport: fake.transport });
    expect(res.address).toBe("93.184.216.34");
    expect(dns.calls).toEqual(["rebind.example.com"]); // resolved once, and that answer is the one connected to
    expect(fake.calls[0].address).toBe("93.184.216.34");
  });

  it("re-resolves and re-checks on a redirect back to the same host (rebinding across hops)", async () => {
    let lookups = 0;
    const dns = fakeResolver({
      "rebind.example.com": () => (++lookups === 1 ? ["93.184.216.34"] : ["10.0.0.7"]),
    });
    const fake = fakeTransport({
      "https://rebind.example.com/": { status: 302, headers: { location: "/again" } },
      "https://rebind.example.com/again": { headers: HTML, body: "<html>internal</html>" },
    });
    expect(await codeOf(safeFetch("https://rebind.example.com/", { kind: "html", resolve: dns.resolve, transport: fake.transport }))).toBe(
      "address_blocked",
    );
    expect(dns.calls).toEqual(["rebind.example.com", "rebind.example.com"]);
    expect(fake.calls).toHaveLength(1);
  });

  it("turns a name that does not resolve into dns_failed", async () => {
    expect(
      await codeOf(safeFetch("https://nowhere.example.com/", { kind: "html", resolve: fakeResolver({}).resolve, transport: fakeTransport({}).transport })),
    ).toBe("dns_failed");
  });
});

describe("safeFetch: redirects", () => {
  const chain = (n: number) => {
    const routes: Record<string, Reply> = {};
    for (let i = 0; i < n; i++) routes[`https://shop.example.com/r${i}`] = { status: 301, headers: { location: `/r${i + 1}` } };
    routes[`https://shop.example.com/r${n}`] = { headers: HTML, body: "<html>end</html>" };
    return routes;
  };

  it("follows three redirects, re-vetting each hop", async () => {
    const dns = shopDns();
    const fake = fakeTransport(chain(3));
    const res = await safeFetch("https://shop.example.com/r0", { kind: "html", resolve: dns.resolve, transport: fake.transport });
    expect(res.text).toBe("<html>end</html>");
    expect(res.redirects).toEqual(["https://shop.example.com/r1", "https://shop.example.com/r2", "https://shop.example.com/r3"]);
    expect(dns.calls).toHaveLength(4);
    expect(fake.destroyed).toBeGreaterThanOrEqual(3); // every redirect response released
  });

  it("refuses a fourth", async () => {
    const fake = fakeTransport(chain(4));
    expect(await codeOf(safeFetch("https://shop.example.com/r0", { kind: "html", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
      "too_many_redirects",
    );
    expect(fake.calls).toHaveLength(4);
  });

  it("honours a lower maxRedirects, including none", async () => {
    expect(
      await codeOf(safeFetch("https://shop.example.com/r0", { kind: "html", maxRedirects: 0, resolve: shopDns().resolve, transport: fakeTransport(chain(1)).transport })),
    ).toBe("too_many_redirects");
  });

  it("upgrades an http:// Location instead of downgrading", async () => {
    const fake = fakeTransport({
      "https://shop.example.com/a": { status: 302, headers: { location: "http://cdn.example.net/b" } },
      "https://cdn.example.net/b": { headers: HTML, body: "<html>b</html>" },
    });
    const res = await safeFetch("https://shop.example.com/a", { kind: "html", resolve: shopDns().resolve, transport: fake.transport });
    expect(res.url).toBe("https://cdn.example.net/b");
    expect(fake.calls.map((c) => c.url.protocol)).toEqual(["https:", "https:"]);
  });

  it.each([
    ["https://internal.example.com/x", "address_blocked"],
    ["https://169.254.169.254/latest/meta-data/", "host_not_allowed"],
    ["https://localhost/admin", "host_not_allowed"],
    ["file:///etc/passwd", "scheme_not_allowed"],
    ["https://shop.example.com:8443/x", "port_not_allowed"],
    ["https://admin:hunter2@shop.example.com/x", "credentials_in_url"],
  ] as const)("refuses a redirect to %s", async (location, code) => {
    const dns = fakeResolver({ "shop.example.com": ["93.184.216.34"], "internal.example.com": ["192.168.0.10"] });
    const fake = fakeTransport({ "https://shop.example.com/go": { status: 307, headers: { location } } });
    expect(await codeOf(safeFetch("https://shop.example.com/go", { kind: "html", resolve: dns.resolve, transport: fake.transport }))).toBe(code);
    expect(fake.calls).toHaveLength(1);
  });

  it("refuses a redirect without a Location", async () => {
    const fake = fakeTransport({ "https://shop.example.com/go": { status: 302 } });
    expect(await codeOf(safeFetch("https://shop.example.com/go", { kind: "html", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
      "bad_redirect",
    );
  });

  it("never sends a cookie a redirect tried to set", async () => {
    const fake = fakeTransport({
      "https://shop.example.com/login": {
        status: 302,
        headers: { location: "/p", "set-cookie": ["session=abc; Path=/", "cart=1"], "www-authenticate": "Basic" },
      },
      "https://shop.example.com/p": { headers: HTML, body: "<html></html>" },
    });
    await safeFetch("https://shop.example.com/login", { kind: "html", resolve: shopDns().resolve, transport: fake.transport });
    for (const call of fake.calls) {
      const names = Object.keys(call.headers).map((h) => h.toLowerCase());
      expect(names).not.toContain("cookie");
      expect(names).not.toContain("authorization");
    }
    expect(fake.calls[1].headers).toEqual(fake.calls[0].headers);
  });
});

describe("safeFetch: what comes back", () => {
  it("refuses a non-2xx status and says which", async () => {
    const fake = fakeTransport({ "https://shop.example.com/p": { status: 403, headers: HTML, body: "denied" } });
    try {
      await safeFetch("https://shop.example.com/p", { kind: "html", resolve: shopDns().resolve, transport: fake.transport });
      throw new Error("resolved");
    } catch (err) {
      expect(err).toBeInstanceOf(SafeFetchError);
      expect((err as SafeFetchError).code).toBe("http_status");
      expect((err as SafeFetchError).status).toBe(403);
    }
  });

  it("refuses the wrong content type for a page", async () => {
    const fake = fakeTransport({
      "https://shop.example.com/doc": { headers: { "content-type": "application/pdf" }, body: "%PDF-1.7" },
      "https://shop.example.com/js": { headers: { "content-type": "application/javascript" }, body: "alert(1)" },
    });
    for (const path of ["doc", "js"]) {
      expect(await codeOf(safeFetch(`https://shop.example.com/${path}`, { kind: "html", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
        "content_type_not_allowed",
      );
    }
  });

  it("accepts a page without a content type only when it plainly is one", async () => {
    const fake = fakeTransport({
      "https://shop.example.com/ok": { body: "  <!doctype html><html></html>" },
      "https://shop.example.com/bin": { body: Buffer.from([0x00, 0x01, 0x02]) },
    });
    const ok = await safeFetch("https://shop.example.com/ok", { kind: "html", resolve: shopDns().resolve, transport: fake.transport });
    expect(ok.contentType).toBe("text/html");
    expect(await codeOf(safeFetch("https://shop.example.com/bin", { kind: "html", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
      "content_type_not_allowed",
    );
  });

  it("refuses a declared length over the cap without reading the body", async () => {
    const fake = fakeTransport({
      "https://shop.example.com/big": { headers: { ...HTML, "content-length": String(MAX_BYTES.html + 1) }, body: "<html></html>" },
    });
    expect(await codeOf(safeFetch("https://shop.example.com/big", { kind: "html", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
      "too_large",
    );
    expect(fake.bodyReads).toBe(0);
  });

  it("cuts a streamed body at the cap, whatever the header claims", async () => {
    let yielded = 0;
    const fake = fakeTransport({
      "https://shop.example.com/stream": {
        headers: { ...HTML, "content-length": "100" },
        body: async function* () {
          for (let i = 0; i < 1000; i++) {
            yielded++;
            yield Buffer.alloc(64 * 1024, 0x61);
          }
        },
      },
    });
    expect(await codeOf(safeFetch("https://shop.example.com/stream", { kind: "html", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
      "too_large",
    );
    expect(yielded).toBeLessThan(40); // stopped at ~2 MB, not 64 MB
  });

  it("caps DECODED bytes: a gzip bomb stops at the cap (critique #33)", async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(MAX_BYTES.html * 4, 0x20));
    expect(bomb.length).toBeLessThan(64 * 1024);
    const brBomb = zlib.brotliCompressSync(Buffer.alloc(MAX_BYTES.html * 4, 0x20));
    const deflateBomb = zlib.deflateSync(Buffer.alloc(MAX_BYTES.html * 4, 0x20));
    const fake = fakeTransport({
      "https://shop.example.com/gz": { headers: { ...HTML, "content-encoding": "gzip" }, body: bomb },
      "https://shop.example.com/br": { headers: { ...HTML, "content-encoding": "br" }, body: brBomb },
      "https://shop.example.com/df": { headers: { ...HTML, "content-encoding": "deflate" }, body: deflateBomb },
    });
    for (const path of ["gz", "br", "df"]) {
      expect(await codeOf(safeFetch(`https://shop.example.com/${path}`, { kind: "html", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
        "too_large",
      );
    }
  });

  it("clamps maxBytes down to the kind's cap and honours a smaller one", async () => {
    const body = "{" + '"a":1,'.repeat(2000) + '"z":0}';
    const fake = fakeTransport({ "https://shop.example.com/c.json": { headers: { "content-type": "application/json" }, body } });
    expect(
      await codeOf(safeFetch("https://shop.example.com/c.json", { kind: "json", maxBytes: 5 * 1024, resolve: shopDns().resolve, transport: fake.transport })),
    ).toBe("too_large");
    const big = fakeTransport({
      "https://shop.example.com/huge": { headers: HTML, body: Buffer.alloc(MAX_BYTES.html + 10, 0x61) },
    });
    expect(
      await codeOf(safeFetch("https://shop.example.com/huge", { kind: "html", maxBytes: 50 * 1024 * 1024, resolve: shopDns().resolve, transport: big.transport })),
    ).toBe("too_large");
  });

  it("allows a 12 MB-class image but not a bigger one", async () => {
    const okImage = Buffer.concat([JPEG_MAGIC, Buffer.alloc(MAX_BYTES.image - JPEG_MAGIC.length)]);
    const fake = fakeTransport({
      "https://cdn.example.net/ok.jpg": { headers: { "content-type": "image/jpeg" }, body: okImage },
      "https://cdn.example.net/big.jpg": { headers: { "content-type": "image/jpeg" }, body: [okImage, Buffer.alloc(1)] },
    });
    const ok = await safeFetch("https://cdn.example.net/ok.jpg", { kind: "image", resolve: shopDns().resolve, transport: fake.transport });
    expect(ok.body.length).toBe(MAX_BYTES.image);
    expect(await codeOf(safeFetch("https://cdn.example.net/big.jpg", { kind: "image", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
      "too_large",
    );
  });

  it("refuses an unknown or corrupt content-encoding", async () => {
    const fake = fakeTransport({
      "https://shop.example.com/zstd": { headers: { ...HTML, "content-encoding": "zstd" }, body: "xx" },
      "https://shop.example.com/two": { headers: { ...HTML, "content-encoding": "gzip, br" }, body: "xx" },
      "https://shop.example.com/bad": { headers: { ...HTML, "content-encoding": "gzip" }, body: "definitely not gzip" },
    });
    for (const path of ["zstd", "two", "bad"]) {
      expect(await codeOf(safeFetch(`https://shop.example.com/${path}`, { kind: "html", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
        "bad_encoding",
      );
    }
  });
});

describe("safeFetch: images and SVG", () => {
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: a drawing app, with a long comment ' + "x".repeat(200) + " -->\n<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>";

  it("refuses SVG by header before reading the body", async () => {
    const fake = fakeTransport({ "https://cdn.example.net/logo.svg": { headers: { "content-type": "image/svg+xml" }, body: svg } });
    expect(await codeOf(safeFetch("https://cdn.example.net/logo.svg", { kind: "image", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
      "svg_refused",
    );
    expect(fake.bodyReads).toBe(0);
  });

  it("refuses SVG by bytes whatever the header claims", async () => {
    const fake = fakeTransport({
      "https://cdn.example.net/logo.png": { headers: { "content-type": "image/png" }, body: svg },
      "https://cdn.example.net/gz": { headers: { "content-type": "image/png", "content-encoding": "gzip" }, body: zlib.gzipSync(svg) },
    });
    for (const path of ["logo.png", "gz"]) {
      expect(await codeOf(safeFetch(`https://cdn.example.net/${path}`, { kind: "image", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
        "svg_refused",
      );
    }
    expect(customerMessageFor("svg_refused")).toBe(SVG_LOGO_REFUSED);
    expect(SVG_LOGO_REFUSED).toBe("Upload your logo as a PNG");
  });

  it("refuses an HTML page served for a picture as not a picture (even with inline SVG icons)", async () => {
    const page = "<!doctype html><html><body><svg><path/></svg>Not found</body></html>";
    const fake = fakeTransport({ "https://cdn.example.net/x.jpg": { headers: { "content-type": "image/jpeg" }, body: page } });
    expect(await codeOf(safeFetch("https://cdn.example.net/x.jpg", { kind: "image", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
      "not_an_image",
    );
  });

  it("stops reading a big non-picture after its first bytes", async () => {
    let yielded = 0;
    const fake = fakeTransport({
      "https://cdn.example.net/fake.jpg": {
        headers: { "content-type": "image/jpeg" },
        body: async function* () {
          for (let i = 0; i < 1000; i++) {
            yielded++;
            yield Buffer.alloc(8 * 1024, 0x41);
          }
        },
      },
    });
    expect(await codeOf(safeFetch("https://cdn.example.net/fake.jpg", { kind: "image", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
      "not_an_image",
    );
    expect(yielded).toBeLessThan(5);
  });

  it("refuses GIF and HEIC as formats we do not take", async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.from([0, 0, 0, 0]), Buffer.from("mif1heic"), Buffer.alloc(40)]);
    const fake = fakeTransport({
      "https://cdn.example.net/a.gif": { headers: { "content-type": "image/gif" }, body: Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(40)]) },
      "https://cdn.example.net/a.heic": { headers: { "content-type": "image/heic" }, body: heic },
    });
    for (const path of ["a.gif", "a.heic"]) {
      expect(await codeOf(safeFetch(`https://cdn.example.net/${path}`, { kind: "image", resolve: shopDns().resolve, transport: fake.transport }))).toBe(
        "content_type_not_allowed",
      );
    }
  });
});

describe("safeFetch: time", () => {
  it("gives up when the transport never answers", async () => {
    const transport: Transport = () => new Promise(() => {});
    const started = Date.now();
    expect(await codeOf(safeFetch("https://shop.example.com/", { kind: "html", timeoutMs: 60, resolve: shopDns().resolve, transport }))).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("gives up when DNS never answers", async () => {
    const resolve: Resolver = () => new Promise(() => {});
    expect(await codeOf(safeFetch("https://shop.example.com/", { kind: "html", timeoutMs: 60, resolve, transport: fakeTransport({}).transport }))).toBe(
      "timeout",
    );
  });

  it("gives up on a body that trickles forever, and releases the connection", async () => {
    const fake = fakeTransport({
      "https://shop.example.com/slow": {
        headers: HTML,
        body: async function* () {
          yield "<html>";
          await new Promise(() => {});
        },
      },
    });
    expect(await codeOf(safeFetch("https://shop.example.com/slow", { kind: "html", timeoutMs: 60, resolve: shopDns().resolve, transport: fake.transport }))).toBe(
      "timeout",
    );
    expect(fake.destroyed).toBe(1);
  });

  it("stops when the caller's signal fires", async () => {
    const controller = new AbortController();
    const transport: Transport = () => new Promise(() => {});
    const pending = safeFetch("https://shop.example.com/", { kind: "html", signal: controller.signal, resolve: shopDns().resolve, transport });
    setTimeout(() => controller.abort(), 20);
    expect(await codeOf(pending)).toBe("aborted");
  });

  it("passes the connect budget to the transport, never above the total", async () => {
    const fake = fakeTransport({ "https://shop.example.com/": { headers: HTML, body: "<html></html>" } });
    await safeFetch("https://shop.example.com/", { kind: "html", timeoutMs: 500, connectTimeoutMs: 9_000, resolve: shopDns().resolve, transport: fake.transport });
    expect(fake.calls[0].connectTimeoutMs).toBe(500);
    await safeFetch("https://shop.example.com/", { kind: "html", resolve: shopDns().resolve, transport: fake.transport });
    expect(fake.calls[1].connectTimeoutMs).toBe(3_000);
  });

  it("maps a transport failure to connect_failed and a certificate failure to tls_failed", async () => {
    const refused: Transport = async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    };
    const cert: Transport = async () => {
      throw Object.assign(new Error("Hostname/IP does not match certificate's altnames"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    };
    expect(await codeOf(safeFetch("https://shop.example.com/", { kind: "html", resolve: shopDns().resolve, transport: refused }))).toBe("connect_failed");
    expect(await codeOf(safeFetch("https://shop.example.com/", { kind: "html", resolve: shopDns().resolve, transport: cert }))).toBe("tls_failed");
  });
});

describe("decodeText", () => {
  it("honours the header charset, then <meta charset>, then UTF-8", () => {
    const latin = Buffer.from([0x43, 0x61, 0x66, 0xe9]); // "Café" in windows-1252
    expect(decodeText(latin, "text/html; charset=windows-1252")).toBe("Café");
    const withMeta = Buffer.concat([Buffer.from('<meta charset="iso-8859-1"><p>'), latin]);
    expect(decodeText(withMeta, "text/html")).toBe('<meta charset="iso-8859-1"><p>Café');
    expect(decodeText(Buffer.from("Café ☕", "utf8"), null)).toBe("Café ☕");
    expect(decodeText(Buffer.from("x", "utf8"), "text/html; charset=made-up")).toBe("x");
  });
});

describe("sniffImageType", () => {
  it("reads the magic bytes", () => {
    expect(sniffImageType(Buffer.concat([JPEG_MAGIC, Buffer.alloc(8)]))).toBe("image/jpeg");
    expect(sniffImageType(Buffer.concat([PNG_MAGIC, Buffer.alloc(8)]))).toBe("image/png");
    expect(sniffImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("image/webp");
    const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from("ftypavif"), Buffer.alloc(4), Buffer.from("avifmif1miaf"), Buffer.alloc(4)]);
    expect(sniffImageType(avif)).toBe("image/avif");
    expect(sniffImageType(Buffer.from("\ufeff  <svg viewBox='0 0 1 1'/>"))).toBe("image/svg+xml");
    expect(sniffImageType(Buffer.from("hello"))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe("customerMessageFor", () => {
  it("says the page could not be read for everything but SVG", () => {
    expect(customerMessageFor("address_blocked")).toBe(PAGE_UNREADABLE);
    expect(customerMessageFor("timeout")).toBe(PAGE_UNREADABLE);
    expect(PAGE_UNREADABLE).toBe("We couldn't read that page. Add photos instead.");
  });
});

describe("pinnedLookup", () => {
  it("answers with the pinned address in both callback shapes", async () => {
    const lookup = pinnedLookup("93.184.216.34", 4) as unknown as (
      host: string,
      options: object,
      cb: (err: unknown, address: unknown, family?: number) => void,
    ) => void;
    const single = await new Promise<[unknown, number | undefined]>((resolve) => lookup("anything.example", {}, (_e, a, f) => resolve([a, f])));
    expect(single).toEqual(["93.184.216.34", 4]);
    const all = await new Promise<unknown>((resolve) => lookup("anything.example", { all: true }, (_e, a) => resolve(a)));
    expect(all).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
});

describe("httpsTransport: the pin at the socket", () => {
  // A plain TCP server on loopback stands in for "wherever the pin points".
  // shop.invalid cannot resolve anywhere (RFC 6761), so a connection arriving
  // here can only have come from the pinned address; the ClientHello it sends
  // carries the hostname as SNI, so certificate checks still use the name.
  async function listen(onConnection: (socket: net.Socket) => void) {
    const server = net.createServer(onConnection);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    return { server, port };
  }

  it("connects to the pinned address and sends the hostname as SNI", async () => {
    let hello = Buffer.alloc(0);
    const { server, port } = await listen((socket) => {
      socket.on("data", (chunk: Buffer) => {
        hello = Buffer.concat([hello, chunk]);
        socket.destroy();
      });
    });
    try {
      const controller = new AbortController();
      const outcome = await httpsTransport({
        url: new URL("https://shop.invalid/p?x=1"),
        address: "127.0.0.1",
        family: 4,
        port,
        headers: { "user-agent": SAFE_FETCH_USER_AGENT },
        signal: controller.signal,
        connectTimeoutMs: 2_000,
      }).then(
        () => "resolved",
        (err: unknown) => (err instanceof SafeFetchError ? err.code : "other"),
      );
      expect(["connect_failed", "tls_failed"]).toContain(outcome);
      expect(hello.length).toBeGreaterThan(0);
      expect(hello[0]).toBe(0x16); // a TLS handshake record: it spoke TLS, not plain HTTP
      expect(hello.includes(Buffer.from("shop.invalid"))).toBe(true);
    } finally {
      server.close();
    }
  });

  it("times out a connection that never finishes the TLS handshake", async () => {
    const sockets: net.Socket[] = [];
    const { server, port } = await listen((socket) => {
      sockets.push(socket); // accept, then say nothing
    });
    try {
      const started = Date.now();
      const outcome = await httpsTransport({
        url: new URL("https://shop.invalid/"),
        address: "127.0.0.1",
        family: 4,
        port,
        headers: {},
        signal: new AbortController().signal,
        connectTimeoutMs: 150,
      }).then(
        () => "resolved",
        (err: unknown) => (err instanceof SafeFetchError ? err.code : "other"),
      );
      expect(outcome).toBe("timeout");
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
    }
  });
});
