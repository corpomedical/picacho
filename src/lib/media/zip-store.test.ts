import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, zipStore, zipStoreStream } from "./zip-store";

describe("crc32", () => {
  it("matches the reference value for the canonical check string", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("is zero for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("zipStore", () => {
  const entries = [
    { name: "z0-base.png", bytes: new TextEncoder().encode("not really a png") },
    { name: "z1-woman.png", bytes: new Uint8Array([1, 2, 3, 4, 5]) },
  ];

  it("writes the three ZIP structures in order with the right signatures", () => {
    const z = zipStore(entries);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(2); // entries
  });

  it("is deterministic — same contents, same bytes", () => {
    expect(Buffer.from(zipStore(entries)).equals(Buffer.from(zipStore(entries)))).toBe(true);
  });

  it("round-trips through the system unzip, when one is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "zipstore-"));
    const path = join(dir, "layers.zip");
    writeFileSync(path, zipStore(entries));
    let unzip: string | null = null;
    for (const candidate of ["/usr/bin/unzip", "/usr/local/bin/unzip"]) if (existsSync(candidate)) unzip = candidate;
    if (!unzip) return; // CI without unzip: the structural test above still ran
    execFileSync(unzip, ["-q", "-o", path, "-d", dir]);
    expect(readFileSync(join(dir, "z0-base.png"), "utf8")).toBe("not really a png");
    expect([...readFileSync(join(dir, "z1-woman.png"))]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("zipStoreStream", () => {
  const entries = [
    { name: "z00-base.png", bytes: new TextEncoder().encode("streamed base") },
    { name: "z01-cup.png", bytes: new Uint8Array(70_000).fill(7) },
  ];
  async function collect(): Promise<Buffer> {
    const reader = zipStoreStream(entries).getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    return Buffer.concat(parts);
  }
  it("uses data descriptors and ends with a central directory", async () => {
    const z = await collect();
    const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
    expect(v.getUint16(6, true) & 0x0008).toBe(0x0008);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
  });
  it("round-trips through the system unzip, when one is present", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zipstream-"));
    const path = join(dir, "stream.zip");
    writeFileSync(path, await collect());
    let unzip: string | null = null;
    for (const c of ["/usr/bin/unzip", "/usr/local/bin/unzip"]) if (existsSync(c)) unzip = c;
    if (!unzip) return;
    execFileSync(unzip, ["-q", "-o", path, "-d", dir]);
    expect(readFileSync(join(dir, "z00-base.png"), "utf8")).toBe("streamed base");
    expect(readFileSync(join(dir, "z01-cup.png")).length).toBe(70_000);
  });
});
