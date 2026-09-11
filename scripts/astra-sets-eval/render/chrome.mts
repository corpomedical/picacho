// Headless Chrome over the DevTools protocol, for the snapshot page. The
// flags are the working harness's (swiftshader WebGL, a fresh temporary
// profile) plus a network lockdown: every host but 127.0.0.1 resolves to
// nothing and every request that is not loopback goes to a dead proxy, and
// Chrome's own background traffic (updates, metrics, safe browsing, sync)
// is switched off. The runner talks to Chrome through the net guard: the
// debugging port is registered as the only other loopback port it may open.
//
// One navigation per set, so every set gets a fresh WebGL context; page
// exceptions and console errors are captured per set; 60 s per set. The
// temporary profile is deleted when the session closes.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NetGuard } from "../lib/net-guard.mts";
import { HarnessError, sleep } from "../lib/util.mts";

export const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const LOCKDOWN = [
  "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
  "--proxy-server=http://127.0.0.1:9",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-extensions",
  "--disable-domain-reliability",
  "--disable-client-side-phishing-detection",
  "--safebrowsing-disable-auto-update",
  "--metrics-recording-only",
  "--no-default-browser-check",
  "--no-first-run",
  "--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication,CertificateTransparencyComponentUpdater",
];

export type Pose = { poseId: string; position: [number, number, number]; target: [number, number, number]; fovDeg: number; figure: boolean };
export type Frame = { poseId: string; jpeg: string | null; controlsWouldMove: boolean };
export type RenderResult = {
  lift: { fill: number; exposure: number };
  lifted: boolean;
  frames: Frame[];
  errors: string[];
  ms: number;
  meshCount: number;
};

export type ChromeSession = {
  renderSet(url: string, key: string, mark: { x: number; z: number; facingDeg: number } | null, poses: Pose[]): Promise<RenderResult>;
  close(): Promise<void>;
};

type Pending = { resolve: (m: Record<string, unknown>) => void; timer: ReturnType<typeof setTimeout> };

export async function startChrome(o: { chromePath: string; net: NetGuard }): Promise<ChromeSession> {
  if (!existsSync(o.chromePath)) throw new HarnessError(`Chrome not found at ${o.chromePath} (pass --chrome <path>)`);
  const profile = mkdtempSync(join(tmpdir(), "astra-eval-chrome-"));
  const child: ChildProcess = spawn(
    o.chromePath,
    [
      "--headless=new",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--window-size=1100,1100",
      ...LOCKDOWN,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const cleanup = () => {
    try {
      child.kill();
    } catch {
      // already gone
    }
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // a locked file in a temp dir is not worth failing a run over
    }
  };

  let port = 0;
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 150 && !port; i++) {
    if (existsSync(portFile)) port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
    if (!port) await sleep(100);
  }
  if (!port) {
    cleanup();
    throw new HarnessError("Chrome did not open its debugging port within 15 s");
  }
  o.net.registerLoopbackPort(port);

  let pageWs = "";
  for (let i = 0; i < 50 && !pageWs; i++) {
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type?: string; webSocketDebuggerUrl?: string }[];
      pageWs = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
    } catch {
      // not ready yet
    }
    if (!pageWs) await sleep(100);
  }
  if (!pageWs) {
    cleanup();
    throw new HarnessError("Chrome has no page target");
  }

  const ws = new WebSocket(pageWs);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new HarnessError("DevTools WebSocket failed to open")));
  });
  let id = 0;
  const pending = new Map<number, Pending>();
  let pageErrors: string[] = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data)) as { id?: number; method?: string; params?: Record<string, unknown> };
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id) as Pending;
      clearTimeout(p.timer);
      pending.delete(m.id);
      p.resolve(m as Record<string, unknown>);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = (m.params?.exceptionDetails ?? {}) as { exception?: { description?: string }; text?: string };
      pageErrors.push(String(d.exception?.description ?? d.text ?? "exception").slice(0, 300));
    } else if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") {
      const args = (m.params.args ?? []) as { value?: unknown; description?: string }[];
      pageErrors.push(args.map((a) => String(a.value ?? a.description ?? "")).join(" ").slice(0, 300));
    }
  });
  const send = (method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const i = ++id;
      const timer = setTimeout(() => {
        pending.delete(i);
        reject(new HarnessError(`DevTools ${method} timed out`));
      }, timeoutMs);
      pending.set(i, { resolve, timer });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression: string, timeoutMs = 30_000): Promise<unknown> => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    const result = (r.result ?? {}) as { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } };
    if (result.exceptionDetails) throw new Error(String(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "evaluation failed").slice(0, 300));
    return result.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");

  return {
    async renderSet(url, key, mark, poses) {
      pageErrors = [];
      await send("Page.navigate", { url });
      let ready = false;
      for (let i = 0; i < 300 && !ready; i++) {
        await sleep(100);
        try {
          ready = (await evaluate("window.pageReady === true", 5_000)) === true;
        } catch {
          // the page is mid-navigation
        }
      }
      if (!ready) throw new HarnessError(`snapshot page did not load (${pageErrors.join("; ") || "no error reported"})`);
      const value = (await evaluate(`window.renderSet(${JSON.stringify(key)}, ${JSON.stringify(mark)}, ${JSON.stringify(poses)})`, 60_000)) as
        | (RenderResult & { error?: string })
        | null;
      if (!value || value.error) throw new Error(value?.error ?? "renderSet returned nothing");
      return { ...value, errors: [...(value.errors ?? []), ...pageErrors] };
    },
    async close() {
      for (const p of pending.values()) clearTimeout(p.timer);
      try {
        ws.close();
      } catch {
        // closing anyway
      }
      o.net.unregisterLoopbackPort(port);
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill();
        setTimeout(resolve, 3000);
      });
      cleanup();
    },
  };
}
