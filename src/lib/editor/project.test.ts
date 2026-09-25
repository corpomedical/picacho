import { beforeEach, describe, expect, it, vi } from "vitest";
import { footageIndex, previewCsp, projectDir, projectToken, readProjectToken, readTar, safeProjectPath } from "./project";

/** A minimal ustar writer for the tests: one 512-byte header per entry, data padded to 512. */
function tar(entries: { name: string; data?: string; type?: string; prefix?: string }[]): Uint8Array {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? "");
    const h = Buffer.alloc(512);
    h.write(e.name.slice(0, 100), 0, "utf8");
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    h.write(e.type ?? "0", 156, "ascii");
    h.write("ustar\0", 257, "ascii");
    if (e.prefix) h.write(e.prefix, 345, "utf8");
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return new Uint8Array(Buffer.concat(blocks));
}

beforeEach(() => {
  vi.stubEnv("MEDIA_SIGNING_SECRET", "test-secret");
});

describe("the packed project", () => {
  it("reads the regular files of a tar, skipping folders and links, honouring long names", () => {
    const files = readTar(
      tar([
        { name: "./", type: "5" },
        { name: "./index.html", data: "<html></html>" },
        { name: "./assets/sfx/hit.wav", data: "RIFF" },
        { name: "./footage", type: "2" },
        { name: "././@LongLink", type: "L", data: `./assets/${"y".repeat(110)}.png` },
        { name: "truncated-name", data: "long" },
        { name: "b.css", prefix: "styles", data: "a{}" },
      ]),
    );
    expect(files.map((f) => f.path)).toEqual(["index.html", "assets/sfx/hit.wav", `assets/${"y".repeat(110)}.png`, "styles/b.css"]);
    expect(Buffer.from(files[0].data).toString()).toBe("<html></html>");
  });

  it("drops names that climb out, and refuses a cut-short archive", () => {
    const files = readTar(tar([{ name: "../../etc/passwd", data: "x" }, { name: "/abs.html", data: "y" }, { name: "ok.html", data: "z" }]));
    expect(files.map((f) => f.path)).toEqual(["abs.html", "ok.html"]);
    const whole = tar([{ name: "a.mp4", data: "0123456789".repeat(100) }]);
    expect(() => readTar(whole.subarray(0, 700))).toThrow("cut short");
  });

  it("cleans paths and finds the footage links", () => {
    expect(safeProjectPath("./compositions/intro.html")).toBe("compositions/intro.html");
    expect(safeProjectPath("a/../b")).toBeNull();
    expect(safeProjectPath("a\\b")).toBeNull();
    expect(safeProjectPath("")).toBeNull();
    expect(footageIndex("footage/clip-3.mp4")).toBe(3);
    expect(footageIndex("footage/clip-3.mp4/../x")).toBeNull();
    expect(footageIndex("assets/clip-3.mp4")).toBeNull();
    expect(projectDir("u1", "e1", "g1")).toBe("u1/e1/projects/g1");
  });
});

describe("the preview token", () => {
  const edit = "11111111-1111-4111-8111-111111111111";
  const gen = "22222222-2222-4222-8222-222222222222";

  it("opens one edit's one video until it expires, and nothing when touched", () => {
    const now = Date.UTC(2026, 8, 25, 12);
    const token = projectToken(edit, gen, now);
    expect(readProjectToken(token, now + 60_000)).toEqual({ editId: edit, generationId: gen });
    expect(readProjectToken(token, now + 7 * 3600_000)).toBeNull();
    const [e, g, exp, sig] = token.split(".");
    expect(readProjectToken([e, "33333333-3333-4333-8333-333333333333", exp, sig].join("."), now)).toBeNull();
    expect(readProjectToken([e, g, String(Number(exp) + 999), sig].join("."), now)).toBeNull();
    expect(readProjectToken("nonsense", now)).toBeNull();
  });

  it("gives the preview its own narrow policy: framed only by us, no forms, media from our storage", () => {
    const csp = previewCsp("https://abc.supabase.co");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("media-src 'self' blob: https://abc.supabase.co");
    expect(csp).toContain("form-action 'none'");
  });
});
