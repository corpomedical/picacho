// The snapshot page's files, served from MEMORY on 127.0.0.1 only: the
// product's src/lib/sets/{set-spec,build-scene,exposure,compare}.ts with
// their types stripped (Node's own stripTypeScriptTypes; all four have zero
// runtime imports once stripped), three.js from node_modules,
// snap-page.html, and one /spec/<key>.json per set. Nothing is written to
// disk, so no generated .js ever lands where tsc, ESLint or vitest would
// sweep it up.

import { createServer, type Server } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { SetSpec } from "../../../src/lib/sets/set-spec.ts";
import type { NetGuard } from "../lib/net-guard.mts";
import { EVAL_DIR } from "../lib/util.mts";

type File = { body: string | Buffer; type: string };

export type Stage = {
  port: number;
  pageUrl: string;
  putSpec(key: string, spec: SetSpec): void;
  close(): Promise<void>;
};

/** Node's type stripping, without its one-line "experimental" notice on stderr. */
function strip(src: string): string {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(typeof warning === "string" ? warning : warning.message).includes("stripTypeScriptTypes")) return;
    return (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return stripTypeScriptTypes(src, { mode: "strip" });
  } finally {
    process.emitWarning = emit;
  }
}

export function stageFiles(repoRoot: string): Map<string, File> {
  const files = new Map<string, File>();
  for (const name of ["set-spec", "build-scene", "exposure", "compare"]) {
    const src = readFileSync(join(repoRoot, `src/lib/sets/${name}.ts`), "utf8");
    const js = strip(src).replace(/from\s+"\.\/([\w-]+)"/g, 'from "./$1.js"');
    files.set(`/${name}.js`, { body: js, type: "text/javascript" });
  }
  for (const name of ["three.module.js", "three.core.js"]) {
    files.set(`/${name}`, { body: readFileSync(join(repoRoot, "node_modules/three/build", name)), type: "text/javascript" });
  }
  files.set("/", { body: readFileSync(join(EVAL_DIR, "render/snap-page.html")), type: "text/html; charset=utf-8" });
  return files;
}

export async function startStage(net: NetGuard, repoRoot: string): Promise<Stage> {
  const files = stageFiles(repoRoot);
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const f = files.get(path);
    if (!f || req.method !== "GET") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": f.type, "cache-control": "no-store" });
    res.end(f.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  net.registerLoopbackPort(port);
  return {
    port,
    pageUrl: `http://127.0.0.1:${port}/`,
    putSpec(key, spec) {
      files.set(`/spec/${encodeURIComponent(key)}.json`, { body: JSON.stringify(spec), type: "application/json" });
    },
    close: () =>
      new Promise<void>((resolve) => {
        net.unregisterLoopbackPort(port);
        server.close(() => resolve());
      }),
  };
}
